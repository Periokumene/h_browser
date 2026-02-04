"""ffmpeg 可用性检查与 TS→MP4 转换（Beta）。转换成功后校验 MP4，通过则更新 DB 并删除 TS。"""
from __future__ import annotations

import logging
import os
import re
import subprocess
import sys
from collections import deque
from pathlib import Path
from typing import Callable

from ..config import config
from ..models import MediaItem, session_scope
from .ffprobe import get_duration, validate_mp4_after_convert
from .media_service import get_file_info, get_video_path_for_item

logger = logging.getLogger(__name__)

_IS_WIN = sys.platform == "win32"
CHECK_TIMEOUT_SEC = 2.0

# ffmpeg stderr 中 time= 格式，如 time=00:01:23.45
_RE_TIME = re.compile(r"time=(\d+):(\d+):(\d+)\.?(\d*)")

# 失败时保留的 stderr 行数 / 最大字符数，便于写入 task.error 与日志
_FFMPEG_STDERR_TAIL_LINES = 25
_FFMPEG_STDERR_MAX_CHARS = 1200


def _normalize_exit_code(returncode: int) -> tuple[int, str]:
    """将 Windows 下的无符号 DWORD 转为可读描述。返回 (原始码, 用于展示的字符串)。"""
    if returncode is None:
        return 0, "未知"
    if 0 <= returncode <= 0x7FFFFFFF:
        return returncode, str(returncode)
    # Windows 常见：无符号 DWORD，如 4294967274 即 -22（进程被终止或异常退出）
    signed = returncode - 2**32
    return returncode, f"{signed} (原始 {returncode}，可能为进程被终止或异常退出)"

def check_ffmpeg_available(ffmpeg_path: str | None = None, timeout_sec: float = CHECK_TIMEOUT_SEC) -> bool:
    """自检 ffmpeg 是否可用（执行 -version）。"""
    path = ffmpeg_path or config.ffmpeg_path
    kwargs: dict = {"capture_output": True, "timeout": timeout_sec}
    if _IS_WIN:
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
    try:
        result = subprocess.run([path, "-version"], **kwargs)
        ok = result.returncode == 0
        if not ok:
            logger.info("ffmpeg 自检失败: returncode=%s, path=%s", result.returncode, path)
        return ok
    except FileNotFoundError:
        logger.info("ffmpeg 未找到: %s", path)
        return False
    except subprocess.TimeoutExpired:
        logger.warning("ffmpeg 自检超时 (%ss): %s", timeout_sec, path)
        return False
    except Exception as e:  # noqa: BLE001
        logger.info("ffmpeg 自检异常: %s", e)
        return False


def _parse_time_to_seconds(match: re.Match) -> float:
    h, m, s = int(match.group(1)), int(match.group(2)), int(match.group(3))
    frac = match.group(4)
    if frac:
        s += int(frac.ljust(2, "0")[:2]) / 100.0
    return h * 3600 + m * 60 + s


