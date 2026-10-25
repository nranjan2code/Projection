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

test("a mismatched closer is read the way the text after it parses", () => {
  // "}" typed instead of "]": a member follows, so we are still in the card.
  assert.deepEqual(parseLenient('[{"id":"card","children":[{"id":"a"}}, "data": {"x": 1}}, {"id":"b"}]'), [
    { id: "card", children: [{ id: "a" }], data: { x: 1 } },
    { id: "b" },
  ]);
  // "]" omitted: an array element follows, so the "}" closes the stack.
  assert.deepEqual(parseLenient('[{"id":"stack","children":[{"id":"a"}}, {"id":"b"}]'), [
    { id: "stack", children: [{ id: "a" }] },
    { id: "b" },
  ]);
});

test("a stray extra closer is dropped when the closers after it fit the open containers", () => {
  // From a live 4B run: one "}" too many after a nested child; reading it as a
  // closer would end the node list early and lose the form after it.
  const text = '[{"id":"card","children":[{"id":"b","props":{"style":"primary"}}}]}, {"id":"form"}]';
  assert.deepEqual(parseLenient(text), [{ id: "card", children: [{ id: "b", props: { style: "primary" } }] }, { id: "form" }]);
});

test("JSON written inside a string without escaping is read as the structure it is", () => {
  // From a live 4B run (Telegram, hotels): inner quotes unescaped, closing quote left out.
  assert.deepEqual(parseLenient('{"a":"["x (1)","y"]","b":1}'), { a: ["x (1)", "y"], b: 1 });
  assert.deepEqual(parseLenient('[{"a":"["x","y"]},{"a":2}]'), [{ a: ["x", "y"] }, { a: 2 }]);
  // Strings that only look like JSON stay strings.
  assert.deepEqual(parseLenient('{"t":"{name}","u":"[note] text","v":"[1,2]"}'), { t: "{name}", u: "[note] text", v: "[1,2]" });
});

test("a second value after a stray colon continues the previous member", () => {
  assert.deepEqual(parseLenient('[{"d":"Ryokan": ["Onsen","Tatami"],"n":1},{"n":2}]'), [{ d: "Ryokan\nOnsen\nTatami", n: 1 }, { n: 2 }]);
});

test("a key inside an array means the array's closer was omitted", () => {
  // From a live 4B run: `"hotels":[{...},{...}, "bookings":{}}` — no "]".
  assert.deepEqual(parseLenient('{"hotels":[{"n":1},{"n":2}, "bookings":{}}'), { hotels: [{ n: 1 }, { n: 2 }], bookings: {} });
  assert.deepEqual(parseLenient('{"tags":["a", "b"], "n": 1}'), { tags: ["a", "b"], n: 1 });
});

test("an object where a key belongs, inside an array, starts the next element", () => {
  // Telegram hotel booking, 2026-10-25: the 4B model left out each field's "}"
  // after its props. Read as keys, the next field's members overwrote this
  // one's, and the form lost two of its three fields.
  const text = '[{"id":"details","type":"form","children":[{"id":"date","type":"input","props":{"bind":"/details/date","label":"Check-in Date"},{"id":"guests","type":"select","props":{"bind":"/details/guests","options":["1","2"]},{"id":"notes","type":"textarea","props":{"label":"Special Requests"}}}]}]';
  const [form] = parseLenient(text) as { children: { id: string }[] }[];
  assert.deepEqual(form!.children.map((c) => c.id), ["date", "guests", "notes"]);
});

test("stray closers between a closed top-level list and its next element are part of the early close", () => {
  // Playground sales dashboard, 2026-10-25 (4B): "...,"span":3}]}, {"id":"alert",...}]}]".
  // The "]" closed the list, the "}" stopped the continuation, and the alert was lost.
  assert.deepEqual(parseLenient('[{"id":"a"}]}, {"id":"b"}]}]'), [{ id: "a" }, { id: "b" }]);
  assert.deepEqual(parseLenient('[1]], 2] trailing prose'), [1, 2]);
});

test("a stray extra closer followed by more elements is read by the closers further on", () => {
  // Shape of the 4B dashboard call above: one "}" too many inside a children list.
  const text = '[{"id":"root","children":[{"id":"k","children":[{"id":"a"}}, {"id":"b"}]}], "span": 2}, {"id":"c"}]';
  assert.deepEqual(parseLenient(text), [{ id: "root", children: [{ id: "k", children: [{ id: "a" }, { id: "b" }] }], span: 2 }, { id: "c" }]);
});

test("a key that opens with one quote and closes with the other", () => {
  // Playground Q3 dashboard, 2026-10-25 (4B): "action':'view_july','payload':{'month':'July'}.
  assert.deepEqual(parseLenient(`{"label":"View details","action':'view_july','payload':{'month':'July'}}`), { label: "View details", action: "view_july", payload: { month: "July" } });
  // An apostrophe inside an ordinary string value is untouched.
  assert.deepEqual(parseLenient(`{"content":"it's: fine","n":1}`), { content: "it's: fine", n: 1 });
});

test("key and value glued into one string, and a key with its separator before the value", () => {
  // 4B: "type:section" (bench gate job-application) and "type:=","select" (form cassette).
  assert.deepEqual(parseLenient('{"id":"s","type:section","props":{}}'), { id: "s", type: "section", props: {} });
  assert.deepEqual(parseLenient('{"id":"c","type:=","select", "props":{}}'), { id: "c", type: "select", props: {} });
  // Prose with a colon after a value still continues that value.
  assert.deepEqual(parseLenient('{"body": "Pick up a", "Note: b"}'), { body: "Pick up a\nNote: b" });
});

test("a value missing its opening quote", () => {
  // 4B: "type":select" (bench gate job-application); "content": **"Plank" ...", (gate workout-tabs).
  assert.deepEqual(parseLenient('{"type":select","props":{"a":1}}'), { type: "select", props: { a: 1 } });
  assert.deepEqual(parseLenient('{"content": **Bold** (3 sets: hold).", "variant": "code"}'), { content: "**Bold** (3 sets: hold).", variant: "code" });
});

test("a spaced key: value string after an id is a member, after prose it continues the prose", () => {
  // 4B, bench pizza-order: {"id": "total_price", "type: stat", ...} made the id "total_price\ntype: stat".
  assert.deepEqual(parseLenient('{"id": "total_price", "type: stat", "props": {}}'), { id: "total_price", type: "stat", props: {} });
  assert.deepEqual(parseLenient('{"body": "Pickup at noon", "Note: b"}'), { body: "Pickup at noon\nNote: b" });
});

test("a colon inside the key's quotes, and an unquoted key inside an array", () => {
  // 4B, bench pizza-order: {"id: "topping_details", type: list, ...} and "...}}, span:2},".
  assert.deepEqual(parseLenient('{"id: "topping_details", type: list}'), { id: "topping_details", type: "list" });
  assert.deepEqual(parseLenient('{"children":[{"id":"a"}, span:2}'), { children: [{ id: "a" }], span: 2 });
});
