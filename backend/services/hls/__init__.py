"""HLS 流媒体：基于关键帧的分段、播放列表生成与分片服务；可选 ffmpeg 生成并缓存标准 HLS。"""
from .keyframes import get_segment_list
from .playlist import build_m3u8
from .serve import read_segment, get_segment_range
from .ffmpeg_cache import (
    ensure_cache,
    read_cached_playlist,
    get_cached_segment_path,
)

__all__ = [
    "get_segment_list",
    "build_m3u8",
    "read_segment",
    "get_segment_range",
    "ensure_cache",
    "read_cached_playlist",
    "get_cached_segment_path",
]
