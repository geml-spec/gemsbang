// A group's link, or an avatar's own (S37), as the person and their agent meet it (spec §6.1, §6.3):
// the line to paste to someone else's agent, and the links a person pasted
// into their own conversation — an agent follows an invitation only when its
// person pasted it there, from a relay the person trusts (§5 rule 5). Pure.
import { LINK_CODE } from "./links.js";
import { say, type Lang } from "./words.js";

/** Which a link is: a group's (`/i/`), or an avatar's own, which starts a two-person chat (`/u/`). */
export type InviteKind = "group" | "person";
/** A link's origin, code and kind, from `/i/<code>`, `/u/<code>` or either with `.md`, any query dropped; undefined for anything else. */
export function parseInvite(text: string): { origin: string; code: string; md: boolean; kind: InviteKind } | undefined {
  let u: URL;
  try { u = new URL(text.trim()); } catch { return undefined; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
  const m = /^\/([iu])\/([^/.]+)(\.md)?$/.exec(u.pathname);
  if (m === null || !LINK_CODE.test(m[2]!)) return undefined;
  return { origin: u.origin, code: m[2]!, md: m[3] !== undefined, kind: m[1] === "u" ? "person" : "group" };
}

/** A link's address for an agent, as `invitesIn` keeps it: `<origin>/i/<code>.md` or `<origin>/u/<code>.md`. */
export const inviteMd = (p: { origin: string; code: string; kind: InviteKind }): string => `${p.origin}/${p.kind === "person" ? "u" : "i"}/${p.code}.md`;

/** The invitations for agents in a text the person typed or pasted, a group's or an avatar's, each once. */
export function invitesIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s"'<>()（）「」，。]+\/[iu]\/[a-z0-9]{8}\.md/g)) {
    const p = parseInvite(m[0]);
    if (p === undefined) continue;
    const url = inviteMd(p);
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

/** The line a person pastes to their own agent: read the instructions and join as me (spec §6.3). */
export const invitePrompt = (origin: string, code: string, group: string, lang: Lang): string => say("panel.invite.line", lang, { url: `${origin}/i/${code}.md`, group });
/** The line for an avatar's own link (S37): read the instructions and start a two-person chat with it. */
export const personInvitePrompt = (origin: string, code: string, name: string, lang: Lang): string => say("panel.invite.dmLine", lang, { url: `${origin}/u/${code}.md`, name });

/** An http(s) origin with no path, as a relay's address is given; undefined when the text is not one. */
export function relayOrigin(text: string): string | undefined {
  let u: URL;
  try { u = new URL(text.trim()); } catch { return undefined; }
  if ((u.protocol !== "https:" && u.protocol !== "http:") || (u.pathname !== "/" && u.pathname !== "") || u.search !== "" || u.hash !== "") return undefined;
  return u.origin;
}
