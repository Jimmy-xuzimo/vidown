"""测试：配置加载与默认值。"""

from __future__ import annotations

import json

import pytest

from vidown.core.config import (
    Config,
    QualityConfig,
    load_config,
    save_config,
)


class TestQualityConfig:
    def test_defaults(self):
        q = QualityConfig()
        assert q.force_codec == "h264"
        assert q.video_crf == 18
        assert q.audio_bitrate == "320k"


class TestConfigJson:
    def test_round_trip(self):
        cfg = Config()
        s = cfg.to_json()
        loaded = json.loads(s)
        assert loaded["quality"]["force_codec"] == "h264"

    def test_save_and_load(self, tmp_path):
        cfg = Config()
        cfg.quality.video_crf = 23
        path = tmp_path / "cfg.json"
        save_config(cfg, path)
        loaded = load_config(path)
        assert loaded.quality.video_crf == 23

    def test_load_yaml(self, tmp_path):
        yaml_text = """
general:
  download_dir: "/tmp/vid"
quality:
  video_crf: 20
  force_codec: hevc
"""
        if not _has_yaml():
            pytest.skip("PyYAML 未安装")
        path = tmp_path / "cfg.yaml"
        path.write_text(yaml_text)
        loaded = load_config(path)
        assert loaded.quality.video_crf == 20
        assert loaded.quality.force_codec == "hevc"

    def test_merge(self, tmp_path):
        base = Config()
        base.quality.video_crf = 18
        save_config(base, tmp_path / "base.json")

        override = {"quality": {"video_crf": 23}}
        (tmp_path / "override.json").write_text(json.dumps(override))

        loaded = load_config(tmp_path / "base.json")
        assert loaded.quality.video_crf == 18


def _has_yaml():
    try:
        import yaml  # noqa

        return True
    except ImportError:
        return False
