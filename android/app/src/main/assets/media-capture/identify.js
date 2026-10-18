// Extension sandbox; nothing is injected into the page's JavaScript world.
(async () => {
  try {
    const id = await browser.runtime.sendMessage({kind: "identify"});
    await browser.runtime.sendNativeMessage("vidown", {kind: "identify", webTabId: id});
  } catch (_) { /* A navigation may close the frame before identification finishes. */ }
})();
