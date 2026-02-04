"""字幕服务：请求迅雷字幕 API、拉取字幕文件并做 SRT → WebVTT 转换。

- 列表由后端代理迅雷 API，避免前端跨域并统一返回 vttUrl。
- 单条字幕由后端拉取原始 URL，若为 SRT 则转为 WebVTT 后返回，前端仅请求本域。
"""
from __future__ import annotations

import re
import logging
from typing import Any
from urllib.parse import quote_plus

import requests

XUNLEI_SUBTITLE_LIST_URL = "http://api-shoulei-ssl.xunlei.com/oracle/subtitle"
TIMEOUT = 15

logger = logging.getLogger(__name__)


def fetch_subtitle_list(code: str) -> list[dict[str, Any]]:
    """按编号请求迅雷字幕列表，返回带 vttUrl 的条目列表（vttUrl 为相对路径，指向本后端 /api/subtitles/track）。"""
    params = {"name": code}
    try:
        r = requests.get(XUNLEI_SUBTITLE_LIST_URL, params=params, timeout=TIMEOUT)
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        logger.warning("迅雷字幕列表请求失败 code=%s: %s", code, e)
        return []

    if data.get("code") != 0 or "data" not in data:
        return []

    items = []
    for raw in data["data"]:
        url = raw.get("url") or ""
        if not url:
            continue
        ext = (raw.get("ext") or "srt").lower().strip()
        vtt_url = f"/api/subtitles/track?url={quote_plus(url)}"
        items.append({
            "gcid": raw.get("gcid", ""),
            "cid": raw.get("cid", ""),
            "url": url,
            "ext": ext,
            "name": raw.get("name", ""),
            "duration": raw.get("duration", 0),
            "score": raw.get("score", 0),
            "languages": raw.get("languages") or [],
            "extra_name": raw.get("extra_name", ""),
            "vttUrl": vtt_url,
        })
    return items


# SRT 时间行：00:00:01,000 --> 00:00:04,000 或 00:01,000 --> 00:04,000
SRT_TIME_LINE = re.compile(
    r"^(\d{2}:\d{2}:\d{2}[,.]\d{3}|\d{1,2}:\d{2}[,.]\d{3})\s*-->\s*"
    r"(\d{2}:\d{2}:\d{2}[,.]\d{3}|\d{1,2}:\d{2}[,.]\d{3})\s*$",
    re.MULTILINE,
)


def srt_to_webvtt(raw: str) -> str:
    """将 SRT 内容转为 WebVTT。时间格式：SRT 用逗号表示毫秒，WebVTT 用点。"""
    if not raw or not raw.strip():
        return "WEBVTT\n\n"

    # 统一换行并去掉 BOM
    text = raw.replace("\r\n", "\n").replace("\r", "\n").strip()
    if text.startswith("\ufeff"):
        text = text[1:]

    lines = text.split("\n")
    out = ["WEBVTT", ""]
    i = 0
    while i < len(lines):
        line = lines[i]
        # 跳过空行或纯数字（序号）
        if not line.strip():
            i += 1
            continue
        if line.strip().isdigit():
            i += 1
            if i >= len(lines):
                break
            line = lines[i]
        # 时间行
        m = SRT_TIME_LINE.match(line)
        if m:
            start, end = m.group(1).replace(",", "."), m.group(2).replace(",", ".")
            # 补齐为 HH:MM:SS.mmm
            if start.count(":") == 1:
                start = "00:" + start
            if end.count(":") == 1:
                end = "00:" + end
            out.append(f"{start} --> {end}")
            i += 1
            while i < len(lines) and lines[i].strip():
                out.append(lines[i])
                i += 1
            out.append("")
        i += 1

    return "\n".join(out).strip() + "\n"


def fetch_subtitle_as_vtt(original_url: str) -> tuple[bytes, str]:
    """拉取字幕文件，若为 SRT 则转为 WebVTT，返回 (body, content_type)。"""
    r = requests.get(original_url, timeout=TIMEOUT)
    r.raise_for_status()
    content_type = r.headers.get("Content-Type", "").split(";")[0].strip().lower()
    raw = r.text
    if not raw:
        return b"WEBVTT\n\n", "text/vtt"

    ext = "srt" if "srt" in content_type or original_url.lower().endswith(".srt") else "vtt"
    if ext == "srt":
        raw = srt_to_webvtt(raw)
    elif not raw.strip().upper().startswith("WEBVTT"):
        raw = srt_to_webvtt(raw)

    return raw.encode("utf-8"), "text/vtt; charset=utf-8"
