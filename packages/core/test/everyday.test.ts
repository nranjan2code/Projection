import assert from "node:assert/strict";
import { test } from "node:test";
import { basicCatalog, chartText, formFields, projectText, readField, SurfaceStore } from "../src/index.ts";

function render(node: Record<string, unknown>, data?: Record<string, unknown>) {
  const store = new SurfaceStore(basicCatalog);
  const diags = store.render({ surface: "s", nodes: [{ id: "root", ...node }], ...(data ? { data } : {}) } as never);
  return { errors: diags.filter((d) => d.severity === "error"), root: store.resolve("s")!.root!, text: projectText(store.resolve("s")!) };
}

test("calendar: dates, times and 6pm-style times become ISO and HH:MM, sorted; lowered by day", () => {
  const { errors, root, text } = render({ type: "mealplan", props: { schedule: [{ meal: "Dinner: pasta", day: "2026-11-03", time: "6pm" }, { title: "Breakfast", date: "2026-11-02 08:00" }] } });
  assert.deepEqual(errors, []);
  assert.equal(root.type, "calendar");
  assert.deepEqual(root.props.events, [{ title: "Breakfast", date: "2026-11-02", start: "08:00" }, { title: "Dinner: pasta", date: "2026-11-03", start: "18:00" }]);
  assert.equal(root.props.date, "2026-11-02");
  assert.match(text, /Mon 2 Nov 2026\*\* 08:00 · Breakfast/);
});

test("calendar with a bind is still the date picker", () => {
  const { root } = render({ type: "calendar", props: { label: "Trip start", bind: "/trip/start" } });
  assert.equal(root.type, "date");
});

test("board: cards land in their columns; an unlisted column is added; moves read from the bound value", () => {
  const { errors, root, text } = render({ type: "kanban", props: { stages: ["Applied", "Interview"], tasks: [{ company: "Acme", status: "interview" }, { title: "Globex", stage: "Offer" }, "Initech"] } });
  assert.deepEqual(errors, []);
  assert.deepEqual(root.props.columns, [{ id: "Applied", title: "Applied" }, { id: "Interview", title: "Interview" }, { id: "Offer", title: "Offer" }]);
  assert.deepEqual((root.props.cards as { column: string }[]).map((c) => c.column), ["Interview", "Offer", "Applied"]);
  assert.match(text, /\*\*Offer\*\* \(1\)/);
});

test("progress: money and percentages read as numbers; a rating defaults to 5; stage items are steps; a bound rating is an input", () => {
  assert.deepEqual(render({ type: "budget", props: { label: "Food", spent: "$420", limit: "$600" } }).root.props, { label: "Food", value: 420, max: 600, unit: "$" });
  const r = render({ type: "rating", props: { value: 4 } });
  assert.equal(r.root.props.max, 5);
  assert.match(r.text, /★★★★☆ 4\/5/);
  assert.equal(render({ type: "progress", props: { items: [{ title: "Order", status: "done" }] } }).root.type, "steps");
  const input = render({ type: "rating", props: { label: "How was it?", bind: "/form/stars" } }).root;
  assert.equal(input.type, "input");
  assert.equal(input.props.kind, "rating");
});

test("accordion, compare, timer, tree, math, diff and gantt resolve and lower to text", () => {
  const faq = render({ type: "faq", props: { questions: [{ q: "Refunds?", a: "Within 30 days." }] } });
  assert.deepEqual(faq.errors, []);
  assert.match(faq.text, /Refunds\?/);

  const cmp = render({ type: "proscons", props: { winner: "B", options: [{ name: "A", pros: ["cheap"], specs: { Weight: "1 kg" } }, { name: "B", cons: "heavy; loud", price: 99, features: { Weight: "2 kg" } }] } });
  assert.deepEqual(cmp.errors, []);
  const opts = cmp.root.props.options as Record<string, unknown>[];
  assert.deepEqual(opts.map((o) => o.best), [false, true]);
  assert.deepEqual(opts[1]!.cons, ["heavy", "loud"]);
  assert.match(cmp.text, /★ B — 99 \(best pick\)/);

  assert.equal(render({ type: "timer", props: { label: "Eggs", duration: "6m 30s" } }).root.props.duration, 390);
  assert.equal(render({ type: "countdown", props: { duration: "1:30" } }).root.props.duration, 90);
  assert.match(render({ type: "timer", props: { duration: 125 } }).text, /2:05/);

  const tree = render({ type: "filetree", props: { files: ["src/app/main.ts", "src/app/util.ts", "README.md"] } });
  assert.deepEqual(tree.root.props.items, [{ label: "src", children: [{ label: "app", children: [{ label: "main.ts", children: [] }, { label: "util.ts", children: [] }] }] }, { label: "README.md", children: [] }]);
  assert.match(tree.text, /- src\n\s+- app\n\s+- main\.ts/);
  const outline = render({ type: "outline", props: { items: ["Intro", "  Why", "  How", "Summary"] } }).root.props.items as { label: string; children: unknown[] }[];
  assert.deepEqual(outline.map((n) => [n.label, n.children.length]), [["Intro", 2], ["Summary", 0]]);

  const math = render({ type: "equation", props: { latex: "\\frac{a}{b}" } });
  assert.deepEqual(math.errors, []);
  assert.equal(math.root.props.tex, "\\frac{a}{b}");

  const diff = render({ type: "diff", props: { before: "a\nb\nc", after: "a\nB\nc" } });
  assert.match(diff.text, /```diff\n a\n-b\n\+B\n c\n```/);

  const g = render({ type: "roadmap", props: { phases: [{ name: "Build", from: "2026-12-01", to: "2026-12-20", done: 0.5 }, { title: "Plan", start: "2026-11-01", end: "2026-11-15" }] } });
  assert.deepEqual(g.errors, []);
  assert.deepEqual((g.root.props.tasks as { title: string; progress?: number }[]).map((t) => [t.title, t.progress]), [["Plan", undefined], ["Build", 50]]);
});

