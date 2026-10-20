"use strict";
const english = {
  t0: "Skip to content",
  t1: "Experience",
  t2: "Scope",
  t3: "Download",
  t4: "Experience",
  t5: "Scope",
  t6: "Download",
  t7: "Keep what",
  t8: "moves you.",
  t9: "Discover media. Choose your tracks.<br>Keep the original detail, on your device.",
  t10: "Get Vidown",
  t11: "View source",
  t12: "SOURCE QUALITY · LOCAL SAVING",
  t13: "A little more clarity.<br>A lot less friction.",
  t14: "Discover media, choose tracks, manage tasks.<br>One considered desktop workflow.",
  t15: "Workbench",
  t16: "Browser",
  t17: "Settings",
  t18: "Actual application screenshots from the repository. The interface may vary by release.",
  t19: "Discover",
  t20: "Start with a link. Or a browser.",
  t21: "Paste a video URL to parse it, or sign in and play in the built-in browser to discover media. Browsing and downloads share the same login session.",
  t22: "Choose",
  t23: "Know exactly what you save.",
  t24: "Choose video and audio tracks separately. Inspect the resolution, frame rate, codec and dynamic range reported by the source, with unknown values kept explicit.",
  t25: "Keep",
  t26: "Download. Merge. Verify.",
  t27: "Prefer the original codecs and avoid unnecessary re-encoding. Tasks are marked complete only after file validation. Audio-only saving is also supported.",
  t28: "A good save starts<br>with the source.",
  t29: "More than a vague “HD” button.<br>See what you are actually saving.",
  t30: "WORKFLOW",
  t31: "Independent video & audio",
  t32: "Choose using source information. Unknown details stay unknown.",
  t33: "Prefer original codecs",
  t34: "Suitable combinations use MP4; some higher-spec combinations use MKV.",
  t35: "Validate before completion",
  t36: "Download, merge and validation stages keep progress clear.",
  t37: "Results depend on the source and selected track combination.",
  t38: "At home on your desktop.",
  t39: "You stay in control.",
  t40: "One session, connected workflow",
  t41: "The built-in browser’s login session is shared with parsing and downloads, without importing external browser cookies.",
  t42: "A queue at your pace",
  t43: "Run 1–4 tasks concurrently, pause and resume within the same run, and search or clean up your history.",
  t44: "Make it feel like yours",
  t45: "Four palettes, light/dark/system modes and an option to disable motion. Clipboard assistance only fills a URL; it never visits or downloads automatically.",
  t46: "Your next keeper<br>starts here.",
  t47: "Choose the official build for your device.",
  t48: "View the latest release",
  t49: "Requires the system WebView2 Runtime.",
  t50: "macOS 15 or later.",
  t51: "macOS 15 or later.",
  t52: "Built on Ubuntu 24.04.",
  t53: "Built on Ubuntu 24.04.",
  t54: "No separate Python, Node.js or .NET installation needed.",
  t55: "Verification & third-party materials",
  t56: "Clear capabilities.<br>Honest boundaries.",
  t57: "Know the possibilities. Understand the limits.",
  t58: "Does it work with every website?",
  t59: "No. Vidown supports common on-demand HLS, DASH and direct HTTP(S) media. Availability depends on site compatibility, account permissions, region, URL expiry and site controls. Playback or login does not guarantee a download or the highest available quality.",
  t60: "What about DRM, live streams and bulk downloads?",
  t61: "Vidown does not bypass DRM or access permissions, record live streams, or bulk-download channels or collections. Only save content you have permission to download and follow the source website’s rules.",
  t62: "How do sessions and paused tasks work?",
  t63: "Sign in with the built-in browser. External browser cookies and cookies.txt are not imported. Persistent cookies follow the source expiry; session cookies can be backed up with encryption for up to 7 days when OS secure storage is available, but sites may invalidate them earlier. Pause/resume works within the same run; after restart, rediscover the media and create a new task.",
  t64: "Do I need a development environment?",
  t65: "Release packages do not require you to install Python, Node.js or .NET. Windows requires Evergreen WebView2 Runtime. The Windows installer is unsigned; macOS builds use ad-hoc signing without Developer ID signing or notarization. Use the official Releases and consult the verification materials as needed.",
  t66: "This is an evolving open-source project. Native builds and controlled-media validation do not establish compatibility with every site, real account or clean OS installation. Automatic signed-URL refresh, safe resume across restarts and independent engine updates remain unfinished.",
  t67: "Read the project documentation",
  t68: "Give great moments<br>a place to stay.",
  t69: "Get started with Vidown",
  t70: "Local first. Open source. For moments worth keeping.",
  t71: "User guide",
  t72: "Third-party notices",
  t73: "Project-owned code is MIT licensed; third-party components retain their own licenses.",
  t74: "Take your keepers with you.",
  t75: "Native Kotlin and Material 3, adapted for phones, tablets and both orientations. Android 14+. One APK for ARM64 and x86_64.",
  t76: "0.1.0-preview.6 · Preview. Public samples and emulator tests do not establish premium-account support or physical-device performance.",
  t77: "Download Android APK",
  t78: "Source & validation scope",
  t79: "Changelog",
  t80: "A clear record of every release.",
  t81: "Desktop and Android evolve independently. These are published releases; follow each Release for details and verification scope. Dates use China Standard Time.",
  t82: "Desktop",
  t83: "Current",
  t84: "Better short-video webpage extraction",
  t85: "Fix Douyin featured-page and video links, match the requested video, show source formats and retain backup CDNs. Closing tabs or clearing data invalidates the associated cache.",
  t86: "Release notes & download",
  t87: "Local data cleanup and security fixes",
  t88: "Clear browser data and download history separately. Removing sessions, cache and site storage invalidates old resource authorizations. Fix delayed clipboard reads after disabling monitoring and remove a vulnerable dependency chain. Public downloads are reduced to five desktop packages.",
  t89: "Read the full update",
  t90: "Native release builds for five architectures",
  t91: "Add native Actions packaging and controlled download checks for Windows, macOS Intel / Apple Silicon and Linux x64 / ARM64. Publish only after all runners pass; keep matching source, reports and hashes separately.",
  t92: "Rebuilt desktop application and browser",
  t93: "Rebuild as a TypeScript desktop app with WebView2 on Windows. Improve the toolbar, tabs and zoom, add themes, history management and session sharing, and remove external Cookie import. This release published source only.",
  t94: "Native app · independent preview",
  t95: "Preview",
  t96: "Native interface. Complete download workflow.",
  t97: "Kotlin, Compose and Material 3; link-first input, adaptive floating navigation, four light/dark palettes and optional native motion.",
  t98: "Fix Bilibili extractor headers and URL normalization, select video and audio separately, retain backup CDNs and reject HTML as media.",
  t99: "Gecko defaults to desktop mode and shares sign-in sessions. Download, lossless remux, validation and publication to system storage form one workflow.",
  t100: "Android 14+. Controlled protocols and public samples verified; premium permissions, ARM64 hardware, battery and background performance remain unverified. Not published on Google Play.",
  t101: "Browse all releases on GitHub",
  t102: "Fix media request referrers",
  t103: "Use Gecko's native referrer API so media requests retain the page context required by hotlink checks.",
  t104: "Keep byte ranges and the page origin across CDN redirects, without forwarding private credentials or page query parameters.",
  t105: "Add authenticated CDN, fallback and complete-file comparison regressions and publish a new signed APK. Premium accounts and physical devices still require acceptance.",
  t106: "Films and episodes: choose a version, then save",
  t107: "Add film pages, individual episodes and voice-version selection using the browser session, retain original fallback CDNs, and clearly label previews, account restrictions and DRM.",
  t108: "More webpage sources, smoother navigation",
  t109: "Add exact-video Douyin webpage discovery and individual episode and voice-version selection for films and series.",
  t110: "Keep navigation visible at the bottom in portrait and on the left in landscape; swipe between native pages while retaining their state.",
  t112: "Windows · macOS · Linux · Android preview",
  t113: "Actual application interface · Appearance varies by release",
  t111: "Extend media and UI regressions and public-site sampling. Report preview, login, network and premium limits as observed; physical devices and premium accounts still need acceptance.",
  hero74: "Keep what moves you.",
  hero75: "Download workbench",
  hero76: "Source quality first",
  hero77: "A place for every keeper.",
};
const root = document.documentElement;
const languageButton = document.getElementById("language");
const themeButton = document.getElementById("theme");
const menuButton = document.getElementById("menu");
const mobileNav = document.getElementById("mobile-nav");
const chinese = new Map(
  [...document.querySelectorAll("[data-i18n]")].map((el) => [el, el.innerHTML]),
);
let language;
const read = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const save = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};
const media = matchMedia("(prefers-color-scheme: dark)");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const forcedColors = matchMedia("(forced-colors: active)");
const runningAnimations = new Set();
const elementAnimations = new WeakMap();
const motionEase = "cubic-bezier(0.22, 1, 0.36, 1)";
const canAnimate = () =>
  !reducedMotion.matches && !forcedColors.matches && !document.hidden;

