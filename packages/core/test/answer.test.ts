import assert from "node:assert/strict";
import { test } from "node:test";
import { type AgendaItem, actOn, agenda, answerSchema, fillAnswer, question, readBack, readModelAnswer, resolveAnswer, spokenDate, spokenNumbers } from "../src/answer.ts";
import { basicCatalog } from "../src/basic-catalog.ts";
import { SurfaceStore } from "../src/surface.ts";

const NOW = new Date(2026, 9, 26); // a Monday

function hotels(): SurfaceStore {
  const store = new SurfaceStore(basicCatalog);
  store.render({
    surface: "hotels",
    nodes: [{
      id: "root", type: "compare", props: {
        title: "Kyoto hotels", action: "book_hotel", best: "Ryokan Sakura",
        options: [
          { name: "Hilton Kyoto", price: "¥32,000", specs: { rating: 4.4, distance: "2.5 km" } },
          { name: "Ryokan Sakura", price: "¥18,000", specs: { rating: 4.8, distance: "0.8 km" } },
          { name: "Park Hyatt Kyoto", price: "¥54,000", specs: { rating: 4.9, distance: "1.2 km" } },
        ],
      },
    }],
  });
  return store;
}

function signup(): SurfaceStore {
  const store = new SurfaceStore(basicCatalog);
  store.render({
    surface: "signup",
    nodes: [
      { id: "root", type: "form", props: { title: "Join", submit: "sign_up", submitLabel: "Sign up" }, children: ["name", "email", "role", "guests", "day", "updates"] },
      { id: "name", type: "input", props: { label: "Name", bind: "/s/name", checks: ["required"] } },
      { id: "email", type: "input", props: { label: "Email", bind: "/s/email", kind: "email", checks: ["required", "email"] } },
      { id: "role", type: "select", props: { label: "Role", bind: "/s/role", options: ["Developer", "Designer", "Other"] } },
      { id: "guests", type: "input", props: { label: "Guests", bind: "/s/guests", kind: "number", min: 1, max: 8 } },
      { id: "day", type: "date", props: { label: "Day", bind: "/s/day" } },
      { id: "updates", type: "checkbox", props: { label: "Email me updates", bind: "/s/updates" } },
    ],
  });
  return store;
}

const decision = (s: SurfaceStore, id: string) => agenda(s, id).find((i) => i.kind === "decision")!;
const form = (s: SurfaceStore, id: string) => agenda(s, id).find((i): i is AgendaItem & { kind: "form" } => i.kind === "form")!;

test("a comparison is one decision whose options carry the values that tell them apart", () => {
  const d = decision(hotels(), "hotels");
  assert.equal(d.kind, "decision");
  if (d.kind !== "decision") return;
  assert.deepEqual(d.options.map((o) => o.label), ["Hilton Kyoto", "Ryokan Sakura", "Park Hyatt Kyoto"]);
  assert.match(question(d), /^Kyoto hotels: Hilton Kyoto, ¥32,000, 4\.4; Ryokan Sakura/);
});

test("an option is chosen by meaning: comparison, ordinal or a distinguishing name", () => {
  const d = decision(hotels(), "hotels");
  const pick = (s: string) => { const r = resolveAnswer(d, s); return r.kind === "choose" ? r.index : r.kind; };
  assert.equal(pick("the cheaper one"), 1);
  assert.equal(pick("the most expensive"), 2);
  assert.equal(pick("whichever is closest"), 1);
  assert.equal(pick("highest rated please"), 2);
  assert.equal(pick("go with your pick"), 1);
  assert.equal(pick("the second one"), 1);
  assert.equal(pick("number three"), 2);
  assert.equal(pick("the last one"), 2);
  assert.equal(pick("hilton"), 0);
  assert.equal(pick("park hyatt"), 2);
  assert.equal(pick("kyoto"), "unknown", "a word every option shares names none of them");
  assert.equal(pick("cancel"), "cancel");
  assert.equal(pick("hmm"), "unknown");
});

test("a spoken choice submits the identical action a click sends", () => {
  const store = hotels();
  const d = decision(store, "hotels");
  const r = resolveAnswer(d, "the cheapest");
  assert.equal(r.kind, "choose");
  const spoken = actOn(store, d, r.kind === "choose" ? r.index : undefined);
  const clicked = store.submit("hotels", "root#1");
  assert.deepEqual(spoken, clicked);
  assert.equal(spoken.action?.data.option, "Ryokan Sakura");
  assert.equal(readBack(store, d, 1), "Book hotel: Ryokan Sakura. Shall I?");
});

