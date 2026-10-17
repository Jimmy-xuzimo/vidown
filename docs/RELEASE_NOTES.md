# Vidown 1.0.4

新增「设置与账号 → 本地数据清理」，并包含上一版之后的安全修复与浏览器异常处理改进。

- 可分别清除全部网站的浏览器数据、下载记录，或同时清理。执行前再次确认。
- 浏览器清理关闭全部标签页，清除浏览记录、Cookie、加密登录备份、缓存、网站存储及网页缩放设置，并使已探测资源和旧下载计划失效。清理后网站需要重新登录。
- 有等待、进行中或暂停的任务时，先完成或取消任务才能清理浏览器。仅清理下载记录时保留未结束的任务。
- 本功能保留下载文件、下载目录及应用外观设置；需要同时删除文件时，可使用下载记录页的删除选项。
- 移除打包依赖中的已知 `sprintf-js` 漏洞链，保留代理支持；修复扫描发现的问题并约束发行构建的源码来源。

主 Release 仅提供 **5 个应用包**：Windows x64 安装 EXE、macOS Intel／Apple Silicon 各一个 DMG、Linux x64／ARM64 各一个 AppImage。便携 EXE、DEB 和其他重复格式不作为公开下载附件。

[SHA-256 校验、测试报告与第三方对应源码](https://github.com/Jimmy-xuzimo/vidown/releases/tag/v1.0.4-materials)单独保存。五个原生运行器均执行打包应用的受控下载与数据清理测试，全部通过后才发布。

无需另外安装 Python、Node.js、.NET 或媒体工具。Windows 浏览器仍需系统已有的 Evergreen WebView2 Runtime，缺失时尚不自动安装。macOS 要求 15+；Linux 在 Ubuntu 24.04 构建。Windows 未签名，macOS 只有 ad-hoc 签名，没有 Developer ID 或公证。

清理是应用层数据移除，不承诺磁盘取证级擦除，不会清除外部浏览器、操作系统备份或用户自行导出的报告。干净系统安装／卸载、真实账号与所有网站最高规格仍需分别验收。

[使用指南](https://github.com/Jimmy-xuzimo/vidown/blob/main/docs/USER_GUIDE.md) · [测试记录](https://github.com/Jimmy-xuzimo/vidown/blob/main/docs/VALIDATION.md) · [项目介绍](https://jimmy-xuzimo.github.io/vidown/)
