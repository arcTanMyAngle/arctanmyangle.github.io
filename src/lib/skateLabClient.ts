// Talks to the Skate Lab core: in a module Worker when one starts, otherwise on the page, one request per timeout so
// the page still paints between training steps. Requests are answered in the order they were sent.
import type { Checkpoint } from "./skateNet";
import type { LabCore, LabReply, LabRequest } from "./skateLabCore";

export interface LabClient {
  send(req: LabRequest): Promise<LabReply>;
  /** Where the lab runs; "page" after a Worker failed to start or crashed (the lab restarts from the checkpoint). */
  readonly mode: "worker" | "page";
  destroy(): void;
}

interface Waiting {
  req: LabRequest;
  resolve: (reply: LabReply) => void;
}

export function createLabClient(checkpoint: Checkpoint, onModeChange?: (mode: "page") => void): LabClient {
  let worker: Worker | null = null;
  let core: Promise<LabCore> | null = null;
  let destroyed = false;
  let nextId = 1;
  const waiting = new Map<number, Waiting>();
  let pageQueue: Promise<unknown> = Promise.resolve();

  function onPage(req: LabRequest): Promise<LabReply> {
    core ??= import("./skateLabCore").then(({ createLabCore }) => {
      const c = createLabCore();
      c.handle({ type: "init", checkpoint });
      return c;
    });
    const run = pageQueue.then(
      () =>
        new Promise<LabReply>((resolve) => {
          window.setTimeout(() => {
            void core!.then((c) => resolve(destroyed ? { type: "error", message: "destroyed" } : c.handle(req)));
          }, 0);
        }),
    );
    pageQueue = run;
    return run;
  }

  function fallBack() {
    worker?.terminate();
    worker = null;
    if (destroyed) return;
    onModeChange?.("page");
    // Whatever the worker was holding is gone; answer the waiting requests from a page-side lab instead
    const left = [...waiting.values()];
    waiting.clear();
    for (const w of left) void onPage(w.req).then(w.resolve);
  }

  try {
    worker = new Worker(new URL("./skateWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; reply: LabReply }>) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      w.resolve(e.data.reply);
    };
    worker.onerror = fallBack;
    worker.postMessage({ id: 0, req: { type: "init", checkpoint } });
  } catch {
    worker = null;
  }

  return {
    get mode() {
      return worker ? "worker" : "page";
    },
    send(req) {
      if (destroyed) return Promise.resolve({ type: "error", message: "destroyed" });
      if (!worker) return onPage(req);
      const id = nextId++;
      return new Promise<LabReply>((resolve) => {
        waiting.set(id, { req, resolve });
        worker!.postMessage({ id, req });
      });
    },
    destroy() {
      destroyed = true;
      worker?.terminate();
      worker = null;
      waiting.clear();
    },
  };
}
