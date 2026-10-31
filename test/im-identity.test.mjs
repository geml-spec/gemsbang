import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSpeaker, formatSpeaker, personBehind, agentLabel, draftedTag, QUOTED_TAG, sourceFaults } from "../dist/core/im/identity.js";

test("speakers parse and format: a person, an agent with its owner, a guest, the host", () => {
  assert.deepEqual(parseSpeaker("person:john"), { kind: "person", id: "john" });
  assert.deepEqual(parseSpeaker("agent:xiaoping@john"), { kind: "agent", name: "xiaoping", owner: "john" });
  assert.deepEqual(parseSpeaker("guest:a1b2"), { kind: "guest", id: "a1b2" });
  assert.deepEqual(parseSpeaker("host"), { kind: "host" });
  for (const s of ["person:john", "agent:xiaoping@john", "guest:a1b2", "host"]) assert.equal(formatSpeaker(parseSpeaker(s)), s);
  for (const bad of ["john", "agent:xiaoping", "agent:@john", "agent:xiaoping@", "person:", "person:a b", "robot:x", "Host", ""]) assert.equal(parseSpeaker(bad), undefined, bad);
});

test("the person behind a speaker: themself, the agent's owner, nobody for a guest or the host", () => {
  assert.equal(personBehind({ kind: "person", id: "john" }), "john");
  assert.equal(personBehind({ kind: "agent", name: "xiaoping", owner: "john" }), "john");
  assert.equal(personBehind({ kind: "guest", id: "a1b2" }), undefined);
  assert.equal(personBehind({ kind: "host" }), undefined);
});

test("an agent's label always carries its owner's badge (rule 6); the name-line tags", () => {
  assert.equal(agentLabel("小评", "John"), "小评 · 代 John");
  assert.equal(draftedTag("小评"), "小评起草");
  assert.equal(QUOTED_TAG, "本人原话");
});

test("the four sources: a person is self or drafted, an agent is agent or quoted, the host is not checked", () => {
  const john = { kind: "person", id: "john" }, xp = { kind: "agent", name: "xiaoping", owner: "john" };
  assert.deepEqual(sourceFaults(john, "self"), []);
  assert.deepEqual(sourceFaults(john, "drafted"), []);
  assert.deepEqual(sourceFaults(john, "agent"), ["本人的消息不能标为 agent 发言"]);
  assert.deepEqual(sourceFaults(john, "quoted"), ["本人的消息不能标为 agent 发言"]);
  assert.deepEqual(sourceFaults({ kind: "guest", id: "g" }, "drafted"), []);
  assert.deepEqual(sourceFaults(xp, "agent"), []);
  assert.deepEqual(sourceFaults(xp, "quoted"), []);
  assert.deepEqual(sourceFaults(xp, "self"), ["agent 的消息不能标为本人亲打"]);
  assert.deepEqual(sourceFaults({ kind: "host" }, "self"), []);
});
