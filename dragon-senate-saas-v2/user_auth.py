from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, AsyncGenerator

from fastapi import Depends
from fastapi_users import BaseUserManager, FastAPIUsers, UUIDIDMixin, schemas
from fastapi_users.authentication import AuthenticationBackend, BearerTransport, JWTStrategy
from fastapi_users.db import SQLAlchemyBaseUserTableUUID, SQLAlchemyUserDatabase
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import String, Text, or_, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from notification_center import send_password_reset_notification


def _utcnow_naive() -> datetime:
    # Keep DB timestamps in naive UTC for TIMESTAMP WITHOUT TIME ZONE columns.
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _normalize_db_url(db_url: str) -> str:
    if db_url.startswith("postgresql+asyncpg://"):
        return db_url
    if db_url.startswith("postgresql://"):
        return db_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if db_url.startswith("sqlite+aiosqlite://"):
        return db_url
    if db_url.startswith("sqlite:///"):
        return db_url.replace("sqlite:///", "sqlite+aiosqlite:///", 1)
    if db_url.startswith("sqlite://"):
        suffix = db_url.replace("sqlite://", "", 1)
        return f"sqlite+aiosqlite://{suffix}"
    return db_url


def _auth_database_url() -> str:
    raw = (
        os.getenv("AUTH_DATABASE_URL", "").strip()
        or os.getenv("DATABASE_URL", "").strip()
        or "sqlite+aiosqlite:///./dragon_auth.db"
    )
    return _normalize_db_url(raw)


def _jwt_secret() -> str:
    return os.getenv("JWT_SECRET", "change_this_to_a_long_random_secret").strip()


def _jwt_lifetime_seconds() -> int:
    ttl_minutes_raw = os.getenv("JWT_EXPIRE_MINUTES", "120").strip()
    try:
        ttl_minutes = max(5, int(ttl_minutes_raw))
    except ValueError:
        ttl_minutes = 120
    return ttl_minutes * 60


def _normalize_roles(raw: Any) -> list[str]:
    if isinstance(raw, list):
        values = [str(item).strip().lower() for item in raw]
    elif isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                values = [str(item).strip().lower() for item in parsed]
            else:
                values = [part.strip().lower() for part in raw.split(",")]
        except json.JSONDecodeError:
            values = [part.strip().lower() for part in raw.split(",")]
    else:
        values = []

    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        if not value or value in seen:
            continue
        seen.add(value)
        out.append(value)
    if not out:
        out = ["member"]
    return out


class Base(DeclarativeBase):
    pass


