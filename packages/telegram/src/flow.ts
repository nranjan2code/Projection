// Forms in a chat: one question at a time. Choices become buttons, yes/no
// becomes two buttons, everything else is a typed reply. Each answer runs the
// field's named checks; values are written to the surface store, so the final
// submit is the same store.submit the web uses.

import { getAt, isRequired, type ResolvedNode, runChecks, type SurfaceStore } from "@vak/core";

export interface Choice {
  label: string;
  value: unknown;
}

export interface Step {
  key: string;
  bindPath: string;
  type: string;
  label: string;
  required: boolean;
  checks: unknown;
  kind?: string;
  choices?: Choice[];
  multiple?: boolean;
  range?: boolean;
}

export interface Prompt {
  text: string;
  /** Rows of buttons; each button answers with the choice index. */
  choices?: string[][];
  /** Expect a typed reply. */
  typed: boolean;
}

const INPUT_TYPES = new Set(["input", "textarea", "select", "checkbox", "date"]);
const SKIP = "skip";

function choicesOf(n: ResolvedNode): Choice[] | undefined {
  if (n.type === "checkbox") return [{ label: "Yes", value: true }, { label: "No", value: false }];
  if (n.type !== "select" || !Array.isArray(n.props.options)) return undefined;
  return n.props.options.map((o) =>
    o && typeof o === "object" ? { label: String((o as Record<string, unknown>).label ?? (o as Record<string, unknown>).value), value: (o as Record<string, unknown>).value } : { label: String(o), value: o },
  );
}

/** The bound fields inside `scope`, in reading order. */
export function stepsOf(scope: ResolvedNode): Step[] {
  const steps: Step[] = [];
  const visit = (n: ResolvedNode) => {
    if (INPUT_TYPES.has(n.type) && n.bindPath) {
      steps.push({
        key: n.key,
        bindPath: n.bindPath,
        type: n.type,
        label: String(n.props.label ?? n.id),
        required: isRequired(n.props.checks),
        checks: n.props.checks,
        kind: typeof n.props.kind === "string" ? n.props.kind : undefined,
        choices: choicesOf(n),
        multiple: Boolean(n.props.multiple),
        range: Boolean(n.props.range),
      });
    }
    n.children.forEach(visit);
  };
  visit(scope);
  return steps;
}

export class FormFlow {
  readonly surface: string;
  /** The control whose activation submits once every step is answered. */
  readonly source: string;
  readonly steps: Step[];
  private index = 0;
  private picked: unknown[] = [];

  constructor(surface: string, source: string, steps: Step[]) {
    this.surface = surface;
    this.source = source;
    this.steps = steps;
  }

  get current(): Step | undefined {
    return this.steps[this.index];
  }

  get done(): boolean {
    return this.index >= this.steps.length;
  }

  prompt(store: SurfaceStore): Prompt | undefined {
    const step = this.current;
    if (!step) return undefined;
    const n = `${this.index + 1}/${this.steps.length}`;
    const optional = step.required ? "" : ` (optional, send "${SKIP}" to skip)`;
    const existing = getAt(store.get(this.surface)?.data, step.bindPath);
    const now = existing !== undefined && existing !== "" && !step.choices ? ` — currently "${String(existing)}"` : "";
    if (step.choices) {
      const rows = step.choices.map((c) => [c.label]);
      if (step.multiple) rows.push(["✓ Done"]);
      if (!step.required) rows.push(["Skip"]);
      const picked = step.multiple && this.picked.length ? ` · chosen: ${this.picked.map(String).join(", ")}` : "";
      return { text: `${n} · ${step.label}${step.multiple ? " (choose any, then Done)" : ""}${picked}`, choices: rows, typed: false };
    }
    const hint = step.type === "date" ? (step.range ? " (YYYY-MM-DD to YYYY-MM-DD)" : " (YYYY-MM-DD)") : step.kind === "email" ? " (email)" : step.kind === "number" ? " (a number)" : "";
    return { text: `${n} · ${step.label}${hint}${optional}${now}`, typed: true };
  }

  /** Apply a typed reply or a button choice (by row label). Returns an error to show, or undefined. */
  answer(store: SurfaceStore, input: { text?: string; choice?: string }): string | undefined {
    const step = this.current;
    if (!step) return "this form is complete";
    let value: unknown;
    if (step.choices) {
      const label = input.choice ?? input.text?.trim();
      if (label === "Skip" && !step.required) return this.advance(store, step, undefined);
      if (step.multiple && label === "✓ Done") return this.advance(store, step, [...this.picked]);
      const choice = step.choices.find((c) => c.label === label);
      if (!choice) return `Please choose one of: ${step.choices.map((c) => c.label).join(", ")}`;
      if (step.multiple) {
        this.picked = this.picked.includes(choice.value) ? this.picked.filter((v) => v !== choice.value) : [...this.picked, choice.value];
        return undefined;
      }
      value = choice.value;
    } else {
      const text = (input.text ?? "").trim();
      if (text.toLowerCase() === SKIP && !step.required) return this.advance(store, step, undefined);
      if (step.type === "date" && step.range) {
        const m = /^(\d{4}-\d{2}-\d{2})\s*(?:to|–|-{1,2}|→)\s*(\d{4}-\d{2}-\d{2})$/i.exec(text);
        if (!m) return "Please send two dates like 2026-11-10 to 2026-11-17";
        value = [m[1], m[2]];
      } else if (step.type === "date") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "Please send a date like 2026-11-10";
        value = text;
      } else if (step.kind === "number") {
        if (!Number.isFinite(Number(text)) || text === "") return "Please send a number";
        value = Number(text);
      } else value = text;
    }
    const fails = runChecks(value, step.checks);
    if (fails.length) return fails.join("; ");
    return this.advance(store, step, value);
  }

  private advance(store: SurfaceStore, step: Step, value: unknown): undefined {
    if (value !== undefined) store.setValue(this.surface, step.bindPath, value);
    this.index++;
    this.picked = [];
    return undefined;
  }
}
