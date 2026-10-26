// Answers in words: what a surface is waiting for, and a spoken or typed
// answer turned into the same values and action a click would produce. Voice
// is the first target; any conversational one can use it. Nothing here asks a
// model: resolution is deterministic, and the one shape a model may fill for an
// unresolved answer (answerSchema) is read back through the same field checks.
// Approvals are the app's; they are resolved strictly and never by a model.

import { type FormField, formFields, readField } from "./chat.ts";
import { runChecks } from "./checks.ts";
import { getAt } from "./pointer.ts";
import { type ResolvedNode, type SubmitResult, type SurfaceStore } from "./surface.ts";

export interface AnswerOption {
  label: string;
  /** The control `store.submit` activates for this option. */
  source: string;
  /** Plain values that describe the option (price, date, rating…), for comparisons and for telling options apart. */
  values: Record<string, unknown>;
  best?: boolean;
}

export type AgendaItem =
  | { kind: "decision"; id: string; surface: string; title?: string; action: string; options: AnswerOption[] }
  | { kind: "form"; id: string; surface: string; title?: string; action: string; source: string; fields: FormField[] }
  /** Supplied by the app. `change`: it writes, deletes or reaches the internet, so consent must name one of `words`. */
  | { kind: "approval"; id: string; title: string; change: boolean; words: string[] };

export type Resolution =
  | { kind: "choose"; index: number }
  | { kind: "ambiguous"; indices: number[] }
  /** Values and errors keyed by FormField.key. */
  | { kind: "fill"; values: Record<string, unknown>; errors: Record<string, string> }
  | { kind: "yes" | "no" | "cancel" | "repeat" | "back" | "unknown" };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const plain = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);
const text = (v: unknown) => (v === undefined || v === null ? "" : String(v));

function humanize(name: string): string {
  const w = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
}

// ---------------------------------------------------------------------------
// Agenda

/** What `surfaceId` is waiting for, in reading order. Forms take their own buttons; other buttons are decisions. */
export function agenda(store: SurfaceStore, surfaceId: string): AgendaItem[] {
  const resolved = store.resolve(surfaceId);
  if (!resolved?.root) return [];
  const comp = (n: ResolvedNode) => store.catalog.components[n.type];
  const items: AgendaItem[] = [];
  const forms = new Set<string>();
  // Sibling buttons are one decision; template copies of one button ("pick#0", "pick#1") are one decision too.
  const groups = new Map<string, { at: number; buttons: { node: ResolvedNode; owner?: ResolvedNode }[]; title?: string }>();

  const addForm = (scope: ResolvedNode, source: ResolvedNode) => {
    if (forms.has(scope.key)) return;
    forms.add(scope.key);
    const fields = formFields(scope);
    if (!fields.length && scope === source) return;
    const name = text(scope.props.submit ?? source.props.action) || "submit";
    items.push({ kind: "form", id: `${surfaceId}:${scope.key}`, surface: surfaceId, title: text(scope.props.title) || undefined, action: text(source.props.submitLabel ?? source.props.label) || humanize(name), source: source.key, fields });
  };

  const visit = (n: ResolvedNode, trail: ResolvedNode[]) => {
    const c = comp(n);
    if (c?.role === "form") return addForm(n, n);
    if (c?.role === "action") {
      const list = c.choices ? n.props[c.choices] : undefined;
      if (Array.isArray(list) && n.props.action) {
        items.push({
          kind: "decision", id: `${surfaceId}:${n.key}`, surface: surfaceId, title: text(n.props.title) || undefined,
          action: text(n.props.actionLabel) || humanize(text(n.props.action)),
          options: list.map((item, i) => optionOf(item, `${n.key}#${i}`, n.props.best)),
        });
      } else if (n.props.action || n.props.label) {
        const scope = store.submitScope(surfaceId, n.key)?.scope;
        if (scope) addForm(scope, n);
        else {
          const parent = trail.at(-1);
          const key = n.key !== n.id ? `id:${n.id}` : `in:${parent?.key ?? ""}`;
          const g = groups.get(key) ?? { at: items.length, buttons: [], title: text(parent?.props.title) || undefined };
          // A template copy's own card names the option ("Choose" alone does not).
          g.buttons.push({ node: n, owner: [...trail].reverse().find((a) => a.props.title || a.props.name) });
          groups.set(key, g);
        }
      }
    }
    for (const ch of n.children) visit(ch, [...trail, n]);
  };
  visit(resolved.root, []);

  // Decisions go where their first button was, among the forms.
  const decisions = [...groups.entries()].map(([key, g]) => {
    const labels = g.buttons.map((b) => text(b.node.props.label) || humanize(text(b.node.props.action) || b.node.id));
    const repeated = new Set(labels).size < labels.length;
    const options = g.buttons.map((b, i): AnswerOption => {
      const owner = b.owner ? optionOf(b.owner.props, b.node.key) : undefined;
      const payload = isObject(b.node.props.payload) ? Object.fromEntries(Object.entries(b.node.props.payload).filter(([, v]) => plain(v))) : {};
      return { label: repeated && owner ? owner.label : labels[i]!, source: b.node.key, values: { ...owner?.values, ...payload } };
    });
    const action = repeated ? labels[0]! : "Choose";
    return { at: g.at, item: { kind: "decision" as const, id: `${surfaceId}:${key}`, surface: surfaceId, title: g.title, action, options } };
  });
  for (const d of decisions.reverse()) items.splice(d.at, 0, d.item);
  return items;
}

