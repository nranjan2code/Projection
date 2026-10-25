import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { basicCatalog } from "../src/basic-catalog.ts";
import { improves, SurfacePublisher } from "../src/publish.ts";
import { SurfaceStore } from "../src/surface.ts";
import { projectText } from "../src/text-projector.ts";
import { walk } from "../src/surface.ts";

// Real 4B output from Vakyartha: "Compare three hotels in Kyoto for a week in
// November and let me book one". All four renders named a list template
// "hotel_tpl" and never sent it; each retry dropped more; the last one, with
// only the title left, replaced the rest.
const kyoto = JSON.parse(readFileSync(new URL("./fixtures/vakyartha-kyoto-4b-2026-10-25.json", import.meta.url), "utf8")) as { calls: { tool: string; args: string }[] };

const bad = (n: number) => ({ surface: "s", nodes: [{ id: "root", type: "stack", children: [...Array.from({ length: n }, (_, i) => `t${i}`), "never_sent"] }, ...Array.from({ length: n }, (_, i) => ({ id: `t${i}`, type: "text", props: { content: `line ${i}` } }))] });
const good = (n: number) => ({ surface: "s", nodes: [{ id: "root", type: "stack", children: Array.from({ length: n }, (_, i) => `t${i}`) }, ...Array.from({ length: n }, (_, i) => ({ id: `t${i}`, type: "text", props: { content: `line ${i}` } }))] });

test("a missing list template shows each item from its data, so the first render is already complete", () => {
  const store = new SurfaceStore(basicCatalog);
  const diags = store.apply(kyoto.calls[0]!.tool, kyoto.calls[0]!.args);
  assert.ok(!diags.some((d) => d.severity === "error" && d.message.includes("hotel_tpl")));
  const text = projectText(store.resolve("kyoto_hotels")!);
  for (const name of ["Ryōtei Hakone Ryokan", "Kiyamachi Hotel", "Nijomaru Guest House"]) assert.ok(text.includes(`[Card] ${name}`), name);
  assert.ok(text.includes("**Price per night:** $380"));
  assert.ok(!text.includes("[pending]"));
  // The second render (with the form's inputs) is clean, so the run ends there.
  const second = store.apply(kyoto.calls[1]!.tool, kyoto.calls[1]!.args);
  assert.deepEqual(second.filter((d) => d.severity === "error"), []);
  assert.ok(projectText(store.resolve("kyoto_hotels")!).includes("[Input (email)] Email*"));
});

test("a list whose \"[\" was left out is read as a list, not as made-up keys", () => {
  const store = new SurfaceStore(basicCatalog);
  store.apply(kyoto.calls[0]!.tool, kyoto.calls[0]!.args);
  const hotels = store.get("kyoto_hotels")!.data.hotels as Record<string, unknown>[];
  assert.deepEqual(hotels[1]!.features, ["Business-class rooms", "business center", "Rooftop dining", "Quick shuttle to temples"]);
  assert.deepEqual(hotels[2]!.ratings, [4.1]);
  assert.ok(!("Local ryokan style" in hotels[2]!));
});

test("a child that never arrived is a placeholder only while the render streams", () => {
  const store = new SurfaceStore(basicCatalog);
  store.render(bad(1), { partial: true });
  const types = (): string[] => {
    const out: string[] = [];
    walk(store.resolve("s")!.root!, (n) => out.push(n.type));
    return out;
  };
  assert.ok(types().includes("$pending"));
  assert.equal(store.snapshot("s")!.partial, true);
  store.render(bad(1));
  assert.ok(!types().includes("$pending"));
  assert.equal(store.snapshot("s")!.partial, undefined);
});

test("a template written in place is a node like any other child", () => {
  const store = new SurfaceStore(basicCatalog);
  const diags = store.render({
    surface: "s",
    nodes: [{ id: "root", type: "stack", children: { each: "/items", template: { type: "card", props: { title: "{name}" } } } }] as never,
    data: { items: [{ name: "A" }, { name: "B" }] },
  });
  assert.deepEqual(diags.filter((d) => d.severity === "error"), []);
  assert.equal(projectText(store.resolve("s")!), "[Card] A\n[Card] B");
});

test("improves: clean always shows; broken never replaces clean; broken replaces broken only with as much content", () => {
  assert.equal(improves({ errors: 0, content: 1 }, { errors: 2, content: 9 }), true);
  assert.equal(improves({ errors: 0, content: 1 }, { errors: 0, content: 9 }), true);
  assert.equal(improves({ errors: 1, content: 9 }, { errors: 0, content: 1 }), false);
  assert.equal(improves({ errors: 2, content: 5 }, { errors: 1, content: 5 }), true);
  assert.equal(improves({ errors: 1, content: 4 }, { errors: 1, content: 5 }), false);
});

test("a retry that would make the shown surface worse is held, and the run's end puts it back", () => {
  const store = new SurfaceStore(basicCatalog);
  const pub = new SurfacePublisher(store);
  store.render(bad(3), { partial: true });
  assert.ok(pub.streaming("s"), "a first render streams to the user");
  store.render(bad(3));
  const first = pub.settle("s");
  assert.ok(first.snapshot);

  store.render(bad(1), { partial: true });
  assert.equal(pub.streaming("s"), undefined, "a rewrite does not blank what is shown");
  store.render(bad(1));
  assert.deepEqual(pub.settle("s"), { held: true });

  const restored = pub.finish();
  assert.equal(restored.length, 1);
  assert.ok(restored[0]!.version > first.snapshot!.version, "clients take the restored version as newer");
  assert.equal(store.assess("s")!.content, 3);
});

test("a clean version replaces what is shown, even when smaller", () => {
  const store = new SurfaceStore(basicCatalog);
  store.render(good(3));
  const pub = new SurfacePublisher(store);
  store.render(good(1));
  assert.ok(pub.settle("s").snapshot);
  assert.deepEqual(pub.finish(), []);
});

test("a render cut off mid-stream stops showing placeholders when the run ends", () => {
  const store = new SurfaceStore(basicCatalog);
  const pub = new SurfacePublisher(store);
  store.render(bad(2), { partial: true });
  const [settled] = pub.finish();
  assert.equal(settled!.partial, undefined);
  assert.ok(!projectText(store.resolve("s")!).includes("[pending]"));
});
