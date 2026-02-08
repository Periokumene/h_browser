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


def _is_local_path(s: Optional[str]) -> bool:
    """判断是否为本地路径（非 URL、非空），用于决定是否采用 NFO 中的 thumb/fanart 值。"""
    if not s or not s.strip():
        return False
    s = s.strip()
    if s.startswith("http://") or s.startswith("https://"):
        return False
    return True


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

    # 海报：优先从明确标记为 poster 的字段获取
    for poster_el in (
        root.find("poster"),
        root.find('thumb[@aspect="poster"]'),
        root.find('thumb[@type="poster"]'),
    ):
        if poster_el is not None:
            t = _text(poster_el)
            if _is_local_path(t):
                meta.poster_path = t
                break

    # 缩略图：优先从明确标记为 thumb/thumbnail 的字段获取（排除已用于 poster 的）
    # 先尝试 <thumbnail>
    thumbnail_el = root.find("thumbnail")
    if thumbnail_el is not None:
        t = _text(thumbnail_el)
        if _is_local_path(t):
            meta.thumb = t
    # 如果 thumb 未设置，再尝试所有 <thumb>（跳过已用于 poster 的）
    if not meta.thumb:
        for thumb_el in root.findall("thumb"):
            # 跳过已用于 poster 的 thumb（aspect="poster" 或 type="poster"）
            if thumb_el.get("aspect") == "poster" or thumb_el.get("type") == "poster":
                continue
            t = _text(thumb_el)
            if _is_local_path(t):
                meta.thumb = t
                break

    # fanart：<fanart> 或 <fanart><thumb>...</thumb></fanart>
    fanart = root.find("fanart")
    if fanart is not None:
        first = fanart.find("thumb") or fanart
        t = _text(first) if first is not None else _text(fanart)
        if _is_local_path(t):
            meta.fanart_path = t

    return meta


def _resolve_art_path(
    nfo_dir: Path,
    candidate: Optional[str],
    code: str,
    fallback_names: tuple[str, ...],
) -> Optional[Path]:
    """先尝试 candidate（相对/绝对），不存在则按 fallback_names 在同目录查找。"""
    if candidate:
        c = candidate.strip()
        p = Path(c)
        if p.is_absolute():
            if p.exists():
                return p
        else:
            resolved = (nfo_dir / c).resolve()
            if resolved.exists():
                return resolved
    for name in fallback_names:
        path = nfo_dir / name
        if path.exists():
            return path
    return None


def _poster_fallback_names(code: str) -> tuple[str, ...]:
    return (
        f"{code}-poster.jpg",
        f"{code}-poster.png",
        f"{code}-thumb.jpg",
        f"{code}-thumb.png",
        "poster.jpg",
        "poster.png",
        "poster.jpeg",
        "poster.webp",
        f"{code}.jpg",
        f"{code}.png",
        "thumb.jpg",
        "folder.jpg",
    )


def _fanart_fallback_names(code: str) -> tuple[str, ...]:
    return (
        f"{code}-fanart.jpg",
        f"{code}-fanart.png",
        "fanart.jpg",
        "fanart.png",
        "fanart.jpeg",
    )


def _thumb_fallback_names(code: str) -> tuple[str, ...]:
    return (
        f"{code}-thumb.jpg",
        f"{code}-thumb.png",
        f"{code}-poster.jpg",
        f"{code}-poster.png",
        "thumb.jpg",
        "poster.jpg",
        "folder.jpg",
    )


def get_poster_path(nfo_path: Path, code: str, metadata: VideoMetadata) -> Optional[Path]:
    """根据 NFO 路径、番号与已解析元数据，解析出海报文件的绝对路径。"""
    nfo_dir = nfo_path.parent.resolve()
    candidate = metadata.poster_path or metadata.thumb
    return _resolve_art_path(nfo_dir, candidate, code, _poster_fallback_names(code))


def get_fanart_path(nfo_path: Path, code: str, metadata: VideoMetadata) -> Optional[Path]:
    """解析 fanart 图片绝对路径，约定同目录 {code}-fanart.jpg 等。"""
    nfo_dir = nfo_path.parent.resolve()
    return _resolve_art_path(
        nfo_dir, metadata.fanart_path, code, _fanart_fallback_names(code)
    )


def get_thumb_path(nfo_path: Path, code: str, metadata: VideoMetadata) -> Optional[Path]:
    """解析 thumb 缩略图绝对路径，约定同目录 {code}-thumb.jpg、{code}-poster.jpg 等。"""
    nfo_dir = nfo_path.parent.resolve()
    candidate = metadata.thumb or metadata.poster_path
    return _resolve_art_path(nfo_dir, candidate, code, _thumb_fallback_names(code))


def update_nfo_genres_tags(nfo_path: Path, genres: List[str], tags: List[str]) -> None:
    """将类型（genres）与标签（tags）写回 NFO 文件，保留其余节点不变。

    - <genre> 与 <tag> 作为根元素（如 <movie>）的直接子元素，结构正确。
    - 写回前对整棵树做缩进，使每个元素单独成行、格式统一美观。
    """
    if not nfo_path.exists():
        raise FileNotFoundError(f"NFO 不存在: {nfo_path}")
    try:
        tree = ET.parse(nfo_path)
        root = tree.getroot()
    except Exception as exc:
        logger.warning("解析 NFO 失败（写回前）: %s (%s)", nfo_path, exc)
        raise

    # 移除已有的 genre/tag，避免重复或顺序错乱
    for el in list(root.findall("genre")):
        root.remove(el)
    for el in list(root.findall("tag")):
        root.remove(el)

    # 在根节点下追加：先所有 genre，再所有 tag（均为根的直接子项）
    for g in genres:
        if g and str(g).strip():
            el = ET.SubElement(root, "genre")
            el.text = str(g).strip()
    for t in tags:
        if t and str(t).strip():
            el = ET.SubElement(root, "tag")
            el.text = str(t).strip()

    # 统一缩进，使每个子元素单独成行、不堆在一行
    ET.indent(tree, space="    ", level=0)

    # 使用 str(path) 确保跨平台（尤其 Windows）正确写回
    tree.write(
        str(nfo_path),
        encoding="utf-8",
        xml_declaration=True,
        default_namespace=None,
        method="xml",
    )


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
