"""DASH / MPD 探测与解析模块。

提供 MPD (Media Presentation Description) 的解析能力，提取可下载的
Representation、SegmentTemplate/SegmentList 信息，并生成统一的 VideoInfo。

当前支持：
  - 静态 MPD (static) 与直播 MPD (dynamic) 识别
  - SegmentTemplate + SegmentTimeline / SegmentList
  - SegmentBase (单文件 on-demand)
  - 常见视频/音频 AdaptationSet 分离

DRM / CENC 加密的 MPD 会被明确拒绝，避免下载无效片段。
"""

from __future__ import annotations

import math
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

from ..core.config import Config
from ..core.exceptions import DRMRestrictedError, EngineError
from ..core.logger import get_logger
from ..core.models import FormatInfo, MediaKind, Platform, VideoInfo
from ..core.network import http_get_text
from .base import EngineContext

logger = get_logger("engines.dash.probe")


@dataclass
class SegmentInfo:
    """单个 Representation 的下载信息。"""

    representation_id: str
    mime_type: str
    codecs: str
    bandwidth: int
    width: Optional[int] = None
    height: Optional[int] = None
    frame_rate: Optional[float] = None
    audio_sampling_rate: Optional[int] = None
    initialization: Optional[str] = None
    media_segments: List[str] = field(default_factory=list)
    segment_duration: Optional[float] = None
    total_duration: Optional[float] = None
    content_protection: List[Dict[str, Any]] = field(default_factory=list)
    base_url: str = ""


@dataclass
class DashManifest:
    """解析后的 MPD 结构。"""

    url: str
    is_dynamic: bool
    media_duration: Optional[float]
    min_buffer_time: Optional[float]
    base_url: str
    segments: List[SegmentInfo]


