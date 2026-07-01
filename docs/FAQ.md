# 常见问题 (FAQ)

## Q: 安装后 `vidown` 命令找不到？

A: 确保虚拟环境已激活，或者使用 `pip install --user -e .`，或者通过 `python -m vidown ...` 调用。

## Q: ffmpeg 找不到怎么办？

A: 必须先安装 ffmpeg：
- macOS: `brew install ffmpeg`
- Ubuntu/Debian: `sudo apt install ffmpeg`
- Windows: 从 https://www.gyan.dev/ffmpeg/builds/ 下载并加入 PATH
- 也可以手动指定路径：在 `configs/config.default.json` 中修改相应字段（需要扩展代码）

## Q: 下载 YouTube 时报 403 错误？

A: 升级 yt-dlp：
```bash
pip install -U yt-dlp
```
YouTube 经常更新反爬机制，yt-dlp 通常 1-3 天内跟进。

## Q: 提示「受 DRM 保护」怎么办？

A: Netflix / Disney+ / Amazon Prime 等平台的核心内容受 Widevine / PlayReady / FairPlay DRM 保护，无法直接下载。这是行业限制，与工具无关。**请勿用于绕过合法 DRM**，尊重版权。

## Q: Bilibili 大会员 / 付费视频能下吗？

A: 需要在「设置 → Cookie」中导入已登录大会员的浏览器 Cookie。Vidown 会自动以登录态访问。

## Q: M3U8 直播流能下吗？

A: 可以。Vidown 会下载所有 TS 片段并合并为 MP4。**注意**：直播流没有真正的"结束点"，下载到一半停止即可得到当前内容。

## Q: N_m3u8DL-RE 怎么装？

A:
- **macOS**: `brew install N_m3u8DL-RE`（或自行下载 release 二进制）
- **Windows**: https://github.com/nilaoda/N_m3u8DL-RE/releases 下载 `N_m3u8DL-RE.exe`，加入 PATH
- **Linux**: 下载 release，或 `cargo install N_m3u8DL-RE`（需 Rust）

下载后 Vidown 会自动检测。如未检测到，回退到内置多线程 TS 下载器。

## Q: 怎么自定义输出文件名？

A: 编辑 `~/.vidown/config.json`：
```json
{
  "naming": {
    "template": "%(upload_date>%Y-%m-%d)s_%(title)s_%(resolution)s.%(ext)s"
  }
}
```
支持所有 yt-dlp 的输出模板占位符。

## Q: 如何只下载音频？

A: Vidown 主要面向视频。如需纯音频，可临时改配置：
```json
{
  "quality": { "force_codec": "h264" }
}
```
然后用 ffmpeg 提取：
```bash
ffmpeg -i input.mp4 -vn -c:a copy output.m4a
```

未来版本会加入「仅音频」选项。

## Q: GUI 启动后浏览器没自动打开？

A: 手动访问终端打印的 URL（默认 `http://127.0.0.1:8765`）。或者 `vidown gui --no-browser` 然后用其他浏览器访问。

## Q: 端口被占用？

A: `vidown gui --port 9876`

## Q: 想换回 Python 旧版本怎么办？

A: Vidown 需要 Python 3.10+。如系统默认是 3.9，可以：
```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Q: 能不能在服务器上跑（无头模式）？

A: 可以。`vidown gui` 本身不需要 X server，只是 Web 界面。如要部署到服务器并远程访问：
```bash
vidown gui --host 0.0.0.0 --port 8765
```
然后通过 SSH 端口转发访问：
```bash
ssh -L 8765:127.0.0.1:8765 user@server
```

## Q: 性能优化建议？

1. **多线程 M3U8**：将 `engines.m3u8dl.threads` 调高到 32-64（但要注意站点限速）
2. **降低并发下载数**：若网络不稳定，把 `general.max_concurrent_downloads` 降到 2
3. **NVENC 硬件加速**：修改 `vidown/postprocess/ffmpeg_pipe.py` 中的 `-c:v libx264` 为 `-c:v h264_nvenc`（NVIDIA）或 `-c:v h264_qsv`（Intel）
4. **避免重编码**：源视频若为 H.264，Vidown 会自动 `-c copy` 跳过编码

## Q: 如何上报 Bug？

请到 https://github.com/vidown/vidown/issues 提交 Issue，附上：
1. `vidown check` 的输出
2. `vidown --version`
3. 完整的错误日志（`vidown -v <URL>`）
4. 复现步骤
