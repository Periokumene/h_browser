"""媒体库扫描：遍历 MEDIA_ROOT，收集 .nfo、解析元数据、匹配同目录 .mp4/.ts，写入 media_items。

- 以 .nfo 文件名为番号（code），同目录下 {code}.mp4 或 {code}.ts 为视频
- 使用 media_service 统一的数据访问层进行磁盘扫描与数据库同步
- 同一次扫描内相同番号只保留第一次出现的 NFO，避免 UNIQUE 冲突
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

            # 使用统一的服务层同步磁盘到数据库
            try:
                sync_item_from_disk(session, code, nfo_path, last_scanned_at=now)
                processed += 1
            except Exception as exc:  # noqa: BLE001
                logger.warning("同步媒体条目失败 %s: %s", nfo_path, exc)

    session.commit()
    logger.info("扫描完成，共处理 %s 条媒体记录", processed)
    return processed

