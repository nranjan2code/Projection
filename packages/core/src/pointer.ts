// JSON Pointer (RFC 6901) helpers plus VPS relative-path scoping.

export function parsePointer(pointer: string): string[] {
  if (pointer === "" || pointer === "/") return [];
  const body = pointer.startsWith("/") ? pointer.slice(1) : pointer;
  return body.split("/").map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}

export function joinPointer(segments: readonly (string | number)[]): string {
  return segments.map((s) => "/" + String(s).replace(/~/g, "~0").replace(/\//g, "~1")).join("");
}

/** Resolve a path against a template scope: absolute paths start with `/`. */
export function resolvePath(path: string, scope = ""): string {
  if (path.startsWith("/")) return path;
  return path === "" ? scope : `${scope}/${path}`;
}

export function getAt(root: unknown, pointer: string): unknown {
  let cur: unknown = root;
  for (const seg of parsePointer(pointer)) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

const UNSAFE = new Set(["__proto__", "prototype", "constructor"]);

/**
 * Write into `root` at `pointer`, creating intermediate objects. `undefined`
 * deletes. Returns false when the path is unusable (e.g. walks through a string).
 */
export function setAt(root: Record<string, unknown>, pointer: string, value: unknown, mode: "add" | "replace" = "replace"): boolean {
  const segs = parsePointer(pointer);
  if (segs.length === 0 || segs.some((s) => UNSAFE.has(s))) return false;
  let cur: unknown = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i]!;
    const container = cur as Record<string, unknown>;
    let next = container[seg];
    if (next === undefined || next === null) {
      next = /^\d+$/.test(segs[i + 1]!) ? [] : {};
      container[seg] = next;
    }
    if (typeof next !== "object") return false;
    cur = next;
  }
  const last = segs[segs.length - 1]!;
  if (Array.isArray(cur)) {
    const idx = last === "-" ? cur.length : Number(last);
    if (!Number.isInteger(idx) || idx < 0 || idx > cur.length) return false;
    if (value === undefined) cur.splice(idx, 1);
    else if (mode === "add") cur.splice(idx, 0, value);
    else cur[idx] = value;
    return true;
  }
  const obj = cur as Record<string, unknown>;
  if (value === undefined) delete obj[last];
  else obj[last] = value;
  return true;
}
