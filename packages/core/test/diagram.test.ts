import assert from "node:assert/strict";
import { test } from "node:test";
import { basicCatalog, coerce, projectText, SurfaceStore } from "../src/index.ts";

function render(node: Record<string, unknown>, data?: Record<string, unknown>) {
  const store = new SurfaceStore(basicCatalog);
  const diags = store.render({ surface: "s", nodes: [{ id: "root", ...node }], ...(data ? { data } : {}) } as never);
  return { diags, errors: diags.filter((d) => d.severity === "error"), resolved: store.resolve("s")! };
}

// The shape of the reference memory server's read_graph result, passed through
// as a model would after reading it (Vakyartha, "show my memory as a graph").
const memory = {
  entities: [
    { name: "Nisheeth Ranjan", entityType: "person", observations: ["Builds Vakyartha", "Lives in Pune"] },
    { name: "Vakyartha", entityType: "project", observations: [] },
  ],
  relations: [{ from: "Nisheeth Ranjan", to: "Vakyartha", relationType: "builds" }],
};

test("a knowledge graph in the memory server's own shape becomes canonical nodes and edges", () => {
  const { errors, resolved } = render({ type: "knowledgegraph", props: memory });
  assert.deepEqual(errors, []);
  assert.equal(resolved.root!.type, "diagram");
  assert.deepEqual(resolved.root!.props.nodes, [
    { id: "Nisheeth Ranjan", label: "Nisheeth Ranjan", group: "person", note: "Builds Vakyartha; Lives in Pune" },
    { id: "Vakyartha", label: "Vakyartha", group: "project" },
  ]);
  assert.deepEqual(resolved.root!.props.edges, [{ from: "Nisheeth Ranjan", to: "Vakyartha", label: "builds" }]);
});

test("a graph bound to data resolves the same way", () => {
  const { errors, resolved } = render({ type: "graph", props: { nodes: "{/memory/entities}", edges: "{/memory/relations}" } }, { memory });
  assert.deepEqual(errors, []);
  assert.equal((resolved.root!.props.nodes as unknown[]).length, 2);
  assert.equal((resolved.root!.props.edges as { label: string }[])[0]!.label, "builds");
});

test("edges name nodes by id or label; an end naming no node becomes one; text edges parse", () => {
  const { errors, resolved } = render({
    type: "graph",
    props: { nodes: [{ id: "ceo", label: "Asha (CEO)" }, "Ravi"], edges: [{ source: "Asha (CEO)", target: "ravi" }, "Ravi -> Meera: manages", "ceo → Board"] },
  });
  assert.deepEqual(errors, []);
  assert.deepEqual((resolved.root!.props.nodes as { id: string }[]).map((n) => n.id), ["ceo", "Ravi", "Meera", "Board"]);
  assert.deepEqual(resolved.root!.props.edges, [
    { from: "ceo", to: "Ravi" },
    { from: "Ravi", to: "Meera", label: "manages" },
    { from: "ceo", to: "Board" },
  ]);
});

test("a lone node is a valid graph (an empty memory still draws)", () => {
  const { errors, resolved } = render({ type: "graph", props: { nodes: [{ name: "You" }] } });
  assert.deepEqual(errors, []);
  assert.deepEqual(resolved.root!.props, { nodes: [{ id: "You", label: "You" }], edges: [] });
});

test("\"graph\" with chart props is still a chart", () => {
  const { resolved } = render({ type: "graph", props: { kind: "line", labels: ["W1", "W2"], series: [3, 5] } });
  assert.equal(resolved.root!.type, "chart");
});

test("text targets read every connection and every unconnected node", () => {
  const { resolved } = render({ type: "graph", props: { ...memory, entities: [...memory.entities, { name: "Pune", entityType: "city" }] } });
  const text = projectText(resolved);
  assert.match(text, /\*\*Nisheeth Ranjan\*\* → builds → \*\*Vakyartha\*\*/);
  assert.match(text, /\*\*Pune\*\* \(city\)/);
  assert.doesNotMatch(text, /\*\*Vakyartha\*\* \(project\)/);
});

test("aliases are renamed inside an anyOf branch the value already satisfies", () => {
  const schema = { anyOf: [{ type: "string" }, { type: "object", properties: { label: { type: "string", aliases: ["name"] } } }] } as const;
  assert.deepEqual(coerce(schema as never, { name: "A" }), { label: "A" });
  assert.equal(coerce(schema as never, "A"), "A");
});
