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
  t9: "From a moment on the web<br>to a place in your collection.<br>Know the source. Keep the detail.",
  t10: "Get Vidown",
  t11: "See how it works",
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
  t111: "Extend media and UI regressions and public-site sampling. Report preview, login, network and premium limits as observed; physical devices and premium accounts still need acceptance.",
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
      ? { system: "System", light: "Light", dark: "Dark" }
      : { system: "跟随系统", light: "浅色", dark: "深色" };
  const next = { system: "light", light: "dark", dark: "system" }[preference];
  const label =
    language === "en"
      ? `Theme: ${names[preference]}. Switch to ${names[next]}`
      : `主题：${names[preference]}。切换为${names[next]}`;
  themeButton.setAttribute("aria-label", label);
  themeButton.title = label;
  themeButton.textContent = { system: "◐", light: "☀", dark: "☾" }[preference];
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
themeButton.addEventListener("click", () => {
  root.dataset.preference = { system: "light", light: "dark", dark: "system" }[
    root.dataset.preference
  ];
  save("vidown-site-theme", root.dataset.preference);
  updateTheme();
});
media.addEventListener("change", updateTheme);
const tabs = [...document.querySelectorAll('[role="tab"]')];
function activateTab(tab) {
  tabs.forEach((el) => {
    const selected = el === tab;
    el.setAttribute("aria-selected", String(selected));
    el.tabIndex = selected ? 0 : -1;
    document.getElementById(el.getAttribute("aria-controls")).hidden =
      !selected;
  });
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
const storedLanguage = read("vidown-site-language");
setLanguage(
  ["zh", "en"].includes(storedLanguage)
    ? storedLanguage
    : navigator.language.toLowerCase().startsWith("zh")
      ? "zh"
      : "en",
);
