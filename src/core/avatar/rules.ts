// An avatar's rules (spec §8.1): whether others see that an agent said a
// line (`mark`), and what it may do on a computer it borrows (`borrow`).
// Only the person changes them; a change names only what it changes. Pure.
import type { Fault } from "./words.js";

export interface Rules { mark: boolean; borrow: string[] }

/** What a borrowed computer may be used for: read, edit, run the tests; push and secrets only when the person says. */
export const BORROWS: readonly string[] = ["read", "edit", "test", "push", "secrets"];
export const DEFAULT_RULES: Rules = { mark: true, borrow: ["read", "edit", "test"] };

/** The rules with a change laid over them, or why the change is not one. */
export function withRules(base: Rules, change: unknown): Rules | Fault {
  if (typeof change !== "object" || change === null || Array.isArray(change)) return { code: "rules.notObject" };
  const c = change as Record<string, unknown>;
  const out: Rules = { mark: base.mark, borrow: [...base.borrow] };
  for (const key of Object.keys(c)) {
    if (key === "mark") {
      if (typeof c["mark"] !== "boolean") return { code: "rules.mark" };
      out.mark = c["mark"];
    } else if (key === "borrow") {
      const b = c["borrow"];
      if (!Array.isArray(b) || !b.every((x) => typeof x === "string" && BORROWS.includes(x))) return { code: "rules.borrow", params: { allowed: BORROWS.join(", ") } };
      out.borrow = BORROWS.filter((x) => (b as string[]).includes(x));
    } else return { code: "rules.unknown", params: { key } };
  }
  return out;
}
