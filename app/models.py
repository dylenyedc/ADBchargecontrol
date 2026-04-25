from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ChargeControlConfig(BaseModel):
    """Optional per-connection charging control configuration.

    backend="none" is intentionally the default. Many Android devices do not
    expose a portable charging switch, so the service reports unsupported
    instead of pretending a control action succeeded.
    """

    backend: Literal["none", "sysfs", "commands"] = "none"
    sysfs_path: str | None = None
    enable_value: str = "1"
    disable_value: str = "0"
    enable_command: str | None = None
    disable_command: str | None = None
    require_su: bool = False


class ConnectionConfig(BaseModel):
    id: str
    name: str
    adb_path: str = "adb"
    server_host: str | None = "127.0.0.1"
    server_port: int | None = Field(default=5037, ge=1, le=65535)
    serial: str | None = None
    note: str | None = None
    enabled: bool = True
    charging: ChargeControlConfig = Field(default_factory=ChargeControlConfig)

    @field_validator("id")
    @classmethod
    def validate_id(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("connection id cannot be empty")
        return normalized

    @field_validator("name", "adb_path")
    @classmethod
    def validate_required_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("field cannot be empty")
        return normalized

    @field_validator("server_host", "serial", "note", mode="before")
    @classmethod
    def empty_string_to_none(cls, value: str | None) -> str | None:
        if isinstance(value, str) and not value.strip():
            return None
        return value


class PolicyConfig(BaseModel):
    charge_upper_limit: int = Field(default=80, ge=1, le=100)
    charge_lower_limit: int = Field(default=30, ge=0, le=99)
    temperature_stop_threshold_c: float = Field(default=42.0)
    temperature_resume_threshold_c: float = Field(default=40.0)
    minimum_allowed_battery_percent: int = Field(default=20, ge=0, le=100)
    force_charge_enabled: bool = False
    force_charge_stop_percent: int = Field(default=95, ge=1, le=100)
    charge_start_timeout_seconds: int = Field(default=30, ge=0, le=600)
    policy_name: str = "threshold"

    @model_validator(mode="after")
    def validate_policy_ranges(self) -> "PolicyConfig":
        if self.charge_lower_limit >= self.charge_upper_limit:
            raise ValueError("charge_lower_limit must be lower than charge_upper_limit")
        if self.temperature_resume_threshold_c >= self.temperature_stop_threshold_c:
            raise ValueError("temperature_resume_threshold_c must be lower than temperature_stop_threshold_c")
        return self


class AppConfig(BaseModel):
    connections: list[ConnectionConfig] = Field(default_factory=list)
    active_connection_id: str | None = None
    policy: PolicyConfig = Field(default_factory=PolicyConfig)


class PluggedState(BaseModel):
    ac: bool | None = None
    usb: bool | None = None
    wireless: bool | None = None
    dock: bool | None = None
    raw: str | int | None = None


class BatteryStatus(BaseModel):
    level: int | None = None
    status: str | None = None
    status_raw: str | int | None = None
    health: str | None = None
    health_raw: str | int | None = None
    temperature_c: float | None = None
    plugged: PluggedState = Field(default_factory=PluggedState)
    present: bool | None = None
    voltage_mv: int | None = None
    current_now_ua: int | None = None
    charge_counter_uah: int | None = None
    max_charging_current_ua: int | None = None
    max_charging_voltage_uv: int | None = None
    technology: str | None = None
    timestamp: datetime = Field(default_factory=utc_now)
    raw: dict[str, str] = Field(default_factory=dict)


class PolicyDecision(BaseModel):
    action: Literal["allow_charging", "stop_charging", "hold"] = "hold"
    reason: str = "no decision"
    desired_charging_enabled: bool | None = None
    policy_name: str = "threshold"
    timestamp: datetime = Field(default_factory=utc_now)


class ControlCapability(BaseModel):
    supported: bool
    backend: str = "none"
    message: str


class ControlResult(BaseModel):
    requested_enabled: bool | None = None
    action: Literal["enable_charging", "disable_charging", "noop"] = "noop"
    success: bool = False
    supported: bool = False
    backend: str = "none"
    message: str = ""
    timestamp: datetime = Field(default_factory=utc_now)


class ConnectionHealth(BaseModel):
    connection_id: str
    status: Literal["unknown", "connected", "disconnected", "offline", "disabled", "error"] = "unknown"
    connected: bool = False
    last_checked: datetime | None = None
    last_error: str | None = None
    reconnect_attempts: int = 0
    next_retry_at: datetime | None = None


class RuntimeSnapshot(BaseModel):
    active_connection: ConnectionConfig | None = None
    battery: BatteryStatus | None = None
    policy: PolicyConfig
    decision: PolicyDecision | None = None
    last_action: ControlResult | None = None
    requested_charging_enabled: bool | None = None
    connection_health: dict[str, ConnectionHealth] = Field(default_factory=dict)
    control_capability: ControlCapability | None = None
    last_error: str | None = None
    timestamp: datetime = Field(default_factory=utc_now)


class BatteryHistoryRecord(BaseModel):
    timestamp: datetime = Field(default_factory=utc_now)
    connection_id: str
    connection_name: str | None = None
    battery: BatteryStatus
    is_charging: bool | None = None
    power_connected: bool | None = None
    policy: PolicyConfig
    decision: PolicyDecision | None = None
    action_executed: bool = False
    last_action: ControlResult | None = None
    requested_charging_enabled: bool | None = None
    control_capability: ControlCapability | None = None
    last_error: str | None = None
