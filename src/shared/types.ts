export type Protocol = "hls" | "dash" | "http" | "telegram";
export type TaskState =
  | "queued"
  | "downloading"
  | "merging"
  | "verifying"
  | "completed"
  | "paused"
  | "cancelled"
  | "failed"
  | "interrupted";
export interface Track {
  id: string;
  kind: "video" | "audio" | "muxed";
  label: string;
  protocol: Protocol;
  width?: number;
  height?: number;
  fps?: number;
  codec?: string;
  audioCodec?: string;
  bitrate?: number;
  language?: string;
  dynamicRange?: string;
  sampleRate?: number;
  channels?: number;
}
export interface MediaAsset {
  id: string;
  title: string;
  pageUrl: string;
  tracks: Track[];
  warnings: string[];
  duration?: number;
}
export interface SourceCandidate {
  id: string;
  tabId: string;
  pageUrl: string;
  host: string;
  protocol: Protocol;
  contentType: string;
  detectedAt: number;
}
export interface RequestContextRef {
  id: string;
  profile: string;
}
export interface PrivateTrack extends Track {
  url: string;
  fallbacks?: { url: string; identity?: string }[];
  selector?: string;
  manifest?: string;
  engineId?: string;
  identity?: string;
}
export interface PrivateAsset extends Omit<MediaAsset, "tracks"> {
  tracks: PrivateTrack[];
  context: RequestContextRef;
}
export interface DownloadPlan {
  id: string;
  asset: PrivateAsset;
  tracks: PrivateTrack[];
  output: "source" | "compatible";
  directory: string;
}
export interface TaskRecord {
  id: string;
  title: string;
  state: TaskState;
  progress?: number;
  bytes?: number;
  networkBytes?: number;
  speed?: number;
  error?: string;
  output?: string;
  updatedAt: number;
  resumable: boolean;
}
export interface TaskEvent {
  taskId: string;
  sequence: number;
  state?: TaskState;
  progress?: number;
  bytes?: number;
  message?: string;
}
export interface BrowserTab {
  id: string;
  url: string;
  title: string;
  loading: boolean;
}
export interface Settings {
  downloadDir: string;
  concurrency: number;
  proxy: string;
  clipboard: boolean;
}
export interface Snapshot {
  tasks: TaskRecord[];
  candidates: SourceCandidate[];
  tabs: BrowserTab[];
  activeTab?: string;
  settings: Settings;
  tools: Record<string, string>;
  telegram: { state: string; detail?: string };
}
export type WorkerRequest = {
  id: string;
  action: "probe" | "download" | "abort";
  payload: any;
};
export type WorkerResponse = {
  id: string;
  type: "result" | "error" | "progress";
  data: any;
};
export interface DesktopAPI {
  snapshot(): Promise<Snapshot>;
  probe(input: {
    url?: string;
    candidateId?: string;
    tabId?: string;
  }): Promise<MediaAsset>;
  download(input: {
    assetId: string;
    trackIds: string[];
    output: "source" | "compatible";
  }): Promise<void>;
  task(input: {
    id: string;
    action: "pause" | "resume" | "cancel" | "open" | "retry";
  }): Promise<void>;
  browser(input: {
    action:
      | "new"
      | "navigate"
      | "back"
      | "forward"
      | "reload"
      | "select"
      | "close"
      | "bounds"
      | "hide"
      | "logout";
    tabId?: string;
    url?: string;
    bounds?: { x: number; y: number; width: number; height: number };
  }): Promise<void>;
  settings(input: Partial<Settings>): Promise<void>;
  directory(): Promise<string | undefined>;
  diagnostics(): Promise<string | undefined>;
  telegram(input: {
    action: string;
    value?: string;
    apiId?: number;
    apiHash?: string;
  }): Promise<unknown>;
  onUpdate(callback: (snapshot: Snapshot) => void): () => void;
}
