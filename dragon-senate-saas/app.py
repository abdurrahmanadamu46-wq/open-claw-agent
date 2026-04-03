import json
import os
import secrets
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from typing import Any

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from pydantic import BaseModel, Field

from dragon_senate import app as dragon_graph

load_dotenv()

ALGORITHM = "HS256"
security = HTTPBearer(auto_error=False)


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class UserClaims(BaseModel):
    sub: str
    tenant_id: str
    roles: list[str] = Field(default_factory=list)
    exp: int


class TaskRequest(BaseModel):
    task_description: str = Field(..., min_length=1, max_length=4000)
    user_id: str = Field(..., min_length=1, max_length=128)


class TaskResponse(BaseModel):
    status: str
    request_id: str
    score: Any | None = None
    leads: list[Any] = Field(default_factory=list)
    call_log: list[Any] = Field(default_factory=list)
    evolution: list[Any] = Field(default_factory=list)


def _get_required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _jwt_secret() -> str:
    return _get_required_env("JWT_SECRET")


def _jwt_ttl_minutes() -> int:
    raw = os.getenv("JWT_EXPIRE_MINUTES", "120").strip()
    try:
        return max(5, int(raw))
    except ValueError:
        return 120


def _load_users() -> list[dict[str, Any]]:
    raw = os.getenv("APP_USERS_JSON", "").strip()
    if raw:
        try:
            parsed = json.loads(raw)
            if isinstance(parsed, list):
                users = [u for u in parsed if isinstance(u, dict)]
                if users:
                    return users
        except json.JSONDecodeError:
            pass
    return [
        {
            "username": "admin",
            "password": "change_me",
            "tenant_id": "tenant_demo",
            "roles": ["admin"],
        }
    ]


def _create_access_token(username: str, tenant_id: str, roles: list[str]) -> LoginResponse:
    expires_delta = timedelta(minutes=_jwt_ttl_minutes())
    expire_at = datetime.now(UTC) + expires_delta
    payload = {
        "sub": username,
        "tenant_id": tenant_id,
        "roles": roles,
        "exp": int(expire_at.timestamp()),
    }
    token = jwt.encode(payload, _jwt_secret(), algorithm=ALGORITHM)
    return LoginResponse(access_token=token, expires_in=int(expires_delta.total_seconds()))


def _auth_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or missing bearer token",
    )


def _decode_user(credentials: HTTPAuthorizationCredentials | None = Depends(security)) -> UserClaims:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _auth_error()
    try:
        payload = jwt.decode(credentials.credentials, _jwt_secret(), algorithms=[ALGORITHM])
        return UserClaims(**payload)
    except (JWTError, ValueError):
        raise _auth_error()


@asynccontextmanager
async def lifespan(app: FastAPI):
    db_url = _get_required_env("DATABASE_URL")
    checkpointer_cm = AsyncPostgresSaver.from_conn_string(db_url)
    checkpointer = await checkpointer_cm.__aenter__()
    try:
        await checkpointer.setup()
        app.state.persistent_graph = dragon_graph.compile(checkpointer=checkpointer)
        app.state.checkpointer_cm = checkpointer_cm
        app.state.app_boot_id = str(uuid.uuid4())
        yield
    finally:
        await checkpointer_cm.__aexit__(None, None, None)


app = FastAPI(
    title="龙虾元老院 SaaS - 大陆版",
    version="1.0.0",
    lifespan=lifespan,
)


@app.get("/")
async def index():
    return {
        "service": "dragon-senate-saas",
        "ok": True,
        "endpoints": {
            "healthz": "/healthz",
            "docs": "/docs",
            "login": "/auth/login",
            "run": "/run-dragon-team",
            "status": "/status/{user_id}",
        },
    }


@app.get("/healthz")
async def healthz():
    return {"ok": True, "boot_id": app.state.app_boot_id}


@app.post("/auth/login", response_model=LoginResponse)
async def login(body: LoginRequest):
    users = _load_users()
    for user in users:
        if user.get("username") != body.username:
            continue
        if not secrets.compare_digest(str(user.get("password", "")), body.password):
            break
        tenant_id = str(user.get("tenant_id", "tenant_demo"))
        roles = [str(r).lower() for r in user.get("roles", ["member"])]
        return _create_access_token(body.username, tenant_id, roles)
    raise HTTPException(status_code=401, detail="Username or password incorrect")


@app.get("/auth/me")
async def me(current_user: UserClaims = Depends(_decode_user)):
    return {
        "username": current_user.sub,
        "tenant_id": current_user.tenant_id,
        "roles": current_user.roles,
    }


@app.get("/status/{user_id}")
async def get_status(user_id: str, current_user: UserClaims = Depends(_decode_user)):
    if current_user.sub != user_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="Forbidden for this user_id")
    return {"status": "9只龙虾正在为你工作", "user_id": user_id}


@app.post("/run-dragon-team", response_model=TaskResponse)
async def run_dragon_team(request: TaskRequest, current_user: UserClaims = Depends(_decode_user)):
    if current_user.sub != request.user_id and "admin" not in current_user.roles:
        raise HTTPException(status_code=403, detail="user_id mismatch with login user")

    request_id = str(uuid.uuid4())
    config = {"configurable": {"thread_id": request.user_id}}
    try:
        result = await app.state.persistent_graph.ainvoke(
            {"task_description": request.task_description, "messages": []},
            config,
        )
        return TaskResponse(
            status="success",
            request_id=request_id,
            score=result.get("score"),
            leads=result.get("leads", []),
            call_log=result.get("call_log", []),
            evolution=result.get("evolution_log", []),
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"9只龙虾出错了: {exc}") from exc
