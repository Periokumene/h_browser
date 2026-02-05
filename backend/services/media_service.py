"""媒体库统一数据访问服务。

提供统一的接口访问媒体数据，封装数据库读写与磁盘/NFO 读取，便于未来扩展缓存、增量同步等功能。

职责划分：
- 数据库操作：MediaItem、Genre、Tag 的 CRUD
- 磁盘操作：NFO 解析、视频文件查找、海报路径解析
- 数据同步：磁盘 → 数据库的同步逻辑
- 元数据获取：统一返回完整元数据（DB + NFO）
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session

from ..models import Genre, MediaItem, Tag
from .metadata import (
    ActorInfo,
    VideoMetadata,
    get_fanart_path,
    get_poster_path,
    get_thumb_path,
    parse_nfo,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# 磁盘操作：文件查找、NFO 解析
# ---------------------------------------------------------------------------


def find_video_file(nfo_dir: Path, code: str) -> Optional[Path]:
    """在同目录下根据番号查找对应视频文件（mp4 / ts）。"""
    for ext in (".mp4", ".ts"):
        candidate = nfo_dir / f"{code}{ext}"
        if candidate.exists():
            return candidate
    return None


def get_file_info(file_path: Optional[Path]) -> tuple[Optional[datetime], Optional[int]]:
    """获取文件的 mtime 和 size。"""
    if file_path is None or not file_path.exists():
        return None, None
    try:
        stat = file_path.stat()
        mtime = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
        size = stat.st_size
        return mtime, size
    except OSError:
        return None, None


def load_metadata_from_nfo(nfo_path: Path) -> Optional[VideoMetadata]:
    """从 NFO 文件加载元数据。"""
    if not nfo_path.exists():
        return None
    try:
        return parse_nfo(nfo_path)
    except Exception as exc:  # noqa: BLE001
        logger.warning("解析 NFO 失败: %s (%s)", nfo_path, exc)
        return None


# ---------------------------------------------------------------------------
# 数据库操作：Genre/Tag 辅助
# ---------------------------------------------------------------------------


def get_or_create_genre(session: Session, name: str) -> Genre:
    """获取或创建 Genre 对象。"""
    genre = session.query(Genre).filter(Genre.name == name).first()
    if genre is None:
        genre = Genre(name=name)
        session.add(genre)
        session.flush()  # 获取 ID
    return genre


def get_or_create_tag(session: Session, name: str) -> Tag:
    """获取或创建 Tag 对象。"""
    tag = session.query(Tag).filter(Tag.name == name).first()
    if tag is None:
        tag = Tag(name=name)
        session.add(tag)
        session.flush()  # 获取 ID
    return tag


# ---------------------------------------------------------------------------
# 数据库操作：MediaItem CRUD
# ---------------------------------------------------------------------------


def get_item_by_code(session: Session, code: str) -> Optional[MediaItem]:
    """从数据库根据番号获取 MediaItem。"""
    return session.query(MediaItem).filter(MediaItem.code == code).one_or_none()


def create_or_update_item(
    session: Session,
    code: str,
    nfo_path: Path,
    video_path: Optional[Path] = None,
    metadata: Optional[VideoMetadata] = None,
    file_mtime: Optional[datetime] = None,
    file_size: Optional[int] = None,
    last_scanned_at: Optional[datetime] = None,
) -> MediaItem:
    """创建或更新 MediaItem，并同步 genres/tags 关联。

    参数：
    - code: 番号
    - nfo_path: NFO 文件路径
    - video_path: 视频文件路径（可选）
    - metadata: 元数据（可选，用于 genres/tags）
    - file_mtime, file_size: 文件信息（可选）
    - last_scanned_at: 扫描时间（可选，默认当前时间）

    返回：创建或更新后的 MediaItem（已 flush，有 ID）。
    """
    if last_scanned_at is None:
        last_scanned_at = datetime.now(timezone.utc)

    item = get_item_by_code(session, code)
    is_new = item is None

    if item is None:
        # 新建时必填字段须在 flush 前设置，否则 INSERT 触发 NOT NULL 约束失败
        item = MediaItem(code=code, nfo_path=str(nfo_path))
        session.add(item)
        session.flush()  # 确保新 item 有 ID，才能操作关联关系

    # 更新基本字段
    item.nfo_path = str(nfo_path)
    item.video_path = str(video_path) if video_path is not None else None
    item.video_type = video_path.suffix.lstrip(".") if video_path is not None else None
    item.file_size = file_size
    item.file_mtime = file_mtime
    item.last_scanned_at = last_scanned_at

    # 更新 title/description（优先从 metadata，否则从 NFO 简单解析）
    if metadata:
        if metadata.title:
            item.title = metadata.title
        if metadata.plot:
            item.description = metadata.plot
    else:
        # 简单解析 title/plot（避免重复 parse_nfo）
        try:
            import xml.etree.ElementTree as ET
            tree = ET.parse(nfo_path)
            root = tree.getroot()
            title = root.findtext("title")
            plot = root.findtext("plot")
            if title:
                item.title = title
            if plot:
                item.description = plot
        except Exception:  # noqa: BLE001
            pass

    # 更新 genres/tags 关联
    if metadata:
        item.genres.clear()
        item.tags.clear()

        for genre_name in metadata.genres or []:
            if genre_name and genre_name.strip():
                genre = get_or_create_genre(session, genre_name.strip())
                item.genres.append(genre)

        for tag_name in metadata.tags or []:
            if tag_name and tag_name.strip():
                tag = get_or_create_tag(session, tag_name.strip())
                item.tags.append(tag)

    return item


# ---------------------------------------------------------------------------
# 统一元数据获取：DB + NFO
# ---------------------------------------------------------------------------


def get_item_full_metadata(session: Session, code: str) -> Optional[dict]:
    """获取完整的媒体元数据（数据库 + NFO）。

    返回字典包含：
    - db_item: MediaItem 对象（或 None）
    - nfo_metadata: VideoMetadata 对象（或 None，如果 NFO 存在且解析成功）
    - nfo_path: Path 对象（或 None）
    - video_path: Path 对象（或 None）
    """
    item = get_item_by_code(session, code)
    if item is None:
        return None

    nfo_path = Path(item.nfo_path) if item.nfo_path else None
    video_path = Path(item.video_path) if item.video_path else None

    nfo_metadata = None
    if nfo_path and nfo_path.exists():
        nfo_metadata = load_metadata_from_nfo(nfo_path)

    return {
        "db_item": item,
        "nfo_metadata": nfo_metadata,
        "nfo_path": nfo_path,
        "video_path": video_path,
    }


def get_poster_path_for_item(session: Session, code: str) -> Optional[Path]:
    """获取指定番号的海报路径（从数据库读取 NFO 路径，解析海报）。"""
    full = get_item_full_metadata(session, code)
    if not full or not full["nfo_path"]:
        return None
    nfo_path = full["nfo_path"]
    metadata = full["nfo_metadata"]
    if metadata is None:
        metadata = load_metadata_from_nfo(nfo_path)
    if metadata is None:
        return None
    return get_poster_path(nfo_path, code, metadata)


def get_fanart_path_for_item(session: Session, code: str) -> Optional[Path]:
    """获取指定番号的 fanart 路径。"""
    full = get_item_full_metadata(session, code)
    if not full or not full["nfo_path"]:
        return None
    nfo_path = full["nfo_path"]
    metadata = full["nfo_metadata"]
    if metadata is None:
        metadata = load_metadata_from_nfo(nfo_path)
    if metadata is None:
        return None
    return get_fanart_path(nfo_path, code, metadata)


def get_thumb_path_for_item(session: Session, code: str) -> Optional[Path]:
    """获取指定番号的 thumb 路径。"""
    full = get_item_full_metadata(session, code)
    if not full or not full["nfo_path"]:
        return None
    nfo_path = full["nfo_path"]
    metadata = full["nfo_metadata"]
    if metadata is None:
        metadata = load_metadata_from_nfo(nfo_path)
    if metadata is None:
        return None
    return get_thumb_path(nfo_path, code, metadata)


# ---------------------------------------------------------------------------
# 磁盘 → 数据库同步
# ---------------------------------------------------------------------------


def sync_item_from_disk(
    session: Session,
    code: str,
    nfo_path: Path,
    last_scanned_at: Optional[datetime] = None,
) -> MediaItem:
    """从磁盘同步单个媒体条目到数据库。

    流程：
    1. 查找同目录视频文件
    2. 解析 NFO 元数据
    3. 获取文件信息（mtime, size）
    4. 创建或更新 MediaItem，同步 genres/tags

    返回：创建或更新后的 MediaItem。
    """
    nfo_dir = nfo_path.parent
    video_path = find_video_file(nfo_dir, code)

    # 确定用于 mtime/size 的目标文件（优先视频，否则 NFO）
    stat_target = video_path if video_path is not None else nfo_path
    file_mtime, file_size = get_file_info(stat_target)

    # 解析 NFO 元数据
    metadata = load_metadata_from_nfo(nfo_path)

    # 创建或更新数据库条目
    return create_or_update_item(
        session=session,
        code=code,
        nfo_path=nfo_path,
        video_path=video_path,
        metadata=metadata,
        file_mtime=file_mtime,
        file_size=file_size,
        last_scanned_at=last_scanned_at,
    )
