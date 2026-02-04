"""通过 ffprobe 获取视频时长，用于 HLS m3u8 精确 #EXTINF。启动时自检可用性，请求时带超时避免卡顿。"""
from __future__ import annotations

import json
import logging
import subprocess
import sys
from pathlib import Path

logger = logging.getLogger(__name__)

_IS_WIN = sys.platform == "win32"

# 自检超时（秒），仅验证 ffprobe 可执行
CHECK_TIMEOUT_SEC = 2.0
# 单次获取时长超时（秒），避免大文件或异常导致请求卡住
DURATION_TIMEOUT_SEC = 5.0


def check_ffprobe_available(ffprobe_path: str, timeout_sec: float = CHECK_TIMEOUT_SEC) -> bool:
    """自检 ffprobe 是否可用（执行 -version，不访问媒体文件）。"""
    kwargs: dict = {"capture_output": True, "timeout": timeout_sec}
    if _IS_WIN:
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
    try:
        result = subprocess.run([ffprobe_path, "-version"], **kwargs)
        ok = result.returncode == 0
        if not ok:
            logger.info("ffprobe 自检失败: returncode=%s, path=%s", result.returncode, ffprobe_path)
        return ok
    except FileNotFoundError:
        logger.info("ffprobe 未找到: %s，将使用固定 #EXTINF 时长", ffprobe_path)
        return False
    except subprocess.TimeoutExpired:
        logger.warning("ffprobe 自检超时 (%ss): %s", timeout_sec, ffprobe_path)
        return False
    except Exception as e:  # noqa: BLE001
        logger.info("ffprobe 自检异常: %s", e)
        return False


def get_duration(
    file_path: Path,
    ffprobe_path: str,
    timeout_sec: float = DURATION_TIMEOUT_SEC,
) -> float | None:
    """用 ffprobe 获取媒体时长（秒）。超时或失败返回 None。"""
    path_str = str(file_path.resolve())
    run_kw: dict = {"capture_output": True, "text": True, "timeout": timeout_sec}
    if _IS_WIN:
        run_kw["creationflags"] = subprocess.CREATE_NO_WINDOW
    try:
        result = subprocess.run(
            [
                ffprobe_path,
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                path_str,
            ],
            **run_kw,
        )
        if result.returncode != 0:
            logger.debug("ffprobe 获取时长失败: code=%s path=%s stderr=%s", result.returncode, path_str, result.stderr)
            return None
        line = (result.stdout or "").strip().splitlines()[0] if result.stdout else ""
        if not line:
            return None
        duration = float(line)
        if duration <= 0 or duration > 86400 * 7:  # 0 ~ 7 天
            logger.debug("ffprobe 时长异常: %s path=%s", duration, path_str)
            return None
        return duration
    except subprocess.TimeoutExpired:
        logger.warning("ffprobe 获取时长超时 (%ss): %s", timeout_sec, path_str)
        return None
    except (ValueError, IndexError, OSError) as e:
        logger.debug("ffprobe 解析时长失败: %s path=%s", e, path_str)
        return None
    except Exception as e:  # noqa: BLE001
        logger.debug("ffprobe 异常: %s path=%s", e, path_str)
        return None


def get_format_and_streams(
    file_path: Path,
    ffprobe_path: str,
    timeout_sec: float = DURATION_TIMEOUT_SEC,
) -> dict | None:
    """用 ffprobe 获取 format.duration 与 streams 数量。失败返回 None。
    返回格式: {"duration": float, "video_count": int, "audio_count": int}。
    """
    path_str = str(file_path.resolve())
    run_kw: dict = {"capture_output": True, "text": True, "timeout": timeout_sec}
    if _IS_WIN:
        run_kw["creationflags"] = subprocess.CREATE_NO_WINDOW
    try:
        result = subprocess.run(
            [
                ffprobe_path,
                "-v", "error",
                "-show_entries", "format=duration:stream=codec_type",
                "-of", "json",
                path_str,
            ],
            **run_kw,
        )
        if result.returncode != 0 or not result.stdout:
            return None
        data = json.loads(result.stdout)
        duration = None
        fmt = data.get("format") or {}
        if "duration" in fmt:
            try:
                duration = float(fmt["duration"])
            except (TypeError, ValueError):
                pass
        streams = data.get("streams") or []
        video_count = sum(1 for s in streams if s.get("codec_type") == "video")
        audio_count = sum(1 for s in streams if s.get("codec_type") == "audio")
        return {
            "duration": duration,
            "video_count": video_count,
            "audio_count": audio_count,
        }
    except subprocess.TimeoutExpired:
        logger.warning("ffprobe 获取流信息超时 (%ss): %s", timeout_sec, path_str)
        return None
    except Exception as e:  # noqa: BLE001
        logger.debug("ffprobe 获取流信息失败: %s path=%s", e, path_str)
        return None


# TS→MP4 校验：时长允许误差（秒）
VALIDATE_DURATION_TOLERANCE_SEC = 8.0
# MP4 体积相对 TS 的最小比例，低于则视为异常
VALIDATE_MIN_SIZE_RATIO = 0.85


def validate_mp4_after_convert(
    ts_path: Path,
    mp4_path: Path,
    ffprobe_path: str,
    duration_tolerance_sec: float = VALIDATE_DURATION_TOLERANCE_SEC,
    min_size_ratio: float = VALIDATE_MIN_SIZE_RATIO,
) -> tuple[bool, str]:
    """
    校验转换后的 MP4 是否完整可靠（用于决定是否可安全删除 TS）。
    返回 (True, "") 表示通过；(False, "原因") 表示不通过。
    """
    if not mp4_path.exists():
        return False, "MP4 文件不存在"
    try:
        ts_size = ts_path.stat().st_size if ts_path.exists() else 0
        mp4_size = mp4_path.stat().st_size
    except OSError:
        return False, "无法读取文件大小"
    if ts_size > 0 and mp4_size < ts_size * min_size_ratio:
        return False, f"MP4 体积过小 (约 {mp4_size / ts_size:.1%}，低于 {min_size_ratio:.0%})"

    info = get_format_and_streams(mp4_path, ffprobe_path)
    if not info:
        return False, "无法用 ffprobe 读取 MP4 格式或流信息"
    if info.get("video_count", 0) < 1:
        return False, "MP4 中未检测到视频流"
    mp4_duration = info.get("duration")
    if mp4_duration is None or mp4_duration <= 0:
        return False, "MP4 时长为空或无效"

    ts_duration: float | None = None
    if ts_path.exists():
        ts_duration = get_duration(ts_path, ffprobe_path)
    if ts_duration is not None and ts_duration > 0:
        diff = abs(mp4_duration - ts_duration)
        if diff > duration_tolerance_sec:
            return False, f"MP4 与 TS 时长差异过大 ({diff:.1f}s，允许 {duration_tolerance_sec}s)"
    return True, ""
