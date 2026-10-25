import assert from "node:assert/strict";
import { test } from "node:test";
import { basicCatalog, mapLink, projectText, SurfaceStore } from "../src/index.ts";

function render(nodes: unknown[]) {
  const store = new SurfaceStore(basicCatalog);
  const diags = store.render({ surface: "s", nodes } as never);
  return { errors: diags.filter((d) => d.severity === "error"), resolved: store.resolve("s")! };
}

test("timeline, steps, code, map and gallery render without errors and read as text", () => {
  const { errors, resolved } = render([
    {
      id: "root",
      type: "stack",
      children: [
        { id: "t", type: "timeline", props: { items: [{ date: "2024", title: "Founded" }, "2026: Series A"] } },
        { id: "st", type: "steps", props: { items: [{ title: "Sign up", status: "completed" }, { title: "Verify", status: "in-progress" }, { title: "Ship" }] } },
        { id: "c", type: "code", props: { language: "bash", content: "npm test" } },
        { id: "m", type: "map", props: { places: [{ name: "Shaniwar Wada", address: "Pune", lat: 18.519, lon: 73.855 }, "Aga Khan Palace, Pune"] } },
        { id: "g", type: "gallery", props: { images: [{ src: "https://example.com/a.jpg", caption: "Front" }] } },
      ],
    },
  ]);
  assert.deepEqual(errors, []);
  const text = projectText(resolved);
  // A small model's "2026: Series A" string became a dated entry; statuses read through their aliases.
  assert.match(text, /\*\*2026\*\* Series A/);
  assert.match(text, /✓ \*\*Sign up\*\*/);
  assert.match(text, /→ \*\*Verify\*\*/);
  assert.match(text, /```bash\nnpm test\n```/);
  assert.match(text, /openstreetmap\.org\/\?mlat=18\.519&mlon=73\.855/);
  assert.match(text, /Aga Khan Palace/);
});

test("map links never carry anything but the place; bad coordinates fall back to a search", () => {
  assert.equal(mapLink({ name: "X", lat: 999, lon: 0 }), "https://www.openstreetmap.org/search?query=X");
  assert.match(mapLink({ name: "Café & Co", address: "Lisbon" }), /query=Caf%C3%A9%20%26%20Co%2C%20Lisbon$/);
});
