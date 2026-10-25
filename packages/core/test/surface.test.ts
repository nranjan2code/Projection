import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { basicCatalog } from "../src/basic-catalog.ts";
import { formatDiagnostics, SurfaceStore } from "../src/surface.ts";
import { ToolCallStream } from "../src/stream.ts";
import { projectText } from "../src/text-projector.ts";

const trip = {
  surface: "trip",
  nodes: [
    { id: "root", type: "stack", children: ["hdr", "f"] },
    { id: "hdr", type: "card", props: { title: "Plan your trip", subtitle: "for {/user/name}" } },
    { id: "f", type: "form", props: { submit: "book" }, children: ["dest", "email"] },
    { id: "dest", type: "input", props: { label: "Destination", bind: "/form/dest", checks: ["required"] } },
    { id: "email", type: "input", props: { label: "Email", bind: "/form/email", kind: "email", checks: ["email"] } },
  ],
  data: { user: { name: "Nisheeth" }, form: {} },
};

test("render resolves bindings into a tree", () => {
  const store = new SurfaceStore(basicCatalog);
  assert.deepEqual(store.render(structuredClone(trip)), []);
  const r = store.resolve("trip")!;
  assert.equal(r.root?.type, "stack");
  assert.equal(r.root?.children[0]?.props.subtitle, "for Nisheeth");
  assert.equal(r.root?.children[1]?.children[0]?.bindPath, "/form/dest");
});

test("submit runs checks, then returns the action", () => {
  const store = new SurfaceStore(basicCatalog);
  store.render(structuredClone(trip));
  const bad = store.submit("trip", "f");
  assert.deepEqual(bad.errors, { dest: ["This field is required"] });
  store.setValue("trip", "/form/dest", "Kyoto");
  store.setValue("trip", "/form/email", "not-an-email");
  assert.deepEqual(store.submit("trip", "f").errors, { email: ["Enter a valid email"] });
  store.setValue("trip", "/form/email", "a@b.co");
  const ok = store.submit("trip", "f", "telegram");
  assert.deepEqual(ok.action, {
    action: "book", surface: "trip", source: "f", target: "telegram",
    data: { dest: "Kyoto", email: "a@b.co" },
  });
});

test("templates repeat per list item with relative paths", () => {
  const store = new SurfaceStore(basicCatalog);
  store.render({
    surface: "s",
    nodes: [
      { id: "root", type: "grid", children: { each: "/hotels", template: "h" } },
      { id: "h", type: "card", props: { title: "{name}", body: "{price} USD" }, children: ["pick"] },
      { id: "pick", type: "button", props: { label: "Pick", action: "pick", payload: { name: "{name}" } } },
    ],
    data: { hotels: [{ name: "A", price: 100 }, { name: "B", price: 90 }] },
  });
  const root = store.resolve("s")!.root!;
  assert.deepEqual(root.children.map((c) => [c.key, c.props.title, c.props.body]), [["h#0", "A", "100 USD"], ["h#1", "B", "90 USD"]]);
  const res = store.submit("s", "pick#1");
  assert.deepEqual(res.action?.data, { name: "B" });
});

test("repairs nested nodes, top-level props, type casing, missing ids", () => {
  const store = new SurfaceStore(basicCatalog);
  const diags = store.render({
    surface: "x",
    nodes: [
      {
        id: "root",
        type: "Grid",
        children: [
          { type: "Card", title: "One" },
          { type: "stat", label: "Users", value: 42 },
        ],
      },
    ],
  } as never);
  assert.deepEqual(diags.filter((d) => d.severity === "error"), []);
  const root = store.resolve("x")!.root!;
  assert.equal(root.type, "grid");
  assert.deepEqual(root.children.map((c) => [c.type, c.props.title ?? c.props.label]), [["card", "One"], ["stat", "Users"]]);
});

test("unknown components become placeholders with a correctable error", () => {
  const store = new SurfaceStore(basicCatalog);
  const diags = store.render({ surface: "x", nodes: [{ id: "root", type: "carousel3d" }] });
  assert.equal(store.resolve("x")!.root!.type, "$invalid");
  assert.match(formatDiagnostics(diags), /unknown component "carousel3d"; set "type" to one of: stack, grid/);
});

test("update patches props and data; null deletes", () => {
  const store = new SurfaceStore(basicCatalog);
  store.render(structuredClone(trip));
  store.update({
    surface: "trip",
    nodes: [{ id: "hdr", props: { title: "3 options", subtitle: null } }],
    data: [{ op: "replace", path: "/user/name", value: "Ana" }],
  });
  const hdr = store.resolve("trip")!.root!.children[0]!;
  assert.equal(hdr.props.title, "3 options");
  assert.equal(hdr.props.subtitle, undefined);
  assert.equal(store.get("trip")!.data.user && (store.get("trip")!.data.user as { name: string }).name, "Ana");
});

test("visibleIf hides nodes", () => {
  const store = new SurfaceStore(basicCatalog);
  store.render({
    surface: "v",
    nodes: [
      { id: "root", type: "stack", children: ["a"] },
      { id: "a", type: "alert", props: { title: "Hi", visibleIf: "{/show}" } },
    ],
    data: { show: false },
  });
  assert.equal(store.resolve("v")!.root!.children.length, 0);
  store.setValue("v", "/show", true);
  assert.equal(store.resolve("v")!.root!.children.length, 1);
});

test("props schema errors are reported, bindings are not", () => {
  const store = new SurfaceStore(basicCatalog);
  const diags = store.render({
    surface: "e",
    nodes: [
      { id: "root", type: "stack", props: { direction: "diagonal" }, children: ["s"] },
      { id: "s", type: "stat", props: { label: "x", value: "{/n}" } },
    ],
  });
  assert.equal(diags.length, 1);
  assert.match(diags[0]!.message, /direction must be one of/);
});

test("streaming renders nodes as they complete", () => {
  const store = new SurfaceStore(basicCatalog);
  const s = new ToolCallStream(store, "vak_render");
  const json = JSON.stringify(trip);
  const seen: number[] = [];
  for (let i = 0; i < json.length; i += 7) {
    const tick = s.push(json.slice(i, i + 7));
    if (tick.changed) seen.push(store.get("trip")!.nodes.size);
  }
  const end = s.end();
  assert.deepEqual(end.diagnostics, []);
  assert.ok(seen.length > 3, "rendered progressively");
  assert.equal(seen[0], 1);
  // No node was ever applied with a truncated id.
  for (const id of store.get("trip")!.nodes.keys()) assert.ok(["root", "hdr", "f", "dest", "email"].includes(id));
});

