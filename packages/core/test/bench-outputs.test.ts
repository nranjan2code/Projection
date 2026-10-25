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
  // The table's rows were bound to data the model never sent: it showed only
  // its header, and the model is told so.
  assert.deepEqual(errors(last.diags).map((m) => m.split(" has no value")[0]), ["{/data/products}"]);
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
  // The first render bound its chart and table to data it had not sent yet.
  assert.deepEqual(calls.map((c) => errors(c.diags).map((m) => m.split(" has no value")[0])), [["{/data/traffic_values}", "{/data/top_pages}"], [], [], []]);
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
  // Its table's rows were never sent (only the header showed).
  assert.deepEqual(errors(last.diags).map((m) => m.split(" has no value")[0]), ["{/products}"]);
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

// The component bench's real 4B output retried four times on the JavaScript
// template literal ${name}. Literal source must survive even when surface
// data or a form happens to use the same name.
test("javascript-snippet (component bench): code braces are literal and whole-value bindings still work", () => {
  const call = JSON.parse(readFileSync(new URL("./fixtures/bench-code-4b-2026-10-25.json", import.meta.url), "utf8")) as { tool: string; args: string };
  const store = new SurfaceStore(basicCatalog);
  const args = parseLenient(call.args) as Record<string, unknown>;
  const expected = 'const name = "Ada";\nconsole.log(`Hello, ${name}!`);\n';
  assert.deepEqual(store.apply(call.tool, args).filter((d) => d.severity === "error"), []);
  assert.equal(store.resolve(String(args.surface))!.root!.props.code, expected);
  store.apply("vak_update", { surface: args.surface, data: { name: "Grace" } });
  assert.equal(store.resolve(String(args.surface))!.root!.props.code, expected);

  // Aliases are protected before normalization can collapse {{name}}, and
  // code can still come from data without interpolating inside that source.
  const diagnostics = store.render({ surface: "literal", data: { snippet: expected }, nodes: [
    { id: "root", type: "form", props: { submit: "save" }, children: ["literal", "bound", "name"] },
    { id: "name", type: "input", props: { label: "Name", bind: "/form/name" } },
    { id: "literal", type: "code", props: { source: '{{name}} ${name} {name} \\{name}' } },
    { id: "bound", type: "code", props: { code: "{/snippet}" } },
  ] });
  assert.deepEqual(diagnostics.filter((d) => d.severity === "error"), []);
  const children = store.resolve("literal")!.root!.children;
  assert.equal(children[0]!.props.code, '{{name}} ${name} {name} \\{name}');
  assert.equal(children[1]!.props.code, expected);
});

const componentCalls = JSON.parse(readFileSync(new URL("./fixtures/bench-components-4b-2026-10-25.json", import.meta.url), "utf8")) as Record<string, { tool: string; args: string }>;

test("map (component bench): JSON object sequences retain every place", () => {
  const store = new SurfaceStore(basicCatalog);
  const call = componentCalls["map-sequence"]!;
  const args = parseLenient(call.args) as Record<string, unknown>;
  assert.deepEqual(store.apply(call.tool, args).filter((d) => d.severity === "error"), []);
  assert.deepEqual(store.resolve(String(args.surface))!.root!.props.places, [
    { name: "British Museum", address: "Great Russell Street, London" },
    { name: "Tate Modern", address: "Bankside, London" },
  ]);
  // A single encoded object is a one-item list, not a fake binding. A real
  // binding remains a binding and resolves normally.
  for (const places of ['{"name":"Single place","address":"Side Street"}', '{/places}']) {
    store.render({ surface: "single", nodes: [{ id: "root", type: "map", props: { places } }], data: { places: [{ name: "Single place", address: "Side Street" }] } });
    assert.deepEqual(store.resolve("single")!.root!.props.places, [{ name: "Single place", address: "Side Street" }]);
  }
});

test("steps (component bench): leaf item records in children become its declared array prop", () => {
  const store = new SurfaceStore(basicCatalog);
  const call = componentCalls["step-children"]!;
  // The first node of the real call has the complete, unambiguous records.
  // Later copies in that same call are distinct output errors, not permission
  // to invent fields or rename the user's labels during recovery.
  const args = parseLenient(call.args) as Record<string, unknown>;
  args.nodes = [(args.nodes as unknown[])[0]];
  assert.deepEqual(store.apply(call.tool, args).filter((d) => d.severity === "error"), []);
  const root = store.resolve(String(args.surface))!.root!;
  assert.equal(root.type, "steps");
  assert.deepEqual(root.props.items, [
    { status: "done", title: "Payment made" },
    { description: "Your item is being carefully packed", status: "current", title: "Packing order" },
    { description: "Ready to ship", status: "todo", title: "Shipping dispatched" },
  ]);
  assert.deepEqual(root.children, []);
});

