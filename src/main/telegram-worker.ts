import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { classifyError } from "../core/safety";
const require = createRequire(__filename);
const port = (process as any).parentPort;
let send: any,
  receive: any,
  client: number | undefined,
  config: any,
  closing = false;
let native: any;
function nativeLibrary(): any {
  if (!native) {
    const koffi = require("koffi");
    const path = require("prebuilt-tdlib")
      .getTdjson()
      .replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
    native = koffi.load(path);
    native.func("const char *td_execute(const char *request)")(
      JSON.stringify({
        "@type": "setLogVerbosityLevel",
        new_verbosity_level: 0,
      }),
    );
  }
  return native;
}
let seq = 0;
const pending = new Map<
  number,
  {
    resolve: (value: any) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
  }
>();
const post = (value: any) => port.postMessage(value);
function invoke(method: any): Promise<any> {
  if (client === undefined)
    return Promise.reject(new Error("请先配置并登录 Telegram"));
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => {
        pending.delete(id);
        reject(new Error("Telegram 请求超时"));
      },
      method["@type"] === "downloadFile" ? 24 * 3600000 : 60000,
    );
    pending.set(id, { resolve, reject, timer });
    send(client, JSON.stringify({ ...method, "@extra": id }));
  });
}
function poll(): void {
  if (closing) return;
  receive.async(0.05, (_error: any, text: string) => {
    if (text) {
      try {
        const data = JSON.parse(text);
        const call = pending.get(data["@extra"]);
        if (call) {
          pending.delete(data["@extra"]);
          clearTimeout(call.timer);
          data["@type"] === "error"
            ? call.reject(new Error(`${data.code}: ${data.message}`))
            : call.resolve(data);
        }
        if (data["@type"] === "updateAuthorizationState") {
          const state = data.authorization_state["@type"];
          post({ event: "auth", state });
          if (state === "authorizationStateWaitTdlibParameters")
            void invoke({
              "@type": "setTdlibParameters",
              database_directory: config.directory,
              files_directory: config.directory + "/files",
              database_encryption_key: config.key,
              use_file_database: true,
              use_chat_info_database: true,
              use_message_database: true,
              use_secret_chats: false,
              api_id: config.apiId,
              api_hash: config.apiHash,
              system_language_code: "zh-Hans",
              device_model: "Vidown Desktop",
              system_version: process.platform,
              application_version: "1.0.0-alpha.1",
            }).catch((error) =>
              post({
                event: "auth",
                state: "error",
                detail: classifyError(error),
              }),
            );
        }
        if (data["@type"] === "updateFile")
          post({
            event: "file",
            fileId: data.file.id,
            bytes: data.file.local?.downloaded_size,
          });
      } catch {}
    }
    setImmediate(poll);
  });
}
port.on("message", async ({ data }: any) => {
  try {
    let result: any;
    switch (data.action) {
      case "version":
        result = JSON.parse(
          nativeLibrary().func("const char *td_execute(const char *request)")(
            JSON.stringify({ "@type": "getOption", name: "version" }),
          ),
        ).value;
        break;
      case "init": {
        if (client !== undefined)
          throw new Error(
            "Telegram 已初始化，请完成当前登录或重启应用后更换应用身份",
          );
        config = data.payload;
        await mkdir(config.directory, { recursive: true });
        const lib = nativeLibrary();
        const create = lib.func("int td_create_client_id(void)");
        send = lib.func("void td_send(int client_id, const char *request)");
        receive = lib.func("const char *td_receive(double timeout)");
        const execute = lib.func("const char *td_execute(const char *request)");
        execute(
          JSON.stringify({
            "@type": "setLogVerbosityLevel",
            new_verbosity_level: 0,
          }),
        );
        client = create();
        poll();
        result = await invoke({ "@type": "getOption", name: "version" });
        break;
      }
      case "phone":
        result = await invoke({
          "@type": "setAuthenticationPhoneNumber",
          phone_number: data.payload.value,
          settings: {
            "@type": "phoneNumberAuthenticationSettings",
            allow_flash_call: false,
            allow_missed_call: false,
            is_current_phone_number: false,
            allow_sms_retriever_api: false,
          },
        });
        break;
      case "code":
        result = await invoke({
          "@type": "checkAuthenticationCode",
          code: data.payload.value,
        });
        break;
      case "password":
        result = await invoke({
          "@type": "checkAuthenticationPassword",
          password: data.payload.value,
        });
        break;
      case "logout":
        result = await invoke({ "@type": "logOut" });
        break;
      case "probe": {
        const info = await invoke({
          "@type": "getMessageLinkInfo",
          url: data.payload.url,
        });
        const message = info.message;
        if (!message) throw new Error("该消息不存在或账号无权访问");
        const props = await invoke({
          "@type": "getMessageProperties",
          chat_id: message.chat_id,
          message_id: message.id,
        });
        if (message.can_be_saved === false || props.can_be_saved === false)
          throw new Error("该消息不允许保存");
        const c = message.content;
        const media =
          c.video ??
          c.audio ??
          c.document ??
          c.animation ??
          c.voice_note ??
          c.video_note;
        const file =
          media?.video ??
          media?.audio ??
          media?.document ??
          media?.animation ??
          media?.voice ??
          media?.video_note;
        if (!file?.id) throw new Error("该消息没有可保存的视频或音频");
        result = {
          fileId: file.id,
          title: media.file_name || `Telegram ${message.id}`,
          duration: media.duration,
          width: media.width,
          height: media.height,
          audio: !!(c.audio || c.voice_note),
        };
        break;
      }
      case "download": {
        result = await invoke({
          "@type": "downloadFile",
          file_id: data.payload.fileId,
          priority: 16,
          offset: 0,
          limit: 0,
          synchronous: true,
        });
        if (!result.local?.is_downloading_completed)
          throw new Error("Telegram 文件未完成下载");
        result = { path: result.local.path };
        break;
      }
      case "cancel":
        result = await invoke({
          "@type": "cancelDownloadFile",
          file_id: data.payload.fileId,
          only_if_pending: false,
        });
        break;
      case "shutdown":
        closing = true;
        result = await invoke({ "@type": "close" });
        break;
      default:
        throw new Error("未知 Telegram 操作");
    }
    post({ id: data.id, type: "result", data: result });
  } catch (error) {
    post({ id: data.id, type: "error", data: classifyError(error) });
  }
});
