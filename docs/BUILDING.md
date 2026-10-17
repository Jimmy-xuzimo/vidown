# 多平台发行构建

`Build and publish installers` 工作流在 `v*` 标签推送时执行，也可手动指定版本和 ref 进行试构建。手动运行默认不发布；打开 publish 时，所有构建、报告及校验通过后才创建缺失标签；已有标签必须指向本轮测试提交，绝不移动旧标签。标签必须等于 `v` 加 `package.json` 的版本。五个原生运行器分别构建，不在 Windows 上伪造 macOS／Linux 包。

| 平台    | 运行器／架构                  | 产物                          |
| ------- | ----------------------------- | ----------------------------- |
| Windows | Windows 2025 x64              | NSIS 安装 EXE、便携自解压 EXE |
| macOS   | macOS 15 Intel、Apple Silicon | 各自的 DMG                    |
| Linux   | Ubuntu 24.04 x64、ARM64       | 各自的 AppImage、DEB          |

macOS 当前设置最低 15.0；Linux 在 Ubuntu 24.04 构建，不承诺兼容更旧的 glibc。Windows 使用系统 Evergreen WebView2；macOS／Linux 使用包内 Chromium。macOS 使用 ad-hoc 本地签名，没有 Apple Developer ID／公证；Windows 未进行发布者签名。首次启动可能遇到系统来源验证提示，不应关闭系统整体安全机制。

## 依赖与源码材料

打包工具的 `@electron/get@3.1.0` 使用限定范围的 npm override，将代理库固定为 `global-agent@4.1.3`，移除引入 `GHSA-hp3w-g68c-fv3c` 的旧 `roarr`／`sprintf-js` 链，同时保留构建代理能力。不要用 `--omit=optional` 绕过此依赖；回归测试直接调用该打包下载器，验证代理鉴权与 `NO_PROXY`。后续升级下载器时应重新评估该 override。三端源码 CI 同时执行完整 npm 依赖审计；CodeQL 定期扫描 TypeScript／JavaScript、Python、C# 和 Actions。

1. `npm ci --ignore-scripts` 使用锁定的应用依赖。Node.js 24、Python 3.13.16；Windows 另有 .NET SDK 8。
2. `scripts/build-media.sh` 从固定提交构建 FFmpeg n9.0.2 和 x264，静态链接，不读取运行器上随机安装的编解码库。配置关闭自动发现；Windows 使用系统 Schannel，macOS 使用系统 Secure Transport，Linux FFmpeg 不包含独立 TLS 库（应用的网络传输由 Chromium／下载引擎完成）。记录完整配置和源码归档。FFmpeg 原生 HEVC 解码／无损合并仍可用；不额外捆绑 HEVC 编码器。
3. `scripts/build-extractor.py` 在专属虚拟环境中，从固定 yt-dlp 提交及其锁定默认依赖构建 PyInstaller 独立程序，包含 EJS。保存全部已安装 Python 分发的精确 sdist、CPython 源码、实际依赖清单、许可文本及构建脚本。没有混入用户浏览器 Cookie、其他环境里的包或可选 curl-cffi 模拟库。非交互程序不包含 Readline／Tk。
4. `npm run setup` 在 `VIDOWN_TOOLS_FROM_SOURCE=1` 下校验本轮提取器哈希、下载并验证 N_m3u8DL-RE 的上游摘要，准备 Electron 和许可文件。`npm run dist -- --<win|mac|linux> --<x64|arm64> --publish never --config.electronDist=node_modules/electron/dist` 构建对应包。
5. 工作流先固定一次应用提交，全部运行器使用同一个 SHA。每个运行器执行类型／生产构建、单元测试、实际协议样本、时间轴边界、备用源隔离，以及**打包后**浏览器探测→鉴权下载→合并→验证。Windows 加测原生 WebView2 和便携 EXE；其他系统展开实际安装容器，核对载荷哈希与权限，再启动实际 ZIP／AppImage 中的程序。任一失败，发布作业不运行。
6. `collect-release.mjs` 保存安装包、独立的 `*-sources.tar.gz`、`*-verification.json` 和 `*-SHA256SUMS.txt`。最终发布作业重算五组校验值，主 Release 仅上传 Windows EXE、macOS DMG、Linux AppImage／DEB。对应源码、验证报告和公开附件校验值上传至同版本的独立资料 Release（`v<version>-materials`，标记为预发布以免取代最新应用版本），并由主 Release 链接。精确对应源码永久公开保存，不以临时 Actions artifact 或上游最新分支代替。macOS ZIP 与 Linux tar.gz 仍用于内部载荷验证，不对外重复发布。

源码归档包含 FFmpeg、x264、yt-dlp、CPython、Python 依赖、构建配方、FFmpeg 配置与 Python 包版本。对应应用源码由同一 Git 标签提供。Linux 文件名中的 x86_64／amd64 与 x64 均指 Intel／AMD 64 位；ARM64 的文件标记为 arm64。每次构建记录 Actions 运行地址；不保证不同编译器、时间戳及签名下二进制逐字节可复现。

重新构建可在相同标签上手动运行工作流，或在上述原生环境解开源码包并执行随包脚本。运行器依赖（编译器、SDK、打包工具）由工作流声明，Python 依赖具体版本和源归档摘要见 `extractor-build.json`。所有安装包都通过 CI 才上传，但这不等同于每个发行版的干净系统安装／卸载、真实账号或人工播放验收。

## 受控 HDR 样本

`tests/fixtures/hdr10.mp4` 是自有 lavfi 测试图生成的 1.25 秒、320×180 HEVC Main10/HDR10 样本，采用项目 MIT 许可。固定该输入让各运行器无需安装测试专用 HEVC 编码器；成品仍由实际 FFmpeg／ffprobe 合并、解码并检查色彩及 HDR 参数。它不是会员视频或真实平台验收。
