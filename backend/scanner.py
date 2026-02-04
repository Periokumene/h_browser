"""媒体库扫描：遍历 MEDIA_ROOT，收集 .nfo、解析元数据、匹配同目录 .mp4/.ts，写入 media_items。

- 以 .nfo 文件名为番号（code），同目录下 {code}.mp4 或 {code}.ts 为视频
- NFO 解析：XML 中 <title>、<plot> 写入 title、description
- 同一次扫描内相同番号只保留第一次出现的 NFO，避免 UNIQUE 冲突
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional
import logging
import xml.etree.ElementTree as ET

from .config import config
from .models import Genre, MediaItem, Tag
from .services.metadata import parse_nfo


logger = logging.getLogger(__name__)

# 模板文件名黑名单：这些文件名不应被当作番号处理
_TEMPLATE_NFO_NAMES = {
    "movie",
    "template",
    "sample",
    "example",
    "test",
    "default",
    "blank",
}


def _is_template_nfo(nfo_path: Path) -> bool:
    """判断是否为模板 NFO 文件（如 movie.nfo、template.nfo），应跳过。"""
    stem = nfo_path.stem.lower()
    return stem in _TEMPLATE_NFO_NAMES


def _parse_nfo(nfo_path: Path) -> tuple[Optional[str], Optional[str]]:
    """解析 NFO 文件，返回 (title, description)。

    NFO 格式可能不统一，这里做宽松解析：
    - 优先尝试 XML 中的 <title> 与 <plot>
    - 若解析失败则返回 (None, None)
    """
    try:
        tree = ET.parse(nfo_path)
        root = tree.getroot()
        title = root.findtext("title")
        plot = root.findtext("plot")
        return title, plot
    except Exception as exc:  # noqa: BLE001
        logger.warning("解析 NFO 失败: %s (%s)", nfo_path, exc)
        return None, None


def _find_video_for_code(dir_path: Path, code: str) -> Optional[Path]:
    """在同目录下根据番号查找对应视频文件（mp4 / ts）。"""
    for ext in (".mp4", ".ts"):
        candidate = dir_path / f"{code}{ext}"
        if candidate.exists():
            return candidate
    return None


def _get_or_create_genre(session, name: str) -> Genre:
    """获取或创建 Genre 对象。"""
    genre = session.query(Genre).filter(Genre.name == name).first()
    if genre is None:
        genre = Genre(name=name)
        session.add(genre)
        session.flush()  # 获取 ID
    return genre


def _get_or_create_tag(session, name: str) -> Tag:
    """获取或创建 Tag 对象。"""
    tag = session.query(Tag).filter(Tag.name == name).first()
    if tag is None:
        tag = Tag(name=name)
        session.add(tag)
        session.flush()  # 获取 ID
    return tag


def scan_media(session, media_root: Optional[Path] = None) -> int:
    """扫描媒体目录，将 NFO + 视频信息写入数据库。

    返回本次扫描处理的条目数量。
    """
    if media_root is None:
        media_root = config.MEDIA_ROOT

    media_root = Path(media_root).resolve()
    if not media_root.exists():
        logger.warning("媒体根目录不存在: %s", media_root)
        return 0

    processed = 0
    now = datetime.now(timezone.utc)
    seen_codes: set[str] = set()

    for dirpath, _dirnames, filenames in os.walk(media_root):
        dir_path = Path(dirpath)
        nfo_files = [f for f in filenames if f.lower().endswith(".nfo")]
        if not nfo_files:
            continue

        for nfo_name in nfo_files:
            nfo_path = dir_path / nfo_name
            code = nfo_path.stem  # 去掉扩展名

            # 跳过模板文件（如 movie.nfo、template.nfo）
            if _is_template_nfo(nfo_path):
                logger.debug("跳过模板 NFO 文件: %s", nfo_path)
                continue

            # 同一次扫描中，如出现相同番号的多个 NFO，仅处理第一条，避免唯一约束冲突
            if code in seen_codes:
                logger.info("检测到重复番号 %s，跳过后续 NFO：%s", code, nfo_path)
                continue
            seen_codes.add(code)

            video_path = _find_video_for_code(dir_path, code)

            # 取 NFO 或视频的 mtime，作为增量更新依据
            try:
                stat_target = video_path if video_path is not None else nfo_path
                stat = stat_target.stat()
                file_mtime = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
                file_size = stat.st_size
            except OSError:
                file_mtime = None
                file_size = None

            title, description = _parse_nfo(nfo_path)

            item: Optional[MediaItem] = (
                session.query(MediaItem).filter(MediaItem.code == code).one_or_none()
            )

            if item is None:
                item = MediaItem(code=code)
                session.add(item)
                session.flush()  # 确保新 item 有 ID，才能操作关联关系

            item.nfo_path = str(nfo_path)
            item.video_path = str(video_path) if video_path is not None else None
            item.video_type = (
                video_path.suffix.lstrip(".") if video_path is not None else None
            )
            item.file_size = file_size
            item.file_mtime = file_mtime
            item.last_scanned_at = now

            if title:
                item.title = title
            if description:
                item.description = description

            # 解析并更新 genre/tag 关联关系
            try:
                metadata = parse_nfo(nfo_path)
                if metadata:
                    # 清空现有关联，重新设置（需要 item 有 ID）
                    item.genres.clear()
                    item.tags.clear()

                    # 添加 genres
                    for genre_name in metadata.genres or []:
                        if genre_name and genre_name.strip():
                            genre = _get_or_create_genre(session, genre_name.strip())
                            item.genres.append(genre)

                    # 添加 tags
                    for tag_name in metadata.tags or []:
                        if tag_name and tag_name.strip():
                            tag = _get_or_create_tag(session, tag_name.strip())
                            item.tags.append(tag)
            except Exception as exc:  # noqa: BLE001
                logger.debug("解析 NFO 元数据用于筛选失败 %s: %s", nfo_path, exc)

            processed += 1

    session.commit()
    logger.info("扫描完成，共处理 %s 条媒体记录", processed)
    return processed