test("orphaned subtrees are attached to the root, not hidden", () => {
  const store = new SurfaceStore(basicCatalog);
  const diags = store.render({
    surface: "o",
    nodes: [
      { id: "root", type: "grid", children: ["a"] },
      { id: "a", type: "stat", props: { label: "A", value: 1 } },
      { id: "f", type: "form", props: { submit: "go" }, children: ["n"] },
      { id: "n", type: "input", props: { label: "Name", bind: "/n" } },
    ],
  });
  assert.deepEqual(diags.map((d) => d.node), ["f"]);
  assert.deepEqual(store.resolve("o")!.root!.children.map((c) => c.id), ["a", "f"]);
});

test("orphans next to a leaf root get a wrapping stack", () => {
  const store = new SurfaceStore(basicCatalog);
  store.render({
    surface: "w",
    nodes: [
      { id: "root", type: "text", props: { content: "hi" } },
      { id: "b", type: "button", props: { label: "Go", action: "go" } },
    ],
  });
  const root = store.resolve("w")!.root!;
  assert.equal(root.type, "stack");
  assert.deepEqual(root.children.map((c) => c.type), ["text", "button"]);
});

test("a button collects inputs from its container when there is no form", () => {
  const store = new SurfaceStore(basicCatalog);
  store.render({
    surface: "b",
    nodes: [
      { id: "root", type: "section", props: { title: "Book" }, children: ["name", "go"] },
      { id: "name", type: "input", props: { label: "Name", bind: "/booking/name", checks: ["required"] } },
      { id: "go", type: "button", props: { label: "Book", action: "book" } },
    ],
  });
  assert.deepEqual(store.submit("b", "go").errors, { name: ["This field is required"] });
  store.setValue("b", "/booking/name", "Ana");
  assert.deepEqual(store.submit("b", "go").action, { action: "book", surface: "b", source: "go", data: { name: "Ana" } });
});

test("double-encoded nodes are unwrapped; empty renders are errors", () => {
  const store = new SurfaceStore(basicCatalog);
  const nodes = JSON.stringify([{ id: "root", type: "stack", children: ["t"] }, { id: "t", type: "text", props: { content: "hi" } }]) + "]}";
  assert.deepEqual(store.apply("vak_render", { surface: "d", nodes }), []);
  assert.equal(store.resolve("d")!.root!.children[0]!.props.content, "hi");
  const empty = store.apply("vak_render", { surface: "e", nodes: [] });
  assert.match(empty[0]!.message, /nodes is empty/);
});

test("missing types are inferred and wrong value shapes coerced", () => {
  const store = new SurfaceStore(basicCatalog);
  const diags = store.render({
    surface: "i",
    nodes: [
      { id: "root", children: ["c", "l", "s"] },
      { id: "c", props: { title: "Hotel", body: "Nice" } },
      { id: "l", type: "list", props: { items: [{ name: "Room 1" }, { name: "Room 2" }] } },
      { id: "s", type: "stat", props: { label: "Rating", value: 4.8, delta: 3 } },
    ],
  } as never);
  assert.deepEqual(diags.filter((d) => d.severity === "error"), []);
  const root = store.resolve("i")!.root!;
  assert.equal(root.type, "stack");
  assert.deepEqual(root.children.map((c) => c.type), ["card", "list", "stat"]);
  assert.deepEqual(root.children[1]!.props.items, ["Room 1", "Room 2"]);
  assert.equal(root.children[2]!.props.delta, "3");
});

test("invalid nodes keep failing until an update fixes them", () => {
  const store = new SurfaceStore(basicCatalog);
  store.render({ surface: "u", nodes: [{ id: "root", type: "stack", children: ["x"] }, { id: "x", type: "wat" }] });
  assert.equal(store.update({ surface: "u", nodes: [{ id: "x", props: { foo: 1 } }] }).filter((d) => d.severity === "error").length, 1);
  assert.deepEqual(store.update({ surface: "u", nodes: [{ id: "x", type: "text", props: { content: "ok" } }] }), []);
  assert.equal(store.resolve("u")!.root!.children[0]!.type, "text");
});

test("no root: top-level nodes are wrapped; synonyms and enum aliases repaired; leaf children hoisted", () => {
  const store = new SurfaceStore(basicCatalog);
  const diags = store.render({
    surface: "q",
    nodes: [
      { id: "hdr", type: "alert", props: { title: "Q3" }, children: ["note"] },
      { id: "note", type: "text", props: { text: "Revenue up" } },
      { id: "c", type: "chart", props: { kind: "bar", series: [{ name: "rev", data: [1, 2] }] } },
      { id: "t", type: "table", props: { columns: [{ key: "a", align: "Right" }], rows: [] } },
    ],
  } as never);
  assert.deepEqual(diags.filter((d) => d.severity === "error"), []);
  const root = store.resolve("q")!.root!;
  assert.equal(root.type, "stack");
  assert.deepEqual(root.children.map((c) => c.id), ["hdr", "note", "c", "t"]);
  assert.equal(root.children[1]!.props.content, "Revenue up");
  assert.deepEqual((root.children[2]!.props.series as { values: number[] }[])[0]!.values, [1, 2]);
  assert.equal((root.children[3]!.props.columns as { align: string }[])[0]!.align, "end");
});

test("HTML-ish types, ids as type hints, bare chart numbers, prose children, node maps", () => {
  const store = new SurfaceStore(basicCatalog);
  const diags = store.render({
    surface: "h",
    components: {
      root: { type: "div", children: ["title", "revenue_chart", "signup", "Thanks for reading!"] },
      title: { type: "h1", text: "Q3" },
      revenue_chart: { props: { kind: "BarChart", series: [1, 2, 3], labels: ["a", "b", "c"] } },
      signup: { type: "form", children: ["email_input"] },
      email_input: { props: { label: "Email", bind: "/email" } },
    },
  } as never);
  assert.deepEqual(diags.filter((d) => d.severity === "error"), []);
  const root = store.resolve("h")!.root!;
  assert.deepEqual(root.children.map((c) => c.type), ["text", "chart", "form", "text"]);
  assert.equal(root.children[0]!.props.variant, "heading");
  assert.equal(root.children[1]!.props.kind, "bar");
  assert.deepEqual(root.children[1]!.props.series, [{ values: [1, 2, 3] }]);
  assert.equal(root.children[2]!.children[0]!.type, "input");
  assert.equal(root.children[3]!.props.content, "Thanks for reading!");
});

