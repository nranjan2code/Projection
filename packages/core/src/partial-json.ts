// Lenient, streaming-tolerant JSON parser.
//
// - Parses any prefix of a JSON document, closing whatever is still open, so a
//   UI can render while tool-call arguments stream in.
// - Repairs what models commonly emit: code fences and prose around the JSON,
//   comments, trailing commas, single quotes (even a key that opens with one
//   quote and closes with the other), unquoted keys, raw newlines in
//   strings, Python-style True/False/None, and keyless values inside an object
//   ({"body": "a", "b"} — the stray value continues the previous member),
//   objects whose "}" was omitted before the next array element, and
//   values after a closed top-level array ("[a], b, c" or "[a]}, b" — they
//   continue the array).
// - Reports which containers are unfinished and which object keys hold a
//   string that was cut off, so callers never act on a half-written id.

export interface PartialResult {
  value: unknown;
  /** The root value closed and nothing was cut off. */
  complete: boolean;
  /** Objects/arrays whose closing bracket has not arrived. */
  incomplete: WeakSet<object>;
  /** Keys whose string value was truncated, per object. */
  partialKeys: WeakMap<object, Set<string>>;
}

const MISSING = Symbol("missing");
type Parsed = unknown | typeof MISSING;

const IDENT_VALUES: Record<string, unknown> = {
  true: true, false: false, null: null,
  True: true, False: false, None: null, undefined: null,
};

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

class Parser {
  i = 0;
  /** Open containers, innermost last, for repairing mismatched closers. */
  private open: ("{" | "[")[] = [];
  private truncated = false;
  readonly incomplete = new WeakSet<object>();
  readonly partialKeys = new WeakMap<object, Set<string>>();
  private s: string;
  /** The text is finished: values touching EOF are not still growing. */
  private final: boolean;

  constructor(s: string, final: boolean) {
    this.s = s;
    this.final = final;
  }

  get eof(): boolean {
    return this.i >= this.s.length;
  }

  get sawTruncation(): boolean {
    return this.truncated;
  }

  /**
   * "[a], b, c": an array closed too early; comma-separated values after it
   * belong to it. Stray closers before a comma were part of the same early
   * close ("[{..}]}, {..}]}]" from the 4B model, which shut its root list
   * one level too soon and kept writing siblings).
   */
  continueArray(arr: unknown[]): void {
    for (;;) {
      this.skip();
      while (this.s[this.i] === "]" || this.s[this.i] === "}") {
        this.i++;
        this.skip();
      }
      if (this.s[this.i] !== ",") return;
      this.i++;
      this.skip();
      if (this.eof) return;
      const v = this.value();
      if (v === MISSING) return;
      arr.push(v);
    }
  }

  skip(): void {
    const s = this.s;
    while (this.i < s.length) {
      const c = s[this.i]!;
      if (c === " " || c === "\n" || c === "\r" || c === "\t") this.i++;
      else if (c === "/" && s[this.i + 1] === "/") {
        while (this.i < s.length && s[this.i] !== "\n") this.i++;
      } else if (c === "/" && s[this.i + 1] === "*") {
        const end = s.indexOf("*/", this.i + 2);
        this.i = end < 0 ? s.length : end + 2;
      } else break;
    }
  }

  value(): Parsed {
    this.skip();
    if (this.eof) {
      this.truncated = true;
      return MISSING;
    }
    const c = this.s[this.i]!;
    if (c === "{") return this.object();
    if (c === "[") return this.array();
    if (c === '"' || c === "'") {
      const embedded = this.embeddedJson(c);
      if (embedded !== MISSING) return embedded;
      return this.string().value;
    }
    if (c === "-" || c === "+" || c === "." || (c >= "0" && c <= "9")) return this.number();
    return this.ident();
  }

  object(): Parsed {
    this.open.push("{");
    try {
      return this.objectBody();
    } finally {
      this.open.pop();
    }
  }

  array(): Parsed {
    this.open.push("[");
    try {
      return this.arrayBody();
    } finally {
      this.open.pop();
    }
  }

