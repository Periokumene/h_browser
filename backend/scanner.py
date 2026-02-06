"""媒体库扫描：遍历多个媒体库路径，收集 .nfo、解析元数据、匹配同目录 .mp4/.ts，统一写入同一 media.db。

- 以 .nfo 文件名为番号（code），同目录下 {code}.mp4 或 {code}.ts 为视频
- 使用 media_service 统一的数据访问层进行磁盘扫描与数据库同步
- 不存在的媒体库路径会跳过（容错），不引起错误
- 番号重复时（同一扫描内或跨路径）只保留第一次出现的 NFO
"""
from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import logging

from .config import config
from .services.media_service import sync_item_from_disk

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


def _scan_one_root(session, media_root: Path, now: datetime, seen_codes: set[str]) -> int:
    """扫描单个媒体根目录，将 NFO + 视频信息写入当前 session。返回本路径处理条数。"""
    processed = 0
    for dirpath, _dirnames, filenames in os.walk(media_root):
        dir_path = Path(dirpath)
        nfo_files = [f for f in filenames if f.lower().endswith(".nfo")]
        if not nfo_files:
            continue

        for nfo_name in nfo_files:
            nfo_path = dir_path / nfo_name
            code = nfo_path.stem

            if _is_template_nfo(nfo_path):
                logger.debug("跳过模板 NFO 文件: %s", nfo_path)
                continue

            if code in seen_codes:
                logger.info("检测到重复番号 %s，跳过后续 NFO：%s", code, nfo_path)
                continue
            seen_codes.add(code)

            try:
                sync_item_from_disk(session, code, nfo_path, last_scanned_at=now)
                processed += 1
            except Exception as exc:  # noqa: BLE001
                logger.warning("同步媒体条目失败 %s: %s", nfo_path, exc)

    return processed


def scan_media(session, media_roots: Optional[list[str | Path]] = None) -> int:
    """扫描媒体目录（可多个），将 NFO + 视频信息统一写入数据库。

    - media_roots 为 None 时使用 config.media_roots
    - 不存在的路径会记录警告并跳过，不抛错
    - 番号重复时只保留第一次出现的条目
    返回本次扫描处理的条目总数。
    """
    if media_roots is None:
        media_roots = config.media_roots

    now = datetime.now(timezone.utc)
    seen_codes: set[str] = set()
    total = 0

    for raw in media_roots:
        root = Path(raw).resolve()
        if not root.exists():
            logger.warning("媒体库路径不存在，已跳过: %s", root)
            continue
        total += _scan_one_root(session, root, now, seen_codes)

    session.commit()
    logger.info("扫描完成，共处理 %s 条媒体记录", total)
    return total