test("structural rules: array-wrapped type, template spec in children or props, metadata keys, typeless containers", () => {
  const store = new SurfaceStore(basicCatalog);
  const diags = store.render({
    surface: "r",
    nodes: [
      { id: "root", type: ["stack"], children: ["list1", "rep", "box"] },
      { id: "list1", type: "grid", children: [{ each: "/hotels", template: { template: "h" } }] },
      { id: "rep", each: "/hotels", template: "h" },
      { id: "box", __v__: 0, children: ["t"] },
      { id: "h", type: "card", title: "{name}" },
      { id: "t", type: "text", content: "x" },
    ],
    data: { hotels: [{ name: "A" }, { name: "B" }] },
  } as never);
  assert.deepEqual(diags.filter((d) => d.severity === "error"), []);
  const root = store.resolve("r")!.root!;
  assert.equal(root.type, "stack");
  assert.deepEqual(root.children[0]!.children.map((c) => c.props.title), ["A", "B"]);
  assert.equal(root.children[1]!.type, "stack");
  assert.deepEqual(root.children[1]!.children.map((c) => c.props.title), ["A", "B"]);
  assert.equal(root.children[2]!.type, "stack");
  assert.equal(root.children[2]!.props.__v__, undefined);
});

test("table string columns are matched to row keys after bindings resolve", () => {
  const store = new SurfaceStore(basicCatalog);
  store.render({
    surface: "t",
    nodes: [{ id: "root", type: "table", props: { columns: ["Product", "Revenue", "Units sold", "Growth vs. Q2"], rows: "{/products}" } }],
    data: { products: [{ product: "Headphones", revenue: "$184k", units: "1,230", growth: "+18%" }] },
  });
  const cols = store.resolve("t")!.root!.props.columns as { key: string; label: string }[];
  assert.deepEqual(cols.map((c) => [c.label, c.key]), [["Product", "product"], ["Revenue", "revenue"], ["Units sold", "units"], ["Growth vs. Q2", "growth"]]);
});

test("table columns fall back to position, and stay keys for array rows", () => {
  const store = new SurfaceStore(basicCatalog);
  store.render({ surface: "p", nodes: [{ id: "root", type: "table", props: { columns: ["Name", "Cost"], rows: [{ a: "x", b: 1 }] } }] });
  assert.deepEqual((store.resolve("p")!.root!.props.columns as { key: string }[]).map((c) => c.key), ["a", "b"]);
  store.render({ surface: "q", nodes: [{ id: "root", type: "table", props: { columns: ["Name"], rows: [["x"]] } }] });
  assert.deepEqual(store.resolve("q")!.root!.props.columns, [{ label: "Name", key: "Name" }]);
});

