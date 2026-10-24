import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLenient, parsePartial } from "../src/partial-json.ts";

test("parses complete JSON", () => {
  const r = parsePartial('{"a": [1, 2, {"b": "c"}], "d": null}', { final: true });
  assert.deepEqual(r.value, { a: [1, 2, { b: "c" }], d: null });
  assert.equal(r.complete, true);
});

test("closes every prefix without throwing", () => {
  const doc = '{"surface":"s","nodes":[{"id":"root","type":"card","props":{"title":"Héllo \\"x\\"","n":12.5}}],"ok":true}';
  for (let i = 0; i <= doc.length; i++) parsePartial(doc.slice(0, i));
  assert.deepEqual(parsePartial(doc).value, JSON.parse(doc));
});

test("marks truncated strings and open containers", () => {
  const r = parsePartial('{"nodes":[{"id":"ro');
  const v = r.value as { nodes: Record<string, unknown>[] };
  const node = v.nodes[0]!;
  assert.equal(node.id, "ro");
  assert.ok(r.partialKeys.get(node)?.has("id"));
  assert.ok(r.incomplete.has(v.nodes));
  assert.equal(r.complete, false);
});

test("drops numbers that may still be growing", () => {
  assert.deepEqual(parsePartial('{"a": 12').value, {});
  assert.deepEqual(parsePartial('{"a": 12,').value, { a: 12 });
});

test("repairs sloppy model output", () => {
  const sloppy = `Sure! Here it is:
\`\`\`json
{
  // a comment
  surface: 'trip',
  nodes: [ {id: "root", type: "card", props: {title: 'It\\'s here', done: True, x: None},}, ],
}
\`\`\``;
  assert.deepEqual(parseLenient(sloppy), {
    surface: "trip",
    nodes: [{ id: "root", type: "card", props: { title: "It's here", done: true, x: null } }],
  });
});

test("tolerates raw newlines inside strings", () => {
  assert.deepEqual(parseLenient('{"t": "line1\nline2"}'), { t: "line1\nline2" });
});

test("ignores __proto__ keys", () => {
  const v = parseLenient('{"__proto__": {"polluted": 1}, "a": 1}') as Record<string, unknown>;
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.deepEqual(Object.keys(v), ["a"]);
});

test("a value with no key continues the previous member", () => {
  assert.deepEqual(parseLenient('{"body": "- a", "- b", "- c", "tags": ["x"], "y", "n": 1}'), { body: "- a\n- b\n- c", tags: ["x", "y"], n: 1 });
});

test("an array closed too early continues with the values after it", () => {
  assert.deepEqual(parseLenient('[{"id":"root"}], {"id":"a"}, {"id":"b"}]'), [{ id: "root" }, { id: "a" }, { id: "b" }]);
  assert.deepEqual(parseLenient("[1, 2]"), [1, 2]);
});
