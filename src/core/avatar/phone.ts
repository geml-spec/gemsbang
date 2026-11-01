// Logging in by phone (spec §6.2, transport §2.5): a person is their phone
// number, which the relay keeps only as a salted hash; a six-digit code
// texted to it is the proof, good for ten minutes, three to a number in ten
// minutes and ten to a network in an hour. A mainland number may come
// without its country code. Pure: the rules (the words are words.ts's); the relay keeps
// the codes and sends the text.
import { createHash } from "node:crypto";
import { DEFAULT_LANG, say, type Fault, type Lang } from "./words.js";

export const CODE_RE = /^\d{6}$/;
export const CODE_TTL_MS = 10 * 60_000;
export const CODES_PER_PHONE = 3;
export const CODES_PER_IP_HOUR = 10;
/** Wrong codes a number may send in ten minutes; at that many, every code of the number stops working until ten minutes pass. */
export const CODE_MISSES = 5;

/** The number in E.164, spaces, dashes, dots and brackets dropped; an 11-digit mainland number starting with 1 gets +86; undefined when it is no number. */
export function normalizePhone(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.replace(/[\s\-().]/g, "");
  if (/^1\d{10}$/.test(t)) return `+86${t}`;
  if (/^\+\d{7,15}$/.test(t)) return t;
  return undefined;
}

export const phoneFault = (v: unknown): Fault | undefined => (normalizePhone(v) === undefined ? { code: "phone.required" } : undefined);

/** The number as the relay keeps it: a hash with the relay's salt, never the digits. */
export const hashPhone = (phone: string, salt: string): string => "sha256:" + createHash("sha256").update(`${salt}:${phone}`, "utf8").digest("hex");

/** The last four digits, to say where the code went. */
export const tailOf = (phone: string): string => phone.slice(-4);

/** The text that carries the code, in the language the person asked in. */
export const codeText = (code: string, lang: Lang = DEFAULT_LANG): string => say("code.text", lang, { code });