test("text projector reads a surface the way a user would", async () => {
  const { projectText } = await import("../src/text-projector.ts");
  const store = new SurfaceStore(basicCatalog);
  for (const ex of basicCatalog.examples) store.render(structuredClone(ex.render));
  const sales = projectText(store.resolve("sales")!);
  assert.match(sales, /^# Sales this month/);
  assert.match(sales, /Revenue: \$198k \(\+8%\)/);
  assert.match(sales, /\[line chart\] W1, W2, W3, W4\n\s+Revenue \(\$k\): 42, 51, 47, 58/);
  assert.match(sales, /Desk lamp \| \$24k/);
  const beta = projectText(store.resolve("beta")!);
  assert.match(beta, /\[Input \(email\)\] Email\*/);
  assert.match(beta, /\[Select\] Role: Developer \/ Designer \/ Other/);
  assert.match(projectText(store.resolve("trips")!), /\[Card\] Mountain cabin — \$240[\s\S]*\[Button: Choose → choose_trip\]/);
});

test("bench-driven: data inside nodes and update merge objects reach the data model", () => {
  const store = new SurfaceStore(basicCatalog);
  store.render({
    surface: "d",
    nodes: [
      { id: "root", type: "stack", children: ["k"] },
      { id: "k", type: "stat", props: { label: "CPU", value: "{/cpu}" }, data: { cpu: "42%" } },
    ],
    data: { title: "x" },
  } as never);
  assert.equal(store.resolve("d")!.root!.children[0]!.props.value, "42%");
  assert.equal(store.get("d")!.data.title, "x");
  store.update({ surface: "d", data: { cpu: "51%" } } as never);
  assert.equal(store.resolve("d")!.root!.children[0]!.props.value, "51%");
});

test("bench-driven: a JSON string where a list belongs is parsed, a binding is kept", () => {
  const store = new SurfaceStore(basicCatalog);
  const diags = store.render({
    surface: "t",
    nodes: [
      { id: "root", type: "stack", children: ["a", "b"] },
      { id: "a", type: "table", props: { columns: ["Task"], rows: '[{"task":"Buy oat milk"}]' } },
      { id: "b", type: "list", props: { items: "{/todo}" } },
    ],
    data: { todo: ["x"] },
  });
  assert.deepEqual(diags.filter((d) => d.severity === "error"), []);
  const [a, b] = store.resolve("t")!.root!.children;
  assert.deepEqual(a!.props.rows, [{ task: "Buy oat milk" }]);
  assert.deepEqual(b!.props.items, ["x"]);
});

test("bench-driven: HTML in markdown props becomes markdown; scalar payloads are sent as {value}", () => {
  const store = new SurfaceStore(basicCatalog);
  store.render({
    surface: "h",
    nodes: [
      { id: "root", type: "stack", children: ["t", "b"] },
      { id: "t", type: "text", props: { content: "<p><strong>Steps</strong></p><ol><li>Open</li><li>Tap</li></ol>" } },
      { id: "b", type: "button", props: { label: "Apply", action: "apply", payload: "frontend-role" } },
    ],
  });
  assert.equal(store.resolve("h")!.root!.children[0]!.props.content, "**Steps**\n\n1. Open\n2. Tap");
  assert.deepEqual(store.submit("h", "b").action?.data, { value: "frontend-role" });
});

test("inputs nothing can submit are an error; visibility toggles and forms are fine", () => {
  const store = new SurfaceStore(basicCatalog);
  const stranded = store.render({
    surface: "s",
    nodes: [
      { id: "root", type: "stack", children: ["name", "email"] },
      { id: "name", type: "input", props: { label: "Name", bind: "/f/name" } },
      { id: "email", type: "input", props: { label: "Email", bind: "/f/email" } },
    ],
  });
  assert.match(stranded.find((d) => d.severity === "error")!.message, /"name", "email" collect values but nothing submits them: put them in a form or add a button/);
  const toggle = store.render({
    surface: "t",
    nodes: [
      { id: "root", type: "stack", children: ["more", "details"] },
      { id: "more", type: "checkbox", props: { label: "Show details", bind: "/ui/more" } },
      { id: "details", type: "text", props: { content: "…", visibleIf: "{/ui/more}" } },
    ],
  });
  assert.deepEqual(toggle.filter((d) => d.severity === "error"), []);
});

test("an empty container surface is an error the model can act on", () => {
  const store = new SurfaceStore(basicCatalog);
  const diags = store.render({ surface: "chats", title: "Messages", nodes: [{ id: "root", type: "stack" }] });
  assert.ok(diags.some((d) => d.severity === "error" && /surface is empty/.test(d.message)));
  assert.ok(!store.render({ surface: "ok", nodes: [{ id: "root", type: "stack", children: ["t"] }, { id: "t", type: "text", props: { text: "hi" } }] }).some((d) => /empty/.test(d.message)));
});

test("an update that replaces a parent's children removes what it cut out, and a node keeps one parent", () => {
  // From a live run: after a booking submit the model patched the form with the
  // hotel cards as its children, cutting out the form's own fields.
  const store = new SurfaceStore(basicCatalog);
  store.render({
    surface: "h",
    nodes: [
      { id: "root", type: "stack", children: ["compare", "book"] },
      { id: "compare", type: "grid", children: ["h1", "h2"] },
      { id: "h1", type: "card", props: { title: "Ritz" } },
      { id: "h2", type: "card", props: { title: "Hoshinya" } },
      { id: "book", type: "form", props: { submit: "confirm" }, children: ["name"] },
      { id: "name", type: "input", props: { label: "Name", bind: "/b/name" } },
    ],
  });
  const diags = store.update({ surface: "h", nodes: [{ id: "book", children: [{ id: "h1", type: "card", props: { title: "Ritz", badge: "booked" } }, { id: "h2", type: "card", props: { title: "Hoshinya" } }] as never }] });
  const st = store.get("h")!;
  assert.ok(!st.nodes.has("name"), "the cut-out field is gone, not attached to the root");
  assert.ok(diags.some((d) => /removed: "name"/.test(d.message)));
  assert.deepEqual(st.nodes.get("compare")!.children, ["h1", "h2"]);
  assert.deepEqual(st.nodes.get("book")!.children, [], "the cards stay with their first parent");
  assert.ok(diags.some((d) => d.node === "h1" && /kept under "compare"/.test(d.message)));
  assert.deepEqual(st.nodes.get("root")!.children, ["compare", "book"]);
});

test("a list template listed among children renders only per item; lists in text read as lists", () => {
  // From a live run: {each, template} written as a children item, with the template beside it.
  const store = new SurfaceStore(basicCatalog);
  store.render({
    surface: "h",
    nodes: [{ id: "root", type: "grid", children: [{ each: "/hotels", template: "h" }, { id: "h", type: "card", props: { title: "{name}", body: "{amenities}" } }] as never }],
    data: { hotels: [{ name: "Zen", amenities: ["Onsen", "Tatami"] }, { name: "Villa", amenities: ["Gym"] }] },
  });
  const text = projectText(store.resolve("h")!);
  assert.equal((text.match(/\[Card\]/g) ?? []).length, 2);
  assert.doesNotMatch(text, /\{name\}/);
  assert.match(text, /Onsen, Tatami/);
});

test("placeholders with no value are an error, surface data by name binds; double-escaped newlines become line breaks", () => {
  const store = new SurfaceStore(basicCatalog);
  const diags = store.render({ surface: "p", nodes: [{ id: "root", type: "card", props: { title: "Hotels", body: "{description}\\n\\n**Price**: {price}" } }] });
  assert.ok(diags.some((d) => d.severity === "error" && /\{description\}, \{price\} has no value/.test(d.message)));
  // From a live run: "{details}" with "details" in the surface's own data means "{/details}".
  const own = store.render({ surface: "c", nodes: [{ id: "root", type: "alert", props: { title: "Booked", body: "{details}" } }], data: { details: "Code KYOTO-1" } });
  assert.ok(!own.some((d) => /has no value/.test(d.message)));
  assert.match(projectText(store.resolve("c")!), /Code KYOTO-1/);
  assert.equal(store.get("p")!.nodes.get("root")!.props!.body, "{description}\n\n**Price**: {price}");
  const ok = store.render({ surface: "q", nodes: [{ id: "root", type: "stack", children: { each: "/xs", template: "t" } }, { id: "t", type: "text", props: { content: "{name} \\{literal}" } }], data: { xs: [{ name: "a" }] } });
  assert.ok(!ok.some((d) => /list template/.test(d.message)));
});

test("data written inside the nodes string after the list is part of the call; items' own lists and plain values bind", () => {
  // From a live run: nodes: "[...], \"data\": {...}", an item list at "/amenities", plain items as "{item}".
  const store = new SurfaceStore(basicCatalog);
  const nodes = JSON.stringify([
    { id: "root", type: "stack", children: { each: "/hotels", template: "h" } },
    { id: "h", type: "card", props: { title: "{name}" }, children: ["a"] },
    { id: "a", type: "stack", children: { each: "/amenities", template: "t" } },
    { id: "t", type: "text", props: { content: "{item}" } },
  ]);
  const diags = store.apply("vak_render", { surface: "k", nodes: `${nodes}, "data": {"hotels":[{"name":"Zen","amenities":["Onsen","Tatami"]}]}` });
  assert.ok(diags.some((d) => /"data" was written inside "nodes"/.test(d.message)));
  assert.equal(projectText(store.resolve("k")!), "[Card] Zen\n  Onsen\n  Tatami");
});

test("one fixed button per item stays with its own item; repeated endings after a placeholder are dropped", () => {
  // From a live run: "Book <hotel>" x3 inside the card template, price "$800/night" + "{price}/night".
  const store = new SurfaceStore(basicCatalog);
  store.render({
    surface: "h",
    nodes: [
      { id: "root", type: "stack", children: { each: "/hotels", template: "c" } },
      { id: "c", type: "card", props: { title: "{name}", subtitle: "{price}/night" }, children: ["b1", "b2"] },
      { id: "b1", type: "button", props: { label: "Book Zen", action: "book" } },
      { id: "b2", type: "button", props: { label: "Book Villa", action: "book" } },
    ],
    data: { hotels: [{ name: "Zen", price: "$800/night" }, { name: "Villa", price: "$1,200" }] },
  });
  assert.equal(projectText(store.resolve("h")!), "[Card] Zen — $800/night\n  [Button: Book Zen → book]\n[Card] Villa — $1,200/night\n  [Button: Book Villa → book]");
  // A single fixed button per card is the normal pattern and stays in every card.
  const trips = basicCatalog.examples.find((e) => e.render.surface === "trips")!.render;
  store.render(structuredClone(trips));
  assert.equal((projectText(store.resolve("trips")!).match(/\[Button: Choose/g) ?? []).length, 3);
});

test("node settings written as an object of their own in a children list apply to the node before them", () => {
  // Telegram, 2026-10-25, the 4B model after a "Book" tap: the trailing
  // {"priority":"secondary"} was read as a node with no type (an error, and a retry).
  const call = {
    surface: "booking_details",
    title: "Your Booking Details",
    nodes:
      '[{"children":[{"children":[{"id":"info","type":"text","props":{"content":"You have selected: **Kyoto City Hotel**\\n\\nThis is a modern business hotel located in the city center, perfect for your temple visits and dining at local restaurants. Free breakfast is included."},"variant":"body"},{"children":[{"id":"pay-btn","type":"button","props":{"action":"confirm_booking","label":"Confirm Booking","payload":{},"style":"primary"}}]}]},{"priority":"secondary"}]',
    data: { guests: 1, hotel: "Kyoto City Hotel" },
  };
  const store = new SurfaceStore(basicCatalog);
  const diags = store.apply("vak_render", call);
  assert.deepEqual(diags.filter((d) => d.severity === "error"), []);
  assert.ok(diags.some((d) => /\{"priority":"secondary"\} in a children list is not a node; applied to/.test(d.message)));
  const text = projectText(store.resolve("booking_details")!);
  assert.match(text, /You have selected: \*\*Kyoto City Hotel\*\*/);
  assert.match(text, /\[Button: Confirm Booking → confirm_booking\]/);
  const settled = [...store.get("booking_details")!.nodes.values()].find((n) => n.props?.priority === "secondary");
  assert.ok(settled && settled.type !== "$invalid", "the setting landed on a real node");

  // With no node before it, it is dropped, still without an error.
  const alone = new SurfaceStore(basicCatalog);
  const d2 = alone.apply("vak_render", { surface: "s", nodes: [{ id: "root", type: "stack", children: [{ span: "full" }, { id: "t", type: "text", props: { content: "hi" } }] }] });
  assert.deepEqual(d2.filter((d) => d.severity === "error"), []);
  assert.deepEqual(alone.get("s")!.nodes.get("root")!.children, ["t"]);
});

test("an input whose kind names another component is that component", () => {
  // Telegram, 2026-10-25, the 4B model confirming a booking: `<input type="date">`
  // written as {"type":"input","props":{"kind":"date"}} failed the kind enum (an
  // error, and a retry that lost the date field).
  const call = {
    surface: "confirmation_success",
    title: "Booking Confirmed! ✨",
    nodes:
      "[{\"children\":[{\"children\":[{\"id\":\"message\",\"type\":\"text\",\"props\":{\"content\":\"Your booking at **Kyoto City Hotel** has been confirmed!\\n\\n- Room: Deluxe city view\\n- Date: (Please fill out details)\\n- Total: ¥8,500 per night\\n\\nA confirmation will be sent to your email shortly.\\n\\nEnjoy exploring Kyoto's temples and cuisine!\"},\"variant\":\"body\"},{\"children\":[{\"id\":\"details\",\"type\":\"form\",\"props\":{\"submit\":\"save_details\",\"submitLabel\":\"Save Details\"},\"children\":[{\"id\":\"date\",\"type\":\"input\",\"props\":{\"bind\":\"/details/date\",\"label\":\"Check-in Date\",\"kind\":\"date\"}},{\"id\":\"guests\",\"type\":\"select\",\"props\":{\"bind\":\"/details/guests\",\"label\":\"Number of Guests\",\"options\":[\"1\",\"2\",\"3\",\"4\"]},{\"id\":\"notes\",\"type\":\"textarea\",\"props\":{\"bind\":\"/details/notes\",\"label\":\"Special Requests\"}}]}]},{\"priority\":\"secondary\",\"type\":\"stack\"}]",
    data: {date: "2024-12-15",guests: 1,hotel: "Kyoto City Hotel",notes: ""},
  };
  const store = new SurfaceStore(basicCatalog);
  const diags = store.apply("vak_render", call);
  assert.deepEqual(diags.filter((d) => d.severity === "error"), []);
  assert.ok(diags.some((d) => d.node === "date" && /kind "date" names the "date" component/.test(d.message)));
  const date = store.get("confirmation_success")!.nodes.get("date")!;
  assert.equal(date.type, "date");
  assert.equal(date.props?.kind, undefined);
  assert.equal(date.props?.bind, "/details/date");
  assert.match(projectText(store.resolve("confirmation_success")!), /Check-in Date/);

  // Aliases of the prop and of the named component work too: a range date, a checkbox.
  const more = new SurfaceStore(basicCatalog);
  const d2 = more.apply("vak_render", {
    surface: "s",
    nodes: [
      { id: "root", type: "form", props: { submit: "go" }, children: ["stay", "agree"] },
      { id: "stay", type: "input", props: { label: "Stay", bind: "/f/stay", inputType: "daterange" } },
      { id: "agree", type: "input", props: { label: "I agree", bind: "/f/agree", kind: "checkbox" } },
    ],
  });
  assert.deepEqual(d2.filter((d) => d.severity === "error"), []);
  assert.equal(more.get("s")!.nodes.get("stay")!.type, "date");
  assert.equal(more.get("s")!.nodes.get("stay")!.props?.range, true);
  assert.equal(more.get("s")!.nodes.get("agree")!.type, "checkbox");

  // A value that names nothing is still an error the model sees; a valid kind is untouched.
  const typo = new SurfaceStore(basicCatalog);
  const d3 = typo.apply("vak_render", {
    surface: "s",
    nodes: [
      { id: "root", type: "form", props: { submit: "go" }, children: ["a", "b"] },
      { id: "a", type: "input", props: { label: "A", bind: "/f/a", kind: "password" } },
      { id: "b", type: "input", props: { label: "B", bind: "/f/b", kind: "email" } },
    ],
  });
  assert.ok(d3.some((d) => d.severity === "error" && d.node === "a" && /props\/kind/.test(d.message)));
  assert.equal(typo.get("s")!.nodes.get("b")!.type, "input");

  // A patch that sets the kind later retypes the existing input.
  const p = typo.apply("vak_update", { surface: "s", nodes: [{ id: "b", props: { kind: "date" } }] });
  assert.ok(p.some((d) => d.node === "b" && /names the "date" component/.test(d.message)));
  assert.equal(typo.get("s")!.nodes.get("b")!.type, "date");
});

test("a root list closed one level early keeps its later siblings; a bare pointer where a list is bound is the binding", () => {
  // Playground, 2026-10-25, the 4B model asked for a Q3 sales dashboard: it shut
  // the root list after the KPI grid ("]}]}"), and an extra "]}" after the table
  // closed the whole list, so the alert after it vanished without a word. The
  // table's rows were "/top_products" with no braces and showed the path itself.
  const call = {
    surface: "sales_dashboard",
    title: "Q3 Sales Dashboard",
    nodes:
      "[{\"id\": \"root\", \"type\": \"stack\", \"children\": [{\"id\": \"kpis\", \"type\": \"grid\", \"props\": {\"columns\": 4}, \"children\": [{\"id\": \"k1\", \"type\": \"stat\", \"props\": {\"label\": \"Revenue\", \"value\": \"$1.2M\", \"delta\": \"+15%\", \"trend\": \"up\"}, \"span\": 2}, {\"id\": \"k2\", \"type\": \"stat\", \"props\": {\"label\": \"Orders\", \"value\": \"8,420\", \"delta\": \"+8%\", \"trend\": \"up\"}, \"span\": 2}, {\"id\": \"k3\", \"type\": \"stat\", \"props\": {\"label\": \"Conversion Rate\", \"value\": \"3.2%\", \"delta\": \"+0.4%\", \"trend\": \"up\"}, \"span\": 1}]}]}, {\"id\": \"chart\", \"type\": \"chart\", \"props\": {\"kind\": \"line\", \"labels\": [\"Jul\", \"Aug\", \"Sep\"], \"series\": [{\"name\": \"Revenue ($k)\", \"values\": [645, 623, 789]}]}}, {\"id\": \"top\", \"type\": \"table\", \"props\": {\"columns\": [{\"key\": \"product\", \"label\": \"Product\"}, {\"key\": \"sales\", \"label\": \"Sales ($k)\", \"align\": \"end\"}], \"rows\": \"/top_products\"}, \"span\": 3}]}, {\"id\": \"alert\", \"type\": \"alert\", \"props\": {\"title\": \"Q3 Report Ready\", \"body\": \"Your Q3 sales report is ready for review.\", \"tone\": \"success\"}}]}]",
    data: { conversion_rate: "3.2%", orders: 8420, revenue: "$1.2M", top_products: [{ product: "Pro Keyboard", sales: "$245k" }, { product: "USB-C Hub", sales: "$189k" }, { product: "Monitor Stand", sales: "$167k" }, { product: "Webcam 4K", sales: "$142k" }, { product: "Desk Mat", sales: "$98k" }] },
  };
  const store = new SurfaceStore(basicCatalog);
  const diags = store.apply("vak_render", call);
  assert.deepEqual(diags.filter((d) => d.severity === "error"), []);
  assert.deepEqual(store.get("sales_dashboard")!.nodes.get("root")!.children, ["kpis", "chart", "top", "alert"]);
  const text = projectText(store.resolve("sales_dashboard")!);
  assert.match(text, /Pro Keyboard \| \$245k/);
  assert.match(text, /Desk Mat \| \$98k/);
  assert.doesNotMatch(text, /\/top_products/);
  assert.match(text, /Q3 Report Ready/);

  // A bare pointer stays text where a prop takes plain text.
  const plain = new SurfaceStore(basicCatalog);
  plain.apply("vak_render", { surface: "s", nodes: [{ id: "root", type: "text", props: { content: "/help" } }] });
  assert.equal(plain.get("s")!.nodes.get("root")!.props?.content, "/help");
});

test("an inline node reusing an id already written in the same call is its own node", () => {
  // Playground, 2026-10-25, the 4B model asked for a 5-day workout plan, one tab
  // per day: every day's button had the id "actions". Each replaced the one
  // before, so Day 1 showed "Start Day 5" and days 2-5 had no button.
  const call = {"surface":"workout_plan","title":"5-Day Beginner Workout Plan","nodes":[{"children":[{"children":[{"id":"actions","props":{"action":"start_day1","label":"Start Day 1","style":"primary"},"type":"button"}],"id":"day1","props":{"body":"Dynamic stretching, light cardio","subtitle":"Focus on mobility","title":"Day 1: Full Body Warm-Up","tone":"info"},"type":"card"},{"children":[{"id":"actions","props":{"action":"start_day2","label":"Start Day 2","style":"primary"},"type":"button"}],"id":"day2","props":{"body":"Chest, back, shoulder exercises","subtitle":"Push and pull focus","title":"Day 2: Upper Body Strength","tone":"info"},"type":"card"},{"children":[{"id":"actions","props":{"action":"start_day3","label":"Start Day 3","style":"primary"},"type":"button"}],"id":"day3","props":{"body":"Yoga or light walking","subtitle":"Low intensity movement","title":"Day 3: Active Recovery","tone":"success"},"type":"card"},{"children":[{"id":"actions","props":{"action":"start_day4","label":"Start Day 4","style":"primary"},"type":"button"}],"id":"day4","props":{"body":"Squats, lunges, core work","subtitle":"Legs and glutes focus","title":"Day 4: Lower Body Power","tone":"info"},"type":"card"},{"children":[{"id":"actions","props":{"action":"start_day5","label":"Start Day 5","style":"primary"},"type":"button"}],"id":"day5","props":{"body":"Short bursts of intense exercise","subtitle":"High intensity burn","title":"Day 5: HIIT Finisher","tone":"warning"},"type":"card"}],"id":"root","props":{"title":"Daily Plans"},"type":"tabs"}]};
  const store = new SurfaceStore(basicCatalog);
  const diags = store.apply("vak_render", call);
  assert.deepEqual(diags.filter((d) => d.severity === "error"), []);
  const text = projectText(store.resolve("workout_plan")!);
  for (let day = 1; day <= 5; day++) assert.equal((text.match(new RegExp(`\\[Button: Start Day ${day} → start_day${day}\\]`, "g")) ?? []).length, 1);
  assert.match(text, /Day 1: Full Body Warm-Up[^]*Start Day 1[^]*Day 2: Upper Body/);

  // An update still patches an existing node by its id.
  store.apply("vak_update", { surface: "workout_plan", nodes: [{ id: "day2", children: [{ id: "actions_2", props: { label: "Begin" } }] }] });
  assert.match(projectText(store.resolve("workout_plan")!), /\[Button: Begin → start_day2\]/);
});

test("a stray closer with no closers right after it is read by how the rest of the text closes", () => {
  // Playground, 2026-10-25, the 4B model's second Q3 dashboard: an extra "}" after
  // the first KPI ("...}}}, {orders}...") was read as an omitted "]", which shut the
  // KPI stack early. Every closer after it landed one level off, so the chart, the
  // table and the data were lost (only the KPIs showed).
  const call = {"surface":"sales-q3","title":"Q3 Sales Dashboard","nodes":"[{\"id\": \"root\", \"type\": \"grid\", \"props\": {\"columns\": 4, \"gap\": \"lg\"}, \"children\": [{\"id\": \"kpis\", \"type\": \"stack\", \"props\": {\"direction\": \"vertical\", \"gap\": \"md\"}, \"children\": [{\"id\": \"revenue_kpi\", \"type\": \"stat\", \"props\": {\"label\": \"Revenue\", \"value\": \"$198k\", \"delta\": \"+$23k\", \"trend\": \"up\", \"tone\": \"success\"}}}, {\"id\": \"orders_kpi\", \"type\": \"stat\", \"props\": {\"label\": \"Orders\", \"value\": \"1,284\", \"delta\": \"+120\", \"trend\": \"up\", \"tone\": \"info\"}}, {\"id\": \"refund_kpi\", \"type\": \"stat\", \"props\": {\"label\": \"Refund Rate\", \"value\": \"0.9%\", \"delta\": \"-0.1%\", \"trend\": \"down\", \"tone\": \"neutral\"}}]}], \"span\": 2, \"priority\": \"primary\"}, {\"id\": \"chart_section\", \"type\": \"stack\", \"props\": {\"direction\": \"vertical\", \"gap\": \"lg\"}, \"children\": [{\"id\": \"revenue_chart\", \"type\": \"chart\", \"props\": {\"kind\": \"line\", \"labels\": [\"July\", \"Aug\", \"Sep\"], \"series\": [{\"name\": \"Revenue ($k)\", \"values\": [135, 142, 186]}, {\"name\": \"Orders (%)\", \"values\": [79, 81, 77]}]}}, {\"id\": \"revenue_breakdown\", \"type\": \"stack\", \"props\": {\"direction\": \"vertical\", \"gap\": \"md\"}, \"children\": [{\"id\": \"prod_1\", \"type\": \"stat\", \"props\": {\"label\": \"Top Product\", \"value\": \"Desk lamp\", \"delta\": \"+24k\", \"trend\": \"up\", \"tone\": \"success\"}}}, {\"id\": \"prod_2\", \"type\": \"stat\", \"props\": {\"label\": \"Runner-up\", \"value\": \"Chair\", \"delta\": \"+19k\", \"trend\": \"up\", \"tone\": \"info\"}}]}], \"priority\": \"secondary\"}, {\"id\": \"top_products_table\", \"type\": \"table\", \"props\": {\"columns\": [{\"key\": \"name\", \"label\": \"Product\"}, {\"key\": \"sales\", \"label\": \"Sales (in $k)\", \"align\": \"end\"}], \"rows\": \"/products/q3\"}, \"priority\": \"primary\"}], \"data\": {\"revenue\": \"$198k\", \"orders\": 1284, \"refunds\": \"0.9%\", \"products\": {\"q3\": [{\"name\": \"Desk lamp\", \"sales\": \"$24k\"}, {\"name\": \"Chair\", \"sales\": \"$19k\"}, {\"name\": \"Cable organizer\", \"sales\": \"$16k\"}, {\"name\": \"Foot rest\", \"sales\": \"$15k\"}, {\"name\": \"Monitor stand\", \"sales\": \"$14k\"}]}}}]"};
  const store = new SurfaceStore(basicCatalog);
  const diags = store.apply("vak_render", call);
  assert.deepEqual(diags.filter((d) => d.severity === "error"), []);
  const nodes = store.get("sales-q3")!.nodes;
  assert.deepEqual(nodes.get("kpis")!.children, ["revenue_kpi", "orders_kpi", "refund_kpi"]);
  assert.deepEqual(nodes.get("revenue_breakdown")!.children, ["prod_1", "prod_2"]);
  const text = projectText(store.resolve("sales-q3")!);
  assert.match(text, /\[line chart\] July, Aug, Sep/);
  assert.match(text, /Monitor stand \| \$14k/);
});

test("a key opened with a double quote and closed with a single one ends at that quote", () => {
  // Playground, 2026-10-25, the 4B model's third Q3 dashboard: every button wrote
  // "action':'view_july','payload':{'month':'July'}. Read to the next double quote,
  // the key swallowed the August card, the table and three product cards, and the
  // buttons that were left sent the action ":".
  const call = {"surface":"q3_dashboard","title":"Q3 Sales Dashboard","nodes":"[{\"id\": \"root\", \"type\": \"grid\", \"props\": {\"columns\": 2, \"minItemWidth\": \"md\", \"gap\": \"lg\"}, \"children\": [{\"id\": \"kpis\", \"type\": \"stack\", \"props\": {\"direction\": \"horizontal\", \"gap\": \"sm\", \"align\": \"end\"}, \"priority\": \"primary\", \"children\": [{\"id\": \"k1\", \"type\": \"stat\", \"props\": {\"label\": \"Revenue\", \"value\": \"$482.3k\", \"delta\": \"+$52.1k\", \"trend\": \"up\", \"tone\": \"success\"}, \"span\": 1}, {\"id\": \"k2\", \"type\": \"stat\", \"props\": {\"label\": \"Orders\", \"value\": \"1,047\", \"delta\": \"+18% w/w\", \"trend\": \"up\", \"tone\": \"info\"}, \"span\": 1}, {\"id\": \"k3\", \"type\": \"stat\", \"props\": {\"label\": \"Avg. Order Value\", \"value\": \"$459\", \"delta\": \"+$34\", \"trend\": \"up\", \"tone\": \"neutral\"}, \"span\": 2}]}, {\"id\": \"revenue_chart\", \"type\": \"chart\", \"props\": {\"kind\": \"area\", \"labels\": [\"July\", \"August\", \"September\"], \"series\": [{\"name\": \"Revenue ($k)\", \"values\": [430, 415, 482]}], \"span\": 1}, \"children\": [{\"id\": \"chart_lines\", \"type\": \"stack\", \"props\": {\"direction\": \"vertical\"}, \"children\": [{\"id\": \"july_line\", \"type\":\"card\",\"props\":{\"label\":\"July\",\"value\":\"$430k\",\"delta\":\"+12%\"},\"children\":[{\"id\":\"view\",\"type\":\"button\",\"props\":{\"label\":\"View details\",\"action':'view_july','payload':{'month':'July'}}}]}}, {\"id\":\"august_line\", \"type\":\"card\",\"props\":{\"label\":\"August\",\"value\":\"$415k\",\"delta\":\"+9%\"},\"children\":[{\"id\":\"view\",\"type\":\"button\",\"props\":{\"label\":\"View details\",\"action':'view_august','payload':{'month':'August'}}}]}]}}]}, {\"id\": \"products_table\", \"type\": \"table\", \"props\": {\"columns\": [{\"key\":\"product\",\"label\":\"Product\"},{\"key\":\"sales\",\"label\":\"Sales ($k)\"}], \"rows\": \"/top_products\"}, \"priority\": \"secondary\", \"children\": [{\"id\":\"row1\",\"type\":\"card\",\"props\":{\"title\":\"Probiotic Complex\",\"value\":\"$24,850\",\"delta\":\"+15%\"},\"children\":[{\"id\":\"action\",\"type\":\"button\",\"props\":{\"label\":\"View details\",\"action':'view_product','payload':{'product':'Probiotic Complex'}}}]}, {\"id\":\"row2\",\"type\":\"card\",\"props\":{\"title\":\"Immune Boost Tablets\",\"value\":\"$38,700\",\"delta\":\"+4%\"},\"children\":[{\"id\":\"action\",\"type\":\"button\",\"props\":{\"label\":\"View details\",\"action':'view_product','payload':{'product':'Immune Boost Tablets'}}}]}, {\"id\":\"row3\",\"type\":\"card\",\"props\":{\"title\":\"Multi-Vitamin Pack\",\"value\":\"$18,200\",\"delta\":\"+7%\"},\"children\":[{\"id\":\"action\",\"type\":\"button\",\"props\":{\"label\":\"View details\",\"action':'view_product','payload':{'product':'Multi-Vitamin Pack'}}}]}, {\"id\":\"row4\",\"type\":\"card\",\"props\":{\"title\":\"Omega-3 Fish Oil\",\"value\":\"$15,400\",\"delta\":\"+2%\"},\"children\":[{\"id\":\"action\",\"type\":\"button\",\"props\":{\"label\":\"View details\",\"action':'view_product','payload':{'product':'Omega-3 Fish Oil'}}}]}, {\"id\":\"row5\",\"type\":\"card\",\"props\":{\"title\":\"Vitamin C Gummies\",\"value\":\"$12,600\",\"delta\":\"+1%\"},\"children\":[{\"id\":\"action\",\"type\":\"button\",\"props\":{\"label\":\"View details\",\"action':'view_product','payload':{'product':'Vitamin C Gummies'}}}]}]}}]","data":{"avg_order_value":459,"orders":1047,"revenue":482.3,"top_products":[{"delta":"+15%","product":"Probiotic Complex","sales":"$24,850"},{"delta":"+4%","product":"Immune Boost Tablets","sales":"$38,700"},{"delta":"+7%","product":"Multi-Vitamin Pack","sales":"$18,200"}]}};
  const store = new SurfaceStore(basicCatalog);
  const diags = store.apply("vak_render", call);
  assert.deepEqual(diags.filter((d) => d.severity === "error"), []);
  const text = projectText(store.resolve("q3_dashboard")!);
  assert.match(text, /\[Button: View details → view_july\]/);
  assert.match(text, /\[Button: View details → view_august\]/);
  for (const p of ["Probiotic Complex", "Immune Boost Tablets", "Multi-Vitamin Pack", "Omega-3 Fish Oil", "Vitamin C Gummies"]) assert.match(text, new RegExp(`\\[Card\\] ${p}`));
  assert.match(text, /Probiotic Complex \| \$24,850/);
  assert.doesNotMatch(text, /→ :\]/);
  const button = [...store.get("q3_dashboard")!.nodes.values()].find((n) => n.props?.action === "view_july");
  assert.deepEqual(button?.props?.payload, { month: "July" });
});

test("a top-level name that only an input's bind path ends in is that input's value", () => {
  // 4B, bench pizza-order: a live total "{size} pizza, {crust} crust" beside
  // selects bound to /form/size and /form/crust was an error and two retries.
  const store = new SurfaceStore(basicCatalog);
  const diags = store.apply("vak_render", {
    surface: "pizza",
    nodes: [
      { id: "root", type: "form", props: { submit: "order" }, children: ["size", "crust", "total"] },
      { id: "size", type: "select", props: { label: "Size", bind: "/form/size", options: ["Small", "Large"] } },
      { id: "crust", type: "select", props: { label: "Crust", bind: "/form/crust", options: ["Thin", "Thick"] } },
      { id: "total", type: "text", props: { content: "{size} pizza, {crust} crust, {sauce} sauce" } },
    ],
  });
  assert.deepEqual(diags.filter((d) => d.severity === "error").map((d) => d.message.slice(0, 20)), ["{sauce} has no value"]);
  store.setValue("pizza", "/form/size", "Large");
  assert.match(projectText(store.resolve("pizza")!), /Large pizza, {2}crust/);
});

test("an input bound under a list in the data is an error naming the conflict", () => {
  // 4B, bench gate todo-add: the add form bound "/todos/new-task" while /todos
  // was the task list, so typed text was never kept and "required" blocked it.
  const store = new SurfaceStore(basicCatalog);
  const diags = store.apply("vak_render", {
    surface: "todo",
    nodes: [
      { id: "root", type: "form", props: { submit: "add" }, children: ["task", "due"] },
      { id: "task", type: "input", props: { label: "Task", bind: "/todos/new-task" } },
      { id: "due", type: "input", props: { label: "Due", bind: "/form/due" } },
    ],
    data: { todos: [{ text: "Yoga" }] },
  });
  const errors = diags.filter((d) => d.severity === "error");
  assert.equal(errors.length, 1);
  assert.match(errors[0]!.message, /bind "\/todos\/new-task" cannot hold a value: "\/todos" is a list/);
});

// Real 4B output from the installed Vakyartha 0.1.0: "Compare three hotels in
// Kyoto for a week in November and let me book one". The first render wrote
// the hotels as a node of type "data"; the second wrote "rating":4.3", and its
// item template repeated the grid's list spec.
const kyotoData = JSON.parse(readFileSync(new URL("./fixtures/vakyartha-kyoto-data-node-4b-2026-10-25.json", import.meta.url), "utf8")) as { calls: { tool: string; args: string }[] };
const hotelNames = ["Kyoto Imperial Palace", "Arashiyama Inn", "Gion Boutique Hotel"];

test("a node of type \"data\" is the surface data at its id", () => {
  const store = new SurfaceStore(basicCatalog);
  const diags = store.apply(kyotoData.calls[0]!.tool, kyotoData.calls[0]!.args);
  assert.ok(!diags.some((d) => d.message.includes("unknown component")));
  const hotels = store.get("hotels_kyoto")!.data.hotels as Record<string, unknown>[];
  assert.deepEqual(hotels.map((h) => h.name), hotelNames);
  const text = projectText(store.resolve("hotels_kyoto")!);
  for (const name of hotelNames) assert.ok(text.includes(`[Card] ${name}`), name);
  // Without an id, its object value is merged into the data at the top.
  const plain = new SurfaceStore(basicCatalog);
  plain.apply("vak_render", { surface: "s", nodes: [{ id: "root", type: "text", props: { content: "{/city}" } }, { type: "data", value: { city: "Kyoto" } }] });
  assert.equal(plain.get("s")!.data.city, "Kyoto");
});

test("a template that repeats itself is one item's layout, not a cycle", () => {
  const store = new SurfaceStore(basicCatalog);
  const diags = store.apply(kyotoData.calls[1]!.tool, kyotoData.calls[1]!.args);
  assert.ok(diags.some((d) => d.node === "tpl" && d.message.includes("own template")));
  const hotels = store.get("hotels_kyoto")!.data.hotels as Record<string, unknown>[];
  assert.deepEqual(hotels.map((h) => h.name), hotelNames);
  assert.ok(hotels.every((h) => Object.keys(h).every((k) => /\w/.test(k))), "no keys made of punctuation");
  const text = projectText(store.resolve("hotels_kyoto")!);
  assert.ok(!text.includes("cycle"));
  assert.ok(text.includes("[Card] Arashiyama Inn — $665"));
  assert.ok(text.includes("[Button: Book This Hotel → book_hotel]"));
});
