// Read only the requested, visible message. Never inspect Telegram's session keys or private client internals.
// Independent DOM adapter. Web A: Message.tsx / MessageContextMenu.tsx.
// Web K: mediaViewer/{base,index}.ts and chat/contextMenu.ts. No private app/session APIs.
export async function telegramMessageAction(input: {
  messageId?: string;
  mediaUrl?: string;
  save?: boolean;
  fingerprint?: string;
}): Promise<{ title: string; fingerprint: string; url: string }> {
  const visible = (node: HTMLElement) => {
    const style = getComputedStyle(node);
    return (
      node.getBoundingClientRect().width > 0 &&
      style.visibility !== "hidden" &&
      style.display !== "none" &&
      !node.closest('.hide, [hidden], [aria-hidden="true"]')
    );
  };
  const enabled = (node: HTMLElement) =>
    visible(node) &&
    !node.matches(':disabled, .disabled, [aria-disabled="true"]');
  const downloadIcon = (node: HTMLElement) =>
    node.matches(".tgico-download") ||
    !!node.querySelector(".tgico-download") ||
    [...node.querySelectorAll(".tgico")].some(
      (icon) => icon.textContent === "\ue973",
    );
  const isK =
    location.hostname === "webk.telegram.org" ||
    location.pathname.startsWith("/k/") ||
    !!document.querySelector(".bubbles, .media-viewer-whole");
  if (isK) {
    let target: HTMLElement;
    let button: HTMLElement | undefined;
    let identity: string;
    let title: string;
    if (!input.messageId) {
      const viewers = [
        ...document.querySelectorAll<HTMLElement>(".media-viewer-whole"),
      ].filter(visible);
      if (viewers.length !== 1)
        throw new Error(
          "请在 Telegram 网页中打开要保存的视频，再提取当前页面；也可以粘贴具体消息链接",
        );
      target = viewers[0];
      const videos = [
        ...target.querySelectorAll<HTMLVideoElement>(
          ".media-viewer-mover.active video, video",
        ),
      ].filter(visible);
      if (videos.length !== 1 || !(videos[0].currentSrc || videos[0].src))
        throw new Error("Telegram 视频尚未载入或正在切换，请播放后重新解析");
      const video = videos[0];
      const src = video.currentSrc || video.src;
      if (
        input.mediaUrl &&
        ![video.currentSrc, video.src].includes(input.mediaUrl)
      )
        throw new Error(
          "此探测资源与当前打开的视频不一致，请重新播放目标视频后提取当前页面",
        );
      identity = [
        location.href,
        src,
        target.querySelector(".media-viewer-author")?.textContent,
        target.querySelector(".media-viewer-caption")?.textContent,
      ].join("\n");
      title =
        target
          .querySelector<HTMLElement>(".media-viewer-caption")
          ?.innerText.trim() ||
        target
          .querySelector<HTMLElement>(".media-viewer-name")
          ?.innerText.trim() ||
        "Telegram 视频";
      if (target.classList.contains("no-forwards"))
        throw new Error("此 Telegram 消息禁止保存，网页没有提供下载权限");
      button = [
        ...target.querySelectorAll<HTMLElement>(
          ".media-viewer-buttons .btn-icon",
        ),
      ].find((node) => downloadIcon(node) && enabled(node));
      if (!button)
        throw new Error(
          "此 Telegram 视频没有可用的网页下载按钮；可能禁止保存、权限尚未载入或网页结构已变化",
        );
    } else {
      if (!/^[1-9]\d*$/.test(input.messageId))
        throw new Error("无效 Telegram 消息编号");
      const messages = [
        ...document.querySelectorAll<HTMLElement>(
          ".bubble[data-mid], .grouped-item[data-mid]",
        ),
      ].filter(
        (node) =>
          visible(node) &&
          [
            input.messageId,
            String(Number(input.messageId) + 4294967296),
          ].includes(node.dataset.mid!),
      );
      if (messages.length !== 1)
        throw new Error(
          "未找到唯一的指定 Telegram 消息；请打开目标视频后提取当前页面",
        );
      target = messages[0];
      if (target.querySelectorAll(".grouped-item").length > 1)
        throw new Error(
          "此消息包含多个媒体，请在网页打开要保存的视频后提取当前页面",
        );
      identity = [
        location.href,
        target.dataset.peerId,
        target.dataset.mid,
        target.innerText,
      ].join("\n");
      title = target.innerText.trim() || "Telegram 媒体";
    }
    if (input.fingerprint && input.fingerprint !== identity)
      throw new Error("消息或视频已变化，请重新解析，防止保存错误内容");
    if (!button) {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (
        [...document.querySelectorAll<HTMLElement>(".btn-menu-item")].some(
          visible,
        )
      )
        throw new Error("请先关闭网页中已有的菜单，再重新解析");
      const rect = target.getBoundingClientRect();
      target.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: rect.left + Math.min(50, rect.width / 2),
          clientY: rect.top + Math.min(50, rect.height / 2),
        }),
      );
      for (let i = 0; i < 30; i++) {
        button = [
          ...document.querySelectorAll<HTMLElement>(".btn-menu-item"),
        ].find((node) => downloadIcon(node) && enabled(node));
        if (button) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (!button) {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
        throw new Error(
          "此 Telegram 消息没有可用的媒体下载操作；可能禁止保存或网页结构已变化",
        );
      }
    }
    if (input.save) {
      button.click();
      // Newer K clients may show a quality menu instead of saving. Do not silently
      // choose a preview rendition or leave a queued task waiting forever.
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (
        button.classList.contains("quality-download-options-button-menu") &&
        [...button.querySelectorAll<HTMLElement>(".btn-menu-item")].some(
          visible,
        )
      ) {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
        throw new Error(
          "网页要求选择保存清晰度，请在 Telegram 网页的下载菜单中选择；实际保存的媒体会自动加入下载任务",
        );
      }
    } else if (input.messageId) {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    }
    return {
      title: title.slice(0, 100),
      fingerprint: identity,
      url: location.href,
    };
  }
  if (!input.messageId)
    throw new Error(
      "此 Telegram 网页请使用具体消息的 t.me 链接解析；当前视频预览暂不支持自动定位",
    );
  const message = document.querySelector<HTMLElement>(
    `.Message[data-message-id="${input.messageId}"]`,
  );
  if (!message)
    throw new Error(
      "未找到指定 Telegram 消息；请确认已在内置浏览器登录并有权访问该消息",
    );
  const fingerprint = location.href + "\n" + message.innerText;
  if (input.fingerprint && input.fingerprint !== fingerprint)
    throw new Error("消息或聊天已变化，请重新粘贴链接解析，防止保存错误内容");
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (
    [...document.querySelectorAll<HTMLElement>(".MenuItem")].some(
      (node) =>
        node.querySelector(".icon-download") &&
        node.getBoundingClientRect().width > 0,
    )
  )
    throw new Error("请先关闭网页中已有的下载菜单，再重新解析");
  message.dispatchEvent(
    new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 300,
      clientY: 220,
    }),
  );
  let button: HTMLElement | undefined;
  for (let i = 0; i < 30; i++) {
    button = [...document.querySelectorAll<HTMLElement>(".MenuItem")].find(
      (node) =>
        node.querySelector(".icon-download") &&
        node.getBoundingClientRect().width > 0 &&
        !node.classList.contains("disabled") &&
        node.getAttribute("aria-disabled") !== "true",
    );
    if (button) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!button) {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    throw new Error(
      "此 Telegram 消息没有可用的媒体下载操作；消息可能禁止保存、尚未载入或网页结构已变化",
    );
  }
  if (/cancel|取消|отмен/i.test(button.innerText))
    throw new Error("此媒体正在由网页下载，请等待结束后重新解析");
  if (input.save) button.click();
  else
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  return {
    title: (message.innerText.trim() || "Telegram 媒体").slice(0, 100),
    fingerprint,
    url: location.href,
  };
}
