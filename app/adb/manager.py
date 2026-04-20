from __future__ import annotations

import logging
from datetime import timedelta

from app.adb.client import AdbClient, AdbCommandError
from app.adb.parser import parse_dumpsys_battery
from app.config import ConfigStore
from app.models import BatteryStatus, ConnectionConfig, ConnectionHealth, utc_now
from app.services.runtime import RuntimeStore

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Owns ADB connection health and reconnect behavior."""

    def __init__(self, config_store: ConfigStore, runtime: RuntimeStore):
        self.config_store = config_store
        self.runtime = runtime
        self._ensure_health_entries()

    def _ensure_health_entries(self) -> None:
        config = self.config_store.config
        current_ids = {conn.id for conn in config.connections}
        for existing_id in self.runtime.health_ids() - current_ids:
            self.runtime.remove_health(existing_id)
        for conn in config.connections:
            if not conn.enabled:
                self.runtime.update_health(
                    conn.id,
                    ConnectionHealth(connection_id=conn.id, status="disabled", connected=False, last_checked=utc_now()),
                )
            elif conn.id not in self.runtime.health_ids():
                status = "disabled" if not conn.enabled else "unknown"
                self.runtime.update_health(
                    conn.id,
                    ConnectionHealth(connection_id=conn.id, status=status, connected=False),
                )

    def sync_from_config(self) -> None:
        self._ensure_health_entries()
        self.runtime.set_active_connection(self.config_store.active_connection())
        self.runtime.set_requested_charging_enabled(None)

    def active_connection(self) -> ConnectionConfig | None:
        return self.config_store.active_connection()

    def set_active(self, connection_id: str) -> ConnectionConfig:
        config = self.config_store.set_active_connection(connection_id)
        conn = next(item for item in config.connections if item.id == connection_id)
        self.runtime.set_active_connection(conn)
        self.runtime.set_requested_charging_enabled(None)
        logger.info("Switched active ADB connection to %s", connection_id)
        return conn

    def _client(self, conn: ConnectionConfig) -> AdbClient:
        return AdbClient(conn)

    def _mark_failure(self, conn: ConnectionConfig, error: Exception) -> None:
        now = utc_now()
        current = self.runtime.get_health(conn.id) or ConnectionHealth(connection_id=conn.id)
        attempts = current.reconnect_attempts + 1
        delay_seconds = min(60, 5 * (2 ** min(attempts - 1, 4)))
        message = str(error)
        status = "offline" if "offline" in message.lower() else "disconnected"
        self.runtime.update_health(
            conn.id,
            ConnectionHealth(
                connection_id=conn.id,
                status=status,
                connected=False,
                last_checked=now,
                last_error=message,
                reconnect_attempts=attempts,
                next_retry_at=now + timedelta(seconds=delay_seconds),
            ),
        )
        logger.warning("ADB connection %s failed: %s", conn.id, message)

    def _mark_connected(self, conn: ConnectionConfig) -> None:
        self.runtime.update_health(
            conn.id,
            ConnectionHealth(
                connection_id=conn.id,
                status="connected",
                connected=True,
                last_checked=utc_now(),
                last_error=None,
                reconnect_attempts=0,
                next_retry_at=None,
            ),
        )

    def reconnect_if_due(self, conn: ConnectionConfig) -> bool:
        if not conn.enabled:
            self.runtime.update_health(
                conn.id,
                ConnectionHealth(connection_id=conn.id, status="disabled", connected=False, last_checked=utc_now()),
            )
            return False

        health = self.runtime.get_health(conn.id)
        if health and health.next_retry_at and health.next_retry_at > utc_now():
            return False

        client = self._client(conn)
        try:
            client.start_server()
            state = client.get_state()
            if state != "device":
                raise RuntimeError(f"adb state is {state}")
            self._mark_connected(conn)
            logger.info("ADB connection %s is connected", conn.id)
            return True
        except Exception as exc:
            self._mark_failure(conn, exc)
            return False

    def maintain_connections(self) -> None:
        self._ensure_health_entries()
        for conn in self.config_store.config.connections:
            if not conn.enabled:
                continue
            health = self.runtime.get_health(conn.id)
            if health is None:
                self.reconnect_if_due(conn)
            elif not health.connected and (health.next_retry_at is None or health.next_retry_at <= utc_now()):
                self.reconnect_if_due(conn)

    def read_battery(self, conn: ConnectionConfig) -> BatteryStatus:
        if not conn.enabled:
            raise RuntimeError(f"connection is disabled: {conn.id}")

        health = self.runtime.get_health(conn.id)
        if health and not health.connected and health.next_retry_at and health.next_retry_at > utc_now():
            raise RuntimeError(f"connection retry scheduled at {health.next_retry_at.isoformat()}")

        client = self._client(conn)
        try:
            output = client.dumpsys_battery()
            battery = parse_dumpsys_battery(output)
            self._mark_connected(conn)
            return battery
        except AdbCommandError as exc:
            self._mark_failure(conn, exc)
            self.reconnect_if_due(conn)
            raise
        except Exception as exc:
            self._mark_failure(conn, exc)
            raise
