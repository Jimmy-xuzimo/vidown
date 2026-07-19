"""配置加载与默认值。"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    import yaml  # type: ignore

    _HAS_YAML = True
except ImportError:
    _HAS_YAML = False

from .exceptions import ConfigError
from .logger import get_logger

logger = get_logger("config")

CONFIG_DIR = Path.home() / ".vidown"
USER_CONFIG_PATH = CONFIG_DIR / "config.json"


@dataclass
class QualityConfig:
    preference: str = "best"
    max_resolution: int = 4320
    min_resolution: int = 144
    force_codec: str = "h264"
    allow_hevc: bool = False
    allow_av1: bool = False
    allow_vp9: bool = False
    video_crf: int = 18
    video_preset: str = "slow"
    audio_codec: str = "aac"
    audio_bitrate: str = "320k"
    prefer_lossless_audio: bool = False


@dataclass
class NamingConfig:
    template: str = "%(title)s [%(uploader)s] %(resolution)s.%(ext)s"
    sanitize_windows: bool = True
    max_length: int = 200


@dataclass
class NetworkConfig:
    user_agent: str = (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
    )
    proxy: Optional[str] = None
    connect_timeout: int = 30
    read_timeout: int = 60
    probe_timeout: int = 60
    retry_max: int = 5
    retry_backoff: float = 1.5
    speed_limit_kbps: int = 0
    use_sponsorblock: bool = True
    sponsorblock_categories: List[str] = field(
        default_factory=lambda: ["sponsor", "intro", "outro", "selfpromo"]
    )


@dataclass
class GeneralConfig:
    download_dir: str = "~/.vidown/downloads"
    max_concurrent_downloads: int = 3
    max_concurrent_fragments: int = 16
    enable_clipboard_watcher: bool = True
    language: str = "auto"
    theme: str = "system"


@dataclass
class YtDlpEngineConfig:
    enabled: bool = True
    format_selector: str = "bestvideo*+bestaudio/best"
    h264_format_selector: str = "bv*[vcodec~='^((he|a)vc|h26[45])']+ba/bv*+ba/b"
    extra_args: List[str] = field(default_factory=list)


@dataclass
class M3u8DlEngineConfig:
    enabled: bool = True
    binary_path: Optional[str] = None
    threads: int = 16
    retry_count: int = 3
    auto_select_best: bool = True


@dataclass
class FallbackEngineConfig:
    enabled: bool = True
    timeout: int = 120


@dataclass
class EnginesConfig:
    ytdlp: YtDlpEngineConfig = field(default_factory=YtDlpEngineConfig)
    m3u8dl: M3u8DlEngineConfig = field(default_factory=M3u8DlEngineConfig)
    fallbacks: Dict[str, FallbackEngineConfig] = field(
        default_factory=lambda: {
            "you_get": FallbackEngineConfig(enabled=True, timeout=120),
            "lux": FallbackEngineConfig(enabled=False, timeout=120),
            "gallery_dl": FallbackEngineConfig(enabled=False, timeout=120),
        }
    )


@dataclass
class PostprocessConfig:
    embed_metadata: bool = True
    embed_thumbnail: bool = True
    embed_subtitles: bool = True
    subtitle_languages: List[str] = field(
        default_factory=lambda: ["zh-Hans", "zh-Hant", "en", "ja"]
    )
    auto_convert_to_mp4: bool = True
    preserve_original: bool = False


@dataclass
class CookiesConfig:
    auto_import_from_browsers: List[str] = field(default_factory=list)
    manual_cookies_file: Optional[str] = None


@dataclass
class UIConfig:
    show_format_preview: bool = True
    default_view: str = "queue"
    show_notifications: bool = True
    minimize_to_tray: bool = True


@dataclass
class Config:
    """Vidown 顶层配置。"""

    general: GeneralConfig = field(default_factory=GeneralConfig)
    quality: QualityConfig = field(default_factory=QualityConfig)
    naming: NamingConfig = field(default_factory=NamingConfig)
    network: NetworkConfig = field(default_factory=NetworkConfig)
    engines: EnginesConfig = field(default_factory=EnginesConfig)
    postprocess: PostprocessConfig = field(default_factory=PostprocessConfig)
    cookies: CookiesConfig = field(default_factory=CookiesConfig)
    ui: UIConfig = field(default_factory=UIConfig)

    # ---- 序列化 ----------------------------------------------------

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent)

    def save(self, path: Optional[Path] = None) -> Path:
        target = Path(path) if path else USER_CONFIG_PATH
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(self.to_json(), encoding="utf-8")
        logger.info(f"配置已保存至 {target}")
        return target


# ----------------------------------------------------------------------
# 加载 / 合并
# ----------------------------------------------------------------------


def _deep_merge(base: dict, override: dict) -> dict:
    """递归合并 dict，override 优先。"""
    result = dict(base)
    for k, v in override.items():
        if k in result and isinstance(result[k], dict) and isinstance(v, dict):
            result[k] = _deep_merge(result[k], v)
        else:
            result[k] = v
    return result


def _build_default_config() -> Config:
    """从内置默认 JSON 构建。"""
    here = Path(__file__).resolve().parent.parent.parent
    default_path = here / "configs" / "config.default.json"
    if default_path.exists():
        data = json.loads(default_path.read_text(encoding="utf-8"))
        return _dict_to_config(data)
    return Config()


def _dict_to_config(data: Dict[str, Any]) -> Config:
    """将 dict 转换为 Config dataclass 树。"""
    return Config(
        general=GeneralConfig(**data.get("general", {})),
        quality=QualityConfig(**data.get("quality", {})),
        naming=NamingConfig(**data.get("naming", {})),
        network=NetworkConfig(**data.get("network", {})),
        engines=_build_engines(data.get("engines", {})),
        postprocess=PostprocessConfig(**data.get("postprocess", {})),
        cookies=CookiesConfig(**data.get("cookies", {})),
        ui=UIConfig(**data.get("ui", {})),
    )


def _build_engines(data: Dict[str, Any]) -> EnginesConfig:
    ytdlp = YtDlpEngineConfig(**data.get("ytdlp", {}))
    m3u8dl = M3u8DlEngineConfig(**data.get("m3u8dl", {}))
    fallbacks = {}
    for k, v in data.get("fallbacks", {}).items():
        fallbacks[k] = FallbackEngineConfig(**v)
    return EnginesConfig(ytdlp=ytdlp, m3u8dl=m3u8dl, fallbacks=fallbacks)


def load_config(path: Optional[Path] = None) -> Config:
    """加载配置。未指定路径时使用用户配置，否则回退到默认。"""
    cfg = _build_default_config()

    candidates: List[Path] = []
    if path is not None:
        candidates.append(Path(path))
    else:
        if USER_CONFIG_PATH.exists():
            candidates.append(USER_CONFIG_PATH)
        # 查找当前工作目录下的 config.yaml / config.json
        for name in ("config.yaml", "config.yml", "config.json"):
            p = Path.cwd() / name
            if p.exists():
                candidates.append(p)

    for cand in candidates:
        if not cand.exists():
            continue
        try:
            text = cand.read_text(encoding="utf-8")
            if cand.suffix.lower() in (".yaml", ".yml"):
                if not _HAS_YAML:
                    logger.warning(f"未安装 PyYAML，跳过 {cand}")
                    continue
                data = yaml.safe_load(text) or {}
            else:
                data = json.loads(text)
            merged = _deep_merge(cfg.to_dict(), data)
            cfg = _dict_to_config(merged)
            logger.info(f"已加载配置: {cand}")
        except Exception as exc:
            raise ConfigError(f"加载配置 {cand} 失败: {exc}") from exc
    return cfg


def save_config(config: Config, path: Optional[Path] = None) -> Path:
    return config.save(path)
