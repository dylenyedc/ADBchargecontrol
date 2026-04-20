from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from threading import RLock
from typing import Any

from pydantic import ValidationError

from app.models import AppConfig, ConnectionConfig, PolicyConfig

logger = logging.getLogger(__name__)

DEFAULT_CONFIG_PATH = Path(os.getenv("ADBCC_CONFIG_PATH", "data/config.json"))


def model_to_dict(model: Any) -> dict[str, Any]:
    return model.model_dump(mode="json")


class ConfigStore:
    """Small JSON-backed configuration store."""

    def __init__(self, path: Path | str = DEFAULT_CONFIG_PATH):
        self.path = Path(path)
        self._lock = RLock()
        self._config = self._load_or_create()

    @property
    def config(self) -> AppConfig:
        with self._lock:
            return self._config.model_copy(deep=True)

    def _load_or_create(self) -> AppConfig:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            config = self.default_config()
            self._write(config)
            return config

        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            return AppConfig.model_validate(data)
        except (json.JSONDecodeError, ValidationError) as exc:
            logger.error("Failed to load config %s: %s", self.path, exc)
            raise

    @staticmethod
    def default_config() -> AppConfig:
        return AppConfig(
            connections=[
                ConnectionConfig(
                    id="default_usb",
                    name="Default USB",
                    adb_path="adb",
                    server_host="127.0.0.1",
                    server_port=5037,
                    serial=None,
                    enabled=True,
                )
            ],
            active_connection_id="default_usb",
            policy=PolicyConfig(),
        )

    def _write(self, config: AppConfig) -> None:
        self.path.write_text(
            json.dumps(model_to_dict(config), indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    def save(self, config: AppConfig) -> AppConfig:
        with self._lock:
            config.active_connection_id = self._next_active_id(config, preferred=config.active_connection_id)
            self._write(config)
            self._config = config.model_copy(deep=True)
            return self._config.model_copy(deep=True)

    def replace_config(self, config: AppConfig) -> AppConfig:
        with self._lock:
            return self.save(config)

    def update_policy(self, policy: PolicyConfig) -> AppConfig:
        with self._lock:
            config = self._config.model_copy(deep=True)
            config.policy = policy
            return self.save(config)

    def upsert_connection(self, connection: ConnectionConfig, original_id: str | None = None) -> AppConfig:
        with self._lock:
            config = self._config.model_copy(deep=True)
            original_id = original_id or connection.id
            if original_id != connection.id and any(
                conn.id == connection.id and conn.id != original_id for conn in config.connections
            ):
                raise ValueError(f"connection id already exists: {connection.id}")
            updated = False
            connections: list[ConnectionConfig] = []
            for existing in config.connections:
                if existing.id == original_id or existing.id == connection.id:
                    if not updated:
                        connections.append(connection)
                    updated = True
                else:
                    connections.append(existing)
            if not updated:
                connections.append(connection)

            config.connections = connections
            if config.active_connection_id == original_id:
                config.active_connection_id = connection.id
            config.active_connection_id = self._next_active_id(config, preferred=config.active_connection_id)
            return self.save(config)

    def delete_connection(self, connection_id: str) -> AppConfig:
        with self._lock:
            config = self._config.model_copy(deep=True)
            remaining = [conn for conn in config.connections if conn.id != connection_id]
            if len(remaining) == len(config.connections):
                raise KeyError(f"unknown connection id: {connection_id}")
            config.connections = remaining
            config.active_connection_id = self._next_active_id(config, preferred=config.active_connection_id)
            return self.save(config)

    def set_active_connection(self, connection_id: str) -> AppConfig:
        with self._lock:
            config = self._config.model_copy(deep=True)
            known = {conn.id: conn for conn in config.connections}
            if connection_id not in known:
                raise KeyError(f"unknown connection id: {connection_id}")
            if not known[connection_id].enabled:
                raise ValueError(f"connection is disabled: {connection_id}")
            config.active_connection_id = connection_id
            return self.save(config)

    @staticmethod
    def _next_active_id(config: AppConfig, preferred: str | None) -> str | None:
        enabled_by_id = {conn.id: conn for conn in config.connections if conn.enabled}
        if preferred in enabled_by_id:
            return preferred
        first_enabled = next((conn.id for conn in config.connections if conn.enabled), None)
        return first_enabled

    def get_connection(self, connection_id: str | None) -> ConnectionConfig | None:
        if connection_id is None:
            return None
        config = self.config
        return next((conn for conn in config.connections if conn.id == connection_id), None)

    def active_connection(self) -> ConnectionConfig | None:
        config = self.config
        return next((conn for conn in config.connections if conn.id == config.active_connection_id), None)
