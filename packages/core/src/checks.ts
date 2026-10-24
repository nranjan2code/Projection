// Named validation functions. Models reference them by name ("required",
// "minLength:3"); no executable code ever crosses from the model. They run
// server-side so every target (Telegram, Discord, ...) gets validation.

export type CheckFn = (value: unknown, arg: string | undefined) => boolean;

const isEmpty = (v: unknown) =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

const len = (v: unknown) => (Array.isArray(v) ? v.length : String(v ?? "").length);

export const builtinChecks: Record<string, { fn: CheckFn; message: (arg?: string) => string }> = {
  required: { fn: (v) => !isEmpty(v) && v !== false, message: () => "This field is required" },
  email: { fn: (v) => isEmpty(v) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v)), message: () => "Enter a valid email" },
  url: {
    fn: (v) => {
      if (isEmpty(v)) return true;
      try {
        return /^https?:$/.test(new URL(String(v)).protocol);
      } catch {
        return false;
      }
    },
    message: () => "Enter a valid URL",
  },
  number: { fn: (v) => isEmpty(v) || Number.isFinite(Number(v)), message: () => "Enter a number" },
  integer: { fn: (v) => isEmpty(v) || Number.isInteger(Number(v)), message: () => "Enter a whole number" },
  minLength: { fn: (v, a) => isEmpty(v) || len(v) >= Number(a), message: (a) => `At least ${a} characters` },
  maxLength: { fn: (v, a) => isEmpty(v) || len(v) <= Number(a), message: (a) => `At most ${a} characters` },
  min: { fn: (v, a) => isEmpty(v) || Number(v) >= Number(a), message: (a) => `Must be at least ${a}` },
  max: { fn: (v, a) => isEmpty(v) || Number(v) <= Number(a), message: (a) => `Must be at most ${a}` },
};

/** Parse "name" or "name:arg". */
export function parseCheck(ref: string): { name: string; arg?: string } {
  const at = ref.indexOf(":");
  return at < 0 ? { name: ref.trim() } : { name: ref.slice(0, at).trim(), arg: ref.slice(at + 1).trim() };
}

/** Returns the failure messages; unknown check names are ignored. */
export function runChecks(value: unknown, refs: unknown, registry = builtinChecks): string[] {
  if (!Array.isArray(refs)) return [];
  const out: string[] = [];
  for (const ref of refs) {
    if (typeof ref !== "string") continue;
    const { name, arg } = parseCheck(ref);
    const check = registry[name];
    if (check && !check.fn(value, arg)) out.push(check.message(arg));
  }
  return out;
}

export function isRequired(refs: unknown): boolean {
  return Array.isArray(refs) && refs.some((r) => typeof r === "string" && parseCheck(r).name === "required");
}
