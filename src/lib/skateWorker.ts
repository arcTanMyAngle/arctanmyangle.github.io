// Web Worker wrapper around the Skate Lab core, so training never blocks the page. The lab lives here between messages.
import { createLabCore, type LabRequest } from "./skateLabCore";

const core = createLabCore();

self.onmessage = (e: MessageEvent<{ id: number; req: LabRequest }>) => {
  const { id, req } = e.data;
  self.postMessage({ id, reply: core.handle(req) });
};
