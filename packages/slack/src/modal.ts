// A form as a Slack modal: every field at once, with Slack's native inputs
// (select menus, date pickers, checkboxes). On submit the modal's state is
// read back through the same field rules the other targets use; problems go
// back to Slack as per-field errors, so the user fixes them in place.

import type { FormField } from "@vak/core";
import { readField, runChecks } from "@vak/core";

/** Slack's limits for modals. */
export const MODAL_LIMITS = { title: 24, button: 24, blocks: 100, label: 2000, options: 100, optionText: 75, metadata: 3000 } as const;

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const plain = (s: string, max: number) => ({ type: "plain_text", text: clip(s, max) || " ", emoji: true });

/** Block ids: one per field, by position (field keys can be longer than Slack allows). */
const blockId = (i: number) => `f${i}`;
const ACTION = "v";

export interface ModalOptions {
  title: string;
  submitLabel?: string;
  /** Identifies the form on submit (view_submission carries it back). */
  callbackId: string;
  /** Opaque state echoed back on submit (≤ 3000 chars). */
  privateMetadata?: string;
  /** Current values by bind path, to prefill. */
  values?: Record<string, unknown>;
}

function element(f: FormField, current: unknown): Record<string, unknown> {
  const has = current !== undefined && current !== null && current !== "";
  if (f.type === "checkbox") {
    const option = { text: plain(f.label, MODAL_LIMITS.optionText), value: "yes" };
    return { type: "checkboxes", action_id: ACTION, options: [option], ...(current === true ? { initial_options: [option] } : {}) };
  }
  if (f.choices) {
    const options = f.choices.slice(0, MODAL_LIMITS.options).map((c, i) => ({ text: plain(c.label, MODAL_LIMITS.optionText), value: String(i) }));
    const initial = f.multiple
      ? options.filter((_, i) => Array.isArray(current) && current.includes(f.choices![i]!.value))
      : options.filter((_, i) => f.choices![i]!.value === current);
    return {
      type: f.multiple ? "multi_static_select" : "static_select",
      action_id: ACTION,
      options,
      ...(f.multiple ? (initial.length ? { initial_options: initial } : {}) : initial[0] ? { initial_option: initial[0] } : {}),
    };
  }
  if (f.type === "date" && !f.range) return { type: "datepicker", action_id: ACTION, ...(has && typeof current === "string" ? { initial_date: current } : {}) };
  if (f.kind === "number") return { type: "number_input", action_id: ACTION, is_decimal_allowed: true, ...(has ? { initial_value: String(current) } : {}) };
  if (f.kind === "email") return { type: "email_text_input", action_id: ACTION, ...(has ? { initial_value: String(current) } : {}) };
  const initial = Array.isArray(current) ? current.join(" to ") : has ? String(current) : undefined;
  return {
    type: "plain_text_input",
    action_id: ACTION,
    multiline: f.type === "textarea",
    ...(f.placeholder || (f.type === "date" && f.range) ? { placeholder: plain(f.placeholder ?? "YYYY-MM-DD to YYYY-MM-DD", 150) } : {}),
    ...(initial !== undefined ? { initial_value: initial } : {}),
  };
}

export function slackModal(fields: FormField[], opts: ModalOptions): Record<string, unknown> {
  return {
    type: "modal",
    callback_id: opts.callbackId,
    title: plain(opts.title, MODAL_LIMITS.title),
    submit: plain(opts.submitLabel || "Submit", MODAL_LIMITS.button),
    close: plain("Cancel", MODAL_LIMITS.button),
    ...(opts.privateMetadata ? { private_metadata: opts.privateMetadata.slice(0, MODAL_LIMITS.metadata) } : {}),
    blocks: fields.slice(0, MODAL_LIMITS.blocks).map((f, i) => ({
      type: "input",
      block_id: blockId(i),
      label: plain(f.label, MODAL_LIMITS.label),
      optional: !f.required,
      element: element(f, opts.values?.[f.bindPath]),
    })),
  };
}

/** The `view.state.values` of a view_submission. */
export type ModalState = Record<string, Record<string, Record<string, unknown>>>;

export interface ModalResult {
  /** Bind path → value, for fields that were answered and valid. */
  values: Record<string, unknown>;
  /** Block id → message, in Slack's `response_action: "errors"` shape. */
  errors: Record<string, string>;
}

/** Read a submitted modal back into field values, checking each field. */
export function readSlackModal(fields: FormField[], state: ModalState): ModalResult {
  const values: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  fields.forEach((f, i) => {
    const v = state[blockId(i)]?.[ACTION] ?? {};
    let result: { value: unknown } | { error: string };
    if (f.type === "checkbox") {
      result = { value: Array.isArray(v.selected_options) && v.selected_options.length > 0 };
    } else if (f.choices) {
      const picked = (f.multiple ? (v.selected_options as { value: string }[] | undefined) ?? [] : v.selected_option ? [v.selected_option as { value: string }] : [])
        .map((o) => f.choices![Number(o.value)]?.value);
      const value = f.multiple ? picked : picked[0];
      const fails = runChecks(value ?? "", f.checks);
      result = fails.length ? { error: fails.join("; ") } : { value };
    } else {
      const raw = v.type === "datepicker" ? v.selected_date : v.value;
      result = readField(f, typeof raw === "string" ? raw : raw == null ? "" : String(raw));
    }
    if ("error" in result) errors[blockId(i)] = result.error;
    else if (result.value !== undefined) values[f.bindPath] = result.value;
  });
  return { values, errors };
}
