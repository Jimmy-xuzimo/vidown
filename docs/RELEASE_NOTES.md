# Vidown 1.0.7

Issue #2：粘贴链接后点击一次“解析并下载”，直接探测并加入队列。每批最多 50 个链接，逐项展示状态，失败可以单独重试；原来的“选择格式…”入口继续保留。

- 自动保留最高可用源规格与匹配音轨。多单集、多语言、源提示及网页原生保存仍需确认。
- 普通探测最多并行两项，浏览器辅助操作串行；实际下载沿用 1–4 并发设置。
- 增加请求幂等、活动任务查重及取消后迟到结果处理。不同短链／签名地址不保证识别为同一媒体；不新增直播、合集或跨重启自动续传。
- 更新 Electron 44.10.1、打包与测试依赖；修复本轮依赖审计问题，旧构建工具通过兼容适配使用新版 minimatch 匹配实现。

主 Release 仅提供 **5 个应用包**：Windows x64 EXE、macOS Intel／Apple Silicon 各一个 DMG、Linux x64／ARM64 各一个 AppImage。安装包由五个原生运行器构建并执行真实受控下载、批量入队、浏览器与数据清理检查。

[SHA-256、测试报告及第三方对应源码](https://github.com/Jimmy-xuzimo/vidown/releases/tag/v1.0.7-materials)单独提供。Android [0.1.0-preview.7](https://github.com/Jimmy-xuzimo/vidown/releases/tag/android-v0.1.0-preview.7) 使用独立通用 APK，新增一键处理和 Google 官方 Compose Material 3 导航。

无需另装 Python、Node.js、.NET 或媒体工具。Windows 需要系统已有 Evergreen WebView2 Runtime，缺失时尚不自动安装。macOS 15+；Linux 在 Ubuntu 24.04 构建。Windows 未签名；macOS 只有 ad-hoc 签名，没有 Developer ID 或公证。升级前请正常退出旧版。真实会员／私有账号、干净系统安装和 Android 真机后台行为仍需单独验收。

[使用指南](https://github.com/Jimmy-xuzimo/vidown/blob/main/docs/USER_GUIDE.md) · [更新历史](https://github.com/Jimmy-xuzimo/vidown/blob/main/docs/CHANGELOG.md) · [项目介绍](https://jimmy-xuzimo.github.io/vidown/)
