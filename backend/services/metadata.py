"""视频元数据读写模块。

- 基于 .nfo 文件读写，兼容常见 Kodi/Ember 等 NFO 结构。
- 预定义接口：ActorInfo、VideoMetadata，便于前后端与未来缓存层复用。
- 预留通过「元数据提供者」抽象接入数据库缓存的扩展点，以改善性能。
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional
import xml.etree.ElementTree as ET

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# 接口定义（与 NFO 常见字段对应，便于未来 DB 缓存时复用）
# ---------------------------------------------------------------------------


@dataclass
class ActorInfo:
    """演员/演员信息。"""
    name: str = ""
    role: str = ""
    thumb: Optional[str] = None  # 头像路径（可为 URL 或相对路径）


@dataclass
class VideoMetadata:
    """视频元数据：标题、简介、评分、演员、海报路径等。"""
    title: Optional[str] = None
    plot: Optional[str] = None
    outline: Optional[str] = None
    rating: Optional[float] = None
    userrating: Optional[float] = None
    votes: Optional[int] = None
    year: Optional[int] = None
    premiered: Optional[str] = None
    released: Optional[str] = None
    runtime: Optional[int] = None  # 分钟
    genres: List[str] = field(default_factory=list)
    tags: List[str] = field(default_factory=list)
    country: Optional[str] = None
    director: Optional[str] = None
    studio: Optional[str] = None
    actors: List[ActorInfo] = field(default_factory=list)
    poster_path: Optional[str] = None   # 海报相对路径或绝对路径（来自 <thumb> 等）
    fanart_path: Optional[str] = None
    thumb: Optional[str] = None        # 通用缩略图


def _text(el: Optional[ET.Element]) -> Optional[str]:
    if el is None:
        return None
    t = (el.text or "").strip()
    return t if t else None


def _int_or_none(s: Optional[str]) -> Optional[int]:
    if s is None:
        return None
    try:
        return int(s.strip())
    except (ValueError, TypeError):
        return None


def _float_or_none(s: Optional[str]) -> Optional[float]:
    if s is None:
        return None
    try:
        return float(s.strip())
    except (ValueError, TypeError):
        return None


def parse_nfo(nfo_path: Path) -> VideoMetadata:
    """从 NFO 文件解析元数据。根节点支持 movie / movieinfo 等常见标签，缺失字段为 None 或空列表。"""
    meta = VideoMetadata()
    if not nfo_path.exists():
        return meta
    try:
        tree = ET.parse(nfo_path)
        root = tree.getroot()
    except Exception as exc:
        logger.warning("解析 NFO 失败: %s (%s)", nfo_path, exc)
        return meta

    # 单值文本
    meta.title = _text(root.find("title"))
    meta.plot = _text(root.find("plot"))
    meta.outline = _text(root.find("outline"))
    meta.rating = _float_or_none(_text(root.find("rating")))
    meta.userrating = _float_or_none(_text(root.find("userrating")))
    meta.votes = _int_or_none(_text(root.find("votes")))
    meta.year = _int_or_none(_text(root.find("year")))
    meta.premiered = _text(root.find("premiered"))
    meta.released = _text(root.find("released"))
    meta.runtime = _int_or_none(_text(root.find("runtime")))
    meta.country = _text(root.find("country"))
    meta.director = _text(root.find("director"))
    meta.studio = _text(root.find("studio"))

    # 多值：genre, tag
    for tag_name, attr in (("genre", "genres"), ("tag", "tags")):
        nodes = root.findall(tag_name)
        vals = []
        for n in nodes:
            t = _text(n)
            if t:
                vals.append(t)
        setattr(meta, attr, vals)

    # actor
    for actor_el in root.findall("actor"):
        name = _text(actor_el.find("name"))
        if not name:
            continue
        role = _text(actor_el.find("role")) or ""
        thumb = _text(actor_el.find("thumb"))
        meta.actors.append(ActorInfo(name=name, role=role, thumb=thumb))

    # 海报/缩略图：优先 aspect="poster" 或 type="poster" 的 thumb，否则第一个 thumb
    thumb_el = root.find('thumb[@aspect="poster"]') or root.find('thumb[@type="poster"]')
    if thumb_el is not None:
        meta.poster_path = _text(thumb_el)
    if not meta.poster_path:
        first_thumb = root.find("thumb")
        if first_thumb is not None:
            meta.poster_path = _text(first_thumb) or meta.thumb
            meta.thumb = meta.poster_path
    if not meta.poster_path:
        meta.thumb = _text(root.find("thumb"))

    fanart = root.find("fanart")
    if fanart is not None:
        # 有时 fanart 下有多张图，取第一张
        first = fanart.find("thumb") or fanart
        meta.fanart_path = _text(first) if first is not None else _text(fanart)

    return meta


def get_poster_path(nfo_path: Path, code: str, metadata: VideoMetadata) -> Optional[Path]:
    """根据 NFO 路径、番号与已解析元数据，解析出海报文件的绝对路径。

    - 若 metadata.poster_path 或 metadata.thumb 为相对路径，则相对于 NFO 所在目录。
    - 若为绝对路径则直接使用（需存在）。
    - 若 NFO 中无海报路径，则尝试同目录下常见文件名：poster.jpg, poster.png, {code}.jpg, {code}-poster.jpg。
    """
    nfo_dir = nfo_path.parent.resolve()
    candidate = metadata.poster_path or metadata.thumb
    if candidate:
        c = candidate.strip()
        p = Path(c)
        if p.is_absolute():
            if p.exists():
                return p
            return None
        # 相对路径
        resolved = (nfo_dir / c).resolve()
        if resolved.exists():
            return resolved

    # 常见文件名
    for name in (
        "poster.jpg",
        "poster.png",
        "poster.jpeg",
        "poster.webp",
        f"{code}.jpg",
        f"{code}.png",
        f"{code}-poster.jpg",
        "thumb.jpg",
        "folder.jpg",
    ):
        path = nfo_dir / name
        if path.exists():
            return path
    return None


# ---------------------------------------------------------------------------
# 可选：未来接入数据库缓存的提供者抽象（此处仅预留，不实现）
# ---------------------------------------------------------------------------
#
# class MetadataProvider(Protocol):
#     def get_metadata(self, code: str, nfo_path: Optional[str] = None) -> Optional[VideoMetadata]: ...
#
# class NfoMetadataProvider:
#     """当前实现：直接读 NFO 文件。"""
#     def get_metadata(self, code: str, nfo_path: Optional[str] = None) -> Optional[VideoMetadata]:
#         if not nfo_path or not Path(nfo_path).exists():
#             return None
#         return parse_nfo(Path(nfo_path))
#
# class CachedMetadataProvider:
#     """未来：先查 DB 缓存，未命中再读 NFO 并回写缓存。"""
#     pass
