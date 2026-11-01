// Which avatar a person comes into a second group as (spec §6.4): the one the
// avatar who brought them knows, the person's avatar in a group they share;
// none shared, there is no default and the person picks one, or a new one.
// An avatar already in the group is the one, and nothing is asked. Pure.

export interface Placed { id: string; groups: { venue: string; members: readonly string[] }[] }

export type Pick = { kind: "in"; avatar: string } | { kind: "known"; avatar: string } | { kind: "choose" };

export function pickAvatar(mine: readonly Placed[], venue: string, inviter: string | undefined): Pick {
  const inside = mine.find((a) => a.groups.some((g) => g.venue === venue));
  if (inside !== undefined) return { kind: "in", avatar: inside.id };
  if (inviter !== undefined) {
    const known = mine.find((a) => a.id !== inviter && a.groups.some((g) => g.members.includes(inviter)));
    if (known !== undefined) return { kind: "known", avatar: known.id };
  }
  return { kind: "choose" };
}
