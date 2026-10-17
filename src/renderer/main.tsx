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
import { useAppearance } from "./appearance";
import { canRemoveHistory } from "../shared/history";
import brandIcon from "../../assets/icon.svg";
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
  const [creatingTab, setCreatingTab] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [resourcesVisible, setResourcesVisible] = useState(true);
  const browserArea = useRef<HTMLDivElement>(null);
  const [deletion, setDeletion] = useState<{ ids?: string[]; count: number }>();
  useAppearance(snapshot?.settings);
  useEffect(
    () =>
      api.onClipboard((copied) => {
        setUrl(copied);
        setNotice("已填入复制的链接");
      }),
    [],
  );
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
  }, [section, snapshot?.activeTab, error, notice, resourcesVisible]);
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
          <img className="brand-mark" src={brandIcon} alt="" />
          <div>vidown</div>
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
          <p>把精彩，完整保存。</p>
          <small>v{snapshot.version}</small>
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
                  placeholder="粘贴视频、音频或网页链接…"
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
                可用规格以源文件与当前账号权限为准。
              </div>
            </>
          )}
          {section === "browser" && (
            <div className="browser-workspace">
              <div className="section-title">
                <div>
                  <h1>浏览器探测</h1>
                  <p className="muted">
                    访问网站、登录并播放，发现可保存的原始资源。
                  </p>
                </div>
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
                      <span className="tab-title" title={t.title}>
                        {t.title}
                      </span>
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
                <button
                  className="new-tab"
                  aria-label="新标签页"
                  title="新标签页"
                  disabled={creatingTab}
                  onClick={async () => {
                    setCreatingTab(true);
                    try {
                      await attempt(() => api.browser({ action: "new" }));
                    } finally {
                      setCreatingTab(false);
                    }
                  }}
                >
                  <Icon name="plus" size={18} />
                </button>
              </div>
              <form
                className="browser-address"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (creatingTab) return;
                  void attempt(() =>
                    api.browser({
                      action: "navigate",
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
                  placeholder="输入网址，自动补全 https://"
                  spellCheck={false}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
                <button
                  className="primary"
                  type="submit"
                  disabled={creatingTab}
                >
                  访问
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={
                    busy || !activeTab || activeTab.url === "about:blank"
                  }
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
                <div className="browser-tool-actions">
                  <button
                    className="text-button"
                    aria-expanded={resourcesVisible}
                    onClick={() => setResourcesVisible(!resourcesVisible)}
                  >
                    {resourcesVisible ? "收起资源栏" : "显示资源栏"}
                  </button>
                </div>
              </div>
              <div
                className={
                  resourcesVisible
                    ? "browser-columns"
                    : "browser-columns resources-hidden"
                }
              >
                <div ref={browserArea} className="browser-surface">
                  {(!activeTab || activeTab.url === "about:blank") && (
                    <section className="browser-welcome" aria-label="新标签页">
                      <img src={brandIcon} width="64" height="64" alt="" />
                      <span className="welcome-brand">VIDOWN</span>
                      <h2>把精彩，完整保存。</h2>
                      <p>从一个网址开始，发现值得留下的声音与画面。</p>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!creatingTab)
                            void attempt(() =>
                              api.browser({ action: "navigate", url: address }),
                            );
                        }}
                      >
                        <input
                          aria-label="新标签页网址"
                          placeholder="输入网站或视频网址"
                          spellCheck={false}
                          value={address}
                          onChange={(e) => setAddress(e.target.value)}
                        />
                        <button
                          className="primary"
                          disabled={creatingTab || !address.trim()}
                        >
                          打开网页 <Icon name="arrow" size={16} />
                        </button>
                      </form>
                      <div className="welcome-steps">
                        <span>
                          <b>01</b> 访问与登录
                        </span>
                        <span>
                          <b>02</b> 播放与发现
                        </span>
                        <span>
                          <b>03</b> 选择与保存
                        </span>
                      </div>
                      <small>
                        登录状态保存在本机，返回工作台即可使用同一账号解析链接。
                      </small>
                    </section>
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
              <div className="history-tools">
                <p className="muted">
                  {tasks.filter(canRemoveHistory).length} 条可清理记录
                </p>
                <button
                  className="secondary"
                  disabled={!tasks.some(canRemoveHistory)}
                  onClick={() =>
                    setDeletion({
                      count: tasks.filter(canRemoveHistory).length,
                    })
                  }
                >
                  一键清除
                </button>
              </div>
              <input
                className="search-input"
                aria-label="搜索历史"
                placeholder="搜索标题…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <TaskList
                remove={(id) => setDeletion({ ids: [id], count: 1 })}
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
              <AppearancePanel
                settings={snapshot.settings}
                save={(input) => attempt(() => api.settings(input))}
              />
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
      {deletion && (
        <DeleteHistoryDialog
          count={deletion.count}
          close={() => setDeletion(undefined)}
          confirm={async (deleteFiles) => {
            await attempt(async () => {
              const result = await api.history({
                ids: deletion.ids,
                deleteFiles,
              });
              setDeletion(undefined);
              setNotice(
                `已删除 ${result.removed} 条记录${deleteFiles ? "，存在的下载文件已移至回收站" : "，下载文件保留"}`,
              );
              if (result.failed.length)
                setError(
                  `${result.failed.length} 条记录未删除：${result.failed[0].error}`,
                );
            });
          }}
        />
      )}
    </div>
  );
}
function TaskList({
  tasks,
  action,
  remove,
}: {
  tasks: TaskRecord[];
  remove?: (id: string) => void;
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
            {remove && canRemoveHistory(t) && (
              <button
                className="text-button danger-text"
                aria-label={`删除记录：${t.title}`}
                onClick={() => remove(t.id)}
              >
                删除
              </button>
            )}
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
function DeleteHistoryDialog({
  count,
  close,
  confirm,
}: {
  count: number;
  close: () => void;
  confirm: (deleteFiles: boolean) => Promise<void>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="delete-dialog"
      aria-labelledby="delete-history-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!pending) close();
      }}
    >
      <div className="dialog-icon">
        <Icon name="clock" size={26} />
      </div>
      <h2 id="delete-history-title">
        删除{count === 1 ? "这条" : ` ${count} 条`}下载记录？
      </h2>
      <p className="muted">进行中和暂停的任务会保留。</p>
      <label className="check-option">
        <input
          type="checkbox"
          checked={deleteFiles}
          onChange={(e) => setDeleteFiles(e.target.checked)}
          disabled={pending}
        />
        同时删除下载文件（移至回收站）
      </label>
      <p className="muted">
        {deleteFiles
          ? "文件无法移至回收站时，对应记录会保留并显示原因。"
          : "仅移除记录，下载文件会保留在原目录。"}
      </p>
      <div className="dialog-actions">
        <button
          className="secondary"
          autoFocus
          disabled={pending}
          onClick={close}
        >
          取消
        </button>
        <button
          className="primary"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            try {
              await confirm(deleteFiles);
            } finally {
              setPending(false);
            }
          }}
        >
          {pending ? "正在删除…" : "确认删除"}
        </button>
      </div>
    </dialog>
  );
}
function AppearancePanel({
  settings,
  save,
}: {
  settings: Settings;
  save: (input: Partial<Settings>) => Promise<unknown>;
}) {
  const [value, setValue] = useState(settings);
  const pending = useRef(0);
  useEffect(() => {
    if (!pending.current) setValue(settings);
  }, [settings]);
  async function change(input: Partial<Settings>) {
    setValue((previous) => ({ ...previous, ...input }));
    pending.current++;
    try {
      await save(input);
    } finally {
      pending.current--;
      if (!pending.current) {
        const actual = await api.snapshot();
        if (!pending.current) setValue(actual.settings);
      }
    }
  }
  const themes = [
    { id: "iris", name: "鸢尾", note: "柔和紫调", color: "#a493ff" },
    { id: "ocean", name: "海蓝", note: "清澈蓝调", color: "#52b8e8" },
    { id: "jade", name: "青玉", note: "自然绿调", color: "#4cc4a4" },
    { id: "rose", name: "玫瑰", note: "温暖粉调", color: "#ec93af" },
  ] as const;
  return (
    <section className="card appearance-card">
      <div className="section-title">
        <h2>外观与交互</h2>
        <span className="muted">自动保存</span>
      </div>
      <div className="appearance-controls">
        <label>
          颜色模式
          <select
            aria-label="颜色模式"
            value={value.colorMode}
            onChange={(e) =>
              void change({
                colorMode: e.target.value as Settings["colorMode"],
              })
            }
          >
            <option value="system">跟随系统</option>
            <option value="dark">深色</option>
            <option value="light">浅色</option>
          </select>
        </label>
      </div>
      <div className="theme-choices" aria-label="界面主题">
        {themes.map((t) => (
          <button
            key={t.id}
            className={`theme-choice ${value.theme === t.id ? "chosen" : ""}`}
            aria-pressed={value.theme === t.id}
            onClick={() => void change({ theme: t.id })}
          >
            <span
              className="theme-preview"
              style={{ "--swatch": t.color } as React.CSSProperties}
            >
              <i />
              <i />
              <i />
            </span>
            <strong>{t.name}</strong>
            <small>{t.note}</small>
          </button>
        ))}
      </div>
      <div className="preference-row">
        <div>
          <strong>自动填入复制的链接</strong>
          <p>监听剪贴板中的网址，填入下载工作台，不会自动开始下载。</p>
        </div>
        <input
          type="checkbox"
          role="switch"
          aria-label="自动填入复制的链接"
          checked={value.clipboard}
          onChange={(e) => void change({ clipboard: e.target.checked })}
        />
      </div>
      <div className="preference-row">
        <div>
          <strong>界面动效</strong>
          <p>轻量过渡；尊重系统的减少动态效果设置。</p>
        </div>
        <input
          type="checkbox"
          role="switch"
          aria-label="界面动效"
          checked={value.animations}
          onChange={(e) => void change({ animations: e.target.checked })}
        />
      </div>
    </section>
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
  useEffect(
    () => setValue(settings),
    [settings.downloadDir, settings.concurrency, settings.proxy],
  );
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
        <button
          className="primary"
          onClick={() =>
            void save({
              downloadDir: value.downloadDir,
              concurrency: value.concurrency,
              proxy: value.proxy,
            })
          }
        >
          保存设置
        </button>
      </div>
    </section>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
