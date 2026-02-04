"""缩略图雪碧图：按视频文件夹存储，每个视频在其目录下拥有 sprites/ 子目录。

- 路径规则：视频所在目录 / sprites / thumbnails.vtt、sprite_0.jpg、sprite_1.jpg、...（多张雪碧图）。
- 完整性以 sprites/ 内 thumbnails.vtt 与 sprite_0.jpg 存在为准；进行中以 sprites/.generating 占位为准。

--- 与前端约定 ---
- 前端通过 GET /api/items/<code>/thumbnails 获取状态；200 时返回 vtt_url、sprite_url（指向首张雪碧图或 stream 目录）。
- VTT 内引用雪碧图使用相对路径（如 sprite_0.jpg#xywh=...），前端以 VTT 的 URL 所在目录为 baseUrl 解析。
"""
from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Optional

from .media_service import get_video_path_for_item

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

# 视频文件夹下的 sprites 子目录名
SPRITES_SUBDIR = "sprites"
# 固定文件名（与前端 stream 路由一致；VTT 内引用同目录 sprite 如 sprite_0.jpg#xywh=...）
VTT_FILENAME = "thumbnails.vtt"
SPRITE_INDEX_FILENAME = "sprite_{}.jpg"
# 占位文件：存在表示该视频的缩略图正在生成，前端收到 202 时可轮询
GENERATING_MARKER = ".generating"


def get_sprites_dir_for_code(session: "Session", code: str) -> Optional[Path]:
    """根据 code 解析视频路径，返回该视频文件夹下的 sprites 目录路径；无视频则返回 None。"""
    video_path = get_video_path_for_item(session, code, None)
    if not video_path:
        return None
    return video_path.parent / SPRITES_SUBDIR


def is_thumbnails_complete(session: "Session", code: str) -> bool:
    """该 code 的缩略图是否已完整生成：sprites 目录存在且 thumbnails.vtt 与 sprite_0.jpg 均存在。"""
    sprites_dir = get_sprites_dir_for_code(session, code)
    if not sprites_dir:
        return False
    return (sprites_dir / VTT_FILENAME).is_file() and (
        sprites_dir / SPRITE_INDEX_FILENAME.format(0)
    ).is_file()


def is_generating(session: "Session", code: str) -> bool:
    """该 code 是否正在生成缩略图：sprites/.generating 占位存在。"""
    sprites_dir = get_sprites_dir_for_code(session, code)
    if not sprites_dir:
        return False
    return (sprites_dir / GENERATING_MARKER).is_file()


def set_generating(sprites_dir: Path, creating: bool) -> None:
    """在指定 sprites 目录下创建或删除 .generating 占位。creating=True 创建，False 删除。"""
    path = sprites_dir / GENERATING_MARKER
    if creating:
        sprites_dir.mkdir(parents=True, exist_ok=True)
        path.touch()
    else:
        if path.is_file():
            try:
                path.unlink()
            except OSError:
                pass


def get_vtt_path_for_code(session: "Session", code: str) -> Optional[Path]:
    """若该 code 缩略图完整，返回其 VTT 文件路径，否则 None。"""
    sprites_dir = get_sprites_dir_for_code(session, code)
    if not sprites_dir:
        return None
    p = sprites_dir / VTT_FILENAME
    return p if p.is_file() else None


def get_sprite_path_for_code(
    session: "Session", code: str, index: int = 0
) -> Optional[Path]:
    """若该 code 对应索引的雪碧图存在，返回其路径，否则 None。index 为雪碧图序号（0 为第一张）。"""
    sprites_dir = get_sprites_dir_for_code(session, code)
    if not sprites_dir:
        return None
    p = sprites_dir / SPRITE_INDEX_FILENAME.format(index)
    return p if p.is_file() else None
