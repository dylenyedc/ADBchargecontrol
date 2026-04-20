from __future__ import annotations

from typing import Any, Generic, TypeVar

from pydantic import BaseModel

from app.models import AppConfig, ConnectionConfig, PolicyConfig

T = TypeVar("T")


class ApiResponse(BaseModel, Generic[T]):
    ok: bool
    data: T | None = None
    error: str | None = None


def ok(data: Any) -> dict[str, Any]:
    return {"ok": True, "data": data, "error": None}


def fail(error: str) -> dict[str, Any]:
    return {"ok": False, "data": None, "error": error}


class ActiveConnectionRequest(BaseModel):
    connection_id: str


class PolicyUpdateRequest(PolicyConfig):
    pass


class ConnectionUpsertRequest(ConnectionConfig):
    original_id: str | None = None


class ConfigUpdateRequest(BaseModel):
    config: AppConfig
