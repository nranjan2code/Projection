import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { type CatalogEntry, checkFolders, Integrations, type IntegrationsOptions, PINNED_MIN_AGE_DAYS, pinnedInstallArgs, timeServer } from "../src/index-client.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

function memorySecrets(): IntegrationsOptions["secrets"] & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return { values, get: (k) => values.get(k), set: (k, v) => void values.set(k, v), delete: (k) => void values.delete(k) };
}

const time: CatalogEntry = { id: "time", name: "Time", publisher: "test", trust: "built-in", summary: "", description: "", homepage: "", icon: "clock", access: [], source: { kind: "builtin", server: () => timeServer() }, config: [] };
const echo: CatalogEntry = {
  id: "echo",
  name: "Echo",
  publisher: "test",
  trust: "vendor",
  summary: "",
  description: "",
  homepage: "",
  icon: "plug",
  access: [],
  source: { kind: "npm", package: "@test/echo-server", version: "1.2.3", bin: "dist/index.js" },
  config: [{ key: "token", label: "Echo token", kind: "secret", required: true, env: "ECHO_TOKEN" }],
};

function setup(extra: Partial<IntegrationsOptions> = {}) {
  const dataDir = mkdtempSync(path.join(tmpdir(), "vak-integrations-"));
  mkdirSync(path.join(dataDir, "logs"));
  const secrets = memorySecrets();
  const approvals: string[] = [];
  const opts: IntegrationsOptions = {
    dataDir,
    catalog: [time, echo],
    secrets,
    npm: path.join(here, "fixtures/fake-npm.mjs"),
    approve: async (req) => (approvals.push(req.tool), "allow-chat"),
    ...extra,
  };
  return { dataDir, secrets, approvals, opts, list: new Integrations(opts) };
}

test("installs are pinned: exact version, every dependency at least 14 days old, no install scripts", () => {
  const now = Date.parse("2026-10-25T12:00:00Z");
  const args = pinnedInstallArgs("@x/server", "2.1.4", "/tmp/t", now);
  assert.equal(PINNED_MIN_AGE_DAYS, 14);
  assert.ok(args.includes("--ignore-scripts"));
  assert.ok(args.includes("@x/server@2.1.4"));
  assert.ok(args.includes("--before=2026-10-11"));
  // A range or tag would let a newer (possibly compromised) release in.
  for (const v of ["^2.1.4", "latest", "2.x", "~1.0.0"]) assert.throws(() => pinnedInstallArgs("@x/server", v, "/tmp/t", now), /exact version/);
  assert.doesNotThrow(() => pinnedInstallArgs("@mcp/server-files", "2026.8.31", "/tmp/t", now));
});

test("an npm server installs with the pinned arguments, runs in its own folder with only its declared key, and uninstalls cleanly", async () => {
  const { dataDir, secrets, list } = setup();
  process.env.OPENAI_API_KEY = "sk-must-not-leak";
  try {
    assert.equal(list.view().find((v) => v.entry.id === "echo")?.status, "not-installed");
    await list.install("echo");
    const args = JSON.parse(readFileSync(path.join(dataDir, "integrations/echo/pkg/npm-args.json"), "utf8")) as string[];
    assert.ok(args.includes("--ignore-scripts") && args.some((a) => a.startsWith("--before=")) && args.includes("@test/echo-server@1.2.3"));
    assert.equal(list.view().find((v) => v.entry.id === "echo")?.status, "needs-setup");

    await list.configure("echo", { enabled: true, secrets: { token: "t0k" } });
    const view = list.view().find((v) => v.entry.id === "echo")!;
    assert.equal(view.status, "ready");
    assert.deepEqual(view.tools.map((t) => [t.name, t.policy]), [["env", "allow"], ["write", "ask"]]);
    const res = await list.test("echo", "env", {});
    assert.match(res.text, /ECHO_TOKEN/);
    assert.doesNotMatch(res.text, /OPENAI_API_KEY/);
    assert.match(res.text, /integrations\/echo\/home/);

    await list.uninstall("echo");
    assert.equal(existsSync(path.join(dataDir, "integrations/echo")), false);
    assert.equal(secrets.values.size, 0);
  } finally {
    await list.stopAll();
    delete process.env.OPENAI_API_KEY;
  }
});

test("first run switches on only the built-ins the app names; state survives a restart", async () => {
  const { opts, list } = setup({ enabledAtFirstRun: ["time", "echo"] });
  // "echo" runs outside code, so it is never switched on without the user.
  assert.deepEqual(list.view().filter((v) => v.enabled).map((v) => v.entry.id), ["time"]);
  await list.configure("time", { policies: { now: "off" } });
  const again = new Integrations(opts);
  assert.equal(again.view().find((v) => v.entry.id === "time")?.enabled, true);
  assert.equal(again.policyOf("time", { name: "now", inputSchema: {} }), "off");
});

test("ask tools wait for approval; allow-for-this-chat lasts for that session only", async () => {
  const { list, approvals } = setup({ enabledAtFirstRun: ["time"] });
  await list.refresh("time");
  const tool = list.view().find((v) => v.entry.id === "time")!.tools[0]!;
  await list.configure("time", { policies: { [tool.name]: "ask" } });
  const call = async (session: string) => {
    const t = (await list.toolsFor(session)).find((x) => x.spec.name.includes(tool.name))!;
    return t.execute({}, {});
  };
  await call("a");
  await call("a");
  assert.equal(approvals.length, 1);
  await call("b");
  assert.equal(approvals.length, 2);
});

test("servers the user adds are unverified, and remote ones must use https", () => {
  const { list } = setup();
  assert.throws(() => list.addCustom({ name: "Plain", url: "http://example.com/mcp" }), /https/);
  const id = list.addCustom({ name: "Mine", url: "https://example.com/mcp", token: "abc" });
  const v = list.view().find((x) => x.entry.id === id)!;
  assert.equal(v.entry.trust, "custom");
  assert.equal(v.secretsSet.token, true);
  assert.doesNotThrow(() => list.addCustom({ name: "Local", url: "http://127.0.0.1:9000/mcp" }));
});

test("folder settings must be specific, absolute and existing", () => {
  const home = mkdtempSync(path.join(tmpdir(), "vak-home-"));
  const inside = path.join(home, "notes");
  mkdirSync(inside);
  assert.deepEqual(checkFolders(`${inside}\n${inside}/`, home), [inside]);
  for (const bad of ["relative/path", "/", "/etc", home, path.join(home, "missing")]) assert.throws(() => checkFolders(bad, home));
});
