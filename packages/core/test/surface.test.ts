import assert from "node:assert/strict";
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

test("placeholders outside a list template are an error; double-escaped newlines become line breaks", () => {
  const store = new SurfaceStore(basicCatalog);
  const diags = store.render({ surface: "p", nodes: [{ id: "root", type: "card", props: { title: "Hotels", body: "{description}\\n\\n**Price**: {price}" } }] });
  assert.ok(diags.some((d) => d.severity === "error" && /\{description\}, \{price\} can only be filled inside a list template/.test(d.message)));
  assert.equal(store.get("p")!.nodes.get("root")!.props!.body, "{description}\n\n**Price**: {price}");
  const ok = store.render({ surface: "q", nodes: [{ id: "root", type: "stack", children: { each: "/xs", template: "t" } }, { id: "t", type: "text", props: { content: "{name} \\{literal}" } }], data: { xs: [{ name: "a" }] } });
  assert.ok(!ok.some((d) => /list template/.test(d.message)));
});