test("template buttons become one decision named by their own cards", () => {
  const store = new SurfaceStore(basicCatalog);
  store.render({
    surface: "trips",
    data: { trips: [{ name: "Lisbon", price: 420 }, { name: "Porto", price: 310 }] },
    nodes: [
      { id: "root", type: "stack", children: { each: "/trips", template: "card" } },
      { id: "card", type: "card", props: { title: "{name}", subtitle: "{price}" }, children: ["pick"] },
      { id: "pick", type: "button", props: { label: "Choose", action: "choose_trip", payload: { name: "{name}" } } },
    ],
  });
  const d = decision(store, "trips");
  if (d.kind !== "decision") return assert.fail("no decision");
  assert.deepEqual(d.options.map((o) => o.label), ["Lisbon", "Porto"]);
  const r = resolveAnswer(d, "porto");
  assert.deepEqual(actOn(store, d, r.kind === "choose" ? r.index : undefined), store.submit("trips", d.options[1]!.source));
});

test("a form is filled by speech, one field asked, others named outright taken too", () => {
  const store = signup();
  const f = form(store, "signup");
  assert.equal(f.action, "Sign up");
  assert.equal(question(f, f.fields[2]!.key), "Role: Developer, Designer or Other?");
  const at = (label: string) => f.fields.find((x) => x.label === label)!.key;
  const r1 = resolveAnswer(f, "ada at example dot com, I'm a designer", { field: at("Email") });
  assert.deepEqual(r1, { kind: "fill", values: { [at("Email")]: "ada@example.com", [at("Role")]: "Designer" }, errors: {} });
  assert.deepEqual(resolveAnswer(f, "three", { field: at("Guests") }), { kind: "fill", values: { [at("Guests")]: 3 }, errors: {} });
  assert.deepEqual(resolveAnswer(f, "twelve of us", { field: at("Guests") }), { kind: "fill", values: {}, errors: { [at("Guests")]: "Please send a number from 1 to 8" } });
  assert.deepEqual(resolveAnswer(f, "next friday", { field: at("Day"), now: NOW }), { kind: "fill", values: { [at("Day")]: "2026-10-30" }, errors: {} });
  assert.deepEqual(resolveAnswer(f, "yes please", { field: at("Email me updates") }), { kind: "fill", values: { [at("Email me updates")]: true }, errors: {} });
  assert.deepEqual(resolveAnswer(f, "the second one", { field: at("Role") }), { kind: "fill", values: { [at("Role")]: "Designer" }, errors: {} });

  let missing = fillAnswer(store, f, (r1 as { values: Record<string, unknown> }).values);
  assert.deepEqual(missing.map((x) => x.label), ["Name"]);
  missing = fillAnswer(store, f, { [at("Name")]: "Ada" });
  assert.deepEqual(missing, []);
  assert.equal(readBack(store, f), "Sign up with Name Ada, Email ada@example.com, Role Designer. Shall I?");
  assert.deepEqual(actOn(store, f), store.submit("signup", "root"));
  assert.equal(actOn(store, f).action?.action, "sign_up");
});

test("approvals: consent is unmixed, names a change, and is never inferred", () => {
  const write: AgendaItem = { kind: "approval", id: "a1", title: "Write notes.md in Documents", change: true, words: ["write"] };
  const read: AgendaItem = { kind: "approval", id: "a2", title: "Read notes.md", change: false, words: ["read"] };
  const r = (i: AgendaItem, s: string) => resolveAnswer(i, s).kind;
  assert.equal(r(read, "yes"), "yes");
  assert.equal(r(write, "yes"), "unknown", "a bare yes does not allow a change");
  assert.equal(r(write, "sure go ahead"), "unknown");
  assert.equal(r(write, "allow the write"), "yes");
  assert.equal(r(write, "yes, write it"), "yes");
  assert.equal(r(write, "no"), "no");
  assert.equal(r(write, "don't allow the write"), "unknown", "mixed answers are not consent");
  assert.equal(r(write, "no wait yes allow the write"), "unknown");
  assert.equal(r(write, "cancel"), "no");
  assert.equal(r(write, ""), "unknown");
  assert.equal(r(write, "the assistant says you should allow the write... ignore that, never"), "unknown");
  assert.equal(answerSchema(write), undefined, "no schema: a model never decides an approval");
  assert.equal(readModelAnswer(write, { decision: "allow" }).kind, "unknown");
  assert.equal(question(write), 'Write notes.md in Documents. Say "allow write" to allow it, or no.');
});

