"""应用配置：config 文件存储媒体库路径与可选的 ffmpeg/ffprobe 路径；数据库路径固定并自动创建。

- 数据库路径：固定为 backend/media.db，由 SQLite 自动创建
- 媒体库路径：支持多个，由用户在 config 中配置；不存在的路径扫描时跳过
- ffmpeg_path / ffprobe_path：可选，未配置时使用环境变量 FFMPEG_PATH/FFPROBE_PATH，否则使用 "ffmpeg"/"ffprobe"
- 启动时自检 ffprobe 是否可用，用于 HLS 精确时长；不可用时退化为固定 #EXTINF:4.0
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Callable

BASE_DIR = Path(__file__).resolve().parent
CONFIG_FILE = Path(os.getenv("CONFIG_FILE", str(BASE_DIR / "config.json")))

# 固定数据库路径，自动创建（SQLite 会在首次连接时创建文件）
DB_PATH = (BASE_DIR / "media.db").resolve()
DATABASE_URL = f"sqlite:///{DB_PATH}"


class Config:
    """应用配置。媒体库路径与 ffmpeg/ffprobe 路径可编辑并持久化到 config 文件。"""

    DB_PATH: Path = DB_PATH
    DATABASE_URL: str = DATABASE_URL

    def __init__(self) -> None:
        self._media_roots: list[str] = []
        self._ffmpeg_path: str | None = None
        self._ffprobe_path: str | None = None
        self._on_change_callbacks: list[Callable[[], None]] = []
        # 启动自检结果：是否可用 ffprobe 获取时长（未检或不可用时为 False）
        self._ffprobe_available: bool = False

    @property
    def media_roots(self) -> list[str]:
        return list(self._media_roots)

    @property
    def ffmpeg_path(self) -> str:
        """ffmpeg 可执行路径；未配置时用环境变量 FFMpeg_PATH，否则 "ffmpeg"。"""
        if self._ffmpeg_path is not None and self._ffmpeg_path.strip():
            return self._ffmpeg_path.strip()
        return os.environ.get("FFMPEG_PATH", "ffmpeg")

    @property
    def ffprobe_path(self) -> str:
        """ffprobe 可执行路径；未配置时用环境变量 FFPROBE_PATH，否则 "ffprobe"。"""
        if self._ffprobe_path is not None and self._ffprobe_path.strip():
            return self._ffprobe_path.strip()
        return os.environ.get("FFPROBE_PATH", "ffprobe")

    @property
    def ffprobe_available(self) -> bool:
        """启动自检后 ffprobe 是否可用；为 True 时 m3u8 使用 ffprobe 获取精确时长。"""
        return self._ffprobe_available

    def set_ffprobe_available(self, value: bool) -> None:
        """设置启动自检结果（由 ffprobe_util 在启动时调用）。"""
        self._ffprobe_available = value

    def load_from_file(self) -> None:
        """从 config 文件加载 media_roots 与可选的 ffmpeg_path/ffprobe_path。"""
        if not CONFIG_FILE.exists():
            return
        try:
            raw = CONFIG_FILE.read_text(encoding="utf-8")
            data = json.loads(raw)
        except (json.JSONDecodeError, OSError):
            return
        if isinstance(data.get("media_roots"), list):
            self._media_roots = [str(x).strip() for x in data["media_roots"] if str(x).strip()]
        if "ffmpeg_path" in data and data["ffmpeg_path"] is not None:
            self._ffmpeg_path = str(data["ffmpeg_path"]).strip() or None
        if "ffprobe_path" in data and data["ffprobe_path"] is not None:
            self._ffprobe_path = str(data["ffprobe_path"]).strip() or None

    def save_to_file(self) -> None:
        """将当前 media_roots 与可选的 ffmpeg_path/ffprobe_path 写入 config 文件。"""
        data: dict = {"media_roots": self._media_roots}
        if self._ffmpeg_path is not None:
            data["ffmpeg_path"] = self._ffmpeg_path
        if self._ffprobe_path is not None:
            data["ffprobe_path"] = self._ffprobe_path
        CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        CONFIG_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def update(
        self,
        *,
        media_roots: list[str] | None = None,
        ffmpeg_path: str | None = None,
        ffprobe_path: str | None = None,
    ) -> None:
        """更新配置并写回文件，然后触发变更回调。传入 None 的键不修改。"""
        if media_roots is not None:
            self._media_roots = [str(x).strip() for x in media_roots if str(x).strip()]
        if ffmpeg_path is not None:
            self._ffmpeg_path = str(ffmpeg_path).strip() or None
        if ffprobe_path is not None:
            self._ffprobe_path = str(ffprobe_path).strip() or None
        self.save_to_file()
        self._notify_change()

    def add_on_change(self, callback: Callable[[], None]) -> None:
        """注册配置变更回调。"""
        self._on_change_callbacks.append(callback)

    def _notify_change(self) -> None:
        for cb in self._on_change_callbacks:
            try:
                cb()
            except Exception:  # noqa: BLE001
                pass

    SECRET_KEY: str = os.getenv("SECRET_KEY", "dev-secret-change-me")
    SCAN_ON_STARTUP: bool = os.getenv("SCAN_ON_STARTUP", "1") == "1"
    HLS_SEGMENT_BYTES: int = int(os.getenv("HLS_SEGMENT_BYTES", str(2 * 1024 * 1024)))
    # 日志级别：环境变量 LOG_LEVEL，可选 DEBUG / INFO / WARNING / ERROR，默认 INFO
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO").upper()


config = Config()
config.load_from_file()
