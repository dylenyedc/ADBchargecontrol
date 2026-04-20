from __future__ import annotations

import logging
from datetime import datetime

from app.adb.manager import ConnectionManager
from app.charging.backend import ChargingBackend
from app.config import ConfigStore
from app.models import BatteryStatus, ControlCapability, ControlResult, PolicyDecision, utc_now
from app.policy.engine import PolicyEngine
from app.services.runtime import RuntimeStore
from app.services.state_store import StateStore

logger = logging.getLogger(__name__)


class BatteryService:
    def __init__(
        self,
        config_store: ConfigStore,
        connection_manager: ConnectionManager,
        policy_engine: PolicyEngine,
        charging_backend: ChargingBackend,
        runtime: RuntimeStore,
        state_store: StateStore,
    ):
        self.config_store = config_store
        self.connection_manager = connection_manager
        self.policy_engine = policy_engine
        self.charging_backend = charging_backend
        self.runtime = runtime
        self.state_store = state_store
        self._last_active_connection_id: str | None = None
        self._charge_start_requested_at: datetime | None = None

    def poll_once(self) -> None:
        action_executed = False
        config = self.config_store.config
        active = self.config_store.active_connection()
        self.runtime.set_policy(config.policy)
        self.runtime.set_active_connection(active)

        self.connection_manager.maintain_connections()

        if active is None:
            self._last_active_connection_id = None
            self._charge_start_requested_at = None
            self.runtime.update_poll_result(None, None, None, "no active connection configured")
            self.state_store.save_snapshot(self.runtime.snapshot())
            return

        if self._last_active_connection_id is not None and self._last_active_connection_id != active.id:
            self.policy_engine.reset()
            self._charge_start_requested_at = None
        self._last_active_connection_id = active.id

        capability = self.charging_backend.capability(active)
        health = self.runtime.get_health(active.id)
        if health and not health.connected and health.next_retry_at and health.next_retry_at > utc_now():
            message = f"connection retry scheduled at {health.next_retry_at.isoformat()}"
            decision = PolicyDecision(action="hold", reason="connection unavailable", desired_charging_enabled=None)
            self.runtime.update_poll_result(None, decision, capability, message)
            self.runtime.set_last_action(
                ControlResult(
                    requested_enabled=None,
                    action="noop",
                    success=True,
                    supported=capability.supported,
                    backend=capability.backend,
                    message=message,
                )
            )
            self.state_store.save_snapshot(self.runtime.snapshot())
            return

        try:
            battery = self.connection_manager.read_battery(active)
            decision = self.policy_engine.evaluate(battery, config.policy)
            self.runtime.update_poll_result(battery, decision, capability, None)

            desired = decision.desired_charging_enabled
            command_failed = False
            if desired is not None and desired != self.runtime.requested_charging_enabled():
                result = self.charging_backend.set_charging_enabled(active, desired)
                self.runtime.set_last_action(result)
                self.runtime.set_requested_charging_enabled(desired)
                command_failed = not result.success
                action_executed = True
            elif desired is None:
                self.runtime.set_last_action(
                    ControlResult(
                        requested_enabled=None,
                        action="noop",
                        success=True,
                        supported=capability.supported,
                        backend=capability.backend,
                        message="policy requested no change",
                    )
                )

            self._update_charge_start_status(
                battery=battery,
                desired=desired,
                capability=capability,
                timeout_seconds=config.policy.charge_start_timeout_seconds,
                command_failed=command_failed,
            )

        except Exception as exc:
            logger.warning("Battery poll failed for connection %s: %s", active.id, exc)
            self.runtime.update_poll_result(None, None, capability, str(exc))
        finally:
            snapshot = self.runtime.snapshot()
            self.state_store.save_snapshot(snapshot)
            self.state_store.append_history_snapshot(snapshot, action_executed=action_executed)

    def _update_charge_start_status(
        self,
        battery: BatteryStatus,
        desired: bool | None,
        capability: ControlCapability,
        timeout_seconds: int,
        command_failed: bool = False,
    ) -> None:
        if command_failed:
            self._charge_start_requested_at = None
            return

        policy_requests_charging = self._policy_requests_charging(desired)
        if not policy_requests_charging:
            self._charge_start_requested_at = None
            return

        if battery.status == "charging":
            self._charge_start_requested_at = None
            self.runtime.set_last_action(
                ControlResult(
                    requested_enabled=True,
                    action="enable_charging",
                    success=True,
                    supported=capability.supported,
                    backend=capability.backend,
                    message="device reports charging",
                )
            )
            return

        now = utc_now()
        if self._charge_start_requested_at is None:
            self._charge_start_requested_at = now

        elapsed_seconds = (now - self._charge_start_requested_at).total_seconds()
        if elapsed_seconds < timeout_seconds:
            self.runtime.set_last_action(
                ControlResult(
                    requested_enabled=True,
                    action="enable_charging",
                    success=True,
                    supported=capability.supported,
                    backend=capability.backend,
                    message=(
                        "waiting for device to report charging "
                        f"({int(elapsed_seconds)}/{timeout_seconds}s)"
                    ),
                )
            )
            return

        if self._power_connected(battery) is False:
            self.runtime.set_last_action(self._no_power_failure(capability, timeout_seconds))
            return

        self.runtime.set_last_action(
            ControlResult(
                requested_enabled=True,
                action="enable_charging",
                success=False,
                supported=capability.supported,
                backend=capability.backend,
                message=f"policy requested charging but device did not report charging within {timeout_seconds}s",
            )
        )

    def _policy_requests_charging(self, desired: bool | None) -> bool:
        return desired is True or (desired is None and self.runtime.requested_charging_enabled() is True)

    @staticmethod
    def _power_connected(battery: BatteryStatus) -> bool | None:
        plugged = battery.plugged
        values = [plugged.ac, plugged.usb, plugged.wireless, plugged.dock]
        if any(value is True for value in values):
            return True
        if any(value is False for value in values):
            return False
        return None

    @staticmethod
    def _no_power_failure(capability: ControlCapability, timeout_seconds: int) -> ControlResult:
        return ControlResult(
            requested_enabled=True,
            action="enable_charging",
            success=False,
            supported=capability.supported,
            backend=capability.backend,
            message=(
                "policy requested charging but device reports no external power connected "
                f"after {timeout_seconds}s"
            ),
        )
