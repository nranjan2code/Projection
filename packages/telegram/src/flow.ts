// Forms in a chat: one question at a time. Choices become buttons, yes/no
// becomes two buttons, everything else is a typed reply. Each answer runs the
// field's named checks; values are written to the surface store, so the final
// submit is the same store.submit the web uses.

import { type FormField, formFields, getAt, readField, type SurfaceStore } from "@vak/core";

/** A form field as asked in the chat (see formFields in @vak/core). */
export type Step = FormField;

export interface Prompt {
  text: string;
  /** Rows of buttons; each button answers with the choice index. */
  choices?: string[][];
  /** Expect a typed reply. */
  typed: boolean;
}

const SKIP = "skip";

/** The bound fields inside `scope`, in reading order. */
export const stepsOf = formFields;

export interface FlowState {
  surface: string;
  source: string;
  index: number;
  picked: unknown[];
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
      const text = input.text ?? "";
      if (text.trim().toLowerCase() === SKIP && !step.required) return this.advance(store, step, undefined);
      const read = readField(step, text);
      if ("error" in read) return read.error;
      value = read.value;
    }
    return this.advance(store, step, value);
  }

  /** Progress only: the steps are derived from the surface again on restore. */
  save(): FlowState {
    return { surface: this.surface, source: this.source, index: this.index, picked: [...this.picked] };
  }

  static restore(store: SurfaceStore, state: FlowState): FormFlow | undefined {
    const found = store.submitScope(state.surface, state.source);
    if (!found?.scope) return undefined;
    const flow = new FormFlow(state.surface, state.source, stepsOf(found.scope));
    flow.index = Math.min(state.index, flow.steps.length);
    flow.picked = [...state.picked];
    return flow;
  }

  private advance(store: SurfaceStore, step: Step, value: unknown): undefined {
    if (value !== undefined) store.setValue(this.surface, step.bindPath, value);
    this.index++;
    this.picked = [];
    return undefined;
  }
}
