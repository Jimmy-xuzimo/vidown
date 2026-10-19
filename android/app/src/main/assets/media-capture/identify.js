// Extension sandbox; nothing is injected into the page's JavaScript world.
(async () => {
  try {
    const id = await browser.runtime.sendMessage({kind: "identify"});
    await browser.runtime.sendNativeMessage("vidown", {kind: "identify", webTabId: id});
    if (["www.douyin.com", "douyin.com", "www.iesdouyin.com", "iesdouyin.com"].includes(location.hostname)) {
      let attempts = 0, previous = "";
      const timer = setInterval(() => {
        if (++attempts > 30) { clearInterval(timer); return; }
        const values = [];
        for (const key of ["RENDER_DATA", "__NEXT_DATA__"]) {
          const text = document.getElementById(key)?.textContent;
          if (!text || text.length > 1024 * 1024) continue;
          try { values.push(JSON.parse(text.startsWith("%") ? decodeURIComponent(text) : text)); }
          catch (_) { /* Only public JSON hydration is read. */ }
        }
        const data = JSON.stringify(values);
        if (data.length <= 1024 * 1024 && data !== previous && values.length) {
          previous = data;
          browser.runtime.sendMessage({kind:"siteData",data}).catch(() => {});
        }
      }, 700);
      addEventListener("pagehide", () => clearInterval(timer), {once:true});
    }
  } catch (_) { /* A navigation may close the frame before identification finishes. */ }
})();
