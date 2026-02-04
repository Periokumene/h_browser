"""基于指定 URL 的演员头像提供方实现。

数据源为可配置的远程地址，需提供 Filetree.json 与 Content 目录结构：
- Filetree 中 Content 按公司/分组组织，每项为 显示名 -> 实际文件名?t=时间戳
- 同一演员可能有多条（多组/多图），按「最新 + 质量优先」选取一张并缓存到本地

与主程序松耦合，通过 config.avatar_source_url 配置；为空则禁用。
"""
from __future__ import annotations

import logging
import urllib.parse
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests

from .interface import ActorImageProvider
from .utils import safe_avatar_basename

logger = logging.getLogger(__name__)


def _parse_timestamp(value: str) -> int:
    """从 'filename?t=123' 或 'filename' 中解析 t，无则返回 0。"""
    if "?t=" in value:
        try:
            return int(value.split("?t=")[1].strip())
        except (IndexError, ValueError):
            pass
    return 0


def _normalize_key(key: str) -> str:
    """文件名 key 转为逻辑名（去掉 .jpg 后缀，用于匹配）。"""
    if not key:
        return ""
    return key.replace(".jpg", "").replace(".jpeg", "").strip()


class AvatarsProvider(ActorImageProvider):
    """基于远程 Filetree（Filetree.json + Content）的演员头像提供方。"""

    def __init__(
        self,
        filetree_url: str,
        content_base_url: str,
        timeout: int = 30,
        use_ai_fix: bool = True,
    ):
        """
        - filetree_url: Filetree.json 的完整 URL
        - content_base_url: Content 目录基础 URL，图片路径将拼接到其后
        - timeout: 请求超时（秒）
        - use_ai_fix: 是否优先使用 AI-Fix 优化图；False 则只用原始图
        """
        self.filetree_url = filetree_url.rstrip("/")
        self.content_base_url = content_base_url.rstrip("/") + "/"
        self.timeout = timeout
        self.use_ai_fix = use_ai_fix
        self._filetree: Optional[Dict[str, Any]] = None
        self._index: Optional[Dict[str, List[Tuple[str, str, int, int]]]] = None  # logical_name -> [(company, filename, t, order)]

    def _fetch_filetree(self) -> Dict[str, Any]:
        """拉取并解析 Filetree.json；失败返回空结构。"""
        if self._filetree is not None:
            return self._filetree
        try:
            r = requests.get(
                self.filetree_url,
                timeout=self.timeout,
                headers={"Accept-Encoding": "gzip"},
            )
            r.raise_for_status()
            self._filetree = r.json()
        except Exception as exc:  # noqa: BLE001
            logger.warning("拉取头像仓库 Filetree 失败: %s", exc)
            self._filetree = {"Information": {}, "Content": {}}
        return self._filetree

    def _build_index(self) -> Dict[str, List[Tuple[str, str, int, int]]]:
        """
        构建 逻辑名 -> [(company, filename, t, quality_order)]。
        Content 内按质量升序，故 order 越大表示质量越高。
        """
        if self._index is not None:
            return self._index
        tree = self._fetch_filetree()
        content = tree.get("Content") or {}
        index: Dict[str, List[Tuple[str, str, int, int]]] = {}
        company_list = list(content.keys())
        for company_idx, company in enumerate(company_list):
            files = content.get(company)
            if not isinstance(files, dict):
                continue
            items = list(files.items())
            for quality_order, (display_key, value) in enumerate(items):
                if not display_key or not isinstance(value, str):
                    continue
                logical = _normalize_key(display_key)
                if not logical:
                    continue
                filename = value.split("?")[0].strip()
                t = _parse_timestamp(value)
                key = logical
                if key not in index:
                    index[key] = []
                index[key].append((company, filename, t, quality_order))
        self._index = index
        return self._index

    def _candidates_for_actor(self, actor_name: str) -> List[Tuple[str, str, int, int]]:
        """根据演员名收集所有候选 (company, filename, t, quality_order)。
        Filetree 中 key 为显示名（如 演员名.jpg / 演员名-1.jpg），已按逻辑名建索引。
        """
        index = self._build_index()
        normalized = actor_name.strip()
        if not normalized:
            return []
        candidates: List[Tuple[str, str, int, int]] = []
        if normalized in index:
            candidates.extend(index[normalized])
        for logical, entries in index.items():
            if logical == normalized:
                continue
            if logical.startswith(normalized + "-") and logical[len(normalized):].lstrip("-").isdigit():
                candidates.extend(entries)
        return candidates

    def _pick_best(
        self,
        candidates: List[Tuple[str, str, int, int]],
    ) -> Optional[Tuple[str, str]]:
        """在候选中选一个：优先最新（t 最大），其次质量（quality_order 最大）。返回 (company, filename)。"""
        if not candidates:
            return None
        def allowed(company: str, filename: str) -> bool:
            if self.use_ai_fix:
                return True
            return not filename.startswith("AI-Fix-")

        filtered = [(c, f, t, q) for c, f, t, q in candidates if allowed(c, f)]
        if not filtered:
            filtered = candidates
        filtered.sort(key=lambda x: (x[2], x[3]), reverse=True)
        company, filename = filtered[0][0], filtered[0][1]
        return (company, filename)

    def _download_to(self, company: str, filename: str, dest_path: Path) -> bool:
        """将 Content/Company/filename 下载到 dest_path。"""
        url = self.content_base_url + urllib.parse.quote(company) + "/" + urllib.parse.quote(filename)
        try:
            r = requests.get(url, timeout=self.timeout, stream=True)
            r.raise_for_status()
            dest_path.parent.mkdir(parents=True, exist_ok=True)
            with open(dest_path, "wb") as f:
                for chunk in r.iter_content(chunk_size=65536):
                    if chunk:
                        f.write(chunk)
            return True
        except Exception as exc:  # noqa: BLE001
            logger.debug("下载演员头像失败 %s: %s", url, exc)
            return False

    def resolve(
        self,
        actor_name: str,
        cache_dir: Path,
    ) -> Optional[str]:
        """解析演员名 → 选最佳图 → 下载到 cache_dir → 返回本地文件名。

        本地文件名规则：safe_avatar_basename(actor_name) + 远端扩展名（仅支持 jpg/png，其他一律按 .jpg 处理）。
        """
        if not actor_name or not actor_name.strip():
            return None
        actor_name = actor_name.strip()
        candidates = self._candidates_for_actor(actor_name)
        best = self._pick_best(candidates)
        if not best:
            return None
        company, remote_filename = best
        ext = Path(remote_filename).suffix.lower()
        if ext not in (".jpg", ".jpeg", ".png"):
            ext = ".jpg"
        if ext == ".jpeg":
            ext = ".jpg"
        local_name = safe_avatar_basename(actor_name) + ext
        dest_path = cache_dir / local_name
        if self._download_to(company, remote_filename, dest_path):
            return local_name
        return None
