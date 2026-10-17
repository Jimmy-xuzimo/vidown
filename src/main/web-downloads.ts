import type { DownloadItem, Session, WebContents } from "electron";
import { mkdirSync, constants } from "node:fs";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { join, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { safeName, classifyError } from "../core/safety";
import type { Store } from "../core/store";
import type { TaskRecord } from "../shared/types";

type Job = {
  item: DownloadItem;
  done: Promise<void>;
  cancel?: "cancelled" | "interrupted";
  verifying: boolean;
};

// Chromium saves blob/service-worker downloads in its own authenticated web session.
// No renderer injection or export of Telegram's IndexedDB keys is needed.
export class WebDownloads {
  private jobs = new Map<string, Job>();
  private pending = new Map<number, { id: string; cancelled?: boolean }>();
  private closed = false;
  constructor(
    private session: Session,
    private owns: (wc: WebContents) => boolean,
    private store: Store,
    private work: string,
    private directory: () => string,
    private changed: () => void,
    private verify: (id: string, file: string) => Promise<void>,
    private abort: (id: string) => void,
  ) {
    mkdirSync(join(work, "browser-downloads"), { recursive: true });
    session.on("will-download", this.receive);
  }
  has(id: string): boolean {
    return (
      this.jobs.has(id) || [...this.pending.values()].some((p) => p.id === id)
    );
  }
  async capture(
    id: string,
    wc: number,
    trigger: () => Promise<void>,
  ): Promise<void> {
    if (this.pending.has(wc))
      throw new Error("该网页仍在准备上一个文件，请等待或刷新网页后重新解析");
    this.pending.set(wc, { id });
    try {
      await trigger();
    } catch (error) {
      this.pending.delete(wc);
      throw error;
    }
  }
  resumable(id: string): boolean {
    const job = this.jobs.get(id);
    return (
      !!job &&
      !job.verifying &&
      this.store.get(id)?.state === "paused" &&
      job.item.canResume()
    );
  }
  private patch(id: string, values: Partial<TaskRecord>) {
    const t = this.store.get(id);
    if (t) this.store.put({ ...t, ...values, updatedAt: Date.now() });
    this.changed();
  }
  action(id: string, action: string): void {
    const pending = [...this.pending.values()].find((p) => p.id === id);
    if (pending) {
      if (action !== "cancel")
        throw new Error("网页正在准备媒体，暂不能暂停；可以取消保存");
      pending.cancelled = true;
      this.patch(id, { state: "cancelled", error: undefined });
      return;
    }
    const job = this.jobs.get(id);
    if (!job) throw new Error("请回到 Telegram 网页重新保存此媒体");
    if (action === "cancel") {
      job.cancel = "cancelled";
      if (job.verifying) this.abort(id);
      else job.item.cancel();
    } else if (action === "pause") {
      if (job.verifying || !job.item.canResume())
        throw new Error("此网页下载不能安全暂停，请在网页内重新保存");
      job.item.pause();
      this.patch(id, {
        state: "paused",
        speed: undefined,
        resumable: job.item.canResume(),
      });
    } else if (action === "resume" || action === "retry") {
      if (!this.resumable(id))
        throw new Error("网页下载已失去续传条件，请回到消息重新保存");
      this.patch(id, { state: "queued" });
      job.item.resume();
      this.patch(id, { state: "downloading", resumable: false });
    } else throw new Error("未知网页下载操作");
  }
  private receive = (
    event: Electron.Event,
    item: DownloadItem,
    wc: WebContents,
  ): void => {
    if (!this.owns(wc)) return;
    if (this.closed) {
      event.preventDefault();
      return;
    }
    const expected = this.pending.get(wc.id);
    this.pending.delete(wc.id);
    if (expected?.cancelled) {
      event.preventDefault();
      return;
    }
    const id = expected?.id ?? randomUUID();
    const extension = extname(item.getFilename()).toLowerCase();
    const media =
      /^(video|audio)\//.test(item.getMimeType()) ||
      /\.(mp4|mkv|webm|mov|m4v|avi|ts|mp3|m4a|aac|flac|ogg|opus|wav)$/.test(
        extension,
      );
    const rawName = item.getFilename() || "网页媒体";
    const stem = extension ? rawName.slice(0, -extension.length) : rawName;
    const title =
      safeName(stem.slice(0, Math.max(1, 90 - extension.length))) + extension;
    if (!expected)
      this.store.put({
        id,
        title,
        state: "queued",
        updatedAt: Date.now(),
        resumable: false,
        source: "browser",
      });
    if (!media) {
      event.preventDefault();
      this.patch(id, {
        state: "failed",
        error: "仅接收网页保存的视频或音频；此文件未下载",
      });
      return;
    }
    const folder = join(this.work, "browser-downloads", id);
    const destination = this.directory();
    try {
      mkdirSync(folder, { recursive: true });
    } catch (error) {
      event.preventDefault();
      this.patch(id, { state: "failed", error: classifyError(error) });
      return;
    }
    const path = join(folder, title);
    item.setSavePath(path);
    this.patch(id, { state: "downloading", pausable: item.canResume() });
    let finish!: () => void;
    const job: Job = {
      item,
      done: new Promise<void>((r) => {
        finish = r;
      }),
      verifying: false,
    };
    this.jobs.set(id, job);
    let time = Date.now(),
      bytes = 0;
    item.on("updated", (_event, state) => {
      if (job.verifying || job.cancel) return;
      const now = Date.now(),
        received = item.getReceivedBytes(),
        total = item.getTotalBytes();
      if (now - time < 250 && state === "progressing" && !item.isPaused())
        return;
      if (
        this.store.get(id)?.state === "paused" &&
        state === "progressing" &&
        !item.isPaused()
      )
        this.patch(id, { state: "queued" });
      this.patch(id, {
        state:
          state === "interrupted" || item.isPaused() ? "paused" : "downloading",
        bytes: received,
        networkBytes: received,
        speed:
          item.isPaused() || state === "interrupted"
            ? undefined
            : Math.round(((received - bytes) * 1000) / Math.max(1, now - time)),
        progress: total > 0 ? (received / total) * 100 : undefined,
        pausable: item.canResume(),
        resumable: item.isPaused() && item.canResume(),
      });
      time = now;
      bytes = received;
    });
    item.once("done", (_event, state) => {
      void (async () => {
        try {
          if (job.cancel || state !== "completed") {
            this.patch(id, {
              state:
                job.cancel ?? (state === "cancelled" ? "cancelled" : "failed"),
              resumable: false,
              speed: undefined,
              error:
                state === "interrupted" && !job.cancel
                  ? "网页传输中断，请回到消息重新保存"
                  : undefined,
            });
            return;
          }
          job.verifying = true;
          this.patch(id, {
            state: "verifying",
            bytes: item.getReceivedBytes(),
            speed: undefined,
            pausable: false,
            resumable: false,
          });
          await this.verify(id, path);
          if (job.cancel) throw new Error("操作已中断");
          await mkdir(destination, { recursive: true });
          const output = join(destination, `${id.slice(0, 8)} ${title}`);
          await copyFile(path, output, constants.COPYFILE_EXCL);
          if (job.cancel) {
            await rm(output, { force: true });
            throw new Error("操作已中断");
          }
          this.patch(id, {
            state: "completed",
            output,
            progress: 100,
            error: undefined,
          });
        } catch (error) {
          this.patch(id, {
            state: job.cancel ?? "failed",
            resumable: false,
            speed: undefined,
            error: job.cancel ? undefined : classifyError(error),
          });
        } finally {
          await rm(folder, { recursive: true, force: true }).catch(() => {});
          this.jobs.delete(id);
          finish();
        }
      })();
    });
  };
  async close(): Promise<void> {
    this.closed = true;
    this.session.removeListener("will-download", this.receive);
    for (const pending of this.pending.values())
      if (!pending.cancelled)
        this.patch(pending.id, {
          state: "interrupted",
          error: "网页准备过程已中断，请重新解析",
          resumable: false,
        });
    this.pending.clear();
    const jobs = [...this.jobs.entries()];
    for (const [id, job] of jobs) {
      job.cancel = "interrupted";
      if (job.verifying) this.abort(id);
      else job.item.cancel();
    }
    await Promise.allSettled(jobs.map(([, job]) => job.done));
  }
}
