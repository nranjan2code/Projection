// Real 4B model output from the bench (fixtures/bench-4b-2026-10-25.json, each
// scenario's recorded tool calls verbatim) replayed through the engine. Each
// test names the repair that output needed; the replay gate scores the same
// runs end to end.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { basicCatalog } from "../src/basic-catalog.ts";
import { parseLenient } from "../src/partial-json.ts";
import { type Diagnostic, SurfaceStore } from "../src/surface.ts";
import { projectText } from "../src/text-projector.ts";

type Recorded = { source: string; turns: { tool: string; args: string }[][] };
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/bench-4b-2026-10-25.json", import.meta.url), "utf8")) as Record<string, Recorded>;

/** Apply a scenario's calls in order; returns the store and each call's diagnostics. */
function replay(name: string) {
  const store = new SurfaceStore(basicCatalog);
  const calls: { surface: string; diags: Diagnostic[] }[] = [];
  for (const turn of fixtures[name]!.turns) {
    for (const call of turn) {
      const args = parseLenient(call.args) as Record<string, unknown>;
      calls.push({ surface: String(args.surface), diags: store.apply(call.tool, args) });
    }
  }
  const last = calls.at(-1)!;
  return { store, calls, last, errors: (d: Diagnostic[]) => d.filter((x) => x.severity === "error").map((x) => x.message), text: projectText(store.resolve(last.surface)!) };
}

test("sales-q3: /data/ path prefix, {{binding}}, nodes in a stray argument, an escaped string kept as a string", () => {
  // Stats bound "{/data/revenue}" with data {revenue}; "${{/data/avg_order_value}}"
  // showed "${}"; the chart and table were written as the string argument
  // "chart": "{...}, {...}]" after the nodes list, and the escaped string was
  // read as raw JSON down to its first object.
  const { last, errors, text } = replay("sales-q3");
  assert.deepEqual(errors(last.diags), []);
  assert.ok(last.diags.some((d) => /nodes written in "chart" were read as part of "nodes"/.test(d.message)));
  assert.match(text, /Revenue: \$1,248,000/);
  assert.match(text, /Avg Order Value: \$438\.50 /);
  assert.match(text, /\[line chart\] July, August, September/);
  assert.match(text, /\[Table\] Product \| Sales/);
});

test("web-analytics: bare pointers bind at any depth, annotation series drop, a repeated children key adds", () => {
  // "value": "/data/visitors" showed the path; a series' "values":
  // "/data/traffic_values" failed validation (three retries); the last retry
  // added a "Peak Day" series of text and wrote "children" twice in one object,
  // and the second list replaced the table.
  const { calls, errors, text } = replay("web-analytics");
  assert.deepEqual(calls.map((c) => errors(c.diags)), [[], [], [], []]);
  assert.match(text, /Total Visitors: 18452/);
  assert.match(text, /Daily Traffic \(visitors\): 12453/);
  assert.doesNotMatch(text, /Peak Day/);
  assert.match(text, /\/products\/electronics\/view \| 28,431/);
  assert.match(text, /Last updated/);
});

test("the lenient readings stay narrow", () => {
  const store = new SurfaceStore(basicCatalog);
  store.apply("vak_render", {
    surface: "s",
    nodes: [
      { id: "root", type: "stack", children: ["a", "b", "c"] },
      // A path that names no data stays text; a currency sign before a value without one stays.
      { id: "a", type: "text", props: { content: "/help" } },
      { id: "b", type: "stat", props: { label: "Total", value: "${/n}" } },
      { id: "c", type: "list", props: { items: null } },
    ],
    data: { n: 12 },
  });
  const text = projectText(store.resolve("s")!);
  assert.match(text, /^\/help$/m);
  assert.match(text, /Total: \$12/);
  // A repeated key with plain values is still last-wins.
  assert.deepEqual(parseLenient('{"labels":["a"],"labels":["a","b"]}'), { labels: ["a", "b"] });
});

