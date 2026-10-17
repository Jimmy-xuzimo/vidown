# 参与贡献

欢迎通过 Issue 和 Pull Request 改进 Vidown。提交前请阅读 [README](README.md)、[使用指南](docs/USER_GUIDE.md)和[行为准则](CODE_OF_CONDUCT.md)。

## 报告问题与提出建议

- 故障请使用「故障反馈」表单，说明应用版本、系统与处理器架构、操作步骤、预期结果和实际结果。区分直接链接解析与内置浏览器探测，注明是否需要登录。
- 功能建议请说明实际使用场景和希望改善的操作。较大改动先开 Issue 讨论，避免重复工作。
- 网站、媒体链接和截图请先检查隐私；不要公开账号、Cookie、授权头、验证码、私有消息或带签名的媒体地址。优先提供可公开访问的页面或本地受控样本。
- 安全漏洞请按照 [安全政策](SECURITY.md)私密报告，不在公开 Issue 或 PR 中披露未修复的利用细节。

## 开发环境

需要 Git、Node.js 24.13+ 和 npm。Windows 原生浏览器宿主另需 .NET SDK 8，以及系统 Evergreen WebView2 Runtime。

只检查源码时，无需下载媒体工具或启动浏览器：

```sh
npm ci --ignore-scripts
npm run check
npm run format:check
npx prettier --check site .github/workflows
```

Windows 完整开发环境的准备方式：

```powershell
npm run setup
npm run native:build
npm run dev
```

`setup` 会联网下载并校验 Electron 和媒体工具。macOS／Linux 的媒体工具准备、源码依赖与原生打包步骤见[构建说明](docs/BUILDING.md)；不要把上述 Windows 快速准备步骤当成各平台的完整发行流程。

## 修改与验证

保持改动集中，说明解决的问题和最终行为；相关文档与锁文件应一起更新。不要提交账号资料、下载内容、`work`、`release`、生成的依赖或运行时。

- 普通源码改动运行 `npm run check` 和格式检查。
- 协议、合并或续传改动，按影响运行 `verify:media`、`verify:protocol-edges`、`verify:mirrors` 等受控测试。
- 浏览器、会话或数据清理改动，运行相关桌面验收，例如 `verify:webview2`（Windows）或 `verify:data-cleanup`。先执行 `npm run build`；修改原生宿主后执行 `npm run native:build`。
- 界面改动附必要截图，检查小窗口、深浅模式及网页工具栏布局。
- 仅文档或模板改动检查格式、链接和表单结构，不要求重建安装包。

桌面验收使用独立测试档案，但部分脚本会临时替换系统剪贴板或把受控文件移至回收站，建议在专用测试环境运行。发布验证还会在五个原生运行器上检查实际打包程序。本机通过不能替代其他系统、真实账号或干净系统安装验收；未执行的检查请如实说明。

## 提交 Pull Request

填写 PR 模板，关联相关 Issue，列出实际执行的验证及剩余限制。PR 可以使用中文或英文；不要把未经验证的平台能力写成已支持。

应用自有代码采用 MIT；第三方组件分别遵循其许可。复用外部代码或新增依赖时，请说明来源和许可证，并更新必要的版权、许可与构建材料。不要直接复制许可不兼容的代码。发行标签由维护者的发布流程创建，不移动既有版本标签。
