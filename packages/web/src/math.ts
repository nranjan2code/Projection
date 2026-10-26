// TeX to MathML for the math component: the common subset of formulas
// (fractions, roots, scripts, Greek, operators, accents, \left…\right,
// matrices and cases). MathML is drawn by the browser itself (WebKit and
// Chromium), so formulas need no fonts or libraries. Unknown commands show as
// their name rather than disappearing.

const M = "http://www.w3.org/1998/Math/MathML";

const SYMBOLS: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ϵ", varepsilon: "ε", zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ", lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", varpi: "ϖ", rho: "ρ", sigma: "σ", tau: "τ", upsilon: "υ", phi: "ϕ", varphi: "φ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ", Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  infty: "∞", partial: "∂", nabla: "∇", hbar: "ℏ", ell: "ℓ", emptyset: "∅", Re: "ℜ", Im: "ℑ", aleph: "ℵ", degree: "°", prime: "′",
};
const OPS: Record<string, string> = {
  times: "×", cdot: "⋅", div: "÷", pm: "±", mp: "∓", ast: "∗", star: "⋆", circ: "∘", bullet: "∙",
  le: "≤", leq: "≤", ge: "≥", geq: "≥", ne: "≠", neq: "≠", approx: "≈", equiv: "≡", sim: "∼", simeq: "≃", cong: "≅", propto: "∝", ll: "≪", gg: "≫",
  to: "→", rightarrow: "→", leftarrow: "←", leftrightarrow: "↔", Rightarrow: "⇒", Leftarrow: "⇐", Leftrightarrow: "⇔", implies: "⟹", iff: "⟺", mapsto: "↦",
  in: "∈", notin: "∉", ni: "∋", subset: "⊂", subseteq: "⊆", supset: "⊃", supseteq: "⊇", cup: "∪", cap: "∩", setminus: "∖", forall: "∀", exists: "∃", neg: "¬", land: "∧", lor: "∨", wedge: "∧", vee: "∨", oplus: "⊕", otimes: "⊗", perp: "⊥", parallel: "∥", mid: "∣",
  ldots: "…", cdots: "⋯", dots: "…", vdots: "⋮", ddots: "⋱", langle: "⟨", rangle: "⟩", lfloor: "⌊", rfloor: "⌋", lceil: "⌈", rceil: "⌉", vert: "|", Vert: "‖", lbrace: "{", rbrace: "}",
  quad: " ", qquad: "  ", ",": " ", ";": " ", ":": " ", "!": "", " ": " ",
};
const BIG: Record<string, string> = { sum: "∑", prod: "∏", coprod: "∐", int: "∫", iint: "∬", iiint: "∭", oint: "∮", bigcup: "⋃", bigcap: "⋂" };
const FUNCS = new Set(["sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "log", "ln", "lg", "exp", "lim", "max", "min", "sup", "inf", "det", "gcd", "deg", "dim", "ker", "arg", "Pr", "mod"]);
const LIMITS = new Set(["lim", "max", "min", "sup", "inf"]);
const ACCENTS: Record<string, string> = { hat: "^", widehat: "^", bar: "¯", overline: "¯", vec: "→", dot: "˙", ddot: "¨", tilde: "~", widetilde: "~" };
const ENV_FENCES: Record<string, [string, string]> = { pmatrix: ["(", ")"], bmatrix: ["[", "]"], Bmatrix: ["{", "}"], vmatrix: ["|", "|"], Vmatrix: ["‖", "‖"], cases: ["{", ""] };

type Tok = { t: "cmd" | "ch" | "{" | "}" | "^" | "_" | "&" | "\\\\"; v: string };

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  for (let i = 0; i < src.length; ) {
    const c = src[i]!;
    if (c === "\\") {
      if (src[i + 1] === "\\") ((out.push({ t: "\\\\", v: "" })), (i += 2));
      else {
        const m = /^[A-Za-z]+/.exec(src.slice(i + 1));
        const name = m ? m[0] : (src[i + 1] ?? "");
        out.push({ t: "cmd", v: name });
        i += 1 + name.length;
      }
    } else if (c === "{" || c === "}" || c === "^" || c === "_" || c === "&") ((out.push({ t: c, v: c })), i++);
    else if (/\s/.test(c)) i++;
    else ((out.push({ t: "ch", v: c })), i++);
  }
  return out;
}

class Parser {
  i = 0;
  readonly toks: Tok[];
  readonly doc: Document;
  readonly display: boolean;
  constructor(toks: Tok[], doc: Document, display: boolean) {
    this.toks = toks;
    this.doc = doc;
    this.display = display;
  }
  el(tag: string, kids: (Node | string)[] = [], attrs: Record<string, string> = {}): Element {
    const e = this.doc.createElementNS(M, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    for (const k of kids) e.append(k);
    return e;
  }
  peek(): Tok | undefined {
    return this.toks[this.i];
  }
  /** A run of atoms until `}` / `\right` / `\end` / `&` / `\\` (whichever the caller stops on). */
  row(stop: (t: Tok) => boolean = (t) => t.t === "}"): Element {
    const kids: Element[] = [];
    while (this.peek() && !stop(this.peek()!)) {
      const a = this.atom();
      if (a) kids.push(this.scripts(a));
    }
    return kids.length === 1 ? kids[0]! : this.el("mrow", kids);
  }
  /** One argument: a braced group or a single token. */
  arg(): Element {
    const t = this.peek();
    if (t?.t === "{") {
      this.i++;
      const r = this.row();
      this.i++;
      return r;
    }
    return this.atom() ?? this.el("mrow");
  }
  rawArg(): string {
    if (this.peek()?.t !== "{") return this.toks[this.i++]?.v ?? "";
    this.i++;
    let depth = 1, s = "";
    while (this.peek() && depth) {
      const t = this.toks[this.i++]!;
      if (t.t === "{") depth++;
      else if (t.t === "}" && !--depth) break;
      s += t.t === "cmd" ? `\\${t.v}` : t.t === "\\\\" ? " " : t.v;
    }
    return s;
  }
  scripts(base: Element): Element {
    let sub: Element | undefined, sup: Element | undefined;
    for (;;) {
      const t = this.peek();
      if (t?.t === "_") ((this.i++), (sub = this.arg()));
      else if (t?.t === "^") ((this.i++), (sup = this.arg()));
      else if (t?.t === "ch" && t.v === "'") ((this.i++), (sup = this.el("mo", ["′"])));
      else break;
    }
    if (!sub && !sup) return base;
    // Big operators and limits stack their scripts in display formulas.
    const under = this.display && base.getAttribute("data-limits") === "1";
    if (sub && sup) return this.el(under ? "munderover" : "msubsup", [base, sub, sup]);
    return sub ? this.el(under ? "munder" : "msub", [base, sub]) : this.el(under ? "mover" : "msup", [base, sup!]);
  }
  atom(): Element | undefined {
    const t = this.toks[this.i++];
    if (!t) return undefined;
    if (t.t === "{") {
      const r = this.row();
      this.i++;
      return r;
    }
    if (t.t === "}" || t.t === "&" || t.t === "\\\\") return undefined;
    if (t.t === "^" || t.t === "_") return this.el("mrow");
    if (t.t === "ch") {
      if (/[0-9.]/.test(t.v)) {
        let n = t.v;
        while (this.peek()?.t === "ch" && /[0-9.]/.test(this.peek()!.v)) n += this.toks[this.i++]!.v;
        return this.el("mn", [n]);
      }
      if (/[A-Za-z]/.test(t.v)) return this.el("mi", [t.v]);
      return this.el("mo", [t.v === "-" ? "−" : t.v === "*" ? "∗" : t.v], /[()[\]|]/.test(t.v) ? { stretchy: "false" } : {});
    }
    const c = t.v;
    if (c === "frac" || c === "dfrac" || c === "tfrac") return this.el("mfrac", [this.arg(), this.arg()]);
    if (c === "binom") return this.el("mrow", [this.el("mo", ["("]), this.el("mfrac", [this.arg(), this.arg()], { linethickness: "0" }), this.el("mo", [")"])]);
    if (c === "sqrt") {
      if (this.peek()?.t === "ch" && this.peek()!.v === "[") {
        this.i++;
        const idx = this.row((x) => x.t === "ch" && x.v === "]");
        this.i++;
        const body = this.arg();
        return this.el("mroot", [body, idx]);
      }
      return this.el("msqrt", [this.arg()]);
    }
    if (c === "text" || c === "mathrm" || c === "textrm" || c === "operatorname" || c === "mbox") {
      const s = this.rawArg();
      return c === "text" || c === "mbox" || c === "textrm" ? this.el("mtext", [s]) : this.el("mi", [s], { mathvariant: "normal" });
    }
    if (c === "mathbf" || c === "boldsymbol" || c === "mathit" || c === "mathbb" || c === "mathcal") {
      const variant = { mathbf: "bold", boldsymbol: "bold-italic", mathit: "italic", mathbb: "double-struck", mathcal: "script" }[c]!;
      const s = this.rawArg();
      return this.el("mi", [s], { mathvariant: variant });
    }
    if (c in ACCENTS) return this.el("mover", [this.arg(), this.el("mo", [ACCENTS[c]!], { stretchy: "true" })], { accent: "true" });
    if (c === "underline") return this.el("munder", [this.arg(), this.el("mo", ["_"], { stretchy: "true" })]);
    if (c === "left") {
      const open = this.delim();
      const body = this.row((x) => x.t === "cmd" && x.v === "right");
      this.i++;
      const close = this.delim();
      return this.el("mrow", [this.el("mo", [open], { fence: "true" }), body, this.el("mo", [close], { fence: "true" })]);
    }
    if (c === "right") return undefined;
    if (c === "begin") return this.env(this.rawArg());
    if (c in BIG) return this.el("mo", [BIG[c]!], { largeop: "true", "data-limits": c.includes("int") ? "0" : "1" });
    if (FUNCS.has(c)) return this.el("mi", [c], { mathvariant: "normal", "data-limits": LIMITS.has(c) ? "1" : "0" });
    if (c in SYMBOLS) return this.el("mi", [SYMBOLS[c]!], /^[A-Z]/.test(c) ? { mathvariant: "normal" } : {});
    if (c in OPS) return this.el("mo", [OPS[c]!]);
    if (c === "{" || c === "}" || c === "%" || c === "$" || c === "#" || c === "_" || c === "&") return this.el("mo", [c]);
    if (c === "displaystyle" || c === "limits" || c === "nolimits") return this.el("mrow");
    return this.el("mtext", [`\\${c}`], { class: "math-unknown" });
  }
  delim(): string {
    const t = this.toks[this.i++];
    if (!t) return "";
    if (t.t === "cmd") return t.v === "{" || t.v === "lbrace" ? "{" : t.v === "}" || t.v === "rbrace" ? "}" : (OPS[t.v] ?? (t.v === "|" ? "‖" : ""));
    return t.v === "." ? "" : t.v;
  }
  env(name: string): Element {
    const rows: Element[] = [];
    let cells: Element[] = [];
    const endRow = () => {
      rows.push(this.el("mtr", cells.map((c) => this.el("mtd", [c]))));
      cells = [];
    };
    for (;;) {
      const cellEl = this.row((x) => x.t === "&" || x.t === "\\\\" || (x.t === "cmd" && x.v === "end"));
      cells.push(cellEl);
      const t = this.toks[this.i++];
      if (!t) break;
      if (t.t === "&") continue;
      if (t.t === "\\\\") {
        endRow();
        continue;
      }
      this.rawArg();
      break;
    }
    if (cells.length) endRow();
    const aligned = name === "aligned" || name === "align" || name === "cases" || name === "align*";
    const table = this.el("mtable", rows, aligned ? { columnalign: name === "cases" ? "left left" : "right left", columnspacing: "0.3em" } : {});
    const f = ENV_FENCES[name];
    return f ? this.el("mrow", [this.el("mo", [f[0]], { fence: "true" }), table, ...(f[1] ? [this.el("mo", [f[1]], { fence: "true" })] : [])]) : table;
  }
}

/** A <math> element for `tex`; `display` draws it as a block with stacked limits. */
export function texToMathML(tex: string, display = true, doc: Document = document): Element {
  const p = new Parser(lex(tex.trim().replace(/^\$\$?|\$\$?$/g, "").replace(/^\\\[|\\\]$/g, "")), doc, display);
  const rows: Element[] = [];
  // Stray closers never end the formula early.
  while (p.peek()) {
    rows.push(p.row());
    if (p.peek()) p.i++;
  }
  const math = p.el("math", [p.el("mrow", rows)], { display: display ? "block" : "inline" });
  math.setAttribute("alttext", tex);
  for (const e of math.querySelectorAll("[data-limits]")) e.removeAttribute("data-limits");
  return math;
}