class MPDProbe:
    """DASH MPD 探测器。"""

    def __init__(self, config: Config):
        self.config = config

    def probe(self, url: str, ctx: EngineContext) -> VideoInfo:
        """探测 MPD URL，返回统一 VideoInfo。"""
        try:
            text = http_get_text(url, self.config)
        except Exception as e:
            raise EngineError(f"获取 MPD 失败: {e}") from e

        try:
            manifest = self._parse(text, url)
        except Exception as e:
            raise EngineError(f"解析 MPD 失败: {e}") from e

        if not manifest.segments:
            raise EngineError("MPD 中未找到可下载的 Representation")

        # 检测 DRM
        for seg in manifest.segments:
            if seg.content_protection:
                raise DRMRestrictedError("该 DASH 流受 DRM 保护，无法下载")

        # 构造 VideoInfo
        video_segs = [s for s in manifest.segments if s.mime_type.startswith("video/")]
        audio_segs = [s for s in manifest.segments if s.mime_type.startswith("audio/")]

        # 选择最佳视频/音频作为默认
        best_video = max(video_segs, key=lambda s: s.bandwidth) if video_segs else None
        best_audio = max(audio_segs, key=lambda s: s.bandwidth) if audio_segs else None

        title = self._guess_title(url)
        info = VideoInfo(
            url=url,
            webpage_url=url,
            platform=Platform.DASH,
            kind=MediaKind.VIDEO,
            title=title,
            is_live=manifest.is_dynamic,
            duration=int(manifest.media_duration) if manifest.media_duration else None,
            extra={
                "manifest": manifest,
                "best_video_id": best_video.representation_id if best_video else None,
                "best_audio_id": best_audio.representation_id if best_audio else None,
            },
        )

        for seg in manifest.segments:
            info.formats.append(self._segment_to_format(seg, manifest))

        ctx.log(
            "info",
            f"MPD 解析完成: {len(manifest.segments)} 个 representation, 直播={manifest.is_dynamic}",
        )
        return info

    def _parse(self, text: str, url: str) -> DashManifest:
        root = ET.fromstring(text)
        ns = self._get_namespace(root)

        mpd_attrs = root.attrib
        is_dynamic = mpd_attrs.get("type", "static") == "dynamic"
        media_duration = self._parse_duration(mpd_attrs.get("mediaPresentationDuration"))
        min_buffer_time = self._parse_duration(mpd_attrs.get("minBufferTime"))

        # BaseURL 可能出现在 MPD 根节点
        base_url = self._get_base_url(root, url, ns)

        segments: List[SegmentInfo] = []
        for period in root.findall(f".//{ns}Period"):
            period_duration = self._parse_duration(period.attrib.get("duration")) or media_duration
            for adaptation in period.findall(f".//{ns}AdaptationSet"):
                adaptation_base = self._get_base_url(adaptation, base_url, ns)
                mime_type = adaptation.attrib.get("mimeType", "")
                if not mime_type:
                    # 从子 Representation 推断
                    first_repr = adaptation.find(f"{ns}Representation")
                    if first_repr is not None:
                        mime_type = first_repr.attrib.get("mimeType", "")

                for repr_elem in adaptation.findall(f"{ns}Representation"):
                    seg = self._parse_representation(
                        repr_elem,
                        adaptation,
                        adaptation_base,
                        mime_type,
                        period_duration,
                        ns,
                    )
                    if seg:
                        segments.append(seg)

        return DashManifest(
            url=url,
            is_dynamic=is_dynamic,
            media_duration=(
                media_duration or period_duration if "period_duration" in dir() else None
            ),
            min_buffer_time=min_buffer_time,
            base_url=base_url,
            segments=segments,
        )

    def _parse_representation(
        self,
        repr_elem: ET.Element,
        adaptation: ET.Element,
        base_url: str,
        mime_type: str,
        period_duration: Optional[float],
        ns: str,
    ) -> Optional[SegmentInfo]:
        attrs = repr_elem.attrib
        rep_id = attrs.get("id", "")
        bandwidth = int(attrs.get("bandwidth", 0))
        rep_mime = attrs.get("mimeType") or mime_type
        if not rep_mime:
            return None

        codecs = attrs.get("codecs") or adaptation.attrib.get("codecs", "")
        width = self._int_attr(attrs.get("width"))
        height = self._int_attr(attrs.get("height"))
        frame_rate = self._float_attr(attrs.get("frameRate"))
        audio_sampling_rate = self._int_attr(attrs.get("audioSamplingRate"))

        rep_base_url = self._get_base_url(repr_elem, base_url, ns)

        # ContentProtection (DRM)
        protections = []
        for cp in repr_elem.findall(f"{ns}ContentProtection"):
            protections.append(
                {
                    "scheme_id_uri": cp.attrib.get("schemeIdUri", ""),
                    "value": cp.attrib.get("value", ""),
                }
            )
        if not protections:
            for cp in adaptation.findall(f"{ns}ContentProtection"):
                protections.append(
                    {
                        "scheme_id_uri": cp.attrib.get("schemeIdUri", ""),
                        "value": cp.attrib.get("value", ""),
                    }
                )

        # Segment 信息
        init: Optional[str] = None
        media_segs: List[str] = []
        seg_duration: Optional[float] = None

        # 1) SegmentTemplate
        seg_template = repr_elem.find(f"{ns}SegmentTemplate")
        if seg_template is None:
            seg_template = adaptation.find(f"{ns}SegmentTemplate")

        if seg_template is not None:
            init, media_segs, seg_duration = self._parse_segment_template(
                seg_template,
                rep_base_url,
                rep_id,
                period_duration,
                ns,
            )

        # 2) SegmentList
        if not media_segs:
            seg_list = repr_elem.find(f"{ns}SegmentList")
            if seg_list is None:
                seg_list = adaptation.find(f"{ns}SegmentList")
            if seg_list is not None:
                init, media_segs, seg_duration = self._parse_segment_list(
                    seg_list,
                    rep_base_url,
                    period_duration,
                    ns,
                )

        # 3) SegmentBase (单文件 on-demand)
        if not media_segs:
            seg_base = repr_elem.find(f"{ns}SegmentBase")
            if seg_base is not None:
                # 单文件：init 就是整个文件
                init = rep_base_url
                media_segs = [rep_base_url]
                if period_duration:
                    seg_duration = period_duration

        # 兜底：如果 Representation 自身有 BaseURL 且没有 segment 信息，视为单文件
        if not media_segs:
            repr_base = repr_elem.find(f"{ns}BaseURL")
            if repr_base is not None and repr_base.text:
                full = urljoin(rep_base_url, repr_base.text.strip())
                init = full
                media_segs = [full]
                if period_duration:
                    seg_duration = period_duration

        if not media_segs:
            return None

        return SegmentInfo(
            representation_id=rep_id,
            mime_type=rep_mime,
            codecs=codecs,
            bandwidth=bandwidth,
            width=width,
            height=height,
            frame_rate=frame_rate,
            audio_sampling_rate=audio_sampling_rate,
            initialization=init,
            media_segments=media_segs,
            segment_duration=seg_duration,
            total_duration=period_duration,
            content_protection=protections,
            base_url=rep_base_url,
        )

    def _parse_segment_template(
        self,
        seg_template: ET.Element,
        base_url: str,
        rep_id: str,
        period_duration: Optional[float],
        ns: str,
    ) -> Tuple[Optional[str], List[str], Optional[float]]:
        init_template = seg_template.attrib.get("initialization")
        media_template = seg_template.attrib.get("media")
        timescale = int(seg_template.attrib.get("timescale", 1))
        duration = (
            int(seg_template.attrib.get("duration", 0))
            if "duration" in seg_template.attrib
            else None
        )
        start_number = int(seg_template.attrib.get("startNumber", 1))

        init = None
        if init_template:
            init = urljoin(base_url, init_template.replace("$RepresentationID$", rep_id))

        media_segs: List[str] = []
        seg_duration_sec: Optional[float] = None

        # SegmentTimeline 模式
        timeline = seg_template.find(f"{ns}SegmentTimeline")
        if timeline is not None:
            t = 0
            for s in timeline.findall(f"{ns}S"):
                s_t = int(s.attrib.get("t", t))
                s_d = int(s.attrib["d"])
                s_r = int(s.attrib.get("r", 0))
                t = s_t
                for _ in range(s_r + 1):
                    if media_template:
                        url = media_template.replace("$RepresentationID$", rep_id)
                        url = url.replace("$Time$", str(t))
                        url = url.replace("$Number$", str(start_number + len(media_segs)))
                        media_segs.append(urljoin(base_url, url))
                    t += s_d
            if duration is None and media_segs:
                seg_duration_sec = s_d / timescale if s_d else None
        elif duration and period_duration:
            # 固定时长分段
            seg_duration_sec = duration / timescale
            count = max(1, math.ceil(period_duration / seg_duration_sec))
            for i in range(count):
                if media_template:
                    url = media_template.replace("$RepresentationID$", rep_id)
                    url = url.replace("$Number$", str(start_number + i))
                    url = url.replace("$Time$", str(i * duration))
                    media_segs.append(urljoin(base_url, url))

        return init, media_segs, seg_duration_sec

    def _parse_segment_list(
        self,
        seg_list: ET.Element,
        base_url: str,
        period_duration: Optional[float],
        ns: str,
    ) -> Tuple[Optional[str], List[str], Optional[float]]:
        init = None
        init_elem = seg_list.find(f"{ns}Initialization")
        if init_elem is not None and init_elem.attrib.get("sourceURL"):
            init = urljoin(base_url, init_elem.attrib["sourceURL"])

        media_segs: List[str] = []
        seg_duration: Optional[float] = None
        for seg in seg_list.findall(f"{ns}SegmentURL"):
            src = seg.attrib.get("media")
            if src:
                media_segs.append(urljoin(base_url, src))
            if seg_duration is None:
                dur = seg.attrib.get("duration")
                if dur:
                    seg_duration = float(dur)

        return init, media_segs, seg_duration

    def _get_base_url(self, elem: ET.Element, fallback: str, ns: str) -> str:
        base = elem.find(f"{ns}BaseURL")
        if base is not None and base.text:
            return urljoin(fallback, base.text.strip())
        return fallback

    def _get_namespace(self, root: ET.Element) -> str:
        tag = root.tag
        if tag.startswith("{"):
            return f"{{{tag.split('}')[0][1:]}}}"
        return ""

    def _parse_duration(self, value: Optional[str]) -> Optional[float]:
        if not value:
            return None
        # ISO 8601 duration, e.g. PT1H2M3S / PT4M2.500S
        m = re.match(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?", value)
        if not m:
            return None
        hours = float(m.group(1) or 0)
        minutes = float(m.group(2) or 0)
        seconds = float(m.group(3) or 0)
        return hours * 3600 + minutes * 60 + seconds

    def _int_attr(self, value: Optional[str]) -> Optional[int]:
        if value is None:
            return None
        try:
            return int(value)
        except ValueError:
            return None

    def _float_attr(self, value: Optional[str]) -> Optional[float]:
        if value is None:
            return None
        try:
            return float(value)
        except ValueError:
            return None

    def _segment_to_format(self, seg: SegmentInfo, manifest: DashManifest) -> FormatInfo:
        is_video = seg.mime_type.startswith("video/")
        return FormatInfo(
            format_id=seg.representation_id,
            ext=(
                "m4s"
                if not seg.initialization or seg.initialization != seg.media_segments[0]
                else "mp4"
            ),
            resolution=f"{seg.width}x{seg.height}" if seg.width and seg.height else "",
            width=seg.width,
            height=seg.height,
            vcodec=seg.codecs if is_video else "none",
            acodec=seg.codecs if not is_video else "none",
            vbr=seg.bandwidth / 1000.0 if is_video else 0.0,
            abr=seg.bandwidth / 1000.0 if not is_video else 0.0,
            fps=seg.frame_rate,
            tbr=seg.bandwidth / 1000.0,
            filesize=None,
            format_note=f"DASH {'live' if manifest.is_dynamic else 'static'}",
            protocol="https",
            extra={
                "init": seg.initialization,
                "segments": seg.media_segments,
                "mime_type": seg.mime_type,
                "segment_duration": seg.segment_duration,
                "base_url": seg.base_url,
            },
        )

    def _guess_title(self, url: str) -> str:
        parsed = urlparse(url)
        path = parsed.path or ""
        name = path.split("/")[-1]
        if name:
            return name
        return "dash_stream"
