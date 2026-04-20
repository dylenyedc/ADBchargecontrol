from __future__ import annotations

from threading import RLock

from app.models import (
    BatteryStatus,
    ConnectionConfig,
    ConnectionHealth,
    ControlCapability,
    ControlResult,
    PolicyConfig,
    PolicyDecision,
    RuntimeSnapshot,
    utc_now,
)


class RuntimeStore:
    """Thread-safe in-memory runtime state exposed by API and UI."""

    def __init__(self, policy: PolicyConfig, active_connection: ConnectionConfig | None = None):
        self._lock = RLock()
        self._active_connection = active_connection
        self._battery: BatteryStatus | None = None
        self._policy = policy
        self._decision: PolicyDecision | None = None
        self._last_action: ControlResult | None = None
        self._requested_charging_enabled: bool | None = None
        self._connection_health: dict[str, ConnectionHealth] = {}
        self._control_capability: ControlCapability | None = None
        self._last_error: str | None = None

    def snapshot(self) -> RuntimeSnapshot:
        with self._lock:
            return RuntimeSnapshot(
                active_connection=self._active_connection,
                battery=self._battery,
                policy=self._policy,
                decision=self._decision,
                last_action=self._last_action,
                requested_charging_enabled=self._requested_charging_enabled,
                connection_health={key: value.model_copy(deep=True) for key, value in self._connection_health.items()},
                control_capability=self._control_capability,
                last_error=self._last_error,
                timestamp=utc_now(),
            )

    def set_active_connection(self, connection: ConnectionConfig | None) -> None:
        with self._lock:
            self._active_connection = connection

    def set_policy(self, policy: PolicyConfig) -> None:
        with self._lock:
            self._policy = policy

    def update_poll_result(
        self,
        battery: BatteryStatus | None,
        decision: PolicyDecision | None,
        capability: ControlCapability | None,
        error: str | None = None,
    ) -> None:
        with self._lock:
            self._battery = battery
            self._decision = decision
            self._control_capability = capability
            self._last_error = error

    def set_last_action(self, action: ControlResult | None) -> None:
        with self._lock:
            self._last_action = action

    def set_requested_charging_enabled(self, enabled: bool | None) -> None:
        with self._lock:
            self._requested_charging_enabled = enabled

    def requested_charging_enabled(self) -> bool | None:
        with self._lock:
            return self._requested_charging_enabled

    def update_health(self, connection_id: str, health: ConnectionHealth) -> None:
        with self._lock:
            self._connection_health[connection_id] = health

    def remove_health(self, connection_id: str) -> None:
        with self._lock:
            self._connection_health.pop(connection_id, None)

    def get_health(self, connection_id: str) -> ConnectionHealth | None:
        with self._lock:
            health = self._connection_health.get(connection_id)
            return health.model_copy(deep=True) if health else None

    def health_ids(self) -> set[str]:
        with self._lock:
            return set(self._connection_health)
