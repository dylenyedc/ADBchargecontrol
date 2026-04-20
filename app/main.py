from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.adb.manager import ConnectionManager
from app.charging.adb_backend import AdbChargingBackend
from app.config import ConfigStore
from app.policy.engine import PolicyEngine
from app.services.battery_service import BatteryService
from app.services.runtime import RuntimeStore
from app.services.scheduler import PollingScheduler
from app.services.state_store import StateStore
from app.web.api import router as api_router
from app.web.routes import router as web_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
logger = logging.getLogger(__name__)


def build_services() -> dict[str, object]:
    config_store = ConfigStore()
    config = config_store.config
    runtime = RuntimeStore(policy=config.policy, active_connection=config_store.active_connection())
    state_store = StateStore()
    connection_manager = ConnectionManager(config_store, runtime)
    policy_engine = PolicyEngine()
    charging_backend = AdbChargingBackend()
    battery_service = BatteryService(
        config_store=config_store,
        connection_manager=connection_manager,
        policy_engine=policy_engine,
        charging_backend=charging_backend,
        runtime=runtime,
        state_store=state_store,
    )
    scheduler = PollingScheduler(battery_service=battery_service, interval_seconds=5.0)
    return {
        "config_store": config_store,
        "runtime": runtime,
        "state_store": state_store,
        "connection_manager": connection_manager,
        "policy_engine": policy_engine,
        "charging_backend": charging_backend,
        "battery_service": battery_service,
        "scheduler": scheduler,
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    services = build_services()
    for key, value in services.items():
        setattr(app.state, key, value)
    await app.state.scheduler.start()
    logger.info("ADB charge control service started")
    try:
        yield
    finally:
        await app.state.scheduler.stop()


app = FastAPI(title="ADB Charge Control", version="0.1.0", lifespan=lifespan)
app.mount("/static", StaticFiles(directory="app/web/static"), name="static")
app.include_router(api_router)
app.include_router(web_router)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc: RequestValidationError):
    return JSONResponse(status_code=422, content={"ok": False, "data": None, "error": str(exc)})
