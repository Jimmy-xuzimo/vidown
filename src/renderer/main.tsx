import React, { useState, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import type {
  DesktopAPI,
  Snapshot,
  MediaAsset,
  Track,
  TaskRecord,
  Settings,
} from "../shared/types";
import "./style.css";
declare global {
  interface Window {
    vidown: DesktopAPI;
  }
}
const api = window.vidown;
const labels: Record<string, string> = {
  queued: "等待下载",
  downloading: "正在下载",
  merging: "合并轨道",
  verifying: "验证成品",
  completed: "已完成",
  paused: "已暂停",
  cancelled: "已取消",
  failed: "下载失败",
  interrupted: "上次中断",
};
function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    download: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5" />
        <path d="M4 16v5h16v-5" />
      </>
    ),
    globe: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    settings: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="9" cy="7" r="3" />
        <circle cx="15" cy="17" r="3" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="m9 5 7 7-7 7" />,
    folder: <path d="M3 6h7l2 2h9v12H3z" />,
    check: <path d="m5 12 4 4L20 5" />,
    video: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <path d="m10 9 5 3-5 3z" />
      </>
    ),
    music: (
      <>
        <path d="M9 18V5l11-2v13M9 8l11-2" />
        <ellipse cx="6" cy="18" rx="3" ry="2" />
        <ellipse cx="17" cy="16" rx="3" ry="2" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name] ?? paths.video}
    </svg>
  );
}
function bytes(value?: number) {
  if (value === undefined) return "—";
  if (value < 1024 * 1024) return (value / 1024).toFixed(0) + " KB";
  return value > 1024 ** 3
    ? (value / 1024 ** 3).toFixed(2) + " GB"
    : (value / 1024 ** 2).toFixed(1) + " MB";
}
function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [section, setSection] = useState("download");
  const [url, setUrl] = useState("");
  const [address, setAddress] = useState("");
  const [asset, setAsset] = useState<MediaAsset>();
  const [video, setVideo] = useState("");
  const [audio, setAudio] = useState("");
  const [output, setOutput] = useState<"source" | "compatible">("source");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [resourcesVisible, setResourcesVisible] = useState(true);
  const browserArea = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const acceptSnapshot = (next: Snapshot) =>
      setSnapshot((previous) =>
        !previous || next.revision >= previous.revision ? next : previous,
      );
    api
      .snapshot()
      .then(acceptSnapshot)
      .catch((e) => setError(e.message));
    return api.onUpdate(acceptSnapshot);
  }, []);
  useEffect(() => {
    if (section !== "browser") {
      void api.browser({ action: "hide" });
      return;
    }
    if (!browserArea.current) return;
    const node = browserArea.current;
    const update = () => {
      const rect = node.getBoundingClientRect();
      void api.browser({
        action: "bounds",
        bounds: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        },
      });
    };
    const observer = new ResizeObserver(update);
    observer.observe(node);
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [section, snapshot?.activeTab]);
  useEffect(() => {
    const t = snapshot?.tabs.find((t) => t.id === snapshot.activeTab);
    if (t) setAddress(t.url === "about:blank" ? "" : t.url);
  }, [snapshot?.tabs.find((t) => t.id === snapshot.activeTab)?.url]);
  async function attempt(action: () => Promise<unknown>) {
    setError("");
    setNotice("");
    try {
      return await action();
    } catch (e: any) {
      setError(
        e.message.replace(/^Error invoking remote method '[^']+': Error: /, ""),
      );
    }
  }
  function selectAsset(next: MediaAsset) {
    setAsset(next);
    const v = next.tracks.find((t) => t.kind !== "audio");
    setVideo(v?.id ?? "");
    const a = next.tracks
      .filter((t) => t.kind === "audio")
      .sort(
        (a, b) =>
          Number(/flac/i.test(b.codec ?? "")) -
            Number(/flac/i.test(a.codec ?? "")) ||
          (b.bitrate ?? 0) - (a.bitrate ?? 0),
      )[0];
    setAudio(v?.kind === "muxed" ? "" : (a?.id ?? ""));
    setSection("download");
  }
  async function probe(input: {
    url?: string;
    candidateId?: string;
    tabId?: string;
  }) {
    setBusy(true);
    await attempt(async () => selectAsset(await api.probe(input)));
    setBusy(false);
  }
  async function addTask() {
    if (!asset) return;
    const ids = [video, audio].filter(Boolean);
    await attempt(async () => {
      await api.download({ assetId: asset.id, trackIds: ids, output });
      setNotice("已加入下载队列");
      setAsset(undefined);
    });
  }
  const tasks = snapshot?.tasks ?? [];
  const active = tasks.filter((t) =>
    ["queued", "downloading", "merging", "verifying"].includes(t.state),
  );
  const finished = tasks.filter((t) => t.state === "completed");
  const navigation = [
    ["download", "download", "下载工作台"],
    ["browser", "globe", "浏览器探测"],
    ["history", "clock", "下载记录"],
    ["settings", "settings", "设置与账号"],
  ];
  const selectedVideo = asset?.tracks.find((t) => t.id === video);
  const activeTab = snapshot?.tabs.find((t) => t.id === snapshot.activeTab);
  const trackLabel = (t: Track) =>
    `${t.label}${t.bitrate ? " · " + Math.round(t.bitrate / 1000) + " kbps" : ""}${t.sampleRate ? " · " + t.sampleRate / 1000 + " kHz" : ""}${t.channels ? " · " + t.channels + " 声道" : ""}`;
  if (!snapshot) return <div className="startup">正在启动 Vidown…</div>;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Icon name="download" size={24} />
          </div>
          <div>
            vidown<span>REBUILT FROM SOURCE</span>
          </div>
        </div>
        <div className="sidebar-label">工作空间</div>
        <nav>
          {navigation.map(([id, icon, text]) => (
            <button
              key={id}
              className={section === id ? "nav active" : "nav"}
              onClick={() => {
                setSection(id);
                setError("");
              }}
            >
              <Icon name={icon} />
              <span>{text}</span>
              {id === "download" && active.length > 0 && <b>{active.length}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="preview-chip">
            <i />
            M0 · 关键链路验证版
          </div>
          <p>
            保留原始画质
            <br />
            让每一步下载都有依据。
          </p>
          <small>1.0.0-alpha.3</small>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <span>
            VIDOWN / <b>{navigation.find((n) => n[0] === section)?.[2]}</b>
          </span>
          <span className="local-badge">
            <i /> 本地处理
          </span>
        </header>
        <div
          className={
            section === "browser" ? "content browser-content" : "content"
          }
        >
          {error && (
            <div className="message error" role="alert">
              <span>{error}</span>
              <button onClick={() => setError("")}>×</button>
            </div>
          )}
          {notice && (
            <div className="message success" role="status">
              <span>{notice}</span>
              <button onClick={() => setNotice("")}>×</button>
            </div>
          )}
          {section === "download" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">YOUR MEDIA. ORIGINAL QUALITY.</div>
                  <h1>把精彩，完整保存。</h1>
                  <p>粘贴视频链接，选择画质与音轨。其余交给 Vidown。</p>
                </div>
                <div className="heading-symbol">
                  <Icon name="download" size={46} />
                </div>
              </div>
              <form
                className="url-entry"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (url.trim()) void probe({ url });
                }}
              >
                <Icon name="globe" />
                <input
                  aria-label="视频链接"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="粘贴 B 站、X、Telegram 或流媒体链接…"
                />
                <button
                  className="primary"
                  type="submit"
                  disabled={busy || !url.trim()}
                >
                  {busy ? "正在探测…" : "探测资源"}
                  <Icon name="arrow" size={16} />
                </button>
              </form>
              <div className="entry-caption">
                <span>
                  自动使用内置浏览器登录状态 · 登录后重新探测可用最高规格
                </span>
                <button
                  className="text-button"
                  onClick={() => {
                    setSection("browser");
                    if (!snapshot.tabs.length)
                      void attempt(() => api.browser({ action: "new" }));
                  }}
                >
                  需要登录？打开浏览器探测 <span>↗</span>
                </button>
              </div>
              {asset && (
                <section className="card format-card">
                  <div className="section-title">
                    <h2>选择保存规格</h2>
                    <button
                      className="text-button"
                      onClick={() => setAsset(undefined)}
                    >
                      收起
                    </button>
                  </div>
                  <h3>{asset.title}</h3>
                  <div className="muted truncate">{asset.pageUrl}</div>
                  {asset.warnings.map((w) => (
                    <div key={w} className="inline-warning">
                      {w}
                    </div>
                  ))}
                  <div className="format-fields">
                    <label>
                      视频轨道
                      <select
                        aria-label="视频轨道"
                        value={video}
                        onChange={(e) => {
                          setVideo(e.target.value);
                          if (
                            asset.tracks.find((t) => t.id === e.target.value)
                              ?.kind === "muxed"
                          )
                            setAudio("");
                        }}
                      >
                        <option value="">仅下载音频</option>
                        {asset.tracks
                          .filter((t) => t.kind !== "audio")
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {trackLabel(t)}
                            </option>
                          ))}
                      </select>
                    </label>
                    <label>
                      音频轨道
                      <select
                        aria-label="音频轨道"
                        value={audio}
                        disabled={selectedVideo?.kind === "muxed"}
                        onChange={(e) => setAudio(e.target.value)}
                      >
                        <option value="">
                          {selectedVideo?.kind === "muxed"
                            ? "视频已包含音频"
                            : "请选择音频 / 无音频"}
                        </option>
                        {asset.tracks
                          .filter((t) => t.kind === "audio")
                          .map((t) => (
                            <option key={t.id} value={t.id}>
                              {trackLabel(t)}
                            </option>
                          ))}
                      </select>
                    </label>
                  </div>
                  <div className="format-footer">
                    <label className="inline-label">
                      输出策略
                      <select
                        aria-label="输出策略"
                        value={output}
                        onChange={(e) => setOutput(e.target.value as any)}
                      >
                        <option value="source">保留源规格 · MP4 / MKV</option>
                        <option value="compatible">
                          兼容导出 · H.264 / AAC
                        </option>
                      </select>
                    </label>
                    <button
                      className="primary"
                      onClick={() => void addTask()}
                      disabled={!video && !audio}
                    >
                      <Icon name="download" size={17} />
                      加入下载队列
                    </button>
                  </div>
                  {output === "compatible" && (
                    <p className="inline-warning">
                      兼容导出可能降低画质或音质。HDR／杜比视界的色彩转换尚未开放，请选择保留源规格。
                    </p>
                  )}
                </section>
              )}
              <div className="stats">
                <div>
                  <span>下载中</span>
                  <strong>{active.length.toString().padStart(2, "0")}</strong>
                  <small>任务独立执行</small>
                </div>
                <div>
                  <span>已保存</span>
                  <strong>{finished.length.toString().padStart(2, "0")}</strong>
                  <small>成品通过媒体检查</small>
                </div>
                <div>
                  <span>保存方式</span>
                  <strong className="quality-stat">
                    源画质 <i>优先</i>
                  </strong>
                  <small>不默认转码、不强制降级</small>
                </div>
              </div>
              <div className="section-title">
                <h2>
                  下载队列{" "}
                  <span>
                    {tasks.filter((t) => t.state !== "completed").length}
                  </span>
                </h2>
                <button
                  className="text-button"
                  onClick={() => setSection("history")}
                >
                  全部记录 →
                </button>
              </div>
              <TaskList
                tasks={tasks.filter((t) => t.state !== "completed")}
                action={(id, action) =>
                  void attempt(() => api.task({ id, action: action as any }))
                }
              />
              <div className="footnote">
                本版本用于验证下载链路。B 站会员规格、X 登录、Telegram
                私有内容仍需实际账号验收。
              </div>
            </>
          )}
          {section === "browser" && (
            <div className="browser-workspace">
              <div className="section-title">
                <div>
                  <h1>播放，即可发现。</h1>
                  <p className="muted">
                    在网页内登录并播放视频，右侧会列出发现的媒体请求。
                  </p>
                </div>
                <button
                  className="secondary"
                  onClick={() =>
                    void attempt(() =>
                      api.browser({
                        action: "new",
                      }),
                    )
                  }
                >
                  <Icon name="plus" size={16} />
                  新标签
                </button>
              </div>
              <div className="browser-tabs">
                {snapshot.tabs.map((t) => (
                  <div
                    key={t.id}
                    className={
                      t.id === snapshot.activeTab
                        ? "browser-tab selected"
                        : "browser-tab"
                    }
                  >
                    <button
                      onClick={() =>
                        void attempt(() =>
                          api.browser({ action: "select", tabId: t.id }),
                        )
                      }
                    >
                      {t.loading ? "◌ " : ""}
                      {t.title.slice(0, 22)}
                    </button>
                    <button
                      aria-label="关闭标签"
                      onClick={() =>
                        void attempt(() =>
                          api.browser({ action: "close", tabId: t.id }),
                        )
                      }
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <form
                className="browser-address"
                onSubmit={(e) => {
                  e.preventDefault();
                  void attempt(() =>
                    api.browser({
                      action: snapshot.activeTab ? "navigate" : "new",
                      url: address,
                    }),
                  );
                }}
              >
                <button
                  type="button"
                  aria-label="后退"
                  onClick={() =>
                    void attempt(() => api.browser({ action: "back" }))
                  }
                >
                  ←
                </button>
                <button
                  type="button"
                  aria-label="前进"
                  onClick={() =>
                    void attempt(() => api.browser({ action: "forward" }))
                  }
                >
                  →
                </button>
                <button
                  type="button"
                  aria-label="刷新"
                  onClick={() =>
                    void attempt(() => api.browser({ action: "reload" }))
                  }
                >
                  ↻
                </button>
                <input
                  aria-label="浏览器地址"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
                <button className="primary" type="submit">
                  访问
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={() => void probe({ tabId: snapshot.activeTab })}
                >
                  提取当前页面
                </button>
              </form>
              <div className="browser-tools">
                <div className="zoom-controls" aria-label="网页缩放控制">
                  <button
                    type="button"
                    className="secondary"
                    aria-label="缩小网页"
                    disabled={!activeTab || activeTab.zoomFactor <= 0.25}
                    onClick={() =>
                      void attempt(() =>
                        api.browser({
                          action: "zoom",
                          zoom: Math.max(
                            0.25,
                            Math.round(
                              ((activeTab?.zoomFactor ?? 1) - 0.1) * 100,
                            ) / 100,
                          ),
                        }),
                      )
                    }
                  >
                    −
                  </button>
                  <select
                    aria-label="网页缩放"
                    disabled={!activeTab}
                    value={
                      activeTab?.autoFit
                        ? "fit"
                        : String(activeTab?.zoomFactor ?? 1)
                    }
                    onChange={(e) =>
                      void attempt(() =>
                        api.browser({
                          action: "zoom",
                          zoom:
                            e.target.value === "fit"
                              ? "fit"
                              : Number(e.target.value),
                        }),
                      )
                    }
                  >
                    <option value="fit">
                      适应宽度
                      {activeTab
                        ? ` · ${Math.round(activeTab.zoomFactor * 100)}%`
                        : ""}
                    </option>
                    {[
                      ...new Set([
                        0.25,
                        0.5,
                        0.67,
                        0.75,
                        0.9,
                        1,
                        1.1,
                        1.25,
                        1.5,
                        1.75,
                        2,
                        ...(activeTab && !activeTab.autoFit
                          ? [activeTab.zoomFactor]
                          : []),
                      ]),
                    ]
                      .sort((a, b) => a - b)
                      .map((zoom) => (
                        <option key={zoom} value={zoom}>
                          {Math.round(zoom * 100)}%
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    className="secondary"
                    aria-label="放大网页"
                    disabled={!activeTab || activeTab.zoomFactor >= 2}
                    onClick={() =>
                      void attempt(() =>
                        api.browser({
                          action: "zoom",
                          zoom: Math.min(
                            2,
                            Math.round(
                              ((activeTab?.zoomFactor ?? 1) + 0.1) * 100,
                            ) / 100,
                          ),
                        }),
                      )
                    }
                  >
                    ＋
                  </button>
                </div>
                <button
                  className="text-button"
                  onClick={() => setResourcesVisible(!resourcesVisible)}
                >
                  {resourcesVisible ? "收起资源栏" : "显示资源栏"}
                </button>
              </div>
              <div
                className={
                  resourcesVisible
                    ? "browser-columns"
                    : "browser-columns resources-hidden"
                }
              >
                <div ref={browserArea} className="browser-surface">
                  {!snapshot.tabs.length && (
                    <button
                      className="secondary"
                      onClick={() =>
                        void attempt(() => api.browser({ action: "new" }))
                      }
                    >
                      打开登录与探测浏览器
                    </button>
                  )}
                </div>
                <aside className="resource-panel" hidden={!resourcesVisible}>
                  <div className="section-title">
                    <h2>发现的资源</h2>
                    <span>
                      {
                        snapshot.candidates.filter(
                          (c) => c.tabId === snapshot.activeTab,
                        ).length
                      }
                    </span>
                  </div>
                  <p className="muted">
                    优先选择 HLS / DASH 清单，可获得完整画质和音轨选项。
                  </p>
                  {snapshot.candidates
                    .filter((c) => c.tabId === snapshot.activeTab)
                    .map((c) => (
                      <div className="resource" key={c.id}>
                        <span className="tag">{c.protocol.toUpperCase()}</span>
                        <strong>{c.host}</strong>
                        <small>{c.contentType || "媒体请求"}</small>
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() => void probe({ candidateId: c.id })}
                        >
                          {busy ? "探测中…" : "解析此资源"}
                        </button>
                      </div>
                    ))}
                  {!snapshot.candidates.filter(
                    (c) => c.tabId === snapshot.activeTab,
                  ).length && (
                    <div className="resource-empty">
                      <Icon name="globe" size={34} />
                      <p>等待媒体请求</p>
                      <small>开始播放后，资源会显示在这里。</small>
                    </div>
                  )}
                </aside>
              </div>
            </div>
          )}
          {section === "history" && (
            <>
              <div className="page-heading">
                <div className="eyebrow">YOUR LOCAL LIBRARY</div>
                <h1>每一次保存，都有记录。</h1>
                <p>历史只储存在这台电脑上。</p>
              </div>
              <input
                className="search-input"
                aria-label="搜索历史"
                placeholder="搜索标题…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <TaskList
                tasks={tasks.filter((t) =>
                  t.title.toLowerCase().includes(search.toLowerCase()),
                )}
                action={(id, action) =>
                  void attempt(() => api.task({ id, action: action as any }))
                }
              />
            </>
          )}
          {section === "settings" && (
            <>
              <div className="page-heading">
                <div className="eyebrow">MAKE IT YOURS</div>
                <h1>设置与账号</h1>
                <p>会话保留在本地，账号凭据不会写入诊断报告。</p>
              </div>
              <SettingsPanel
                settings={snapshot.settings}
                save={(input) => attempt(() => api.settings(input))}
                choose={() => api.directory()}
              />
              <section className="card">
                <h2>浏览器会话与诊断</h2>
                <p className="muted">
                  网站登录会保留在本机，下载工作台使用同一浏览器会话；网站可随时使登录失效。
                  临时会话 Cookie 加密保存最多 7 天，持久 Cookie
                  遵循网站有效期。 重启后的旧下载任务仍需重新探测源身份。
                </p>
                <div className="button-row">
                  <button
                    className="secondary"
                    onClick={() =>
                      void attempt(() => api.browser({ action: "logout" }))
                    }
                  >
                    清除内置浏览器登录
                  </button>
                  <button
                    className="secondary"
                    onClick={() => void attempt(() => api.diagnostics())}
                  >
                    导出脱敏诊断
                  </button>
                </div>
                <div className="tool-grid">
                  {Object.entries(snapshot.tools)
                    .filter(([key]) => key !== "receipts")
                    .map(([key, value]) => (
                      <div key={key}>
                        <span>{key}</span>
                        <small>{value}</small>
                      </div>
                    ))}
                </div>
              </section>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
function TaskList({
  tasks,
  action,
}: {
  tasks: TaskRecord[];
  action: (id: string, action: string) => void;
}) {
  if (!tasks.length)
    return (
      <div className="empty-state">
        <div>
          <Icon name="download" size={28} />
        </div>
        <h3>准备好保存下一段精彩</h3>
        <p>粘贴一个链接，或在内置浏览器中发现视频。</p>
      </div>
    );
  return (
    <div className="task-list">
      {tasks.map((t) => (
        <article className={"task-row " + t.state} key={t.id}>
          <div className="task-icon">
            <Icon
              name={t.state === "completed" ? "check" : "video"}
              size={23}
            />
          </div>
          <div className="task-info">
            <strong>{t.title}</strong>
            <div className="task-meta">
              <span className={"state " + t.state}>{labels[t.state]}</span>
              <span>
                {t.state === "downloading" && t.networkBytes
                  ? `本次接收 ${bytes(t.networkBytes)}`
                  : bytes(t.bytes)}
              </span>
              {t.state === "downloading" && !!t.speed && (
                <span>{bytes(t.speed)}/s</span>
              )}
              <span>
                {new Date(t.updatedAt).toLocaleTimeString("zh-CN", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            {t.error && <p className="task-error">{t.error}</p>}
            {!t.resumable &&
              ["paused", "failed", "interrupted"].includes(t.state) && (
                <p className="muted">
                  请重新粘贴链接探测，确认登录与源规格后新建任务。
                </p>
              )}
            {["downloading", "merging", "verifying"].includes(t.state) && (
              <div className="progress-track">
                <i />
              </div>
            )}
          </div>
          <div className="task-actions">
            {t.state === "completed" ? (
              <button
                className="secondary"
                onClick={() => action(t.id, "open")}
              >
                <Icon name="folder" size={16} />
                文件位置
              </button>
            ) : (
              <>
                {["downloading", "queued"].includes(t.state) && (
                  <button
                    className="secondary"
                    onClick={() => action(t.id, "pause")}
                  >
                    暂停
                  </button>
                )}
                {t.resumable && ["paused", "failed"].includes(t.state) && (
                  <button
                    className="secondary"
                    onClick={() => action(t.id, "resume")}
                  >
                    继续
                  </button>
                )}
                {!["cancelled", "interrupted"].includes(t.state) && (
                  <button
                    className="text-button"
                    onClick={() => action(t.id, "cancel")}
                  >
                    取消
                  </button>
                )}
              </>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
function SettingsPanel({
  settings,
  save,
  choose,
}: {
  settings: Settings;
  save: (input: Partial<Settings>) => Promise<unknown>;
  choose: () => Promise<string | undefined>;
}) {
  const [value, setValue] = useState(settings);
  useEffect(() => setValue(settings), [settings]);
  return (
    <section className="card">
      <h2>下载与网络</h2>
      <label>
        保存目录
        <div className="auth-row">
          <input
            aria-label="保存目录"
            value={value.downloadDir}
            onChange={(e) =>
              setValue({ ...value, downloadDir: e.target.value })
            }
          />
          <button
            className="secondary"
            onClick={async () => {
              const dir = await choose();
              if (dir) setValue({ ...value, downloadDir: dir });
            }}
          >
            选择目录
          </button>
        </div>
      </label>
      <div className="format-fields">
        <label>
          同时下载任务
          <select
            value={value.concurrency}
            onChange={(e) =>
              setValue({ ...value, concurrency: Number(e.target.value) })
            }
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label>
          手动代理
          <input
            aria-label="代理"
            placeholder="留空使用系统代理"
            value={value.proxy}
            onChange={(e) => setValue({ ...value, proxy: e.target.value })}
          />
        </label>
      </div>
      <div className="format-footer">
        <span className="muted">同一代理用于内置浏览器和媒体传输。</span>
        <button className="primary" onClick={() => void save(value)}>
          保存设置
        </button>
      </div>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