  /** After the character at the cursor: does an object member (`, key:`) follow? */
  private memberFollows(): boolean {
    return /^.\s*,\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_$][\w$-]*)\s*[:=]/s.test(this.s.slice(this.i, this.i + 400));
  }

  /**
   * A mismatched closer has three readings: a typo for the right closer, the
   * right closer omitted before it (it closes the enclosing container), or a
   * stray extra. Each leaves a different stack of open containers; the reading
   * under which the closers right after it line up with that stack is the one
   * the rest of the text agrees with. Returns the best-fitting reading, or
   * undefined when the following text does not tell them apart.
   */
  private closerReading(): "typo" | "omitted" | "stray" | undefined {
    const run = /^.([\s\]}]*)/s.exec(this.s.slice(this.i, this.i + 200))![1]!.replace(/\s+/g, "");
    if (!run) return this.restReading(this.open);
    const fit = (stack: ("{" | "[")[]) => {
      const st = [...stack];
      let n = 0;
      for (const c of run) {
        if (st.pop() !== (c === "}" ? "{" : "[")) return { n, full: false };
        n++;
      }
      return { n, full: true };
    };
    const open = this.open;
    const readings = {
      typo: fit(open.slice(0, -1)),
      omitted: open.at(-2) === (open.at(-1) === "[" ? "{" : "[") ? fit(open.slice(0, -2)) : { n: -1, full: false },
      stray: fit(open),
    };
    const score = (r: { n: number; full: boolean }) => (r.full ? 1000 : 0) + r.n;
    const ranked = (Object.entries(readings) as [keyof typeof readings, { n: number; full: boolean }][]).sort((a, b) => score(b[1]) - score(a[1]));
    if (score(ranked[0]![1]) > score(ranked[1]![1])) return ranked[0]![0];
    return this.restReading(open);
  }

  /**
   * The closers right after a mismatched one don't decide (`}, {"id":...`):
   * look at every closer in the rest of the text instead. Under each reading,
   * count closers that close something minus closers left with nothing to
   * close; the reading the rest agrees with best wins. From the 4B model's
   * dashboard: `{...stat...}}}, {...}, {...}]}], "span": 2, ...` — the third
   * "}" was a stray extra, but read as an omitted "]" it shut the KPI stack,
   * every later closer landed one level off, and the chart and table were lost.
   */
  private restReading(open: ("{" | "[")[]): "typo" | "omitted" | "stray" | undefined {
    const rest = this.s.slice(this.i + 1, this.i + 8000);
    const agree = (stack: ("{" | "[")[]) => {
      const st = [...stack];
      let score = 0;
      for (let j = 0; j < rest.length; j++) {
        const c = rest[j]!;
        if (c === '"' || c === "'") {
          for (j++; j < rest.length && rest[j] !== c; j++) if (rest[j] === "\\") j++;
        } else if (c === "{" || c === "[") st.push(c);
        else if (c === "}" || c === "]") {
          if (st.at(-1) === (c === "}" ? "{" : "[")) {
            st.pop();
            score++;
          } else score--;
        }
      }
      return score;
    };
    const omittedFits = open.at(-2) === (open.at(-1) === "[" ? "{" : "[");
    const readings: ["typo" | "omitted" | "stray", number][] = [
      ["typo", agree(open.slice(0, -1))],
      ["omitted", omittedFits ? agree(open.slice(0, -2)) : -Infinity],
      ["stray", agree(open)],
    ];
    readings.sort((a, b) => b[1] - a[1]);
    return readings[0]![1] > readings[1]![1] ? readings[0]![0] : undefined;
  }

  /** True when a container of `kind` encloses the current (innermost) one. */
  private enclosedBy(kind: "{" | "["): boolean {
    return this.open.slice(0, -1).includes(kind);
  }

  private objectBody(): Parsed {
    this.i++;
    const obj: Record<string, unknown> = {};
    let lastKey: string | undefined;
    for (;;) {
      this.skip();
      if (this.eof) {
        this.truncated = true;
        this.incomplete.add(obj);
        return obj;
      }
      const c = this.s[this.i]!;
      if (c === "}") {
        this.i++;
        return obj;
      }
      if (c === ",") {
        this.i++;
        continue;
      }
      if (c === "]") {
        // Mismatched closer: read it the way the text after it parses (see
        // closerReading). Undecided by the closers after it: if an
        // object member follows, the "]" really closes the enclosing array
        // (this object's "}" was omitted): end here, leave it to that array.
        // Otherwise it was typed for this object's "}". No enclosing array:
        // treat it as this object's closer too.
        const reading = this.closerReading();
        if (reading === "stray") {
          this.i++;
          continue;
        }
        if (reading === "omitted" || (reading === undefined && this.enclosedBy("[") && this.memberFollows())) return obj;
        this.i++;
        return obj;
      }
      if (c === ":" && lastKey !== undefined) {
        // `"k": "v": [ ... ]`: a second value after a stray colon continues
        // the previous member, like a value with no key (and its closers are
        // its own, not this object's).
        this.i++;
        const v = this.value();
        if (v === MISSING) {
          this.incomplete.add(obj);
          return obj;
        }
        const prev = obj[lastKey];
        const items = Array.isArray(v) ? v : [v];
        if (typeof prev === "string") obj[lastKey] = [prev, ...items.map((x) => (typeof x === "string" ? x : JSON.stringify(x)))].join("\n");
        else if (Array.isArray(prev)) prev.push(...items);
        if (this.truncated) {
          this.incomplete.add(obj);
          return obj;
        }
        continue;
      }
      // `[{"id":"a","props":{...},{"id":"b",...}`: an object where a key
      // belongs, inside an array, means this object's "}" was omitted and
      // the array's next element begins. Leave it to the array (read as a
      // key, its members overwrote this object's and lost the field).
      if (c === "{" && this.enclosedBy("[")) return obj;
      const key = this.key();
      if (key === MISSING) {
        this.incomplete.add(obj);
        return obj;
      }
      this.skip();
      const next = this.s[this.i];
      if (next === "," || next === "}") {
        // A value with no key: it continues the previous member.
        if (lastKey !== undefined) {
          const prev = obj[lastKey];
          if (typeof prev === "string") obj[lastKey] = `${prev}\n${key as string}`;
          else if (Array.isArray(prev)) prev.push(key);
        }
        continue;
      }
      if (next === ":" || next === "=") this.i++;
      const before = this.truncated;
      const isString = this.peekString();
      const v = this.value();
      if (v === MISSING) {
        this.incomplete.add(obj);
        return obj;
      }
      if (key === "__proto__") continue;
      obj[key as string] = v;
      lastKey = key as string;
      if (isString && this.truncated && !before) {
        let set = this.partialKeys.get(obj);
        if (!set) this.partialKeys.set(obj, (set = new Set()));
        set.add(key as string);
      }
      if (this.truncated) {
        this.incomplete.add(obj);
        return obj;
      }
    }
  }

  private arrayBody(): Parsed {
    this.i++;
    const arr: unknown[] = [];
    for (;;) {
      this.skip();
      if (this.eof) {
        this.truncated = true;
        this.incomplete.add(arr);
        return arr;
      }
      const c = this.s[this.i]!;
      if (c === "]") {
        this.i++;
        return arr;
      }
      if (c === "}") {
        // Mismatched closer: read it the way the text after it parses (see
        // closerReading). Undecided by the closers after it: if an
        // object member follows, it was typed for this array's "]" (we are
        // back in the enclosing object). Otherwise this array's "]" was
        // omitted and the "}" closes the enclosing object: end here, leave it.
        const reading = this.closerReading();
        if (reading === "stray") {
          this.i++;
          continue;
        }
        if (reading === "omitted" || (reading === undefined && this.enclosedBy("{") && !this.memberFollows())) return arr;
        this.i++;
        return arr;
      }
      if (c === ",") {
        this.i++;
        continue;
      }
      // `"key":` cannot be an array item: this array's "]" was omitted and the
      // enclosing object continues. Leave the member to it.
      if ((c === '"' || c === "'") && this.enclosedBy("{") && /^("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')\s*:/.test(this.s.slice(this.i, this.i + 300))) {
        return arr;
      }
      const v = this.value();
      if (v === MISSING) {
        this.incomplete.add(arr);
        return arr;
      }
      arr.push(v);
      if (this.truncated) {
        this.incomplete.add(arr);
        return arr;
      }
    }
  }

  /**
   * "[\"a\", \"b\"]" written without escaping the inner quotes ("["a","b"]")
   * ends the string early and scatters the rest. When a string opens with a
   * container whose read stays balanced and is followed right away by the
   * closing quote (or, when that was left out too, directly by a delimiter),
   * that container is the value. A properly
   * escaped JSON string is left a string (the schema coerces it later).
   */
  private embeddedJson(quote: string): Parsed {
    const s = this.s;
    const open = s[this.i + 1];
    if (open !== "[" && open !== "{") return MISSING;
    const start = this.i;
    const asString = this.string();
    const stringEnd = this.i;
    this.i = start;
    if (asString.closed && isJson(asString.value)) return MISSING;
    const sub = new Parser(s.slice(start + 1), true);
    const v = sub.value();
    if (v === MISSING || sub.sawTruncation || (typeof v === "object" && v !== null && sub.incomplete.has(v))) return MISSING;
    let j = start + 1 + sub.i;
    // Only when the string really ended inside the container ("{name}" is a
    // whole string that merely looks like one).
    if (asString.closed && stringEnd > j) return MISSING;
    while (/\s/.test(s[j] ?? "")) j++;
    // The closing quote may be there or omitted; a delimiter must follow.
    let k = s[j] === quote ? j + 1 : j;
    while (/\s/.test(s[k] ?? "")) k++;
    if (k < s.length && !",}]".includes(s[k]!)) return MISSING;
    this.i = s[j] === quote ? j + 1 : j;
    return v;
  }

  peekString(): boolean {
    this.skip();
    const c = this.s[this.i];
    return c === '"' || c === "'";
  }

  key(): Parsed {
    const c = this.s[this.i]!;
    // `"action':'view_july'`: a key opened with one quote and closed with the
    // other (the 4B model drifted into single quotes mid-object). Read to the
    // first quote, the key ended there; read as one string, the key ran to the
    // next `"` and swallowed the nodes after it.
    const mixed = /^(["'])([A-Za-z_$][\w$-]*)(["'])\s*[:=]/.exec(this.s.slice(this.i, this.i + 200));
    if (mixed && mixed[1] !== mixed[3]) {
      this.i += mixed[1]!.length + mixed[2]!.length + 1;
      return mixed[2]!;
    }
    if (c === '"' || c === "'") {
      const { value, closed } = this.string();
      return closed ? value : MISSING;
    }
    const m = /^[A-Za-z_$][\w$-]*/.exec(this.s.slice(this.i));
    if (!m) {
      // Unparseable junk: skip a char so we always make progress.
      this.i++;
      return this.eof ? MISSING : this.key();
    }
    this.i += m[0].length;
    if (this.eof && !this.final) {
      this.truncated = true;
      return MISSING;
    }
    return m[0];
  }

  string(): { value: string; closed: boolean } {
    const quote = this.s[this.i++]!;
    let out = "";
    const s = this.s;
    while (this.i < s.length) {
      const c = s[this.i++]!;
      if (c === quote) return { value: out, closed: true };
      if (c !== "\\") {
        out += c;
        continue;
      }
      if (this.i >= s.length) break;
      const e = s[this.i++]!;
      switch (e) {
        case "n": out += "\n"; break;
        case "t": out += "\t"; break;
        case "r": out += "\r"; break;
        case "b": out += "\b"; break;
        case "f": out += "\f"; break;
        case "u": {
          const hex = s.slice(this.i, this.i + 4);
          if (hex.length < 4) {
            this.i = s.length;
            break;
          }
          out += String.fromCharCode(parseInt(hex, 16));
          this.i += 4;
          break;
        }
        default: out += e;
      }
    }
    this.truncated = true;
    return { value: out, closed: false };
  }

  number(): Parsed {
    const m = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(this.s.slice(this.i));
    if (!m) {
      this.i++;
      if (this.eof) this.truncated = true;
      return MISSING;
    }
    this.i += m[0].length;
    // A number touching EOF may still be growing ("12" -> "123"); drop it.
    if (this.eof && !this.final) {
      this.truncated = true;
      return MISSING;
    }
    return Number(m[0]);
  }

  ident(): Parsed {
    const m = /^[A-Za-z_]\w*/.exec(this.s.slice(this.i));
    if (!m) {
      this.i++;
      return this.eof ? ((this.truncated = true), MISSING) : this.value();
    }
    this.i += m[0].length;
    if (m[0] in IDENT_VALUES) return IDENT_VALUES[m[0]];
    if (this.eof && !this.final) {
      // Probably the prefix of true/false/null.
      this.truncated = true;
      return MISSING;
    }
    // Bare word: keep it as a string rather than failing.
    return m[0];
  }
}

function startOfJson(text: string): number {
  const fence = /```(?:json|jsonc)?\s*/i.exec(text);
  const from = fence ? fence.index + fence[0].length : 0;
  const obj = text.indexOf("{", from);
  const arr = text.indexOf("[", from);
  if (obj < 0) return arr < 0 ? from : arr;
  if (arr < 0) return obj;
  return Math.min(obj, arr);
}

export function parsePartial(text: string, opts: { final?: boolean } = {}): PartialResult {
  const p = new Parser(text.slice(startOfJson(text)), opts.final ?? false);
  const v = p.value();
  if (Array.isArray(v)) p.continueArray(v);
  return {
    value: v === MISSING ? undefined : v,
    complete: v !== MISSING && !p.sawTruncation,
    incomplete: p.incomplete,
    partialKeys: p.partialKeys,
  };
}

/** Parse a finished (possibly sloppy) JSON string; throws if nothing usable. */
export function parseLenient(text: string): unknown {
  const r = parsePartial(text, { final: true });
  if (r.value === undefined) throw new SyntaxError("No JSON value found");
  return r.value;
}