class User(SQLAlchemyBaseUserTableUUID, Base):
    __tablename__ = "auth_users"

    username: Mapped[str | None] = mapped_column(String(length=64), unique=True, nullable=True, index=True)
    tenant_id: Mapped[str] = mapped_column(String(length=128), default="tenant_main", nullable=False, index=True)
    roles_json: Mapped[str] = mapped_column(Text, default='["member"]', nullable=False)
    created_at: Mapped[datetime] = mapped_column(default=_utcnow_naive, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(default=_utcnow_naive, nullable=False)

    @property
    def roles(self) -> list[str]:
        return _normalize_roles(self.roles_json)

    @roles.setter
    def roles(self, value: Any) -> None:
        self.roles_json = json.dumps(_normalize_roles(value), ensure_ascii=False)


class UserRead(schemas.BaseUser[uuid.UUID]):
    username: str | None = None
    tenant_id: str = "tenant_main"
    roles: list[str] = Field(default_factory=lambda: ["member"])


class UserCreate(schemas.BaseUserCreate):
    username: str | None = Field(default=None, max_length=64)
    tenant_id: str | None = Field(default=None, max_length=128)
    roles: list[str] = Field(default_factory=lambda: ["member"])


class UserUpdate(schemas.BaseUserUpdate):
    username: str | None = Field(default=None, max_length=64)
    tenant_id: str | None = Field(default=None, max_length=128)
    roles: list[str] | None = None


class AuthClaims(BaseModel):
    model_config = ConfigDict(extra="ignore")

    sub: str
    tenant_id: str
    roles: list[str] = Field(default_factory=lambda: ["member"])
    user_uuid: str


AUTH_DB_URL = _auth_database_url()
_connect_args = {"check_same_thread": False} if AUTH_DB_URL.startswith("sqlite+") else {}
auth_engine = create_async_engine(
    AUTH_DB_URL,
    echo=False,
    pool_pre_ping=True,
    connect_args=_connect_args,
)
AsyncSessionMaker = async_sessionmaker(auth_engine, expire_on_commit=False)


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionMaker() as session:
        yield session


async def get_user_db(session: AsyncSession = Depends(get_async_session)) -> AsyncGenerator[SQLAlchemyUserDatabase[User, uuid.UUID], None]:
    yield SQLAlchemyUserDatabase(session, User)


class UserManager(UUIDIDMixin, BaseUserManager[User, uuid.UUID]):
    reset_password_token_secret = _jwt_secret()
    verification_token_secret = _jwt_secret()

    async def on_after_register(self, user: User, request=None) -> None:  # noqa: ANN001
        changed = False
        if not user.tenant_id:
            user.tenant_id = f"tenant_{str(user.id).replace('-', '')[:8]}"
            changed = True
        if not user.roles_json:
            user.roles = ["member"]
            changed = True
        if not user.username:
            fallback_name = str(user.email).split("@", 1)[0].strip() or f"user_{str(user.id)[:8]}"
            user.username = fallback_name[:64]
            changed = True
        if changed:
            await self.user_db.update(user, {"tenant_id": user.tenant_id, "roles_json": user.roles_json, "username": user.username})

    async def on_after_forgot_password(self, user: User, token: str, request=None) -> None:  # noqa: ANN001
        send_password_reset_notification(
            email=user.email,
            token=token,
            tenant_id=user.tenant_id,
            username=user.username,
        )


async def get_user_manager(
    user_db: SQLAlchemyUserDatabase[User, uuid.UUID] = Depends(get_user_db),
) -> AsyncGenerator[UserManager, None]:
    yield UserManager(user_db)


bearer_transport = BearerTransport(tokenUrl="auth/jwt/login")


def get_jwt_strategy() -> JWTStrategy[User, uuid.UUID]:
    return JWTStrategy(secret=_jwt_secret(), lifetime_seconds=_jwt_lifetime_seconds())


auth_backend = AuthenticationBackend(
    name="jwt",
    transport=bearer_transport,
    get_strategy=get_jwt_strategy,
)

fastapi_users = FastAPIUsers[User, uuid.UUID](get_user_manager, [auth_backend])
current_active_user = fastapi_users.current_user(active=True)


def claims_from_user(user: User) -> AuthClaims:
    subject = (user.username or user.email or str(user.id)).strip()
    tenant_id = (user.tenant_id or "tenant_main").strip() or "tenant_main"
    roles = _normalize_roles(user.roles_json)
    try:
        from auth_scim import inherited_group_roles_for_user

        roles = _normalize_roles(roles + inherited_group_roles_for_user(tenant_id, str(user.id)))
    except Exception:
        roles = _normalize_roles(roles)
    return AuthClaims(
        sub=subject,
        tenant_id=tenant_id,
        roles=roles,
        user_uuid=str(user.id),
    )


async def init_auth_schema() -> None:
    async with auth_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def ensure_bootstrap_admin() -> dict[str, Any]:
    # NOTE: use a globally valid email domain by default to satisfy email-validator.
    email = os.getenv("AUTH_BOOTSTRAP_ADMIN_EMAIL", "admin@sflaw.store").strip().lower()
    password = os.getenv("AUTH_BOOTSTRAP_ADMIN_PASSWORD", "ChangeMe123!").strip()
    username = os.getenv("AUTH_BOOTSTRAP_ADMIN_USERNAME", "admin").strip()[:64] or "admin"
    tenant_id = os.getenv("AUTH_BOOTSTRAP_ADMIN_TENANT", "tenant_main").strip() or "tenant_main"
    roles = ["admin"]

    async with AsyncSessionMaker() as session:
        existing = (
            await session.execute(
                select(User).where(
                    or_(
                        User.email == email,
                        User.username == username,
                    )
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            changed = False
            if existing.username != username:
                existing.username = username
                changed = True
            if existing.tenant_id != tenant_id:
                existing.tenant_id = tenant_id
                changed = True
            if _normalize_roles(existing.roles_json) != roles:
                existing.roles = roles
                changed = True
            if not existing.is_superuser:
                existing.is_superuser = True
                changed = True
            if not existing.is_active:
                existing.is_active = True
                changed = True
            if not existing.is_verified:
                existing.is_verified = True
                changed = True
            if changed:
                existing.updated_at = _utcnow_naive()
                await session.commit()
            return {"created": False, "email": existing.email, "username": existing.username, "tenant_id": existing.tenant_id}

        user_db = SQLAlchemyUserDatabase(session, User)
        manager = UserManager(user_db)
        payload = UserCreate(
            email=email,
            password=password,
            is_superuser=True,
            is_active=True,
            is_verified=True,
            username=username,
            tenant_id=tenant_id,
            roles=roles,
        )
        created = await manager.create(payload, safe=False, request=None)
        created.roles = roles
        created.updated_at = _utcnow_naive()
        await session.commit()
        return {"created": True, "email": created.email, "username": created.username, "tenant_id": created.tenant_id}


async def get_user_from_access_token(token: str) -> User | None:
    token = (token or "").strip()
    if not token:
        return None
    strategy = get_jwt_strategy()
    async with AsyncSessionMaker() as session:
        user_db = SQLAlchemyUserDatabase(session, User)
        manager = UserManager(user_db)
        user = await strategy.read_token(token, manager)
        if isinstance(user, User):
            return user
    return None


async def authenticate_identity_password(identity: str, password: str) -> User | None:
    identifier = (identity or "").strip()
    if not identifier:
        return None

    async with AsyncSessionMaker() as session:
        result = await session.execute(
            select(User).where(or_(User.email == identifier.lower(), User.username == identifier))
        )
        user = result.scalar_one_or_none()
        if user is None or not user.is_active:
            return None

        user_db = SQLAlchemyUserDatabase(session, User)
        manager = UserManager(user_db)
        verified, updated_hash = manager.password_helper.verify_and_update(password, user.hashed_password)
        if not verified:
            return None
        if updated_hash:
            user.hashed_password = updated_hash
            user.updated_at = _utcnow_naive()
            await session.commit()
        return user


async def issue_access_token_for_user(user: User) -> str:
    strategy = get_jwt_strategy()
    return await strategy.write_token(user)

