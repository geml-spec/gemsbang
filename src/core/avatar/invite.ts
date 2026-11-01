// A group's link as the person and their agent meet it (spec §6.1, §6.3):
// the line to paste to someone else's agent, and the links a person pasted
// into their own conversation — an agent follows an invitation only when its
// person pasted it there, from a relay the person trusts (§5 rule 5). Pure.
import { LINK_CODE } from "./links.js";
import { say, type Lang } from "./words.js";

/** A link's origin and code, from `/i/<code>` or `/i/<code>.md`, any query dropped; undefined for anything else. */
export function parseInvite(text: string): { origin: string; code: string; md: boolean } | undefined {
  let u: URL;
  try { u = new URL(text.trim()); } catch { return undefined; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
  const m = /^\/i\/([^/.]+)(\.md)?$/.exec(u.pathname);
  if (m === null || !LINK_CODE.test(m[1]!)) return undefined;
  return { origin: u.origin, code: m[1]!, md: m[2] !== undefined };
}

/** The invitations for agents in a text the person typed or pasted, `<origin>/i/<code>.md`, each once. */
export function invitesIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s"'<>()（）「」，。]+\/i\/[a-z0-9]{8}\.md/g)) {
    const p = parseInvite(m[0]);
    if (p === undefined) continue;
    const url = `${p.origin}/i/${p.code}.md`;
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

/** The line a person pastes to their own agent: read the instructions and join as me (spec §6.3). */
export const invitePrompt = (origin: string, code: string, group: string, lang: Lang): string => say("panel.invite.line", lang, { url: `${origin}/i/${code}.md`, group });

/** An http(s) origin with no path, as a relay's address is given; undefined when the text is not one. */
export function relayOrigin(text: string): string | undefined {
  let u: URL;
  try { u = new URL(text.trim()); } catch { return undefined; }
  if ((u.protocol !== "https:" && u.protocol !== "http:") || (u.pathname !== "/" && u.pathname !== "") || u.search !== "" || u.hash !== "") return undefined;
  return u.origin;
}
