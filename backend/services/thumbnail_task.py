"""缩略图生成任务：从视频抽帧、拼雪碧图、写 VTT，写入该视频文件夹下的 sprites/ 目录。

- 与 task_runner 配合，任务类型 gen_thumbnails。
- 流程：在视频目录下建 sprites/、创建 .generating 占位 → 抽帧 → 拼图 → 写 VTT → 原子重命名 → 删除占位。
"""
from __future__ import annotations

import logging
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Callable

from ..config import config
from ..models import MediaItem, session_scope
from .ffprobe import get_duration as ffprobe_get_duration
from .media_service import get_video_path_for_item
from .thumbnail_service import SPRITES_SUBDIR, VTT_FILENAME, is_thumbnails_complete, set_generating

logger = logging.getLogger(__name__)

_IS_WIN = sys.platform == "win32"
# 每多少秒取一帧
FRAME_INTERVAL_SEC = 5.0
# 单张缩略图宽高
THUMB_W = 160
THUMB_H = 90
# 单张雪碧图最多容纳的帧数（多张雪碧图时每张不超过此数）
MAX_FRAMES_PER_SPRITE = 200
# 雪碧图网格列数（行数 = ceil(帧数/列数)）
SPRITE_GRID_COLS = 10
# 多张雪碧图时的文件名格式：sprite_0.jpg, sprite_1.jpg, ...
SPRITE_INDEX_FILENAME = "sprite_{}.jpg"
# 临时文件后缀，成功后再原子重命名
TMP_SUFFIX = ".tmp"


def run_gen_thumbnails(
    task_id: str,
    payload: dict,
    put_event: Callable[[dict], None],
    is_cancelled: Callable[[], bool],
) -> None:
    """Worker 入口：为 payload.code 生成缩略图雪碧图与 VTT，写入 sprites 目录并更新 index。"""
    code = payload.get("code")
    if not code or not isinstance(code, str):
        put_event({"task_id": task_id, "status": "failed", "error": "payload 缺少 code"})
        return

    with session_scope() as session:
        video_path = get_video_path_for_item(session, code, None)
    if not video_path or not video_path.exists():
        put_event({"task_id": task_id, "status": "failed", "error": "未找到该编号的视频文件"})
        return

    if not config.ffprobe_available or not getattr(config, "ffmpeg_available", False):
        put_event({"task_id": task_id, "status": "failed", "error": "ffprobe/ffmpeg 不可用"})
        return

    duration = ffprobe_get_duration(video_path, config.ffprobe_path)
    if duration is None or duration <= 0:
        put_event({"task_id": task_id, "status": "failed", "error": "无法获取视频时长"})
        return

    sprites_dir = video_path.parent / SPRITES_SUBDIR
    set_generating(sprites_dir, creating=True)
    put_event({"task_id": task_id, "status": "running", "progress_pct": 0.0})

    try:
        _run_gen_thumbnails_impl(
            task_id=task_id,
            code=code,
            video_path=video_path,
            sprites_dir=sprites_dir,
            duration=duration,
            put_event=put_event,
            is_cancelled=is_cancelled,
        )
    finally:
        set_generating(sprites_dir, creating=False)