function optionOf(item: unknown, source: string, best?: unknown): AnswerOption {
  if (!isObject(item)) return { label: text(item), source, values: {}, best: text(best) === text(item) };
  const label = text(item.name ?? item.title ?? item.label ?? item.id);
  const values: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item)) if (plain(v)) values[k] = v;
  // A comparison's specs ({feature: value}) are what its options differ by.
  for (const nested of [item.specs, item.details]) if (isObject(nested)) for (const [k, v] of Object.entries(nested)) if (plain(v)) values[k] ??= v;
  return { label, source, values, best: item.best === true || (best !== undefined && text(best) === label) };
}

// ---------------------------------------------------------------------------
// Words (English; other languages add a table of the same shape)

/** Lower case, no accents or apostrophes ("don't" → "dont"), words separated by single spaces. */
export function answerWords(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/['’]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
const has = (w: string, phrases: readonly string[]) => phrases.some((p) => ` ${w} `.includes(` ${p} `));

// One list across the languages read aloud (en, fr, de, es, it, pt, nl): people
// mix them ("ok, la deuxième"), and none of these words means something else
// in another of them. Negations are many and win over agreement (see intent),
// so "ne l'autorise pas" is never consent. Words are as answerWords leaves
// them: lower case, no accents or apostrophes.
const YES = ["yes", "yeah", "yep", "yup", "sure", "ok", "okay", "confirm", "confirmed", "correct", "right", "go ahead", "do it", "please do", "sounds good", "thats right", "allow", "approve", "agreed", "fine",
  "oui", "daccord", "vas y", "allez y", "cest bon", "bien sur", "confirme", "autorise", "autoriser",
  "ja", "jawohl", "genau", "klar", "mach das", "bestatigen", "erlauben", "erlaube",
  "si", "vale", "claro", "de acuerdo", "adelante", "confirmo", "permitir", "permite",
  "certo", "va bene", "conferma", "consenti", "procedi",
  "sim", "pode", "permita",
  "jawel", "oke", "doe maar", "akkoord", "bevestig", "toestaan", "sta toe"];
/** Single words of agreement, in every language above: never the word that names an operation. */
export const AGREEMENT_WORDS: ReadonlySet<string> = new Set(YES.filter((y) => !y.includes(" ")));
const NO = ["no", "nope", "dont", "do not", "not", "never", "decline", "deny", "reject", "refuse",
  "non", "pas", "jamais", "refuse", "refuser", "nein", "nicht", "niemals", "ablehnen", "nee", "nunca", "rechazar", "mai", "rifiuta", "nao", "recusar", "niet", "nooit", "weiger"];
const CANCEL = ["cancel", "never mind", "nevermind", "forget it", "stop",
  "annule", "annuler", "laisse tomber", "arrete", "abbrechen", "vergiss es", "stopp", "halt", "cancelar", "cancela", "olvidalo", "basta", "annulla", "lascia perdere", "fermati", "esquece", "chega", "annuleer", "annuleren", "laat maar"];
const REPEAT = ["repeat", "say again", "say that again", "again", "pardon", "what was that",
  "repete", "repeter", "encore une fois", "wiederholen", "nochmal", "noch einmal", "wie bitte", "repite", "repetir", "otra vez", "ripeti", "di nuovo", "de novo", "outra vez", "herhaal", "nog een keer", "opnieuw"];
const BACK = ["back", "go back", "previous", "undo", "retour", "precedent", "zuruck", "vorherige", "atras", "volver", "anterior", "indietro", "precedente", "voltar", "terug", "vorige"];
/** Index i names the (i+1)th option, in any of the languages. */
const ORDINALS = [
  ["first", "premier", "premiere", "erste", "ersten", "erster", "primero", "primera", "primo", "prima", "primeiro", "primeira", "eerste"],
  ["second", "deuxieme", "seconde", "zweite", "zweiten", "zweiter", "segundo", "segunda", "secondo", "seconda", "tweede"],
  ["third", "troisieme", "dritte", "dritten", "dritter", "tercero", "tercera", "terzo", "terza", "terceiro", "terceira", "derde"],
  ["fourth", "quatrieme", "vierte", "vierten", "cuarto", "cuarta", "quarto", "quarta", "vierde"],
  ["fifth", "cinquieme", "funfte", "funften", "quinto", "quinta", "vijfde"],
  ["sixth"], ["seventh"], ["eighth"], ["ninth"], ["tenth"],
];
const LAST = ["last", "last one", "dernier", "derniere", "letzte", "letzten", "ultimo", "ultima", "laatste"];
const SMALL = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const STOP = new Set(["the", "a", "an", "of", "and", "to", "for", "in", "on", "at", "with", "one", "option", "please", "i", "want", "take", "pick", "choose", "lets", "go", "that", "this",
  "le", "la", "les", "un", "une", "de", "du", "der", "die", "das", "den", "ein", "eine", "el", "los", "las", "il", "lo", "gli", "o", "os", "as", "het", "een"]);

/**
 * Comparisons a person makes instead of naming an option. Each names the kind
 * of value it compares by key (a price, a date…) and which end wins; "best"
 * takes the option the surface marks as its pick.
 */
const COMPARISONS: { words: string[]; key?: RegExp; dir: "min" | "max" | "best" }[] = [
  { words: ["cheapest", "cheaper", "least expensive", "lowest price", "lower price", "most affordable", "moins cher", "moins chere", "gunstigste", "gunstigsten", "billigste", "billigsten", "gunstiger", "mas barato", "mas barata", "piu economico", "piu economica", "meno caro", "meno cara", "mais barato", "mais barata", "goedkoopste", "goedkoper"], key: /price|cost|fee|rate|amount|total|fare/i, dir: "min" },
  { words: ["most expensive", "priciest", "pricier", "highest price", "plus cher", "plus chere", "teuerste", "teuersten", "mas caro", "mas cara", "piu caro", "piu cara", "mais caro", "mais cara", "duurste", "duurder"], key: /price|cost|fee|rate|amount|total|fare/i, dir: "max" },
  { words: ["highest rated", "best rated", "top rated"], key: /rating|score|stars|reviews/i, dir: "max" },
  { words: ["shortest", "quickest", "fastest"], key: /duration|length|minutes|hours|travel|time/i, dir: "min" },
  { words: ["longest"], key: /duration|length|minutes|hours/i, dir: "max" },
  { words: ["nearest", "closest"], key: /distance|km|miles|away/i, dir: "min" },
  { words: ["earliest", "soonest"], key: /date|start|depart|when|day|time/i, dir: "min" },
  { words: ["latest"], key: /date|start|depart|when|day|time/i, dir: "max" },
  { words: ["best", "recommended", "your pick", "you recommend", "best one", "meilleur", "meilleure", "recommande", "beste", "besten", "empfohlene", "mejor", "recomendado", "recomendada", "migliore", "consigliato", "consigliata", "melhor", "aanbevolen"], dir: "best" },
];

/** Number words become digits ("twenty five people" → "25 people"); digits are kept. */
export function spokenNumbers(s: string): string {
  const out: string[] = [];
  let n: number | undefined;
  let part = 0;
  const flush = () => { if (n !== undefined) out.push(String(n + part)); n = undefined; part = 0; };
  for (const t of s.split(/\s+/)) {
    const w = t.toLowerCase().replace(/[^a-z-]/g, "");
    const small = SMALL.indexOf(w), ten = TENS.indexOf(w);
    if (small >= 0) { n ??= 0; part += small; }
    else if (ten >= 2) { n ??= 0; part += ten * 10; }
    else if (/^[a-z]+-[a-z]+$/.test(w) && TENS.indexOf(w.split("-")[0]!) >= 2 && SMALL.indexOf(w.split("-")[1]!) > 0) { n ??= 0; part += TENS.indexOf(w.split("-")[0]!) * 10 + SMALL.indexOf(w.split("-")[1]!); }
    else if (w === "hundred" && n !== undefined) part = (part || 1) * 100;
    else if (w === "thousand" && n !== undefined) { n += (part || 1) * 1000; part = 0; }
    else if (w === "and" && n !== undefined) continue;
    else { flush(); out.push(t); }
  }
  flush();
  return out.join(" ");
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * A date said aloud → YYYY-MM-DD, relative to `now`: "today", "tomorrow",
 * "day after tomorrow", a weekday (its next occurrence; "next" does not skip a
 * week, because people use it both ways), "in 3 days", "6 November",
 * "November 6th 2027". A day and month already past mean next year.
 */
export function spokenDate(said: string, now = new Date()): string | undefined {
  const w = answerWords(spokenNumbers(said));
  const m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(said);
  if (m) return m[0];
  const at = (days: number) => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
  if (has(w, ["day after tomorrow"])) return at(2);
  if (has(w, ["today", "tonight"])) return at(0);
  if (has(w, ["tomorrow"])) return at(1);
  const rel = /\bin (\d+) (day|days|week|weeks)\b/.exec(w);
  if (rel) return at(Number(rel[1]) * (rel[2]!.startsWith("week") ? 7 : 1));
  const day = DAYS.findIndex((d) => has(w, [d]));
  if (day >= 0) return at(((day - now.getDay() + 7) % 7) || 7);
  const month = MONTHS.findIndex((mo) => has(w, [mo, mo.slice(0, 3)]));
  if (month < 0) return undefined;
  const dm = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?: of)? ${MONTHS[month]!.slice(0, 3)}\\w*|${MONTHS[month]!.slice(0, 3)}\\w* (\\d{1,2})(?:st|nd|rd|th)?\\b`).exec(w);
  const date = Number(dm?.[1] ?? dm?.[2]);
  if (!date || date > 31) return undefined;
  const year = /\b(\d{4})\b/.exec(w);
  let d = new Date(year ? Number(year[1]) : now.getFullYear(), month, date);
  if (!year && iso(d) < iso(now)) d = new Date(now.getFullYear() + 1, month, date);
  return iso(d);
}

/** yes/no/cancel/repeat/back said on its own, else undefined. Short answers only: in a longer one these words are content. */
function intent(w: string): Resolution | undefined {
  if (w.split(" ").length > 4) return undefined;
  if (has(w, CANCEL)) return { kind: "cancel" };
  if (has(w, BACK)) return { kind: "back" };
  if (has(w, REPEAT)) return { kind: "repeat" };
  const yes = has(w, YES), no = has(w, NO);
  if (yes && !no) return { kind: "yes" };
  if (no && !yes) return { kind: "no" };
  return undefined;
}

// ---------------------------------------------------------------------------
// Resolving

function numeric(v: unknown, dateLike: boolean): number | undefined {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return undefined;
  if (dateLike) {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
  }
  const m = /-?\d[\d,]*(?:\.\d+)?/.exec(v);
  return m ? Number(m[0].replace(/,/g, "")) : undefined;
}

/** Which option an answer names: by comparison, by ordinal, then by the words only that option's label has. */
export function pickOption(options: readonly AnswerOption[], said: string): Resolution | undefined {
  const w = answerWords(spokenNumbers(said));
  if (!options.length || !w) return undefined;
  for (const c of COMPARISONS) {
    if (!has(w, c.words)) continue;
    if (c.dir === "best") {
      const best = options.flatMap((o, i) => (o.best ? [i] : []));
      if (best.length === 1) return { kind: "choose", index: best[0]! };
      continue;
    }
    const keys = Object.keys(options[0]!.values).filter((k) => c.key!.test(k));
    for (const key of keys) {
      const dateLike = /date|day|when|start|depart/i.test(key);
      const vals = options.map((o) => numeric(o.values[key], dateLike));
      if (vals.filter((v) => v !== undefined).length < 2) continue;
      const target = c.dir === "min" ? Math.min(...vals.filter((v): v is number => v !== undefined)) : Math.max(...vals.filter((v): v is number => v !== undefined));
      const hits = vals.flatMap((v, i) => (v === target ? [i] : []));
      return hits.length === 1 ? { kind: "choose", index: hits[0]! } : { kind: "ambiguous", indices: hits };
    }
  }
  const ord = ORDINALS.findIndex((o) => has(w, o));
  if (ord >= 0 && ord < options.length) return { kind: "choose", index: ord };
  if (has(w, LAST)) return { kind: "choose", index: options.length - 1 };
  const num = /\b(?:number|option|choice) (\d+)\b/.exec(w) ?? /^(\d+)$/.exec(w);
  if (num && Number(num[1]) >= 1 && Number(num[1]) <= options.length) return { kind: "choose", index: Number(num[1]) - 1 };

  const labels = options.map((o) => answerWords(o.label));
  const whole = labels.flatMap((l, i) => (l && has(w, [l]) ? [i] : []));
  if (whole.length === 1) return { kind: "choose", index: whole[0]! };
  // Only words that tell options apart count: "Hilton" picks "Hilton Tokyo" over "Park Hyatt Tokyo".
  const tokens = labels.map((l) => new Set(l.split(" ").filter((t) => t && !STOP.has(t) && (t.length > 2 || /\d/.test(t)))));
  const scores = tokens.map((set, i) => [...set].filter((t) => has(w, [t]) && tokens.every((o, j) => j === i || !o.has(t))).length);
  const top = Math.max(...scores);
  if (top === 0) return whole.length > 1 ? { kind: "ambiguous", indices: whole } : undefined;
  const hits = scores.flatMap((s, i) => (s === top ? [i] : []));
  return hits.length === 1 ? { kind: "choose", index: hits[0]! } : { kind: "ambiguous", indices: hits };
}

/** A spoken value for one field: number words, dates, a spoken email, a choice by name or ordinal, then the field's own reading and checks. */
export function readSpoken(field: FormField, said: string, now = new Date()): { value: unknown } | { error: string } {
  if (field.choices) {
    if (field.type === "checkbox") {
      const i = intent(answerWords(said));
      return i?.kind === "yes" ? { value: true } : i?.kind === "no" ? { value: false } : { error: "Please say yes or no" };
    }
    const options = field.choices.map((c) => ({ label: c.label, source: "", values: {} }));
    if (field.multiple) {
      const picked = field.choices.filter((c) => has(answerWords(said), [answerWords(c.label)]));
      return picked.length ? { value: picked.map((c) => c.value) } : { error: `Please choose from: ${field.choices.map((c) => c.label).join(", ")}` };
    }
    const r = pickOption(options, said);
    return r?.kind === "choose" ? readField(field, field.choices[r.index]!.label) : { error: `Please choose one of: ${field.choices.map((c) => c.label).join(", ")}` };
  }
  let t = said.trim();
  if (field.type === "date" && field.range) {
    const [a, b] = t.split(/\s+(?:to|until|till|through)\s+|\s+[–-]\s+/i);
    const from = a ? spokenDate(a, now) : undefined, to = b ? spokenDate(b, now) : undefined;
    t = from && to ? `${from} to ${to}` : t;
  } else if (field.type === "date") t = spokenDate(t, now) ?? t;
  else if (field.kind === "number" || field.kind === "range" || field.kind === "rating") t = /-?\d+(?:\.\d+)?/.exec(spokenNumbers(t).replace(/,/g, ""))?.[0] ?? t;
  else if (field.kind === "time") t = spokenNumbers(t).replace(/\b(\d{1,2}) (\d{2})\b/, "$1:$2").replace(/\s*o ?clock/i, "");
  else if (field.kind === "email") {
    // "ada at example dot com, I'm a designer": the address is the part around "at"; the rest is other content.
    const joined = t.replace(/\s+at\s+/gi, "@").replace(/\s+dot\s+/gi, ".").toLowerCase();
    t = /[^\s,;@]+@[^\s,;@]+\.[a-z]{2,}/.exec(joined)?.[0] ?? joined.replace(/\s+/g, "");
  }
  return readField(field, t);
}

/**
 * An answer to `item`, deterministically. For a form, `field` is the one just
 * asked; choice fields named outright elsewhere in the answer are filled too.
 */
export function resolveAnswer(item: AgendaItem, said: string, opts: { field?: string; now?: Date } = {}): Resolution {
  const w = answerWords(said);
  if (!w) return { kind: "unknown" };
  if (item.kind === "approval") {
    // Consent must be unmixed ("no, allow it" is not consent) and, for a change, name it.
    const yes = has(w, YES), no = has(w, NO) || has(w, CANCEL);
    if (no && !yes) return { kind: "no" };
    if (!yes || no) return { kind: "unknown" };
    return !item.change || item.words.some((x) => answerWords(x) && has(w, [answerWords(x)])) ? { kind: "yes" } : { kind: "unknown" };
  }
  if (item.kind === "decision") return pickOption(item.options, said) ?? intent(w) ?? { kind: "unknown" };

  const asked = item.fields.find((f) => f.key === opts.field) ?? item.fields[0];
  const plainIntent = intent(w);
  if (plainIntent && asked?.type !== "checkbox" && w.split(" ").length <= 2) return plainIntent;
  const values: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  if (asked) {
    const r = readSpoken(asked, said, opts.now);
    if ("value" in r) values[asked.key] = r.value;
    else errors[asked.key] = r.error;
  }
  for (const f of item.fields) {
    if (f === asked || !f.choices || f.multiple || f.type === "checkbox") continue;
    const named = f.choices.filter((c) => answerWords(c.label) && has(w, [answerWords(c.label)]));
    if (named.length === 1) values[f.key] = named[0]!.value;
  }
  return Object.keys(values).length || Object.keys(errors).length ? { kind: "fill", values, errors } : (plainIntent ?? { kind: "unknown" });
}

// ---------------------------------------------------------------------------
// The constrained model answer

/** The only JSON a model may return for an unresolved answer. None for approvals: a model never decides one. */
export function answerSchema(item: AgendaItem): Record<string, unknown> | undefined {
  if (item.kind === "approval") return undefined;
  if (item.kind === "decision") return { type: "object", properties: { option: { enum: item.options.map((o) => o.label) } }, additionalProperties: false };
  const properties: Record<string, unknown> = {};
  for (const f of item.fields) {
    properties[f.label] = f.choices ? (f.multiple ? { type: "array", items: { enum: f.choices.map((c) => c.label) } } : { enum: f.choices.map((c) => c.label) })
      : f.type === "date" ? { type: "string", description: f.range ? "YYYY-MM-DD to YYYY-MM-DD" : "YYYY-MM-DD" }
      : f.kind === "number" || f.kind === "range" || f.kind === "rating" ? { type: "number" } : { type: "string" };
  }
  return { type: "object", properties: { fields: { type: "object", properties, additionalProperties: false } }, additionalProperties: false };
}

/** A model's answer, read through the same field reading and checks as a typed one; anything outside the schema is dropped. */
export function readModelAnswer(item: AgendaItem, answer: unknown): Resolution {
  if (item.kind === "approval" || !isObject(answer)) return { kind: "unknown" };
  if (item.kind === "decision") {
    const i = item.options.findIndex((o) => o.label === answer.option);
    return i >= 0 ? { kind: "choose", index: i } : { kind: "unknown" };
  }
  const given = isObject(answer.fields) ? answer.fields : {};
  const values: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const f of item.fields) {
    const v = given[f.label];
    if (v === undefined || v === null) continue;
    if (f.multiple && f.choices && Array.isArray(v)) {
      const picked = f.choices.filter((c) => v.includes(c.label));
      if (picked.length === v.length) values[f.key] = picked.map((c) => c.value);
      else errors[f.key] = `Please choose from: ${f.choices.map((c) => c.label).join(", ")}`;
      continue;
    }
    const r = readField(f, typeof v === "boolean" ? (v ? "Yes" : "No") : text(v));
    if ("value" in r) values[f.key] = r.value;
    else errors[f.key] = r.error;
  }
  return Object.keys(values).length || Object.keys(errors).length ? { kind: "fill", values, errors } : { kind: "unknown" };
}

// ---------------------------------------------------------------------------
// Acting

/** Write answered values into the surface (every target shows them) and return the fields still missing or failing their checks. */
export function fillAnswer(store: SurfaceStore, item: AgendaItem & { kind: "form" }, values: Record<string, unknown>): FormField[] {
  for (const f of item.fields) if (f.key in values) store.setValue(item.surface, f.bindPath, values[f.key]);
  const data = store.get(item.surface)?.data;
  return item.fields.filter((f) => runChecks(getAt(data, f.bindPath), f.checks).length > 0);
}

/** Submit exactly as a click would: the decision's chosen control, or the form's own. */
export function actOn(store: SurfaceStore, item: AgendaItem, index?: number): SubmitResult {
  if (item.kind === "approval") return { errors: { [item.id]: ["approvals are decided by the app"] } };
  if (item.kind === "form") return store.submit(item.surface, item.source);
  const option = index === undefined ? undefined : item.options[index];
  return option ? store.submit(item.surface, option.source) : { errors: { [item.id]: ["no option chosen"] } };
}

// ---------------------------------------------------------------------------
// Spoken text

/** Values that differ between options: what a listener needs to tell them apart (at most two). */
function telling(options: readonly AnswerOption[]): string[] {
  const keys = Object.keys(options[0]?.values ?? {}).filter((k) => !/^(name|title|label|id|best)$/.test(k));
  return keys.filter((k) => new Set(options.map((o) => text(o.values[k]))).size > 1 && options.every((o) => plain(o.values[k]))).slice(0, 2);
}

const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} or ${xs.at(-1)}`);

/** The question for an item, or for one field of a form. */
export function question(item: AgendaItem, field?: string): string {
  if (item.kind === "approval") return `${item.title}. ${item.change ? `Say "allow ${item.words[0] ?? "it"}" to allow it, or no.` : "Allow it?"}`;
  if (item.kind === "decision") {
    const keys = telling(item.options);
    const said = item.options.map((o) => [o.label, ...keys.map((k) => text(o.values[k]))].filter(Boolean).join(", "));
    return `${item.title ? `${item.title}: ` : ""}${said.join("; ")}. Which one?`;
  }
  const f = item.fields.find((x) => x.key === field) ?? item.fields[0];
  if (!f) return `${item.action}?`;
  if (f.type === "checkbox") return `${f.label}?`;
  if (f.choices) return `${f.label}: ${list(f.choices.map((c) => c.label))}?`;
  return `${f.label}${f.required ? "" : " (optional)"}?`;
}

/** What is about to happen, said before it happens. */
export function readBack(store: SurfaceStore, item: AgendaItem, index?: number): string {
  if (item.kind === "approval") return item.title;
  if (item.kind === "decision") return `${item.action}: ${item.options[index ?? -1]?.label ?? ""}. Shall I?`;
  const data = store.get(item.surface)?.data;
  const said = item.fields.flatMap((f) => {
    const v = getAt(data, f.bindPath);
    if (v === undefined || v === "" || v === null) return [];
    const shown = f.choices ? (Array.isArray(v) ? v : [v]).map((x) => f.choices!.find((c) => c.value === x)?.label ?? text(x)).join(", ") : Array.isArray(v) ? v.map(text).join(" to ") : text(v);
    return [`${f.label} ${shown}`];
  });
  return `${item.action}${said.length ? ` with ${said.join(", ")}` : ""}. Shall I?`;
}
