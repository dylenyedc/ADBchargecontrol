from __future__ import annotations

from fastapi import APIRouter, Query, Request

from app.config import model_to_dict
from app.models import ConnectionConfig, PolicyConfig
from app.schemas import ActiveConnectionRequest, ConfigUpdateRequest, ConnectionUpsertRequest, PolicyUpdateRequest, fail, ok

router = APIRouter(prefix="/api")


@router.get("/status")
def get_status(request: Request):
    runtime = request.app.state.runtime
    snapshot = runtime.snapshot()
    return ok(model_to_dict(snapshot))


@router.get("/history")
def get_history(
    request: Request,
    hours: int = Query(default=24, ge=1, le=24),
    limit: int | None = Query(default=None, ge=1, le=20000),
):
    state_store = request.app.state.state_store
    records = state_store.load_history(hours=hours, limit=limit)
    return ok({"hours": hours, "count": len(records), "records": records})


@router.get("/config")
def get_config(request: Request):
    config_store = request.app.state.config_store
    return ok({"path": str(config_store.path), "config": model_to_dict(config_store.config)})


@router.post("/config")
def update_config(payload: ConfigUpdateRequest, request: Request):
    config_store = request.app.state.config_store
    manager = request.app.state.connection_manager
    runtime = request.app.state.runtime
    try:
        config = config_store.replace_config(payload.config)
        manager.sync_from_config()
        runtime.set_policy(config.policy)
        return ok({"path": str(config_store.path), "config": model_to_dict(config)})
    except Exception as exc:
        return fail(str(exc))


@router.get("/connections")
def get_connections(request: Request):
    config_store = request.app.state.config_store
    runtime = request.app.state.runtime
    backend = request.app.state.charging_backend
    snapshot = runtime.snapshot()
    data = []
    for conn in config_store.config.connections:
        data.append(
            {
                "connection": model_to_dict(conn),
                "health": model_to_dict(snapshot.connection_health.get(conn.id)) if conn.id in snapshot.connection_health else None,
                "control_capability": model_to_dict(backend.capability(conn)),
                "active": conn.id == config_store.config.active_connection_id,
            }
        )
    return ok(data)


@router.post("/connections/active")
def set_active_connection(payload: ActiveConnectionRequest, request: Request):
    manager = request.app.state.connection_manager
    try:
        conn = manager.set_active(payload.connection_id)
        return ok({"active_connection": model_to_dict(conn)})
    except (KeyError, ValueError) as exc:
        return fail(str(exc))


@router.post("/connections")
def upsert_connection(payload: ConnectionUpsertRequest, request: Request):
    config_store = request.app.state.config_store
    manager = request.app.state.connection_manager
    try:
        connection = ConnectionConfig.model_validate(payload.model_dump())
        config = config_store.upsert_connection(connection, original_id=payload.original_id)
        manager.sync_from_config()
        return ok(
            {
                "connection": model_to_dict(connection),
                "active_connection_id": config.active_connection_id,
            }
        )
    except Exception as exc:
        return fail(str(exc))


@router.delete("/connections/{connection_id}")
def delete_connection(connection_id: str, request: Request):
    config_store = request.app.state.config_store
    manager = request.app.state.connection_manager
    try:
        config = config_store.delete_connection(connection_id)
        manager.sync_from_config()
        return ok({"active_connection_id": config.active_connection_id})
    except KeyError as exc:
        return fail(str(exc))


@router.get("/policy")
def get_policy(request: Request):
    return ok(model_to_dict(request.app.state.config_store.config.policy))


@router.post("/policy")
def update_policy(payload: PolicyUpdateRequest, request: Request):
    try:
        policy = PolicyConfig.model_validate(payload.model_dump())
        config = request.app.state.config_store.update_policy(policy)
        request.app.state.runtime.set_policy(config.policy)
        return ok(model_to_dict(config.policy))
    except Exception as exc:
        return fail(str(exc))