def _run_gen_thumbnails_impl(
    task_id: str,
    code: str,
    video_path: Path,
    sprites_dir: Path,
    duration: float,
    put_event: Callable[[dict], None],
    is_cancelled: Callable[[], bool],
    *,
    final_emit_success: bool = True,
) -> bool:
    """实际执行：抽帧 → 拼图 → 写 VTT → 原子重命名。成功返回 True，失败或取消返回 False。
    final_emit_success=False 时不发送 success/failed 事件（供「全部生成」任务内嵌调用）。"""
    temp_dir = sprites_dir / f".tmp_{task_id}"
    temp_dir.mkdir(parents=True, exist_ok=True)
    try:
        frames_dir = temp_dir / "frames"
        frames_dir.mkdir(exist_ok=True)
        # 1) ffmpeg 抽帧：每 FRAME_INTERVAL_SEC 秒一帧，缩放为 THUMB_WxTHUMB_H
        fps = 1.0 / FRAME_INTERVAL_SEC
        frame_pattern = str(frames_dir / "frame_%04d.jpg")
        cmd = [
            config.ffmpeg_path,
            "-y",
            "-i", str(video_path),
            "-vf", f"fps={fps},scale={THUMB_W}:{THUMB_H}",
            "-q:v", "2",
            frame_pattern,
        ]
        run_kw = {"stderr": subprocess.DEVNULL, "stdout": subprocess.DEVNULL}
        if _IS_WIN:
            run_kw["creationflags"] = subprocess.CREATE_NO_WINDOW
        proc = subprocess.run(cmd, **run_kw)
        if proc.returncode != 0:
            if final_emit_success:
                put_event({"task_id": task_id, "status": "failed", "error": "ffmpeg 抽帧失败"})
            return False
        if is_cancelled():
            if final_emit_success:
                put_event({"task_id": task_id, "status": "cancelled"})
            return False

        frame_files = sorted(frames_dir.glob("frame_*.jpg"))
        if not frame_files:
            if final_emit_success:
                put_event({"task_id": task_id, "status": "failed", "error": "未生成任何帧"})
            return False

        num_frames_total = len(frame_files)
        # 按 MAX_FRAMES_PER_SPRITE 分块，每块生成一张雪碧图（sprite_0.jpg, sprite_1.jpg, ...）
        from PIL import Image

        vtt_final = sprites_dir / VTT_FILENAME
        vtt_path_tmp = vtt_final.with_suffix(vtt_final.suffix + TMP_SUFFIX)
        vtt_lines = ["WEBVTT", ""]
        sprite_paths_tmp: list[Path] = []

        for chunk_start in range(0, num_frames_total, MAX_FRAMES_PER_SPRITE):
            if is_cancelled():
                for p in sprite_paths_tmp:
                    if p.exists():
                        p.unlink(missing_ok=True)
                if final_emit_success:
                    put_event({"task_id": task_id, "status": "cancelled"})
                return False

            chunk = frame_files[chunk_start : chunk_start + MAX_FRAMES_PER_SPRITE]
            num_in_chunk = len(chunk)
            chunk_index = chunk_start // MAX_FRAMES_PER_SPRITE
            cols = min(SPRITE_GRID_COLS, num_in_chunk)
            rows = (num_in_chunk + cols - 1) // cols if cols else 0
            sprite_w = THUMB_W * cols
            sprite_h = THUMB_H * rows

            images = []
            try:
                for p in chunk:
                    im = Image.open(p)
                    if im.mode != "RGB":
                        im = im.convert("RGB")
                    images.append(im)
            except Exception as e:
                for im in images:
                    im.close()
                logger.warning("打开或转换帧图失败: %s", e)
                if final_emit_success:
                    put_event({"task_id": task_id, "status": "failed", "error": f"帧图无效: {e}"})
                return False

            sprite = Image.new("RGB", (sprite_w, sprite_h))
            for i, im in enumerate(images):
                row, col = divmod(i, cols)
                sprite.paste(im, (col * THUMB_W, row * THUMB_H))
            for im in images:
                im.close()

            sprite_filename = SPRITE_INDEX_FILENAME.format(chunk_index)
            sprite_final = sprites_dir / sprite_filename
            sprite_path_tmp = sprite_final.with_suffix(sprite_final.suffix + TMP_SUFFIX)
            try:
                sprite.save(str(sprite_path_tmp), "JPEG", quality=85)
            except OSError as e:
                sprite.close()
                logger.warning("写入雪碧图失败: %s", e)
                if final_emit_success:
                    put_event({"task_id": task_id, "status": "failed", "error": f"写入雪碧图失败: {e}"})
                return False
            sprite.close()
            sprite_paths_tmp.append(sprite_path_tmp)

        put_event({"task_id": task_id, "progress_pct": 50.0})

        # 生成 VTT：每帧对应其所在雪碧图中的一格
        for i in range(num_frames_total):
            start_t = i * FRAME_INTERVAL_SEC
            end_t = min((i + 1) * FRAME_INTERVAL_SEC, duration)
            if start_t >= duration:
                break
            chunk_index = i // MAX_FRAMES_PER_SPRITE
            local_i = i % MAX_FRAMES_PER_SPRITE
            chunk_size = min(MAX_FRAMES_PER_SPRITE, num_frames_total - chunk_index * MAX_FRAMES_PER_SPRITE)
            cols = min(SPRITE_GRID_COLS, chunk_size)
            col = local_i % cols
            row = local_i // cols
            x = col * THUMB_W
            y = row * THUMB_H
            sprite_filename = SPRITE_INDEX_FILENAME.format(chunk_index)
            vtt_lines.append(f"{_sec_to_vtt(start_t)} --> {_sec_to_vtt(end_t)}")
            vtt_lines.append(f"{sprite_filename}#xywh={x},{y},{THUMB_W},{THUMB_H}")
            vtt_lines.append("")
        vtt_path_tmp.write_text("\n".join(vtt_lines), encoding="utf-8")

        if is_cancelled():
            vtt_path_tmp.unlink(missing_ok=True)
            for p in sprite_paths_tmp:
                if p.exists():
                    p.unlink(missing_ok=True)
            if final_emit_success:
                put_event({"task_id": task_id, "status": "cancelled"})
            return False

        # 原子重命名：先删旧版 sprite.jpg 与旧 sprite_*.jpg，再重命名所有临时文件
        old_single = sprites_dir / "sprite.jpg"
        if old_single.is_file():
            old_single.unlink()
        for old in sprites_dir.glob("sprite_*.jpg"):
            old.unlink()
        vtt_path_tmp.rename(vtt_final)
        for chunk_index, sprite_path_tmp in enumerate(sprite_paths_tmp):
            if sprite_path_tmp.exists():
                sprite_path_tmp.rename(sprites_dir / SPRITE_INDEX_FILENAME.format(chunk_index))

        if final_emit_success:
            put_event({
                "task_id": task_id,
                "status": "success",
                "progress_pct": 100.0,
                "result": str({"ok": True}),
            })
        return True
    except Exception as e:
        logger.exception("缩略图生成异常 code=%s: %s", code, e)
        if final_emit_success:
            put_event({"task_id": task_id, "status": "failed", "error": str(e)})
        return False
    finally:
        if temp_dir.exists():
            try:
                shutil.rmtree(temp_dir)
            except OSError as e:
                logger.warning("清理临时目录失败 %s: %s", temp_dir, e)


