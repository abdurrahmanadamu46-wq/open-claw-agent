from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class ContentType(str, Enum):
    VIDEO = "video"
    IMAGE_POST = "image_post"
    TEXT_POST = "text_post"


class PublishStatus(str, Enum):
    PENDING = "pending"
    UPLOADING = "uploading"
    PUBLISHED = "published"
    FAILED = "failed"
    REJECTED = "rejected"


@dataclass(slots=True)
class PublishTask:
    task_id: str
    seat_id: str
    tenant_id: str = "tenant_main"
    platform: str = "xiaohongshu"
    content_type: str = ContentType.VIDEO.value
    title: str = ""
    caption: str = ""
    tags: list[str] = field(default_factory=list)
    media_urls: list[str] = field(default_factory=list)
    cover_url: Optional[str] = None
    scheduled_at: Optional[str] = None
    profile_dir: Optional[str] = None
    metadata: dict = field(default_factory=dict)


@dataclass(slots=True)
class PublishResult:
    task_id: str
    status: PublishStatus
    platform_post_id: Optional[str] = None
    platform_url: Optional[str] = None
    error_message: Optional[str] = None
    screenshot_path: Optional[str] = None
    detail: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "status": self.status.value,
            "platform_post_id": self.platform_post_id,
            "platform_url": self.platform_url,
            "error_message": self.error_message,
            "screenshot_path": self.screenshot_path,
            "detail": dict(self.detail or {}),
        }


class PlatformAdapter(ABC):
    @abstractmethod
    async def login_check(self, page) -> bool:
        raise NotImplementedError

    @abstractmethod
    async def publish_video(self, page, task: PublishTask) -> PublishResult:
        raise NotImplementedError

    @abstractmethod
    async def publish_image_post(self, page, task: PublishTask) -> PublishResult:
        raise NotImplementedError

    async def reply_comment(self, page, post_id: str, comment_id: str, reply_text: str) -> bool:
        return False

    async def send_private_message(self, page, user_id: str, message: str) -> bool:
        return False
