// Signing in through another account (S28, S30): where the browser is sent
// to ask Google, GitHub, Facebook or WeChat, and what the relay reads back
// once that account says yes — the code traded for a token, the token for
// who the person is there. Each account's app (its id and secret) is the
// operator's, given to the relay; the requests out go through the shell's
// own `fetch`, so the tests answer them. Nothing here keeps anything: the
// relay decides who the person is (avatars.ts).
import { maskAddress, type SsoKind } from "../core/avatar/address.js";

/** One account's app on the operator's side: its id and its secret. */
export interface SsoApp { id: string; secret: string }
/** The apps the operator set up, by account. */
export type SsoApps = Partial<Record<SsoKind, SsoApp>>;
/** Who the person is on that account: its stable id, what it shows of them, the email it gives and whether it checked it. */
export interface Identity { kind: SsoKind; sub: string; shown: string; email?: string; emailVerified: boolean }
/** A request out, as the adapters use it: `fetch`, or a test's stand-in. */
export type Fetcher = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const form = (o: Record<string, string>): string => new URLSearchParams(o).toString();
const query = (base: string, o: Record<string, string>): string => `${base}?${form(o)}`;
const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : typeof v === "number" ? String(v) : undefined);

/** One request out, its JSON back; anything else is `sso.failed`. */
async function ask(fetch: Fetcher, url: string, init?: Parameters<Fetcher>[1]): Promise<unknown> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`sso.failed: ${r.status} from ${new URL(url).host}`);
  try { return JSON.parse(await r.text()); } catch { throw new Error(`sso.failed: no JSON from ${new URL(url).host}`); }
}

/** Where the browser goes to ask the account: the app, where it comes back to, and the state it carries back. */
export function authorizeUrl(kind: SsoKind, app: SsoApp, state: string, redirect: string): string {
  switch (kind) {
    case "google": return query("https://accounts.google.com/o/oauth2/v2/auth", { client_id: app.id, redirect_uri: redirect, response_type: "code", scope: "openid email profile", state, prompt: "select_account" });
    case "github": return query("https://github.com/login/oauth/authorize", { client_id: app.id, redirect_uri: redirect, scope: "read:user user:email", state });
    case "facebook": return query("https://www.facebook.com/v19.0/dialog/oauth", { client_id: app.id, redirect_uri: redirect, response_type: "code", scope: "email,public_profile", state });
    // WeChat's website login is a QR code the phone scans; its fragment is part of the address it asks for.
    case "wechat": return `${query("https://open.weixin.qq.com/connect/qrconnect", { appid: app.id, redirect_uri: redirect, response_type: "code", scope: "snsapi_login", state })}#wechat_redirect`;
  }
}

/** The code the account sent back traded for who the person is there; a refusal anywhere throws. */
export async function identityOf(kind: SsoKind, app: SsoApp, code: string, redirect: string, fetch: Fetcher): Promise<Identity> {
  switch (kind) {
    case "google": {
      const t = obj(await ask(fetch, "https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: form({ code, client_id: app.id, client_secret: app.secret, redirect_uri: redirect, grant_type: "authorization_code" }) }));
      const u = obj(await ask(fetch, "https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${str(t["access_token"]) ?? ""}` } }));
      const sub = str(u["sub"]), email = str(u["email"])?.toLowerCase();
      if (sub === undefined) throw new Error("sso.failed: Google gave no id");
      return { kind, sub, shown: email !== undefined ? maskAddress({ kind: "email", value: email }) : str(u["name"]) ?? "", ...(email !== undefined ? { email } : {}), emailVerified: u["email_verified"] === true };
    }
    case "github": {
      const t = obj(await ask(fetch, "https://github.com/login/oauth/access_token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: form({ client_id: app.id, client_secret: app.secret, code, redirect_uri: redirect }) }));
      const headers = { authorization: `Bearer ${str(t["access_token"]) ?? ""}`, accept: "application/vnd.github+json", "user-agent": "GemsBang" };
      const u = obj(await ask(fetch, "https://api.github.com/user", { headers }));
      const sub = str(u["id"]), login = str(u["login"]);
      if (sub === undefined) throw new Error("sso.failed: GitHub gave no id");
      // The primary address, when GitHub checked it: a private one is only in this list.
      const emails = await ask(fetch, "https://api.github.com/user/emails", { headers }).catch(() => []);
      const primary = (Array.isArray(emails) ? emails : []).map(obj).find((e) => e["primary"] === true);
      const email = str(primary?.["email"])?.toLowerCase();
      return { kind, sub, shown: login !== undefined ? `@${login}` : "", ...(email !== undefined ? { email } : {}), emailVerified: email !== undefined && primary?.["verified"] === true };
    }
    case "facebook": {
      const t = obj(await ask(fetch, query("https://graph.facebook.com/v19.0/oauth/access_token", { client_id: app.id, client_secret: app.secret, redirect_uri: redirect, code })));
      const u = obj(await ask(fetch, query("https://graph.facebook.com/me", { fields: "id,name,email", access_token: str(t["access_token"]) ?? "" })));
      const sub = str(u["id"]), email = str(u["email"])?.toLowerCase();
      if (sub === undefined) throw new Error("sso.failed: Facebook gave no id");
      // Facebook does not say it checked the address, so it never joins an account by it (Q19).
      return { kind, sub, shown: str(u["name"]) ?? "", ...(email !== undefined ? { email } : {}), emailVerified: false };
    }
    case "wechat": {
      const t = obj(await ask(fetch, query("https://api.weixin.qq.com/sns/oauth2/access_token", { appid: app.id, secret: app.secret, code, grant_type: "authorization_code" })));
      if (t["errcode"] !== undefined) throw new Error(`sso.failed: WeChat ${String(t["errcode"])}`);
      const u = obj(await ask(fetch, query("https://api.weixin.qq.com/sns/userinfo", { access_token: str(t["access_token"]) ?? "", openid: str(t["openid"]) ?? "" })));
      // One person across the operator's WeChat apps is the unionid; without it, the openid of this app.
      const sub = str(u["unionid"]) ?? str(t["unionid"]) ?? str(t["openid"]);
      if (sub === undefined) throw new Error("sso.failed: WeChat gave no id");
      return { kind, sub, shown: str(u["nickname"]) ?? "", emailVerified: false };
    }
  }
}
