// A minimal DOM for testing the web projectors in node: no browser, no
// dependency. It implements only what they use — createElement(s),
// textContent, append, setAttribute — which is also the point: a projector
// that reached for innerHTML could not run against this at all.

class El {
  tag: string;
  attrs: Record<string, string> = {};
  kids: (El | Txt | Frag)[] = [];
  private own = "";
  constructor(tag: string) {
    this.tag = tag;
  }
  get textContent(): string {
    return this.own;
  }
  set textContent(value: string) {
    this.own = value;
    this.kids = [];
  }
  append(...nodes: (El | Txt | Frag | string)[]) {
    for (const n of nodes) this.kids.push(typeof n === "string" ? new Txt(n) : n);
  }
  addEventListener(_name: string, _handler: unknown): void {}
  setAttribute(name: string, value: string) {
    this.attrs[name] = value;
  }
  removeAttribute(name: string) {
    delete this.attrs[name];
  }
  /** Only the `[attr]` form the projectors use. */
  querySelectorAll(selector: string): El[] {
    const name = /^\[([\w-]+)\]$/.exec(selector)?.[1];
    if (!name) return [];
    return descendants(this).filter((el) => el.attrs[name] !== undefined);
  }
  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }
}

function descendants(root: El): El[] {
  const out: El[] = [];
  const walk = (n: El | Txt | Frag) => {
    if (n instanceof El) out.push(n);
    for (const k of (n as El).kids ?? []) walk(k);
  };
  for (const k of root.kids) walk(k);
  return out;
}

class Txt {
  data: string;
  constructor(data: string) {
    this.data = data;
  }
}

class Frag {
  kids: (El | Txt | Frag)[] = [];
  append(...nodes: (El | Txt | Frag | string)[]) {
    for (const n of nodes) this.kids.push(typeof n === "string" ? new Txt(n) : n);
  }
}

export function fakeDoc(): Document {
  return {
    createElement: (tag: string) => new El(tag),
    createElementNS: (_ns: string, tag: string) => new El(tag),
    createTextNode: (text: string) => new Txt(text),
    createDocumentFragment: () => new Frag(),
  } as unknown as Document;
}

/** Every element in the tree with `tag`, in document order. */
export function findAll(root: unknown, tag: string): El[] {
  const out: El[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== "object") return;
    const el = n as El;
    if (el.tag === tag) out.push(el);
    for (const k of el.kids ?? []) walk(k);
  };
  walk(root);
  return out;
}

/** All text a reader would see, in order. */
export function textOf(root: unknown): string {
  if (!root || typeof root !== "object") return "";
  if (root instanceof Txt) return root.data;
  const el = root as El & Frag;
  return (el instanceof El ? el.textContent : "") + (el.kids ?? []).map(textOf).join("");
}
