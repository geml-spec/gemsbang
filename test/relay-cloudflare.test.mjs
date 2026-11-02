import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as worker from "../dist/relay/worker.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
/** wrangler.jsonc without its comments. */
const config = JSON.parse(readFileSync(join(root, "cloudflare", "wrangler.jsonc"), "utf8").replace(/^\s*\/\/.*$/gm, ""));

test("the Cloudflare configuration agrees with the code (architecture §2.3): the built Worker as main, its object's class exported and made on SQLite, the mail binding the object uses, gemsbang.com as the name, the route and the sender; Node's built-ins allowed", () => {
  assert.equal(existsSync(resolve(root, "cloudflare", config.main)), true, "main is the built worker");
  const [binding] = config.durable_objects.bindings;
  assert.deepEqual([binding.name, typeof worker[binding.class_name]], ["RELAY", "function"]);
  assert.deepEqual(config.migrations.map((m) => m.new_sqlite_classes), [[binding.class_name]]);
  assert.deepEqual(config.send_email, [{ name: "EMAIL" }]);
  assert.deepEqual([config.vars.NAME, config.vars.MAIL_FROM, config.routes], ["gemsbang.com", "noreply@gemsbang.com", [{ pattern: "gemsbang.com", custom_domain: true }]]);
  assert.ok(config.compatibility_flags.includes("nodejs_compat"));
  assert.equal(typeof worker.default.fetch, "function");
});
