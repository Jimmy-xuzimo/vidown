/* Vidown 前端逻辑 */
(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // -------- 状态 --------
  const state = {
    tasks: new Map(),
    config: null,
    evtSource: null,
  };

  // -------- Toast 通知 --------
  function toast(message, type = "info", timeout = 3500) {
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = message;
    $("#toastContainer").appendChild(el);
    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transition = "opacity 0.3s";
      setTimeout(() => el.remove(), 300);
    }, timeout);
  }

  // -------- API 调用 --------
  async function api(path, method = "GET", body = null) {
    const opts = { method, headers: { "Content-Type": "application/json" } };
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch(path, opts);
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
    return data;
  }

  // -------- Tab 切换 --------
  function initTabs() {
    $$(".tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        const target = tab.dataset.tab;
        $$(".tab").forEach((t) => t.classList.toggle("active", t === tab));
        $$(".panel").forEach((p) => {
          p.classList.toggle("hidden", p.dataset.panel !== target);
        });
        if (target === "history") loadHistory();
        if (target === "settings") loadSettings();
      });
    });
  }

  // -------- 添加 URL --------
  function initAddUrl() {
    $("#addBtn").addEventListener("click", async () => {
      const text = $("#urlInput").value.trim();
      if (!text) {
        toast("请输入链接", "warning");
        return;
      }
      try {
        const res = await api("/api/batch", "POST", { text });
        if (res.count === 0) {
          toast("未识别到有效链接", "warning");
        } else {
          toast(`已添加 ${res.count} 个任务`, "success");
          $("#urlInput").value = "";
          switchTab("queue");
        }
      } catch (e) {
        toast(`添加失败: ${e.message}`, "error");
      }
    });
    // Ctrl/Cmd+Enter 提交
    $("#urlInput").addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        $("#addBtn").click();
      }
    });
  }

  function switchTab(name) {
    const tab = document.querySelector(`.tab[data-tab="${name}"]`);
    if (tab) tab.click();
  }

  // -------- 任务列表 --------
  function renderTasks() {
    const list = $("#taskList");
    const tasks = Array.from(state.tasks.values());
    if (tasks.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📥</div>
          <div>暂无任务，添加一个链接试试</div>
        </div>`;
      return;
    }
    list.innerHTML = tasks
      .sort((a, b) => b.created_at - a.created_at)
      .map(taskCardHtml)
      .join("");
    bindTaskActions();
    updateStatusbar();
  }

  function taskCardHtml(t) {
    const p = t.progress || {};
    const statusClass = (t.status || "pending").toLowerCase();
    const thumb = t.info && t.info.thumbnail
      ? `<img src="${escapeHtml(t.info.thumbnail)}" alt="" loading="lazy" onerror="this.remove()">`
      : "▶";
    const actions = actionsHtml(t);
    return `
      <div class="task-card" data-task-id="${t.id}">
        <div class="task-thumb">${thumb}</div>
        <div class="task-info">
          <div class="task-title" title="${escapeHtml(t.title || t.url)}">
            ${escapeHtml(t.title || t.url)}
          </div>
          <div class="task-meta">
            <span class="task-status ${statusClass}">${t.status}</span>
            <span>${t.platform || "—"}</span>
            <span>${t.engine_used || "—"}</span>
            <span>${t.selected_resolution || "—"}</span>
            ${t.error_message ? `<span style="color:var(--error)">${escapeHtml(t.error_message)}</span>` : ""}
          </div>
        </div>
        <div class="task-progress-wrap">
          <div class="task-progress-bar">
            <div class="task-progress-fill" style="width:${(p.percent || 0).toFixed(1)}%"></div>
          </div>
          <div class="task-progress-text">
            <span>${(p.percent || 0).toFixed(1)}%</span>
            <span>${humanSpeed(p.speed_bps)} · ETA ${humanEta(p.eta_seconds)}</span>
          </div>
        </div>
        <div class="task-actions">${actions}</div>
      </div>`;
  }

  function actionsHtml(t) {
    const s = (t.status || "").toLowerCase();
    const btns = [];
    if (s === "downloading" || s === "queued" || s === "probing") {
      btns.push(`<button data-act="pause">暂停</button>`);
      btns.push(`<button data-act="cancel">取消</button>`);
    } else if (s === "paused") {
      btns.push(`<button data-act="resume">继续</button>`);
      btns.push(`<button data-act="cancel">取消</button>`);
    } else if (s === "completed") {
      btns.push(`<button data-act="open" title="在文件管理器中显示">📂</button>`);
    }
    btns.push(`<button data-act="remove" title="从列表移除">×</button>`);
    return btns.join("");
  }

  function bindTaskActions() {
    $$(".task-card").forEach((card) => {
      const tid = card.dataset.taskId;
      card.querySelectorAll(".task-actions button").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const act = btn.dataset.act;
          try {
            if (act === "cancel") {
              await api("/api/cancel", "POST", { task_id: tid });
            } else if (act === "pause") {
              await api("/api/pause", "POST", { task_id: tid });
            } else if (act === "resume") {
              await api("/api/resume", "POST", { task_id: tid });
            } else if (act === "remove") {
              await api("/api/remove", "POST", { task_id: tid });
              state.tasks.delete(tid);
              renderTasks();
            } else if (act === "open") {
              toast("在终端中调用 vidown open <task_id> 以打开文件", "info");
            }
          } catch (e) {
            toast(`操作失败: ${e.message}`, "error");
          }
        });
      });
    });
  }

  // -------- 状态栏 --------
  function updateStatusbar() {
    const tasks = Array.from(state.tasks.values());
    const active = tasks.filter((t) =>
      ["downloading", "probing", "queued", "postprocessing"].includes(
        (t.status || "").toLowerCase()
      )
    ).length;
    const done = tasks.filter((t) => (t.status || "").toLowerCase() === "completed").length;
    const total = tasks.length;
    const totalSpeed = tasks.reduce((s, t) => s + (t.progress?.speed_bps || 0), 0);

    $("#statusActive").textContent = active;
    $("#statusSpeed").textContent = humanSpeed(totalSpeed);
    $("#statusDone").textContent = `${done} / ${total}`;
    $("#queueBadge").textContent = active;
    $("#queueSummary").textContent = `${active} 活动 / ${total - active - done} 等待 / ${done} 完成`;
  }

  // -------- 历史 --------
  async function loadHistory() {
    try {
      const list = await api("/api/history");
      const html = list
        .map(
          (e) => `
        <div class="history-item">
          <div class="history-time">${formatTime(e.created_at)}</div>
          <div class="history-title" title="${escapeHtml(e.url)}">${escapeHtml(e.title || e.url)}</div>
          <div class="history-platform">${e.platform}</div>
          <div class="history-status task-status ${(e.status || "").toLowerCase()}">${e.status}</div>
        </div>`
        )
        .join("");
      $("#historyList").innerHTML =
        list.length === 0
          ? `<div class="empty-state"><div class="empty-icon">📚</div><div>暂无历史</div></div>`
          : html;
    } catch (e) {
      toast(`加载历史失败: ${e.message}`, "error");
    }
  }

  $("#historySearch")?.addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase();
    $$(".history-item").forEach((row) => {
      row.style.display = row.textContent.toLowerCase().includes(q) ? "" : "none";
    });
  });

  $("#clearFinishedBtn")?.addEventListener("click", async () => {
    try {
      await api("/api/clear-finished", "POST");
      // 重新拉取
      const tasks = await api("/api/tasks");
      state.tasks = new Map(tasks.map((t) => [t.id, t]));
      renderTasks();
    } catch (e) {
      toast(`清理失败: ${e.message}`, "error");
    }
  });

  // -------- 设置 --------
  async function loadSettings() {
    try {
      const cfg = await api("/api/config");
      state.config = cfg;
      $("#setDownloadDir").value = cfg.general.download_dir || "";
      $("#setConcurrent").value = cfg.general.max_concurrent_downloads;
      $("#setFragments").value = cfg.general.max_concurrent_fragments;
      $("#setQuality").value = cfg.quality.preference;
      $("#setCodec").value = cfg.quality.force_codec;
      $("#setCrf").value = cfg.quality.video_crf;
      $("#setPreset").value = cfg.quality.video_preset;
      $("#setAudioCodec").value = cfg.quality.audio_codec;
      $("#setAudioBitrate").value = cfg.quality.audio_bitrate;
      $("#setProxy").value = cfg.network.proxy || "";
      $("#setUserAgent").value = cfg.network.user_agent || "";
      $("#setRetry").value = cfg.network.retry_max;
      $("#setSponsorBlock").checked = cfg.network.use_sponsorblock;
    } catch (e) {
      toast(`加载设置失败: ${e.message}`, "error");
    }
  }

  $("#saveSettingsBtn")?.addEventListener("click", async () => {
    const data = {
      general: {
        download_dir: $("#setDownloadDir").value,
        max_concurrent_downloads: parseInt($("#setConcurrent").value, 10),
        max_concurrent_fragments: parseInt($("#setFragments").value, 10),
      },
      quality: {
        preference: $("#setQuality").value,
        force_codec: $("#setCodec").value,
        video_crf: parseInt($("#setCrf").value, 10),
        video_preset: $("#setPreset").value,
        audio_codec: $("#setAudioCodec").value,
        audio_bitrate: $("#setAudioBitrate").value,
      },
      network: {
        proxy: $("#setProxy").value || null,
        user_agent: $("#setUserAgent").value,
        retry_max: parseInt($("#setRetry").value, 10),
        use_sponsorblock: $("#setSponsorBlock").checked,
      },
    };
    try {
      await api("/api/config", "POST", data);
      $("#saveStatus").textContent = "✓ 已保存";
      setTimeout(() => ($("#saveStatus").textContent = ""), 2000);
    } catch (e) {
      toast(`保存失败: ${e.message}`, "error");
    }
  });

  // 浏览器 Cookie 导入
  $$("button[data-browser]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const browser = btn.dataset.browser;
      toast(`正在从 ${browser} 导入 Cookie…`, "info");
      try {
        // 后端无专用端点，通过 settings 标记
        const data = {
          cookies: { auto_import_from_browsers: [browser] }
        };
        await api("/api/config", "POST", data);
        toast(`已设置从 ${browser} 自动导入（下次启动生效）`, "success");
      } catch (e) {
        toast(`导入失败: ${e.message}`, "error");
      }
    });
  });

  // -------- 剪贴板开关 --------
  $("#clipboardSwitch")?.addEventListener("change", async (e) => {
    try {
      if (e.target.checked) {
        await api("/api/clipboard/start", "POST");
        toast("剪贴板监听已开启", "success");
      } else {
        await api("/api/clipboard/stop", "POST");
        toast("剪贴板监听已关闭", "info");
      }
    } catch (err) {
      toast(`切换失败: ${err.message}`, "error");
    }
  });

  // -------- SSE 事件 --------
  function initSSE() {
    const es = new EventSource("/api/events");
    state.evtSource = es;

    const handle = (event) => (data) => {
      try {
        const payload = JSON.parse(data);
        if (event === "progress" || event === "status") {
          state.tasks.set(payload.id, payload);
          renderTasks();
        } else if (event === "log") {
          if (payload.level === "error") toast(payload.message, "error", 5000);
        } else if (event === "clipboard") {
          toast(`🔗 剪贴板新链接: ${payload.url}`, "info", 4000);
        }
      } catch (e) {
        console.error("SSE parse error", e);
      }
    };

    es.addEventListener("progress", (e) => handle("progress")(e.data));
    es.addEventListener("status", (e) => handle("status")(e.data));
    es.addEventListener("log", (e) => handle("log")(e.data));
    es.addEventListener("clipboard", (e) => handle("clipboard")(e.data));

    es.onerror = () => {
      $("#statusConn").classList.remove("connected");
      $("#statusConn").classList.add("disconnected");
      $("#statusConnText").textContent = "已断开，正在重连…";
      // EventSource 会自动重连
      setTimeout(() => {
        if (es.readyState === EventSource.OPEN) {
          $("#statusConn").classList.add("connected");
          $("#statusConn").classList.remove("disconnected");
          $("#statusConnText").textContent = "已连接";
        }
      }, 1000);
    };
    es.onopen = () => {
      $("#statusConn").classList.add("connected");
      $("#statusConnText").textContent = "已连接";
    };
  }

  // -------- 工具 --------
  function escapeHtml(s) {
    if (!s) return "";
    return s
      .toString()
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function humanSpeed(bps) {
    if (!bps) return "0 B/s";
    const u = ["B/s", "KB/s", "MB/s", "GB/s"];
    let v = bps;
    for (let i = 0; i < u.length && v >= 1024; i++) v /= 1024;
    return `${v.toFixed(2)} ${u[Math.min(i, u.length - 1)]}`;
  }
  function humanEta(secs) {
    if (secs == null) return "--";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    if (m >= 60) {
      const h = Math.floor(m / 60);
      return `${h}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  function formatTime(ts) {
    if (!ts) return "";
    const d = new Date(ts * 1000);
    return d.toLocaleString();
  }

  // -------- 启动 --------
  async function bootstrap() {
    initTabs();
    initAddUrl();
    initSSE();

    // 版本
    try {
      const v = await api("/api/version");
      $("#versionTag").textContent = `v${v.version}`;
    } catch (e) {
      $("#versionTag").textContent = "";
    }

    // 初始任务列表
    try {
      const tasks = await api("/api/tasks");
      state.tasks = new Map(tasks.map((t) => [t.id, t]));
      renderTasks();
    } catch (e) {
      console.error(e);
    }
  }

  document.addEventListener("DOMContentLoaded", bootstrap);
})();
