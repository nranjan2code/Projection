// Streaming line / Server-Sent Events / NDJSON readers. Isomorphic: works on
// any WHATWG ReadableStream (Node fetch, browsers).

export async function* readLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        yield buf.slice(0, nl).replace(/\r$/, "");
        buf = buf.slice(nl + 1);
      }
    }
    buf += decoder.decode();
    if (buf) yield buf;
  } finally {
    reader.releaseLock();
  }
}

export interface SseMessage {
  event: string;
  data: string;
}

/** Parse a Server-Sent Events stream (multi-line data, comments, CRLF). */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  let event = "message";
  let data: string[] = [];
  for await (const line of readLines(body)) {
    if (line === "") {
      if (data.length) yield { event, data: data.join("\n") };
      event = "message";
      data = [];
    } else if (line.startsWith(":")) {
      continue;
    } else {
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
  }
  if (data.length) yield { event, data: data.join("\n") };
}

/** Parse newline-delimited JSON. */
export async function* readNdjson(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  for await (const line of readLines(body)) {
    const t = line.trim();
    if (t) yield JSON.parse(t);
  }
}