def run_ts_to_mp4(
    task_id: str,
    payload: dict,
    put_event: Callable[[dict], None],
    is_cancelled: Callable[[], bool],
) -> None:
    """
    在 worker 线程中执行：将 code 对应的 TS 转为 MP4，先写临时文件再原子更名。
    仅读取 TS，绝不修改或写入 TS。put_event 用于上报进度与结果。
    """
    code = payload.get("code")
    if not code or not isinstance(code, str):
        put_event({"task_id": task_id, "status": "failed", "error": "payload 缺少 code"})
        return

    overwrite = payload.get("overwrite", True)

    with session_scope() as session:
        ts_path = get_video_path_for_item(session, code, "ts")
    if not ts_path or not ts_path.exists():
        put_event({"task_id": task_id, "status": "failed", "error": "未找到该编号的 TS 文件"})
        return

    if not check_ffmpeg_available():
        put_event({"task_id": task_id, "status": "failed", "error": "ffmpeg 未安装或不可用"})
        return

    out_dir = ts_path.parent
    final_mp4 = out_dir / f"{code}.mp4"
    # 临时文件必须以 .mp4 结尾，否则部分环境/ffmpeg 会按非 MP4 处理
    temp_path = out_dir / f"{code}.tmp.mp4"

    if final_mp4.exists() and not overwrite:
        put_event({"task_id": task_id, "status": "failed", "error": "已存在 MP4，未选择覆盖"})
        return

    put_event({"task_id": task_id, "status": "running", "payload_merge": {"temp_file_path": str(temp_path)}})

    total_duration: float | None = None
    if config.ffprobe_available:
        total_duration = get_duration(ts_path, config.ffprobe_path)
    if total_duration is None or total_duration <= 0:
        total_duration = None

    try:
        cmd = [
            config.ffmpeg_path,
            "-y",
            "-i", str(ts_path),
            "-c", "copy",
            "-movflags", "+faststart",
            str(temp_path),
        ]
        run_kw: dict = {"stderr": subprocess.PIPE, "stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL}
        if _IS_WIN:
            run_kw["creationflags"] = subprocess.CREATE_NO_WINDOW

        proc = subprocess.Popen(cmd, **run_kw)
        assert proc.stderr is not None
        last_pct: float | None = None
        stderr_tail: deque[str] = deque(maxlen=_FFMPEG_STDERR_TAIL_LINES)
        while True:
            if is_cancelled():
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                if temp_path.exists():
                    try:
                        temp_path.unlink()
                    except OSError as e:
                        logger.warning("取消时删除临时文件失败 %s: %s", temp_path, e)
                put_event({"task_id": task_id, "status": "cancelled"})
                return

            line = proc.stderr.readline()
            if not line:
                break
            line_str = line.decode("utf-8", errors="replace").rstrip()
            stderr_tail.append(line_str)
            m = _RE_TIME.search(line_str)
            if m and total_duration is not None and total_duration > 0:
                current = _parse_time_to_seconds(m)
                pct = min(99.9, max(0, (current / total_duration) * 100))
                if last_pct is None or pct - last_pct >= 1.0:
                    last_pct = pct
                    put_event({"task_id": task_id, "progress_pct": round(pct, 1)})

        proc.wait()
        if proc.returncode != 0:
            if temp_path.exists():
                try:
                    temp_path.unlink()
                except OSError:
                    pass
            _code, code_str = _normalize_exit_code(proc.returncode)
            stderr_snippet = "\n".join(stderr_tail).strip()
            if len(stderr_snippet) > _FFMPEG_STDERR_MAX_CHARS:
                stderr_snippet = stderr_snippet[-_FFMPEG_STDERR_MAX_CHARS:].lstrip()
                if "\n" in stderr_snippet:
                    stderr_snippet = "...\n" + stderr_snippet
            err_msg = f"ffmpeg 退出码 {code_str}"
            if stderr_snippet:
                err_msg += "\n" + stderr_snippet
            logger.warning(
                "ts_to_mp4 失败 task_id=%s code=%s returncode=%s cmd=%s stderr_last=%s",
                task_id,
                code,
                proc.returncode,
                cmd,
                stderr_snippet[:500] if stderr_snippet else "",
            )
            put_event({"task_id": task_id, "status": "failed", "error": err_msg})
            return

        if not temp_path.exists():
            put_event({"task_id": task_id, "status": "failed", "error": "转换后未生成临时文件"})
            return

        os.replace(temp_path, final_mp4)

        # 校验 MP4 完整可靠后才删除 TS 并更新 DB
        if config.ffprobe_available:
            ok, err_msg = validate_mp4_after_convert(ts_path, final_mp4, config.ffprobe_path)
            if not ok:
                try:
                    final_mp4.unlink()
                except OSError as e:
                    logger.warning("校验失败后删除 MP4 失败 %s: %s", final_mp4, e)
                put_event({"task_id": task_id, "status": "failed", "error": f"MP4 校验未通过: {err_msg}"})
                return

            # 先更新 DB 再删 TS，避免 DB 更新失败时仍可保留 TS
            file_mtime, file_size = get_file_info(final_mp4)
            try:
                with session_scope() as session:
                    item = session.query(MediaItem).filter(MediaItem.code == code).first()
                    if item:
                        item.has_mp4 = 1
                        item.has_ts = 0
                        item.file_size = file_size
                        item.file_mtime = file_mtime
                    session.commit()
            except Exception as e:  # noqa: BLE001
                logger.exception("TS→MP4 成功但更新 media 表失败 code=%s: %s", code, e)
                put_event({"task_id": task_id, "status": "failed", "error": f"更新数据库失败: {e}"})
                return

            try:
                ts_path.unlink()
            except OSError as e:
                logger.warning("删除 TS 失败 %s: %s", ts_path, e)

        put_event({"task_id": task_id, "status": "success", "result": str(final_mp4)})

    except Exception as e:  # noqa: BLE001
        logger.exception("TS→MP4 转换异常 task_id=%s: %s", task_id, e)
        if temp_path.exists():
            try:
                temp_path.unlink()
            except OSError:
                pass
        put_event({"task_id": task_id, "status": "failed", "error": str(e)})
