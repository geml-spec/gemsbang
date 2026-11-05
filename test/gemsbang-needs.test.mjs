import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startAvatarRelay } from "../dist/relay/avatar-server.js";
import { runGb } from "../dist/gemsbang/ops.js";

const ok = (x) => { assert.equal(x.ok, true, x.reason); return x; };

test("需要你 in the client (spec §7.3): the session's avatar asks with im_ask; the next read lists it with its avatar's badge and chat, errors first; the person answers and the words land in the chat; an avatar or a chat muted stays listed, marked; a template for the waiting line", async () => {
  const texts = [];
  const s = await startAvatarRelay({ root: mkdtempSync(join(tmpdir(), "gemsbang-needs-relay-")), name: "relay.test", texter: (t) => { texts.push(t); } });
  try {
    const home = mkdtempSync(join(tmpdir(), "gemsbang-needs-home-"));
    const gb = (call, args = {}) => runGb(call, args, { home, now: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), zoneMinutes: 0 });
    ok(await gb("setup", { relay: s.url }));
    ok(await gb("login-start", { phone: "13800138000" }));
    ok(await gb("login-verify", { phone: "13800138000", code: /(\d{6})/.exec(texts.at(-1).text)[1] }));
    const g = ok(await gb("group", { name: "三年二班家长", avatarName: "Lily 爸爸" })).chat;
    const venue = `${g.owner}/${g.id}`;
    ok(await gb("bind", { session: "s-1", avatar: g.as.id }));
    const asked = ok(await gb("tool-ask", { session: "s-1", venue, kind: "promise", summary: "王老师问周五能不能来当志愿者", draft: "周五我可以去", options: [{ label: "能去", text: "周五我可以去" }], placeholder: true }));
    assert.equal(asked.text, "已经问了本人（承诺），卡上写着将要发出的话；本人答了就以「Lily 爸爸」发到「三年二班家长」。在那之前别替他答。");
    ok(await gb("tool-ask", { session: "s-1", venue, kind: "error", summary: "身体连不上" }));
    const view = ok(await gb("status")).view;
    assert.deepEqual(view.needs.map((n) => [n.kind, n.avatarName, n.group, n.badge.initial, n.muted]), [["error", "Lily 爸爸", "三年二班家长", "L", false], ["promise", "Lily 爸爸", "三年二班家长", "L", false]]);
    assert.equal(ok(await gb("open", { owner: g.owner, id: g.id })).chat.items.some((i) => i.kind === "message"), false, "nothing in the chat until the person answers");
    const promise = view.needs[1];
    const done = ok(await gb("answer", { avatar: promise.avatar, need: promise.id, choice: 0 }));
    assert.deepEqual(done.view.needs.map((n) => n.kind), ["error"]);
    assert.equal(ok(await gb("open", { owner: g.owner, id: g.id })).chat.items.at(-1).text, "周五我可以去");
    assert.equal(ok(await gb("mute", { avatar: g.as.id })).view.needs[0].muted, true);
    assert.deepEqual(ok(await gb("mute", { avatar: g.as.id, on: false })).view.muted, { avatars: [], venues: [] });
    assert.equal(ok(await gb("mute", { venue })).view.needs[0].muted, true);
    assert.equal((await gb("answer", { avatar: promise.avatar, need: promise.id, choice: 0 })).code, "need.answered");
    assert.match(ok(await gb("tool-ask", { session: "s-2", venue, kind: "pay", summary: "x" })).text, /以「Lily 爸爸」发到「三年二班家长」/, "a new session plays the avatar last spoken as (S21)");
  } finally {
    await s.close();
  }
});