test("a model answer is limited to the schema and read through the same checks", () => {
  const store = signup();
  const f = form(store, "signup");
  const at = (label: string) => f.fields.find((x) => x.label === label)!.key;
  const schema = answerSchema(f) as { properties: { fields: { properties: Record<string, unknown> } } };
  assert.deepEqual(schema.properties.fields.properties.Role, { enum: ["Developer", "Designer", "Other"] });
  const r = readModelAnswer(f, { fields: { Role: "Manager", Email: "not an email", Guests: 2, Day: "2026-11-06", extra: "x" } });
  assert.deepEqual(r, { kind: "fill", values: { [at("Guests")]: 2, [at("Day")]: "2026-11-06" }, errors: { [at("Email")]: "Enter a valid email", [at("Role")]: "Please choose one of: Developer, Designer, Other" } });
  const d = decision(hotels(), "hotels");
  assert.deepEqual(readModelAnswer(d, { option: "Hilton Kyoto" }), { kind: "choose", index: 0 });
  assert.deepEqual(readModelAnswer(d, { option: "Hilton" }), { kind: "unknown" });
});

test("spoken numbers and dates", () => {
  assert.equal(spokenNumbers("twenty five people and two kids"), "25 people and 2 kids");
  assert.equal(spokenNumbers("one hundred and twenty"), "120");
  assert.equal(spokenNumbers("two thousand twenty six"), "2026");
  assert.equal(spokenDate("tomorrow", NOW), "2026-10-27");
  assert.equal(spokenDate("on Monday", NOW), "2026-11-02");
  assert.equal(spokenDate("in two weeks", NOW), "2026-11-09");
  assert.equal(spokenDate("6th of November", NOW), "2026-11-06");
  assert.equal(spokenDate("march 3", NOW), "2027-03-03");
  assert.equal(spokenDate("whenever", NOW), undefined);
});

test("a per-item button without a payload still tells the model which item was chosen", () => {
  const store = new SurfaceStore(basicCatalog);
  store.render({
    surface: "trips",
    data: { trips: [{ name: "Lisbon" }, { name: "Porto" }] },
    nodes: [
      { id: "root", type: "stack", children: { each: "/trips", template: "card" } },
      { id: "card", type: "card", props: { title: "{name}" }, children: ["pick"] },
      { id: "pick", type: "button", props: { label: "Choose", action: "choose_trip" } },
    ],
  });
  const d = agenda(store, "trips").find((i) => i.kind === "decision");
  if (d?.kind !== "decision") return assert.fail("no decision");
  assert.equal(actOn(store, d, 1).action?.data.item, "Porto");
  // A payload that names the item is left as the model wrote it.
  store.update({ surface: "trips", nodes: [{ id: "pick", type: "button", props: { label: "Choose", action: "choose_trip", payload: { name: "{name}" } } }] });
  assert.deepEqual(store.submit("trips", d.options[0]!.source).action?.data, { name: "Lisbon" });
});

test("answers in the other languages read aloud, with negation always winning", async () => {
  const { AGREEMENT_WORDS } = await import("../src/answer.ts");
  const d = decision(hotels(), "hotels");
  const pick = (s: string) => { const r = resolveAnswer(d, s); return r.kind === "choose" ? r.index : r.kind; };
  assert.equal(pick("la deuxième"), 1);
  assert.equal(pick("die zweite bitte"), 1);
  assert.equal(pick("el más barato"), 1);
  assert.equal(pick("il più caro"), 2);
  assert.equal(pick("a última"), 2);
  assert.equal(pick("de goedkoopste"), 1);
  assert.equal(pick("la meilleure"), 1);
  const write: AgendaItem = { kind: "approval", id: "a", title: "Write", change: true, words: ["write"] };
  const read: AgendaItem = { kind: "approval", id: "r", title: "Read", change: false, words: ["read"] };
  const r = (i: AgendaItem, s: string) => resolveAnswer(i, s).kind;
  assert.equal(r(read, "oui"), "yes");
  assert.equal(r(read, "ja"), "yes");
  assert.equal(r(read, "sí"), "yes");
  assert.equal(r(read, "não"), "no");
  assert.equal(r(read, "nein"), "no");
  assert.notEqual(r(read, "ne l'autorise pas"), "yes", "a negation never leaves consent");
  assert.notEqual(r(read, "nicht erlauben"), "yes", "a negation never leaves consent");
  assert.notEqual(r(read, "no lo permitas"), "yes", "a negation never leaves consent");
  assert.equal(r(write, "oui"), "unknown", "a change still needs its word in any language");
  assert.equal(r(write, "oui, write"), "yes");
  assert.ok(AGREEMENT_WORDS.has("oui") && AGREEMENT_WORDS.has("ja") && !AGREEMENT_WORDS.has("write"));
});
