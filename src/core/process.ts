import { spawn } from "node:child_process";
import { redact } from "./safety";
export async function command(
  executable: string,
  args: string[],
  options: {
    signal?: AbortSignal;
    onLine?: (line: string) => void;
    timeout?: number;
    env?: NodeJS.ProcessEnv;
    maxOutput?: number;
    cwd?: string;
  } = {},
): Promise<string> {
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      shell: false,
      cwd: options.cwd,
      detached: process.platform !== "win32",
      env: { ...process.env, ...options.env },
    });
    let output = "",
      errors = "",
      pending = "",
      failure: Error | undefined;
    const kill = () => {
      if (child.pid) {
        if (process.platform === "win32")
          spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
            windowsHide: true,
            stdio: "ignore",
          });
        else {
          try {
            process.kill(-child.pid, "SIGTERM");
          } catch {
            child.kill();
          }
        }
      }
    };
    const stop = () => {
      failure = new Error("操作已中断");
      kill();
    };
    options.signal?.addEventListener("abort", stop, { once: true });
    const timer = setTimeout(() => {
      failure = new Error("下载组件超时");
      kill();
    }, options.timeout ?? 120000);
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > (options.maxOutput ?? 16 * 1024 * 1024)) {
        failure = new Error("组件输出过大");
        kill();
      }
      pending += chunk.toString();
      const lines = pending.split(/[\r\n]+/);
      pending = lines.pop() ?? "";
      lines.forEach((line) => options.onLine?.(line));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errors = (errors + chunk.toString()).slice(-12000);
    });
    child.once("error", (error) => {
      failure = error;
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", stop);
      if (failure) reject(failure);
      else if (code !== 0)
        reject(new Error(redact(errors || output || `下载组件退出：${code}`)));
      else resolve(output);
    });
  });
}
