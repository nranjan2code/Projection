// Browser client for a vak agent endpoint: POSTs a turn, reads the SSE
// stream of AgentEvents, mirrors surfaces into a local SurfaceStore.

import { type AgentEvent, readSse, SurfaceStore, basicCatalog, type Catalog } from "@vak/core";

export interface TurnRequest {
  session: string;
  provider: string;
  model: string;
  message?: string;
  action?: { surface: string; source: string; data: Record<string, unknown> };
  [key: string]: unknown;
}

export class VakClient {
  readonly store: SurfaceStore;
  readonly endpoint: string;

  constructor(endpoint: string, catalog: Catalog = basicCatalog) {
    this.endpoint = endpoint;
    this.store = new SurfaceStore(catalog);
  }

  /** Run one turn; `onEvent` sees every event after the store is updated. */
  async turn(req: TurnRequest, onEvent: (e: AgentEvent) => void, signal?: AbortSignal): Promise<void> {
    const res = await fetch(this.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
      signal,
    });
    if (!res.ok || !res.body) {
      onEvent({ type: "error", message: `HTTP ${res.status}: ${await res.text()}` });
      return;
    }
    for await (const msg of readSse(res.body)) {
      const event = JSON.parse(msg.data) as AgentEvent;
      if (event.type === "surface") this.store.load(event.snapshot);
      else if (event.type === "surface_removed") this.store.remove({ surface: event.id });
      onEvent(event);
    }
  }
}
