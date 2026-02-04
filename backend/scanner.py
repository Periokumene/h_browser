"""媒体库扫描入口：从 media_service 导出 scan_media，保持向后兼容。"""
from __future__ import annotations

from .services.media_service import scan_media

__all__ = ["scan_media"]
