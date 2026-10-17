import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAPI } from "../shared/types";
const invoke = (method: string, input?: unknown) =>
  ipcRenderer.invoke("vidown:" + method, input);
const api: DesktopAPI = {
  snapshot: () => invoke("snapshot"),
  probe: (input) => invoke("probe", input),
  download: (input) => invoke("download", input),
  task: (input) => invoke("task", input),
  history: (input) => invoke("history", input),
  browser: (input) => invoke("browser", input),
  settings: (input) => invoke("settings", input),
  directory: () => invoke("directory"),
  diagnostics: () => invoke("diagnostics"),
  onClipboard(callback) {
    const handler = (_event: unknown, url: string) => callback(url);
    ipcRenderer.on("vidown:clipboard", handler);
    return () => ipcRenderer.removeListener("vidown:clipboard", handler);
  },
  onUpdate(callback) {
    const handler = (_event: unknown, data: any) => callback(data);
    ipcRenderer.on("vidown:update", handler);
    return () => ipcRenderer.removeListener("vidown:update", handler);
  },
};
contextBridge.exposeInMainWorld("vidown", Object.freeze(api));