def _sec_to_vtt(sec: float) -> str:
    """将秒数转为 WebVTT 时间格式 HH:MM:SS.mmm。"""
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = sec % 60
    return f"{h:02d}:{m:02d}:{s:06.3f}"


def run_gen_all_thumbnails(
    task_id: str,
    payload: dict,
    put_event: Callable[[dict], None],
    is_cancelled: Callable[[], bool],
) -> None:
    """为所有尚未有缩略图的视频依次生成缩略图，并上报进度（done/total）。"""
    if not config.ffprobe_available or not getattr(config, "ffmpeg_available", False):
        put_event({"task_id": task_id, "status": "failed", "error": "ffprobe/ffmpeg 不可用"})
        return

    with session_scope() as session:
        all_codes = [row[0] for row in session.query(MediaItem.code).all()]
        to_process = [c for c in all_codes if not is_thumbnails_complete(session, c)]

    total = len(to_process)
    put_event({
        "task_id": task_id,
        "status": "running",
        "progress_pct": 0.0,
        "payload_merge": {"total": total, "done": 0, "current_code": None},
    })

    if total == 0:
        put_event({
            "task_id": task_id,
            "status": "success",
            "progress_pct": 100.0,
            "result": str({"ok": True, "done": 0, "total": 0, "failed": 0}),
        })
        return

    done = 0
    failed_count = 0
    for code in to_process:
        if is_cancelled():
            put_event({"task_id": task_id, "status": "cancelled"})
            return
        with session_scope() as session:
            video_path = get_video_path_for_item(session, code, None)
        if not video_path or not video_path.exists():
            continue
        duration = ffprobe_get_duration(video_path, config.ffprobe_path)
        if duration is None or duration <= 0:
            failed_count += 1
            done += 1
            pct = (done / total) * 100.0
            put_event({
                "task_id": task_id,
                "status": "running",
                "progress_pct": pct,
                "payload_merge": {"done": done, "total": total, "current_code": code},
            })
            continue
        sprites_dir = video_path.parent / SPRITES_SUBDIR
        set_generating(sprites_dir, creating=True)
        try:
            ok = _run_gen_thumbnails_impl(
                task_id=task_id,
                code=code,
                video_path=video_path,
                sprites_dir=sprites_dir,
                duration=duration,
                put_event=put_event,
                is_cancelled=is_cancelled,
                final_emit_success=False,
            )
            if not ok:
                if is_cancelled():
                    put_event({"task_id": task_id, "status": "cancelled"})
                    return
                failed_count += 1
        finally:
            set_generating(sprites_dir, creating=False)
        done += 1
        pct = (done / total) * 100.0
        put_event({
            "task_id": task_id,
            "status": "running",
            "progress_pct": pct,
            "payload_merge": {"done": done, "total": total, "current_code": code},
        })

    put_event({
        "task_id": task_id,
        "status": "success",
        "progress_pct": 100.0,
        "result": str({"ok": True, "done": done, "total": total, "failed": failed_count}),
    })
