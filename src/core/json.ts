// JSON as gemsbang's documents hold it: the value type, and canonical JSON —
// one line, keys sorted by code point — so a block's hash does not depend on
// how its object was built or how the file ends its lines. Pure.

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/**
 * Compare two strings by Unicode CODE POINT, not UTF-16 code unit: an astral
 * character's lead surrogate can sort below a BMP character with a higher code
 * point, which is backwards for exactly the characters "sorted by code point"
 * exists to place. Spreading a string iterates by code point.
 */
function compareByCodePoint(a: string, b: string): number {
  const as = [...a];
  const bs = [...b];
  const len = Math.min(as.length, bs.length);
  for (let i = 0; i < len; i++) {
    const diff = as[i]!.codePointAt(0)! - bs[i]!.codePointAt(0)!;
    if (diff !== 0) return diff;
  }
  return as.length - bs.length;
}

/** The value as canonical JSON: one line, object keys sorted by code point. */
export function canonical(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const keys = Object.keys(value).sort(compareByCodePoint);
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical(value[k] as JsonValue)).join(",") + "}";
}
