// The ways a person signs in (architecture §3.1, §3.2): an address a code is
// sent to — an email, a phone number — each one more way in to the same
// person, and the relay keeps each only as a salted hash. The beta signs in
// by email; a phone number stays a way in. What the person is shown of an
// address is masked: the first letter and the domain of an email, the last
// four digits of a number. Another account — Google, GitHub, Facebook,
// WeChat (S28, S30) — is a way in too, by the id that account gives, kept
// hashed the same way; what is shown of it is what that account shows of
// itself. Pure: the rules (the words are words.ts's); the relay keeps the
// codes and sends them.
import { createHash } from "node:crypto";
import { hashPhone, normalizePhone, tailOf } from "./phone.js";
import { DEFAULT_LANG, say, type Fault, type Lang } from "./words.js";

/** The other accounts a person may sign in with (S28, S30): each gives the relay a stable id for the person. */
export type SsoKind = "google" | "github" | "facebook" | "wechat";
export const SSO_KINDS: readonly SsoKind[] = ["google", "github", "facebook", "wechat"];
export const isSsoKind = (v: unknown): v is SsoKind => typeof v === "string" && (SSO_KINDS as readonly string[]).includes(v);
export type AddressKind = "email" | "phone" | SsoKind;
export interface Address { kind: AddressKind; value: string }
export const EMAIL_MAX = 254;

/** The email trimmed and in lower case; undefined when it is none: one @, a dot in the domain, no spaces, at most 254 characters. */
export function normalizeEmail(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim().toLowerCase();
  return t.length <= EMAIL_MAX && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(t) ? t : undefined;
}

/** The address a body gives: its `email`, else its `phone`; undefined when neither is one. */
export function addressOf(body: Readonly<Record<string, unknown>>): Address | undefined {
  if (body["email"] !== undefined) { const e = normalizeEmail(body["email"]); return e === undefined ? undefined : { kind: "email", value: e }; }
  const p = normalizePhone(body["phone"]);
  return p === undefined ? undefined : { kind: "phone", value: p };
}

/** Why a body gives no address: an email that is none, a number that is none, or nothing. */
export function addressFault(body: Readonly<Record<string, unknown>>): Fault | undefined {
  if (addressOf(body) !== undefined) return undefined;
  if (body["email"] !== undefined) return { code: "email.bad" };
  if (body["phone"] !== undefined) return { code: "phone.required" };
  return { code: "address.required" };
}

/** The address as the relay keeps it: a hash with the relay's salt and its kind; a number's hash is the one phone.ts has always made. */
export const hashAddress = (a: Address, salt: string): string =>
  a.kind === "phone" ? hashPhone(a.value, salt) : "sha256:" + createHash("sha256").update(`${salt}:${a.kind}:${a.value}`, "utf8").digest("hex");

/** The login index's key for an address's hash: its kind and 24 hex digits. */
export const keyOf = (kind: AddressKind, hash: string): string => `${kind}-${hash.slice(7, 31)}`;

/** What the person is shown of an address: `j***@example.com`, or `•••• 0000`. */
export function maskAddress(a: Address): string {
  if (a.kind === "phone") return `•••• ${tailOf(a.value)}`;
  if (a.kind !== "email") return "";
  const at = a.value.lastIndexOf("@");
  return `${a.value.slice(0, 1)}***${a.value.slice(at)}`;
}

/** The mail that carries a code, in the language the person asked in. */
export const codeMail = (code: string, lang: Lang = DEFAULT_LANG): { subject: string; text: string } => ({ subject: say("code.mail.subject", lang, { code }), text: say("code.text", lang, { code }) });
