// A form as Discord modals. A modal holds at most 5 labelled inputs, so a
// longer form is asked as consecutive pages (the bot opens the next page from
// a button after each submit). Choices are select menus; everything else is a
// text input read through the same field rules the other targets use. Discord
// cannot mark fields as invalid in place, so errors come back as a list for
// the bot to show, with the user's answers prefilled on retry.

import type { FormField } from "@vak/core";
import { readField, runChecks } from "@vak/core";
import { C } from "./project.ts";

export const MODAL_LIMITS = { fields: 5, title: 45, label: 45, description: 100, options: 25, optionLabel: 100, placeholder: 100, value: 4000 } as const;

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Fields split into modal pages. */
export function modalPages(fields: FormField[]): FormField[][] {
  const pages: FormField[][] = [];
  for (let i = 0; i < fields.length; i += MODAL_LIMITS.fields) pages.push(fields.slice(i, i + MODAL_LIMITS.fields));
  return pages;
}

const inputId = (i: number) => `f${i}`;

function input(f: FormField, i: number, current: unknown): Record<string, unknown> {
  const choices = f.choices;
  if (choices && choices.length <= MODAL_LIMITS.options) {
    return {
      type: C.StringSelect,
      custom_id: inputId(i),
      required: f.required,
      min_values: f.required ? 1 : 0,
      max_values: f.multiple ? choices.length : 1,
      options: choices.map((c, j) => ({
        label: clip(c.label, MODAL_LIMITS.optionLabel),
        value: String(j),
        ...((f.multiple ? Array.isArray(current) && current.includes(c.value) : c.value === current) ? { default: true } : {}),
      })),
    };
  }
  const hint = f.placeholder ?? (f.type === "date" ? (f.range ? "YYYY-MM-DD to YYYY-MM-DD" : "YYYY-MM-DD") : choices ? choices.map((c) => c.label).join(" / ") : undefined);
  const value = Array.isArray(current) ? current.join(" to ") : current === undefined || current === null ? undefined : String(current);
  return {
    type: C.TextInput,
    custom_id: inputId(i),
    style: f.type === "textarea" ? 2 : 1,
    required: f.required,
    ...(hint ? { placeholder: clip(hint, MODAL_LIMITS.placeholder) } : {}),
    ...(value ? { value: value.slice(0, MODAL_LIMITS.value) } : {}),
  };
}

export interface ModalOptions {
  /** Echoed back on submit as data.custom_id (≤ 100 chars). */
  customId: string;
  title: string;
  values?: Record<string, unknown>;
}

/** One modal page (≤ 5 fields), as the `data` of an interaction response of type 9. */
export function discordModal(page: FormField[], opts: ModalOptions): Record<string, unknown> {
  return {
    custom_id: opts.customId.slice(0, 100),
    title: clip(opts.title, MODAL_LIMITS.title),
    components: page.slice(0, MODAL_LIMITS.fields).map((f, i) => ({
      type: C.Label,
      label: clip(f.label, MODAL_LIMITS.label),
      component: input(f, i, opts.values?.[f.bindPath]),
    })),
  };
}

/** `data.components` of a modal submit: labels holding the submitted input. */
export type ModalSubmit = { component?: { custom_id?: string; value?: string; values?: string[] } }[];

export interface ModalResult {
  values: Record<string, unknown>;
  /** Field label → message. */
  errors: Record<string, string>;
}

export function readDiscordModal(page: FormField[], submitted: ModalSubmit): ModalResult {
  const byId = new Map(submitted.map((c) => [c.component?.custom_id, c.component] as const));
  const values: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  page.forEach((f, i) => {
    const got = byId.get(inputId(i)) ?? {};
    let result: { value: unknown } | { error: string };
    if (Array.isArray(got.values) && f.choices) {
      const picked = got.values.map((v) => f.choices![Number(v)]?.value);
      const value = f.multiple ? picked : picked[0];
      const fails = runChecks(value ?? "", f.checks);
      result = fails.length ? { error: fails.join("; ") } : { value };
    } else if (f.type === "checkbox") {
      // A checkbox with too many choices for a select never happens; typed yes/no is accepted too.
      const t = (got.value ?? "").trim().toLowerCase();
      result = t === "" && !f.required ? { value: undefined } : /^(y|yes|true|1)$/.test(t) ? { value: true } : /^(n|no|false|0)$/.test(t) ? { value: false } : { error: "Please answer yes or no" };
    } else {
      result = readField(f, got.value ?? "");
    }
    if ("error" in result) errors[f.label] = result.error;
    else if (result.value !== undefined) values[f.bindPath] = result.value;
  });
  return { values, errors };
}