test("leaf child recovery keeps explicit items and never swallows a nested subtree", () => {
  const store = new SurfaceStore(basicCatalog);
  store.render({ surface: "explicit", nodes: [{ id: "root", type: "steps", props: { items: [{ title: "Keep", status: "done" }] }, children: [{ title: "Other", status: "todo" }] }] } as never);
  assert.match(projectText(store.resolve("explicit")!), /Keep/);
  store.render({ surface: "nested", nodes: [{ id: "root", type: "steps", children: [{ id: "section", type: "section", props: { title: "Parent" }, children: [{ id: "text", type: "text", props: { content: "Do not lose this" } }] }] }] } as never);
  assert.match(projectText(store.resolve("nested")!), /Do not lose this/);
});

// Both live 4B runs chose timeline despite supplying all three process
// states. Catalog-declared semantic variants preserve those states as steps.
test("state-bearing timeline (4B reliability run) becomes steps without losing fields", () => {
  const store = new SurfaceStore(basicCatalog);
  const call = componentCalls["state-timeline"]!;
  const args = parseLenient(call.args) as Record<string, unknown>;
  assert.deepEqual(store.apply(call.tool, args).filter((d) => d.severity === "error"), []);
  const step = store.resolve(String(args.surface))!.root!.children[0]!;
  assert.equal(step.type, "steps");
  assert.deepEqual(step.props.items, [
    { date: "2024-01-15", description: "Payment processed successfully", status: "done", title: "Payment" },
    { date: "2024-01-16", description: "Item packed and quality checked", status: "current", title: "Packing" },
    { date: "2024-01-18", description: "Ready for departure", status: "todo", title: "Shipping" },
  ]);
  store.render({ surface: "bound-process", nodes: [{ id: "root", type: "timeline", props: { items: "{/process}" } }], data: { process: [{ title: "Review", status: "active" }] } });
  assert.equal(store.resolve("bound-process")!.root!.type, "steps");
  assert.deepEqual(store.resolve("bound-process")!.root!.props.items, [{ title: "Review", status: "current" }]);
  // A genuine history has dates and titles, but no process states to recover.
  store.render({ surface: "history", nodes: [{ id: "root", type: "timeline", props: { items: [{ date: "2025", title: "Founded" }] } }] });
  assert.equal(store.resolve("history")!.root!.type, "timeline");
  // Never retarget to a component removed by a target's capability profile.
  const { steps: _steps, ...components } = basicCatalog.components;
  const limited = new SurfaceStore({ ...basicCatalog, components });
  limited.apply(call.tool, args);
  assert.equal(limited.resolve(String(args.surface))!.root!.children[0]!.type, "timeline");
});

test("formatted totals and literal source from the live reliability run survive projection", () => {
  const store = new SurfaceStore(basicCatalog);
  for (const name of ["formatted-totals", "literal-code"]) {
    const call = componentCalls[name]!;
    const args = parseLenient(call.args) as Record<string, unknown>;
    assert.deepEqual(store.apply(call.tool, args).filter((d) => d.severity === "error"), []);
    const root = store.resolve(String(args.surface))!.root!;
    if (name === "formatted-totals") {
      const rows = root.props.rows as Record<string, unknown>[];
      assert.deepEqual(rows.at(-1), { item: "Total", units: 9, revenue: "$65" });
      assert.deepEqual(rows.slice(0, -1).map((r) => r.margin), ["10%", "20%", "15%"]);
    } else {
      assert.equal(String(root.props.code).trimEnd(), 'const name = "Ada";\nconsole.log(`Hello, ${name}!`);');
    }
  }
});

// The last failing contract run supplied correct display strings and totals,
// but quoted its binding across the closing brace: {"/data/invoice_rows}".
test("quoted table pointer (4B contract run) binds rows and computes formatted totals", () => {
  const store = new SurfaceStore(basicCatalog);
  const call = componentCalls["quoted-rows"]!;
  const args = parseLenient(call.args) as Record<string, unknown>;
  assert.deepEqual(store.apply(call.tool, args).filter((d) => d.severity === "error"), []);
  assert.deepEqual((store.resolve(String(args.surface))!.root!.props.rows as unknown[]).at(-1), { item: "Total", units: 9, revenue: "$65" });
  // Matching quotes inside the braces are the same mistake; source code is
  // literal, so a snippet that happens to show that syntax stays unchanged.
  store.render({ surface: "quoted", nodes: [{ id: "root", type: "stack", children: ["list", "code"] }, { id: "list", type: "list", props: { items: '{"/items"}' } }, { id: "code", type: "code", props: { code: '{"/items"}' } }], data: { items: ["a", "b"] } });
  const children = store.resolve("quoted")!.root!.children;
  assert.deepEqual(children[0]!.props.items, ["a", "b"]);
  assert.equal(children[1]!.props.code, '{"/items"}');
});
