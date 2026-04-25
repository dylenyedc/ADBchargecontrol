from __future__ import annotations

import re
from typing import Any

from app.models import BatteryStatus, PluggedState

STATUS_MAP = {
    "1": "unknown",
    "2": "charging",
    "3": "discharging",
    "4": "not_charging",
    "5": "full",
}

HEALTH_MAP = {
    "1": "unknown",
    "2": "good",
    "3": "overheat",
    "4": "dead",
    "5": "over_voltage",
    "6": "unspecified_failure",
    "7": "cold",
}

PLUGGED_MAP = {
    1: "ac",
    2: "usb",
    4: "wireless",
    8: "dock",
}


def _normalize_key(key: str) -> str:
    key = key.strip().lower()
    key = re.sub(r"[^a-z0-9]+", "_", key)
    return key.strip("_")


def _to_bool(value: str) -> bool | None:
    lowered = value.strip().lower()
    if lowered in {"true", "1", "yes", "y", "on"}:
        return True
    if lowered in {"false", "0", "no", "n", "off"}:
        return False
    return None


def _to_int(value: str) -> int | None:
    match = re.search(r"-?\d+", value)
    if not match:
        return None
    try:
        return int(match.group(0))
    except ValueError:
        return None


def _parse_temperature(value: str | None) -> float | None:
    if value is None:
        return None
    match = re.search(r"-?\d+(?:\.\d+)?", value)
    if not match:
        return None
    raw = float(match.group(0))
    # Android commonly reports tenths of Celsius, e.g. 313 means 31.3C.
    # Values in a normal Celsius range are left untouched for custom ROMs.
    if abs(raw) > 100:
        raw = raw / 10.0
    return round(raw, 2)


def _normalize_enum(value: str | None, mapping: dict[str, str]) -> tuple[str | None, str | int | None]:
    if value is None:
        return None, None
    raw = value.strip()
    raw_int = _to_int(raw)
    if raw_int is not None and str(raw_int) in mapping:
        return mapping[str(raw_int)], raw_int
    normalized = raw.lower().replace(" ", "_")
    return normalized or None, raw


def _parse_plugged(raw: dict[str, str]) -> PluggedState:
    plugged = PluggedState(
        ac=_to_bool(raw["ac_powered"]) if "ac_powered" in raw else None,
        usb=_to_bool(raw["usb_powered"]) if "usb_powered" in raw else None,
        wireless=_to_bool(raw["wireless_powered"]) if "wireless_powered" in raw else None,
    )

    if "dock_powered" in raw:
        plugged.dock = _to_bool(raw["dock_powered"])

    if "plugged" in raw:
        raw_value = raw["plugged"]
        plugged.raw = _to_int(raw_value) if _to_int(raw_value) is not None else raw_value
        numeric = _to_int(raw_value)
        if numeric is not None:
            for bit, key in PLUGGED_MAP.items():
                if numeric & bit:
                    setattr(plugged, key, True)
                elif getattr(plugged, key) is None:
                    setattr(plugged, key, False)
    return plugged


def parse_dumpsys_battery(output: str) -> BatteryStatus:
    raw: dict[str, str] = {}
    for line in output.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        normalized = _normalize_key(key)
        if normalized:
            raw[normalized] = value.strip()

    status, status_raw = _normalize_enum(raw.get("status"), STATUS_MAP)
    health, health_raw = _normalize_enum(raw.get("health"), HEALTH_MAP)

    level = _to_int(raw.get("level", "")) if "level" in raw else None
    if level is not None:
        level = max(0, min(100, level))

    present = _to_bool(raw["present"]) if "present" in raw else None
    voltage = _to_int(raw.get("voltage", "")) if "voltage" in raw else None
    charge_counter = _to_int(raw.get("charge_counter", "")) if "charge_counter" in raw else None
    max_charging_current = _to_int(raw.get("max_charging_current", "")) if "max_charging_current" in raw else None
    max_charging_voltage = _to_int(raw.get("max_charging_voltage", "")) if "max_charging_voltage" in raw else None
    technology = raw.get("technology")

    return BatteryStatus(
        level=level,
        status=status,
        status_raw=status_raw,
        health=health,
        health_raw=health_raw,
        temperature_c=_parse_temperature(raw.get("temperature")),
        plugged=_parse_plugged(raw),
        present=present,
        voltage_mv=voltage,
        charge_counter_uah=charge_counter,
        max_charging_current_ua=max_charging_current,
        max_charging_voltage_uv=max_charging_voltage,
        technology=technology or None,
        raw=raw,
    )
