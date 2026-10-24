// Simulated user: acts on the UI a model produced, through the same store
// path a real click takes (bound values → checks → action).

import type { ResolvedNode, SurfaceStore, VpsAction } from "@vak/core";
import { walkTree } from "./rubric.ts";
import type { Act } from "./scenarios.ts";

export type ActOutcome = { action: VpsAction; values: Record<string, unknown> } | { error: string };

const today = "2026-11-10";

/** What a person would type into a field they were not told how to fill. */
function defaultValue(node: ResolvedNode): unknown {
  const p = node.props;
  const label = `${String(p.label ?? "")} ${node.bindPath ?? ""}`.toLowerCase();
  switch (node.type) {
    case "checkbox":
      return true;
    case "date":
      return p.range ? [today, "2026-11-17"] : today;
    case "textarea":
      return "It happens every time I try.";
    case "select": {
      const opts = Array.isArray(p.options) ? p.options : [];
      const first = opts[0] && typeof opts[0] === "object" ? (opts[0] as Record<string, unknown>).value : opts[0];
      return p.multiple ? [first] : first;
    }
    default: {
      if (p.kind === "email" || /e-?mail/.test(label)) return "alex@example.com";
      if (p.kind === "number" || /(guests|qty|quantity|count|number|age|people)/.test(label)) return 2;
      if (p.kind === "tel" || /phone/.test(label)) return "+1 555 0100";
      if (p.kind === "url" || /(url|website|portfolio|link)/.test(label)) return "https://example.com";
      if (/name/.test(label)) return "Alex Doe";
      return "Sample answer";
    }
  }
}

function findTarget(root: ResolvedNode, act: Act): ResolvedNode | undefined {
  let found: ResolvedNode | undefined;
  if (act.target === "form") {
    walkTree(root, (n) => (found ??= n.type === "form" ? n : undefined));
    if (found) return found;
  }
  // A button: matching the label if given, preferring primary ones.
  const buttons: ResolvedNode[] = [];
  walkTree(root, (n) => {
    if (n.type === "button" && typeof n.props.action === "string" && n.props.action) buttons.push(n);
  });
  const re = act.label ? new RegExp(act.label, "i") : undefined;
  const candidates = re ? buttons.filter((b) => re.test(String(b.props.label ?? ""))) : buttons;
  return candidates.find((b) => b.props.style === "primary") ?? candidates[0];
}

/** Fill the inputs in `scope` and activate `target`. */
export function performAct(store: SurfaceStore, surfaceId: string, act: Act): ActOutcome {
  const resolved = store.resolve(surfaceId);
  if (!resolved?.root) return { error: `surface ${surfaceId} not found` };
  const target = findTarget(resolved.root, act);
  if (!target) return { error: `no ${act.target} to act on` };

  // Fill every bound input on the surface, so a button outside a form still finds values.
  const values: Record<string, unknown> = {};
  walkTree(resolved.root, (n) => {
    if (!n.bindPath || !["input", "textarea", "select", "checkbox", "date"].includes(n.type)) return;
    const haystack = `${String(n.props.label ?? "")} ${n.bindPath}`;
    const given = Object.entries(act.fill ?? {}).find(([pattern]) => new RegExp(pattern, "i").test(haystack));
    values[n.bindPath] = given ? given[1] : defaultValue(n);
  });
  store.setValues(surfaceId, values);

  const res = store.submit(surfaceId, target.key, "bench");
  if (!res.action) return { error: `submit blocked: ${JSON.stringify(res.errors)}` };
  return { action: res.action, values };
}
