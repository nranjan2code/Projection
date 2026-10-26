import assert from "node:assert/strict";
import { test } from "node:test";
import { basicCatalog } from "../src/basic-catalog.ts";
import { SurfaceStore } from "../src/surface.ts";
import { titleRepeated } from "../src/title.ts";

function root(title: string, nodes: unknown[]) {
  const store = new SurfaceStore(basicCatalog);
  store.apply("vak_render", { surface: "s", title, nodes });
  return store.resolve("s")!;
}

test("a title the opening content already says is an echo", () => {
  // Vakyartha, 2026-10-26, qwen3.5:4b-mlx: a "Hello!" surface opening with "Hello! How can I assist you today?",
  // and "GPT-4o Ultra Released - OpenAI News" opening with the heading "GPT-4o Ultra Released".
  const hello = root("Hello!", [{ id: "root", type: "stack", children: ["m"] }, { id: "m", type: "text", props: { content: "Hello! How can I assist you today?" } }]);
  assert.equal(titleRepeated(hello.title, hello.root), true);
  const news = root("GPT-4o Ultra Released - OpenAI News", [{ id: "root", type: "stack", children: ["h", "b"] }, { id: "h", type: "text", props: { content: "## GPT-4o Ultra Released" } }, { id: "b", type: "text", props: { content: "OpenAI has unveiled…" } }]);
  assert.equal(titleRepeated(news.title, news.root), true);
  const card = root("Kyoto hotels", [{ id: "root", type: "card", props: { title: "Kyoto Hotels" } }]);
  assert.equal(titleRepeated(card.title, card.root), true);
});

test("a title that adds something is kept", () => {
  const weather = root("Weather in Paris", [{ id: "root", type: "card", props: { title: "Weather" } }]);
  assert.equal(titleRepeated(weather.title, weather.root), false);
  const sales = root("Sales overview", [{ id: "root", type: "stack", children: ["t"] }, { id: "t", type: "text", props: { content: "Monthly sales" } }]);
  assert.equal(titleRepeated(sales.title, sales.root), false);
  assert.equal(titleRepeated(undefined, sales.root), false);
});
