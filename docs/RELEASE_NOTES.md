# Vidown 1.0.3

本次新增原生 GitHub Actions 多平台构建与 Release 附件发布。

- Windows x64：安装版 `Setup.exe` 与便携自解压 `Portable.exe`。
- macOS 15+：Intel x64 与 Apple Silicon arm64，分别提供 DMG 和 ZIP。
- Linux：x64 与 ARM64，分别提供 AppImage、DEB 和 tar.gz；在 Ubuntu 24.04 构建。
- Windows 网页使用系统 WebView2，macOS／Linux 网页使用包内 Chromium。外部浏览器 Cookie 导入已移除；需要登录时在内置浏览器操作。
- 安装包自带媒体工具，不需要用户安装 Python、Node.js 或 .NET。Windows 仍需系统 Evergreen WebView2 Runtime。

每个平台的 `*-verification.json` 记录本轮引擎和打包后的真实受控下载验证，`*-SHA256SUMS.txt` 提供校验，`*-sources.tar.gz` 包含第三方对应源码、固定版本、依赖清单与构建材料。应用源码由此标签提供。任意矩阵构建或验证失败，工作流不会公开上传一组不完整的附件。

Windows 未签名；macOS 只有 ad-hoc 签名，没有 Developer ID 或公证。Linux 旧发行版和干净系统安装／卸载、真实会员／私有账号、HDR 播放设备验收仍待完成。CI 启动与实际受控下载通过，不代表全部平台内容或所有站点均已支持。构建链的已知依赖通告和历史验收见 [测试记录](https://github.com/Jimmy-xuzimo/vidown/blob/main/docs/VALIDATION.md)。

便携版是免安装自解压程序，账号、设置及任务仍保存在系统用户资料目录，不是所有数据随 EXE 搬迁。

[使用指南](https://github.com/Jimmy-xuzimo/vidown/blob/main/docs/USER_GUIDE.md) · [构建说明](https://github.com/Jimmy-xuzimo/vidown/blob/main/docs/BUILDING.md) · [项目介绍](https://jimmy-xuzimo.github.io/vidown/)
