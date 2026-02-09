"""通过 ffprobe 获取视频时长，用于 HLS m3u8 精确 #EXTINF。启动时自检可用性，请求时带超时避免卡顿。"""
from __future__ import annotations

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
