from __future__ import annotations

import re
from pathlib import Path
from typing import Optional


_FILENAME_SANITIZE_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def safe_avatar_basename(actor_name: str) -> str:
    """将演员名转为安全的文件名基名（不含扩展名）。"""
    s = _FILENAME_SANITIZE_RE.sub("_", actor_name)
    s = s.strip() or "unknown"
    return s[:200]


def find_existing_avatar(base_dir: Path, actor_name: str) -> Optional[Path]:
    """在 avatars 目录下按演员名尝试 jpg/png，返回第一张存在的图片路径。"""
    base = safe_avatar_basename(actor_name)
    candidates = [base_dir / f"{base}.jpg", base_dir / f"{base}.png"]
    for p in candidates:
        try:
            if p.is_file():
                return p.resolve()
        except OSError:
            continue
    return None

