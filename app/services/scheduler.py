from __future__ import annotations

import asyncio
import logging
from contextlib import suppress

from app.services.battery_service import BatteryService

logger = logging.getLogger(__name__)


class PollingScheduler:
    def __init__(self, battery_service: BatteryService, interval_seconds: float = 5.0):
        self.battery_service = battery_service
        self.interval_seconds = interval_seconds
        self._task: asyncio.Task[None] | None = None
        self._stop = asyncio.Event()

    async def start(self) -> None:
        if self._task is not None and not self._task.done():
            return
        self._stop.clear()
        self._task = asyncio.create_task(self._run(), name="battery-polling-scheduler")

    async def stop(self) -> None:
        self._stop.set()
        if self._task is not None:
            self._task.cancel()
            with suppress(asyncio.CancelledError):
                await self._task

    async def _run(self) -> None:
        logger.info("Battery polling scheduler started")
        while not self._stop.is_set():
            try:
                await asyncio.to_thread(self.battery_service.poll_once)
            except Exception:
                logger.exception("Unexpected polling scheduler error")
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=self.interval_seconds)
            except asyncio.TimeoutError:
                pass
        logger.info("Battery polling scheduler stopped")

