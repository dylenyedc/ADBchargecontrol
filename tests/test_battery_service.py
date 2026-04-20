from datetime import timedelta

from app.charging.backend import ChargingBackend
from app.config import ConfigStore
from app.models import (
    AppConfig,
    BatteryStatus,
    ConnectionConfig,
    ControlCapability,
    ControlResult,
    PluggedState,
    PolicyConfig,
    utc_now,
)
from app.policy.engine import PolicyEngine
from app.services.battery_service import BatteryService
from app.services.runtime import RuntimeStore
from app.services.state_store import StateStore


class FakeConnectionManager:
    def __init__(self, battery: BatteryStatus):
        self.battery = battery

    def maintain_connections(self) -> None:
        return None

    def read_battery(self, connection: ConnectionConfig) -> BatteryStatus:
        return self.battery


class FakeChargingBackend(ChargingBackend):
    def __init__(self):
        self.calls: list[bool] = []

    def capability(self, connection: ConnectionConfig) -> ControlCapability:
        return ControlCapability(supported=True, backend="fake", message="fake charging backend")

    def set_charging_enabled(self, connection: ConnectionConfig, enabled: bool) -> ControlResult:
        self.calls.append(enabled)
        return ControlResult(
            requested_enabled=enabled,
            action="enable_charging" if enabled else "disable_charging",
            success=True,
            supported=True,
            backend="fake",
            message="fake command executed",
        )


def make_service(tmp_path, battery: BatteryStatus, policy: PolicyConfig | None = None):
    config_store = ConfigStore(tmp_path / "config.json")
    config_store.save(
        AppConfig(
            connections=[ConnectionConfig(id="phone", name="Phone")],
            active_connection_id="phone",
            policy=policy or PolicyConfig(charge_upper_limit=80, charge_lower_limit=50),
        )
    )
    runtime = RuntimeStore(policy=config_store.config.policy, active_connection=config_store.active_connection())
    backend = FakeChargingBackend()
    service = BatteryService(
        config_store=config_store,
        connection_manager=FakeConnectionManager(battery),
        policy_engine=PolicyEngine(),
        charging_backend=backend,
        runtime=runtime,
        state_store=StateStore(path=tmp_path / "state.json", history_path=tmp_path / "history.jsonl"),
    )
    return service, runtime, backend


def test_policy_charge_without_external_power_waits_before_failure(tmp_path):
    battery = BatteryStatus(
        level=40,
        status="discharging",
        temperature_c=35.0,
        plugged=PluggedState(ac=False, usb=False, wireless=False, dock=False, raw=0),
    )
    service, runtime, backend = make_service(tmp_path, battery)

    service.poll_once()

    snapshot = runtime.snapshot()
    assert backend.calls == [True]
    assert snapshot.decision.action == "allow_charging"
    assert snapshot.last_action.action == "enable_charging"
    assert snapshot.last_action.success is True
    assert "waiting for device to report charging" in snapshot.last_action.message

    history = service.state_store.load_history()
    assert history[0]["last_action"]["success"] is True
    assert history[0]["power_connected"] is False


def test_policy_charge_without_external_power_fails_after_timeout(tmp_path):
    battery = BatteryStatus(
        level=40,
        status="discharging",
        temperature_c=35.0,
        plugged=PluggedState(ac=False, usb=False, wireless=False, dock=False, raw=0),
    )
    policy = PolicyConfig(charge_upper_limit=80, charge_lower_limit=50, charge_start_timeout_seconds=10)
    service, runtime, backend = make_service(tmp_path, battery, policy=policy)

    service.poll_once()
    service._charge_start_requested_at = utc_now() - timedelta(seconds=11)
    service.poll_once()

    snapshot = runtime.snapshot()
    assert backend.calls == [True]
    assert snapshot.last_action.action == "enable_charging"
    assert snapshot.last_action.success is False
    assert "no external power" in snapshot.last_action.message
    assert "after 10s" in snapshot.last_action.message


def test_existing_requested_charge_without_external_power_waits_before_failure(tmp_path):
    battery = BatteryStatus(
        level=60,
        status="discharging",
        temperature_c=35.0,
        plugged=PluggedState(ac=False, usb=False, wireless=False, dock=False, raw=0),
    )
    service, runtime, backend = make_service(tmp_path, battery)
    runtime.set_requested_charging_enabled(True)

    service.poll_once()

    snapshot = runtime.snapshot()
    assert backend.calls == []
    assert snapshot.decision.action == "hold"
    assert snapshot.last_action.action == "enable_charging"
    assert snapshot.last_action.success is True
    assert "waiting for device to report charging" in snapshot.last_action.message


def test_unknown_power_connection_does_not_mark_charge_failure(tmp_path):
    battery = BatteryStatus(level=40, status="discharging", temperature_c=35.0, plugged=PluggedState())
    service, runtime, backend = make_service(tmp_path, battery)

    service.poll_once()

    snapshot = runtime.snapshot()
    assert backend.calls == [True]
    assert snapshot.last_action.success is True
    assert "waiting for device to report charging" in snapshot.last_action.message


def test_charging_status_clears_pending_charge_failure(tmp_path):
    battery = BatteryStatus(
        level=40,
        status="discharging",
        temperature_c=35.0,
        plugged=PluggedState(ac=False, usb=False, wireless=False, dock=False, raw=0),
    )
    service, runtime, backend = make_service(tmp_path, battery)

    service.poll_once()
    service.connection_manager.battery = BatteryStatus(
        level=40,
        status="charging",
        temperature_c=35.0,
        plugged=PluggedState(ac=False, usb=True, wireless=False, dock=False, raw=2),
    )
    service.poll_once()

    snapshot = runtime.snapshot()
    assert backend.calls == [True]
    assert snapshot.last_action.action == "enable_charging"
    assert snapshot.last_action.success is True
    assert snapshot.last_action.message == "device reports charging"
