// The host's request/response contract works over HTTP or an app-owned private
// transport. Admission, routes and canonical session execution remain shared.
import { Readable, Writable } from "node:stream";
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from "node:http";

export interface HostRequest extends AsyncIterable<Uint8Array | string> {
  method?: string;
  url?: string;
  headers: IncomingHttpHeaders;
}
export interface HostResponse extends Writable {
  readonly headersSent: boolean;
  setHeader(name: string, value: string | number | readonly string[]): this;
  writeHead(status: number, headers?: OutgoingHttpHeaders): this;
  flushHeaders(): void;
}
export type HostHandler = (req: HostRequest, res: HostResponse) => Promise<unknown> | unknown;

/** Web-standard streaming adapter. It creates no socket and opens no listener. */
export function createFetchHandler(handle: HostHandler): (request: Request) => Promise<Response> {
  return (request) => new Promise<Response>((resolve, reject) => {
    const input = request.body ? Readable.fromWeb(request.body as import("node:stream/web").ReadableStream) : Readable.from([]);
    const url = new URL(request.url);
    const req: HostRequest = Object.assign(input, { method: request.method, url: url.pathname + url.search, headers: Object.fromEntries(request.headers) });
    req.headers.host ??= url.host;
    let controller: ReadableStreamDefaultController<Uint8Array>;
    let pending: ((error?: Error | null) => void) | undefined;
    let ended = false;
    const body = new ReadableStream<Uint8Array>({
      start(c) { controller = c; },
      pull() { const done = pending; pending = undefined; done?.(); },
      cancel() { output.destroy(); },
    }, { highWaterMark: 64 * 1024, size: (chunk) => chunk.byteLength });
    const headers = new Headers();
    class ResponseWriter extends Writable implements HostResponse {
      headersSent = false;
      status = 200;
      setHeader(name: string, value: string | number | readonly string[]): this {
        if (this.headersSent) throw new Error("Headers already sent");
        headers.set(name, Array.isArray(value) ? value.join(", ") : String(value));
        return this;
      }
      writeHead(status: number, values: OutgoingHttpHeaders = {}): this {
        this.status = status;
        for (const [key, value] of Object.entries(values)) if (value !== undefined) this.setHeader(key, value);
        this.flushHeaders();
        return this;
      }
      flushHeaders(): void {
        if (this.headersSent) return;
        this.headersSent = true;
        resolve(new Response([204, 205, 304].includes(this.status) || request.method === "HEAD" ? null : body, { status: this.status, headers }));
      }
      write(chunk: string | Uint8Array, encoding?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void): boolean {
        if (this.writableLength + Buffer.byteLength(chunk) > 8 * 1024 * 1024) {
          const error = new Error("Response consumer is too slow");
          this.destroy(error);
          (typeof encoding === "function" ? encoding : callback)?.(error);
          return false;
        }
        return typeof encoding === "function" ? super.write(chunk, encoding) : super.write(chunk, encoding ?? "utf8", callback);
      }
      _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
        this.flushHeaders();
        controller.enqueue(new Uint8Array(chunk));
        if ((controller.desiredSize ?? 0) > 0) callback();
        else pending = callback;
      }
      _final(callback: (error?: Error | null) => void): void {
        this.flushHeaders();
        ended = true;
        controller.close();
        callback();
      }
      _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
        input.destroy();
        if (!ended) { ended = true; try { controller.error(error ?? new Error("Response closed")); } catch { /* reader already cancelled */ } }
        const done = pending; pending = undefined; done?.(error ?? new Error("Response closed"));
        if (!this.headersSent) reject(error ?? new Error("Response closed"));
        request.signal.removeEventListener("abort", abort);
        callback(error);
      }
    }
    const output = new ResponseWriter({ highWaterMark: 64 * 1024 });
    output.on("error", () => { /* delivered through the response stream */ });
    const abort = () => output.destroy(request.signal.reason instanceof Error ? request.signal.reason : new Error("Request aborted"));
    if (request.signal.aborted) { abort(); return; }
    request.signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => handle(req, output)).catch((error: unknown) => {
      output.destroy(error instanceof Error ? error : new Error(String(error)));
    });
  });
}
