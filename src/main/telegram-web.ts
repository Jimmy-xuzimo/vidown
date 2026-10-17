// Read only the requested, visible message. Never inspect Telegram's session keys or private client internals.
// Web A DOM references: Message.tsx data-message-id and MessageContextMenu.tsx icon-download.
export async function telegramMessageAction(input: {
  messageId: string;
  save?: boolean;
  fingerprint?: string;
}): Promise<{ title: string; fingerprint: string; url: string }> {
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