test("chart kinds: stacked, scatter points as pairs, heatmap and radar", () => {
  const sc = render({ type: "scatterplot", props: { series: [[1, 2], [3, 4]] } });
  assert.deepEqual(sc.errors, []);
  assert.deepEqual(sc.root.props.series, [{ x: [1, 3], values: [2, 4] }]);
  assert.deepEqual(chartText(sc.root.props).rows, [["1", "2"], ["3", "4"]]);
  const named = render({ type: "chart", props: { kind: "scatter", series: [{ name: "A", points: [{ x: 1, y: 5 }] }] } });
  assert.deepEqual(named.root.props.series, [{ name: "A", x: [1], values: [5] }]);
  for (const kind of ["stackedbar", "habit", "spider"]) assert.deepEqual(render({ type: "chart", props: { kind, labels: ["a", "b"], series: [[1, 2]] } }).errors, [], kind);
});

test("form inputs: time, range and rating are read from typed answers within bounds", () => {
  const store = new SurfaceStore(basicCatalog);
  store.render({ surface: "f", nodes: [{ id: "root", type: "form", children: ["t", "r", "s", "u"] }, { id: "t", type: "timepicker", props: { label: "At", bind: "/f/at" } }, { id: "r", type: "slider", props: { label: "Spice", bind: "/f/spice", min: 0, max: 10 } }, { id: "s", type: "starrating", props: { label: "Stars", bind: "/f/stars" } }, { id: "u", type: "upload", props: { label: "Photo", bind: "/f/photo", accept: "image/*" } }] } as never);
  const [t, r, s, u] = formFields(store.resolve("f")!.root!);
  assert.deepEqual([t!.kind, r!.kind, s!.kind, u!.kind], ["time", "range", "rating", "file"]);
  assert.deepEqual(readField(t!, "6:30pm"), { value: "18:30" });
  assert.deepEqual(readField(r!, "11"), { error: "Please send a number from 0 to 10" });
  assert.deepEqual(readField(s!, "4 stars"), { value: 4 });
  assert.deepEqual(readField(s!, "6"), { error: "Please send a number from 1 to 5" });
});

test("4B recorded shapes: split board cards rejoin, a bound bar progress is a slider, a note naming the best pick marks it", () => {
  const b = render({ type: "board", props: { columns: ["Applied", "Interview"], cards: [{ title: "Acme" }, { column: "Interview" }, { title: "Globex", column: "Applied" }] } });
  assert.deepEqual((b.root.props.cards as Record<string, unknown>[]).map((c) => [c.title, c.column]), [["Acme", "Interview"], ["Globex", "Applied"]]);
  const store = new SurfaceStore(basicCatalog);
  store.render({ surface: "f", nodes: [{ id: "root", type: "form", children: ["w"] }, { id: "w", type: "progress", props: { label: "Wait", bind: "/f/wait", kind: "bar", max: 10 } }] } as never);
  const w = store.resolve("f")!.root!.children[0]!;
  assert.deepEqual([w.type, w.props.kind], ["input", "range"]);
  const c = render({ type: "compare", props: { options: [{ name: "Pixel 9", note: "Best pick" }, { name: "iPhone 16" }] } });
  assert.deepEqual((c.root.props.options as Record<string, unknown>[]).map((o) => o.best), [true, false]);
});

test("compare with an action: each option is a control of its own on every target", () => {
  const store = new SurfaceStore(basicCatalog);
  const diags = store.render({ surface: "h", nodes: [{ id: "root", type: "compare", props: { action: "book_hotel", actionLabel: "Book", payload: { nights: 7 }, options: [{ name: "Ryokan" }, { name: "Hilton", best: true }] } }] } as never);
  assert.deepEqual(diags.filter((d) => d.severity === "error"), []);
  const res = store.submit("h", "root#1", "test");
  assert.deepEqual(res.action?.action, "book_hotel");
  assert.deepEqual(res.action?.data, { nights: 7, option: "Hilton" });
  assert.equal(res.action?.source, "root#1");
  assert.deepEqual(store.submit("h", res.action!.source, "test").action?.data, { nights: 7, option: "Hilton" });
  assert.ok(store.submit("h", "root#5", "test").errors.root ?? store.submit("h", "root#5", "test").errors["root#5"]);
  const text = projectText(store.resolve("h")!);
  assert.match(text, /\[Button: Book Ryokan → book_hotel\]/);
  assert.match(text, /\[Button: Book Hilton → book_hotel\]/);
});
