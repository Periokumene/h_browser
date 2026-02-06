"""应用配置：config 文件仅存储媒体库路径列表；数据库路径固定并自动创建。

- 数据库路径：固定为 backend/media.db，由 SQLite 自动创建
- 媒体库路径：支持多个，由用户在 config 中配置；不存在的路径扫描时跳过
- 编辑 config 后通过通知回调可触发必要的刷新
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
    """应用配置。仅媒体库路径可编辑并持久化到 config 文件。"""

    DB_PATH: Path = DB_PATH
    DATABASE_URL: str = DATABASE_URL

    def __init__(self) -> None:
        self._media_roots: list[str] = []
        self._on_change_callbacks: list[Callable[[], None]] = []

    @property
    def media_roots(self) -> list[str]:
        return list(self._media_roots)

    def load_from_file(self) -> None:
        """从 config 文件加载 media_roots；文件不存在或无该键时保持空列表。"""
        if not CONFIG_FILE.exists():
            return
        try:
            raw = CONFIG_FILE.read_text(encoding="utf-8")
            data = json.loads(raw)
        except (json.JSONDecodeError, OSError):
            return
        if isinstance(data.get("media_roots"), list):
            self._media_roots = [str(x).strip() for x in data["media_roots"] if str(x).strip()]

    def save_to_file(self) -> None:
        """将当前 media_roots 写入 config 文件。"""
        data = {"media_roots": self._media_roots}
        CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        CONFIG_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def update(self, *, media_roots: list[str] | None = None) -> None:
        """更新媒体库路径并写回文件，然后触发变更回调。"""
        if media_roots is not None:
            self._media_roots = [str(x).strip() for x in media_roots if str(x).strip()]
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


config = Config()
config.load_from_file()