function animateElement(element, keyframes, options = {}) {
  if (!element || !canAnimate() || !element.animate) return;
  elementAnimations.get(element)?.cancel();
  const animation = element.animate(keyframes, {
    duration: 480,
    easing: motionEase,
    ...options,
  });
  elementAnimations.set(element, animation);
  runningAnimations.add(animation);
  const cleanup = () => {
    runningAnimations.delete(animation);
    if (elementAnimations.get(element) === animation)
      elementAnimations.delete(element);
  };
  animation.finished.then(cleanup, cleanup);
  return animation;
}

function revealElement(element, delay = 0) {
  return animateElement(
    element,
    [
      { opacity: 0, transform: "translateY(18px)" },
      { opacity: 1, transform: "translateY(0)" },
    ],
    { delay, fill: "backwards" },
  );
}

let themeTransition;
let themeRevision = 0;
let requestedTheme = root.dataset.theme;

function stopMotion() {
  themeTransition?.skipTransition();
  for (const animation of runningAnimations) animation.cancel();
}
reducedMotion.addEventListener("change", stopMotion);
forcedColors.addEventListener("change", stopMotion);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopMotion();
});
window.addEventListener("pagehide", stopMotion);
const screenAlts = {
  zh: {
    workbench: "Vidown 下载工作台，包含链接输入和任务列表",
    browser: "Vidown 内置浏览器的起始页面",
    settings: "Vidown 偏好设置界面",
  },
  en: {
    workbench: "Vidown download workbench with URL input and task list",
    browser: "Start page of the built-in Vidown browser",
    settings: "Vidown application preferences and appearance settings",
  },
};
function updateTheme() {
  const preference = root.dataset.preference;
  root.dataset.theme =
    preference === "system" ? (media.matches ? "dark" : "light") : preference;
  const names =
    language === "en"
      ? { light: "Light", dark: "Dark" }
      : { light: "浅色", dark: "深色" };
  const current = root.dataset.theme;
  const next = current === "dark" ? "light" : "dark";
  const label =
    language === "en"
      ? `Theme: ${names[current]}. Switch to ${names[next]}`
      : `主题：${names[current]}。切换为${names[next]}`;
  themeButton.setAttribute("aria-label", label);
  themeButton.title = label;
  document.querySelector('meta[name="theme-color"]').content =
    root.dataset.theme === "dark" ? "#16171c" : "#f5f3f0";
}
function setLanguage(value) {
  language = value;
  root.lang = value === "zh" ? "zh-CN" : "en";
  for (const [el, original] of chinese)
    el.innerHTML = value === "zh" ? original : english[el.dataset.i18n];
  document.querySelectorAll("[data-alt]").forEach((el) => {
    el.alt = screenAlts[value][el.dataset.alt];
  });
  languageButton.textContent = value === "zh" ? "EN" : "中文";
  languageButton.setAttribute(
    "aria-label",
    value === "zh" ? "Switch to English" : "切换到中文",
  );
  document.title =
    value === "zh"
      ? "Vidown — 把精彩，完整保存。"
      : "Vidown — Keep what moves you.";
  document.querySelector('meta[name="description"]').content =
    value === "zh"
      ? "Vidown 是开源媒体下载器。通过链接或内置浏览器发现视频，独立选择音视频轨道，在本地下载、合并与校验。提供 Windows、macOS、Linux，以及原生 Android 预览版。"
      : "An open-source media downloader for Windows, macOS and Linux, with a native Android preview. Discover media, choose tracks, and download, merge and validate locally.";
  document
    .querySelectorAll("nav")
    .forEach((el) =>
      el.setAttribute(
        "aria-label",
        value === "zh"
          ? el.id === "mobile-nav"
            ? "移动端导航"
            : "主导航"
          : el.id === "mobile-nav"
            ? "Mobile navigation"
            : "Primary navigation",
      ),
    );
  document
    .querySelector('[role="tablist"]')
    .setAttribute(
      "aria-label",
      value === "zh" ? "Vidown 应用截图" : "Vidown application screenshots",
    );
  updateMenuLabel();
  updateTheme();
}
function updateMenuLabel() {
  const open = !mobileNav.hidden;
  menuButton.setAttribute("aria-expanded", String(open));
  menuButton.setAttribute(
    "aria-label",
    language === "en"
      ? open
        ? "Close navigation"
        : "Open navigation"
      : open
        ? "关闭导航"
        : "打开导航",
  );
  menuButton.textContent = open ? "×" : "☰";
}
function closeMenu() {
  mobileNav.hidden = true;
  updateMenuLabel();
}
menuButton.addEventListener("click", () => {
  mobileNav.hidden = !mobileNav.hidden;
  updateMenuLabel();
  if (!mobileNav.hidden)
    animateElement(mobileNav, [{ opacity: 0 }, { opacity: 1 }], {
      duration: 180,
    });
});
mobileNav.addEventListener("click", (e) => {
  if (e.target.closest("a")) closeMenu();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !mobileNav.hidden) {
    closeMenu();
    menuButton.focus();
  }
});
matchMedia("(min-width: 801px)").addEventListener("change", (e) => {
  if (e.matches) closeMenu();
});
languageButton.addEventListener("click", () => {
  setLanguage(language === "zh" ? "en" : "zh");
  save("vidown-site-language", language);
});
themeButton.addEventListener("click", async () => {
  const next = requestedTheme === "dark" ? "light" : "dark";
  requestedTheme = next;
  const revision = ++themeRevision;
  themeTransition?.skipTransition();
  const apply = () => {
    if (revision !== themeRevision) return;
    root.dataset.preference = next;
    save("vidown-site-theme", next);
    updateTheme();
  };
  if (!canAnimate() || !document.startViewTransition) {
    apply();
    animateElement(document.body, [{ opacity: 0.86 }, { opacity: 1 }], {
      duration: 180,
    });
    return;
  }
  // Keyboard activation uses the same button-centred origin as pointer input.
  const bounds = themeButton.getBoundingClientRect();
  const x = bounds.left + bounds.width / 2;
  const y = bounds.top + bounds.height / 2;
  const radius = Math.ceil(
    Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)),
  );
  root.dataset.themeTransition = "true";
  const transition = document.startViewTransition(apply);
  themeTransition = transition;
  try {
    await transition.ready;
    if (revision !== themeRevision || !canAnimate()) {
      transition.skipTransition();
      return;
    }
    const animation = animateElement(
      root,
      {
        clipPath: [
          `circle(0px at ${x}px ${y}px)`,
          `circle(${radius}px at ${x}px ${y}px)`,
        ],
      },
      { duration: 520, pseudoElement: "::view-transition-new(root)" },
    );
    await animation?.finished;
  } catch {
    // Interrupted snapshots (resize, rapid clicks, backgrounding) still apply
    // the most recent choice; there is no animation-dependent theme state.
    apply();
    transition.skipTransition();
  } finally {
    await transition.finished.catch(() => {});
    if (themeTransition === transition) {
      themeTransition = undefined;
      delete root.dataset.themeTransition;
    }
  }
});
media.addEventListener("change", () => {
  if (root.dataset.preference === "system") {
    updateTheme();
    requestedTheme = root.dataset.theme;
  }
});
const tabs = [...document.querySelectorAll('[role="tab"]')];
function activateTab(tab) {
  const changed = tab.getAttribute("aria-selected") !== "true";
  tabs.forEach((el) => {
    const selected = el === tab;
    el.setAttribute("aria-selected", String(selected));
    el.tabIndex = selected ? 0 : -1;
    document.getElementById(el.getAttribute("aria-controls")).hidden =
      !selected;
  });
  if (changed)
    animateElement(
      document.getElementById(tab.getAttribute("aria-controls")),
      [
        { opacity: 0, transform: "translateY(6px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 260 },
    );
}
tabs.forEach((tab, index) => {
  tab.addEventListener("click", () => activateTab(tab));
  tab.addEventListener("keydown", (e) => {
    let next;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    if (e.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = tabs.length - 1;
    if (next !== undefined) {
      e.preventDefault();
      activateTab(tabs[next]);
      tabs[next].focus();
    }
  });
});
// Decorative pointer tilt: at most 3 degrees per axis, never touch-driven.
const heroArt = document.querySelector(".hero-art");
const heroSection = document.querySelector(".hero");
const tiltMedia = matchMedia(
  "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference) and (forced-colors: none)",
);
let tiltFrame = 0;
let pointerX = 0;
let pointerY = 0;
function resetTilt() {
  cancelAnimationFrame(tiltFrame);
  tiltFrame = 0;
  heroArt.classList.remove("is-tracking");
  heroArt.style.removeProperty("--tilt-x");
  heroArt.style.removeProperty("--tilt-y");
}
function paintTilt() {
  tiltFrame = 0;
  const bounds = heroSection.getBoundingClientRect();
  const clamp = (value) => Math.max(-1, Math.min(1, value));
  const x = clamp(((pointerX - bounds.left) / bounds.width) * 2 - 1);
  const y = clamp(((pointerY - bounds.top) / bounds.height) * 2 - 1);
  heroArt.classList.add("is-tracking");
  heroArt.style.setProperty("--tilt-x", `${(-y * 3).toFixed(2)}deg`);
  heroArt.style.setProperty("--tilt-y", `${(x * 3).toFixed(2)}deg`);
}
heroSection.addEventListener(
  "pointermove",
  (event) => {
    if (!tiltMedia.matches || event.pointerType !== "mouse") return;
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (!tiltFrame) tiltFrame = requestAnimationFrame(paintTilt);
  },
  { passive: true },
);
heroSection.addEventListener("pointerleave", resetTilt);
heroSection.addEventListener("pointercancel", resetTilt);
tiltMedia.addEventListener("change", resetTilt);
window.addEventListener("blur", resetTilt);
window.addEventListener("scroll", resetTilt, { passive: true });
document.addEventListener("visibilitychange", () => {
  if (document.hidden) resetTilt();
});

const storedLanguage = read("vidown-site-language");
setLanguage(
  ["zh", "en"].includes(storedLanguage)
    ? storedLanguage
    : navigator.language.toLowerCase().startsWith("zh")
      ? "zh"
      : "en",
);

// Observe once, animate once, then release each target. Content is never hidden
// in CSS, so unsupported APIs, script failures and reduced motion stay readable.
if (canAnimate() && "IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      let stagger = 0;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        if (entry.boundingClientRect.bottom > 0)
          revealElement(entry.target, Math.min(stagger++ * 55, 165));
      }
    },
    { threshold: 0.08, rootMargin: "0px 0px -16px 0px" },
  );
  document
    .querySelectorAll(
      ".hero-copy, .hero-art, .section-top, .gallery, .steps > article, .detail-grid > div, .feature-grid > article, .download-card, .android-preview, .release-entry, .faq > details, .project-note, .closing, footer",
    )
    .forEach((element) => observer.observe(element));
}

document.querySelectorAll("details").forEach((details) => {
  details.addEventListener("toggle", () => {
    if (!details.open) return;
    animateElement(
      details.querySelector(".release-body") || details.querySelector("p"),
      [{ opacity: 0 }, { opacity: 1 }],
      { duration: 240 },
    );
  });
});
