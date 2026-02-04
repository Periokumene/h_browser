"""演员图片提供方抽象接口。

本模块与具体数据源（如远程头像仓库）解耦，便于未来：
- 剥离为独立包/插件
- 切换为其他图源或本地策略
- 完全禁用该功能
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
from typing import List, Optional

from sqlalchemy.orm import Session


class ActorImageProvider(ABC):
    """演员图片提供方抽象基类。"""

    @abstractmethod
    def resolve(
        self,
        actor_name: str,
        cache_dir: Path,
    ) -> Optional[str]:
        """根据演员名解析并缓存图片，返回相对于 cache_dir 的本地文件名；未找到则返回 None。

        - actor_name: 演员名称（与 NFO/actors 表一致，可能为日文/中文等）
        - cache_dir: 图片缓存目录（一般为数据根下 resources/avatars）
        - 返回: 保存后的文件名（如 "xxx.jpg"）；失败返回 None
        """
        ...

    def update_all(
        self,
        actor_names: List[str],
        cache_dir: Path,
        session: Session,
    ) -> None:
        """全量更新：为所有给定演员解析并缓存图片。

        默认实现：逐人调用 resolve，仅写入文件系统，不再改写 actors.db（image_filename 字段废弃）。
        子类可重写以做批量优化或自定义日志/进度行为。
        """
        for name in actor_names:
            if not name or not name.strip():
                continue
            name = name.strip()
            self.resolve(name, cache_dir)