test("recipe: null props are omitted, a lone {data} object is data", () => {
  // "description": null and "subtitle": null failed their string type; a trailing
  // {"data": {}} in the nodes list was inferred as a chart missing its series.
  const { calls, text } = replay("recipe");
  for (const c of calls) assert.deepEqual(c.diags.filter((d) => d.severity === "error"), []);
  assert.match(text, /\n1\. Lasagna noodles/);
  assert.doesNotMatch(text, /\[bar chart\]/);
});

test("sql-study-plan: \"prop\" is the node's props", () => {
  // Every node wrote "prop": {...}; the select lost label, bind and options.
  const { last, errors, text } = replay("sql-study-plan");
  assert.deepEqual(errors(last.diags), []);
  assert.match(text, /\[Select\] Current Week/);
  assert.match(text, /1 - Basics/);
});

test("web-analytics (gate run): a dotted path binds", () => {
  // "{/data.visitors}" with data {visitors}.
  const { text } = replay("web-analytics-gate");
  assert.match(text, /Total Visitors: 127,453/);
  assert.match(text, /Avg\. Session: 4m 12s/);
});

test("dashboard-filter (gate run): props written as a leaf node's only child are its props", () => {
  // {"id":"chart","type":"chart","children":[{"props":{...}}]}, in three retries.
  const { last, errors, text } = replay("dashboard-filter-gate");
  assert.deepEqual(errors(last.diags), []);
  assert.match(text, /\[line chart\] Mon-Thu, Fri/);
  assert.match(text, /\[Table\] Product \| Sales/);
});

test("workout-tabs (second gate run): prose whose opening quote was left out", () => {
  // "content": **"Plank Variation" - Side Plank** (3 sets...).", "variant": ...
  // skipped a character at a time, its words became day 2's children.
  const { last, errors, text } = replay("workout-tabs-gate2");
  assert.deepEqual(errors(last.diags), []);
  assert.match(text, /\*\*"Plank Variation" - Side Plank\*\* \(3 sets of 20-40 sec/);
  assert.match(text, /\[Tab: Day 3: Upper Body Sculpting\]/);
});

test("job-application (second gate run): key and value in one string, a word missing its opening quote", () => {
  // "type:section" and "type":select" — the select lost its props and failed.
  const { calls, errors, text } = replay("job-application-gate2");
  for (const c of calls) assert.deepEqual(errors(c.diags), []);
  assert.match(text, /\[Select\] Level in CSS\/Sass\*: Beginner \/ Intermediate \/ Expert/);
});

test("job-application (form slice): a typeless, id-less object of form values in children is data", () => {
  // {"name": "", "email": "", "projects": [...]} inside a stack's children was a
  // node "missing type": three retries, then the run timed out.
  const { last, errors, store } = replay("job-application-form-slice");
  assert.deepEqual(errors(last.diags), []);
  assert.ok(last.diags.some((d) => /data written inside nodes was merged/.test(d.message)));
  assert.equal(store.get(last.surface)!.data.resume_uploaded, false);
});

test("workout plan (playground, 0.8B): nodes after the list are kept; empty containers go; an empty surface is an error", () => {
  // Five "tabs" with titles and no panels, the list closed, then the day cards
  // as "children" after it: the cards were dropped and the user saw five empty
  // frames, with no error for the model.
  const { last, errors, text, store } = replay("workout-playground-0.8b");
  assert.deepEqual(errors(last.diags), []);
  assert.ok(last.diags.some((d) => /nodes written in "children" were read as part of "nodes"/.test(d.message)));
  assert.ok(last.diags.some((d) => /empty containers removed/.test(d.message)));
  assert.match(text, /\[Card\] Cardio Day/);
  assert.ok(![...store.get(last.surface)!.nodes.values()].some((n) => n.type === "tabs"));

  // Without the cards there is nothing left to show: an error, so the model adds content.
  const bare = new SurfaceStore(basicCatalog);
  const d = bare.apply("vak_render", {
    surface: "w",
    nodes: [{ id: "root", type: "grid", children: [{ id: "t1", type: "tabs", props: { title: "Day 1" } }, { id: "t2", type: "tabs", props: { title: "Day 2" } }] }],
  });
  assert.ok(d.some((x) => x.severity === "error" && /the surface is empty/.test(x.message)));
});
