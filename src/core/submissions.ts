import { randomUUID } from "node:crypto";
import type { MediaAsset, SubmissionItem } from "../shared/types";

/** Probe states are separate from persisted transfer states. Never persist credentials here. */
export class Submissions {
  private items = new Map<
    string,
    { item: SubmissionItem; url: string; generation: number }
  >();
  private requests = new Map<string, string>();
  private active = 0;
  private browserActive = false;
  constructor(
    private handlers: {
      probe(url: string): Promise<MediaAsset>;
      enqueue(asset: MediaAsset, url: string): Promise<string | undefined>;
      browser(url: string): boolean;
      error(error: unknown): string;
      changed(): void;
    },
  ) {}
  list(): SubmissionItem[] {
    return [...this.items.values()].map(({ item }) => ({ ...item }));
  }
  get busy(): boolean {
    return (
      this.active > 0 ||
      [...this.items.values()].some((row) => row.item.state === "waiting")
    );
  }
  clear(): void {
    if (this.busy) throw new Error("请等待探测结束后清理");
    this.items.clear();
    this.requests.clear();
  }
  pin(assetId: string): boolean {
    return [...this.items.values()].some(
      (row) => row.item.state === "selection" && row.item.asset?.id === assetId,
    );
  }
  complete(assetId: string, taskId: string): void {
    for (const row of this.items.values())
      if (row.item.asset?.id === assetId)
        row.item = { ...row.item, state: "queued", taskId, asset: undefined };
    this.handlers.changed();
  }
  submit(requestId: string, urls: string[]): void {
    if (!/^[\w-]{1,80}$/.test(requestId)) throw new Error("无效提交标识");
    const signature = JSON.stringify(urls);
    if (this.requests.has(requestId)) {
      if (this.requests.get(requestId) !== signature)
        throw new Error("提交标识已用于其他链接");
      return;
    }
    // Bounded session ledger; do not evict pending choices or idempotency keys.
    if (this.items.size + urls.length > 200)
      throw new Error("本次会话已提交较多链接，请处理现有任务后重启应用。");
    this.requests.set(requestId, signature);
    for (const url of urls) {
      const id = randomUUID();
      this.items.set(id, {
        url,
        generation: 0,
        item: { id, title: new URL(url).hostname, state: "waiting" },
      });
    }
    this.handlers.changed();
    this.pump();
  }
  action(id: string, action: "retry" | "cancel"): void {
    const row = this.items.get(id);
    if (!row) throw new Error("找不到提交记录");
    if (action === "retry" && row.item.state === "failed") {
      row.generation++;
      row.item = { ...row.item, state: "waiting", error: undefined };
    } else if (
      action === "cancel" &&
      ["waiting", "probing"].includes(row.item.state)
    ) {
      row.generation++;
      row.item = { ...row.item, state: "cancelled" };
    } else throw new Error("当前状态不支持该操作");
    this.handlers.changed();
    this.pump();
  }
  private pump(): void {
    for (const row of this.items.values()) {
      if (this.active >= 2) break;
      if (row.item.state !== "waiting") continue;
      const browser = this.handlers.browser(row.url);
      if (browser && this.browserActive) continue;
      this.active++;
      if (browser) this.browserActive = true;
      row.item.state = "probing";
      const generation = row.generation;
      this.handlers.changed();
      void (async () => {
        try {
          const asset = await this.handlers.probe(row.url);
          if (generation !== row.generation) return;
          row.item.title = asset.title;
          const taskId = await this.handlers.enqueue(asset, row.url);
          if (generation !== row.generation) return;
          row.item = {
            ...row.item,
            state: taskId ? "queued" : "selection",
            taskId,
            asset: taskId ? undefined : asset,
          };
        } catch (error) {
          if (generation === row.generation)
            row.item = {
              ...row.item,
              state: "failed",
              error: this.handlers.error(error),
            };
        } finally {
          this.active--;
          if (browser) this.browserActive = false;
          this.handlers.changed();
          this.pump();
        }
      })();
    }
  }
}
