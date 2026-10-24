// Small, safe markdown → DOM. Builds nodes directly (never innerHTML), so model
// text can't inject markup. Covers what LLMs actually emit: headings,
// paragraphs, lists, code blocks, inline code, bold, italic, links.

const SAFE_URL = /^(https?:|mailto:)/i;

function inline(text: string, doc: Document): Node[] {
  const out: Node[] = [];
  // Order matters: code first so its contents are not formatted.
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_|\[([^\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(doc.createTextNode(text.slice(last, m.index)));
    if (m[1] !== undefined) {
      const el = doc.createElement("code");
      el.textContent = m[1];
      out.push(el);
    } else if (m[2] !== undefined || m[3] !== undefined) {
      const el = doc.createElement("strong");
      el.append(...inline(m[2] ?? m[3]!, doc));
      out.push(el);
    } else if (m[4] !== undefined || m[5] !== undefined) {
      const el = doc.createElement("em");
      el.append(...inline(m[4] ?? m[5]!, doc));
      out.push(el);
    } else if (m[6] !== undefined) {
      const href = m[7]!;
      if (SAFE_URL.test(href)) {
        const a = doc.createElement("a");
        a.href = href;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.append(...inline(m[6], doc));
        out.push(a);
      } else out.push(doc.createTextNode(m[6]));
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(doc.createTextNode(text.slice(last)));
  return out;
}

export function renderMarkdown(src: string, doc: Document = document): DocumentFragment {
  const frag = doc.createDocumentFragment();
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];
  let list: HTMLElement | null = null;

  const flushPara = () => {
    if (!para.length) return;
    const p = doc.createElement("p");
    para.forEach((line, i) => {
      if (i) p.append(doc.createElement("br"));
      p.append(...inline(line, doc));
    });
    frag.append(p);
    para = [];
  };
  const closeList = () => {
    if (list) frag.append(list);
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = /^```(\w*)/.exec(line);
    if (fence) {
      flushPara();
      closeList();
      const code: string[] = [];
      while (++i < lines.length && !/^```/.test(lines[i]!)) code.push(lines[i]!);
      const pre = doc.createElement("pre");
      const c = doc.createElement("code");
      c.textContent = code.join("\n");
      pre.append(c);
      frag.append(pre);
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      closeList();
      const h = doc.createElement(`h${Math.min(heading[1]!.length + 2, 6)}`);
      h.append(...inline(heading[2]!, doc));
      frag.append(h);
      continue;
    }
    const item = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (item) {
      flushPara();
      const tag = item[2] ? "ol" : "ul";
      if (!list || list.tagName.toLowerCase() !== tag) {
        closeList();
        list = doc.createElement(tag);
      }
      const li = doc.createElement("li");
      li.append(...inline(item[3]!, doc));
      list.append(li);
      continue;
    }
    if (!line.trim()) {
      flushPara();
      closeList();
      continue;
    }
    closeList();
    para.push(line);
  }
  flushPara();
  closeList();
  return frag;
}
