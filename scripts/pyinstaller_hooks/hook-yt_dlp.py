"""PyInstaller hook: yt-dlp 需要收集所有 extractor 的网络协议与后处理模块。"""

from PyInstaller.utils.hooks import collect_submodules, collect_data_files

# 收集 yt_dlp 下所有子模块（extractor 数量很多）
hiddenimports = collect_submodules("yt_dlp")

# 收集 yt_dlp 携带的 LICENSE 与 data 文件
datas = collect_data_files("yt_dlp")

# 收集 you_get 备用引擎
try:
    hiddenimports += collect_submodules("you_get")
    datas += collect_data_files("you_get")
except Exception:
    pass

# 收集 gallery_dl 备用引擎
try:
    hiddenimports += collect_submodules("gallery_dl")
    datas += collect_data_files("gallery_dl")
except Exception:
    pass
