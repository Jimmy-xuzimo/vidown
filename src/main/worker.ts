import { probe, execute, type Tools } from "../core/engine";
import { classifyError } from "../core/safety";
import type { WorkerRequest, WorkerResponse } from "../shared/types";
const port = (process as any).parentPort;
const active = new Map<string, AbortController>();
const send = (message: WorkerResponse) => port.postMessage(message);
port.on("message", async ({ data }: { data: WorkerRequest }) => {
  if (data.action === "abort") {
    active.get(data.id)?.abort();
    return;
  }
  const controller = new AbortController();
  active.set(data.id, controller);
  try {
    const { tools, work, ...payload } = data.payload as {
      tools: Tools;
      work: string;
      [key: string]: any;
    };
    const result =
      data.action === "probe"
        ? await probe(payload.input, tools, work, controller.signal)
        : await execute(payload.plan, tools, work, controller.signal, (event) =>
            send({ id: data.id, type: "progress", data: event }),
          );
    send({ id: data.id, type: "result", data: result });
  } catch (error) {
    send({ id: data.id, type: "error", data: classifyError(error) });
  } finally {
    active.delete(data.id);
  }
});
