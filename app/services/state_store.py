from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import RLock
from typing import Any

from app.config import model_to_dict
from app.models import BatteryHistoryRecord, BatteryStatus, ControlResult, PolicyDecision, RuntimeSnapshot

logger = logging.getLogger(__name__)

DEFAULT_STATE_PATH = Path(os.getenv("ADBCC_STATE_PATH", "data/state.json"))
DEFAULT_HISTORY_PATH = Path(os.getenv("ADBCC_HISTORY_PATH", "data/history.jsonl"))


class StateStore:
    """Tiny JSON state persistence for the last known runtime facts."""

    def __init__(
        self,
        path: Path | str = DEFAULT_STATE_PATH,
        history_path: Path | str = DEFAULT_HISTORY_PATH,
        history_retention_hours: int = 24,
    ):
        self.path = Path(path)
        self.history_path = Path(history_path)
        self.history_retention = timedelta(hours=history_retention_hours)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.history_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()

    def save_snapshot(self, snapshot: RuntimeSnapshot) -> None:
        data: dict[str, Any] = {
            "battery": model_to_dict(snapshot.battery) if isinstance(snapshot.battery, BatteryStatus) else None,
            "decision": model_to_dict(snapshot.decision) if isinstance(snapshot.decision, PolicyDecision) else None,
            "last_action": model_to_dict(snapshot.last_action) if isinstance(snapshot.last_action, ControlResult) else None,
            "timestamp": snapshot.timestamp.isoformat(),
        }
        with self._lock:
            self.path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    def append_history_snapshot(self, snapshot: RuntimeSnapshot, action_executed: bool = False) -> BatteryHistoryRecord | None:
        if snapshot.active_connection is None or snapshot.battery is None:
            return None

        plugged = snapshot.battery.plugged
        plug_values = [plugged.ac, plugged.usb, plugged.wireless, plugged.dock]
        power_connected = True if any(value is True for value in plug_values) else False if any(value is False for value in plug_values) else None
        is_charging = snapshot.battery.status == "charging" if snapshot.battery.status is not None else None

        record = BatteryHistoryRecord(
            timestamp=snapshot.timestamp,
            connection_id=snapshot.active_connection.id,
            connection_name=snapshot.active_connection.name,
            battery=snapshot.battery,
            is_charging=is_charging,
            power_connected=power_connected,
            policy=snapshot.policy,
            decision=snapshot.decision,
            action_executed=action_executed,
            last_action=snapshot.last_action,
            requested_charging_enabled=snapshot.requested_charging_enabled,
            control_capability=snapshot.control_capability,
            last_error=snapshot.last_error,
        )

        record_data = model_to_dict(record)
        line = json.dumps(record_data, ensure_ascii=False)
        with self._lock:
            records = self._load_recent_history_items_locked(self.history_retention)
            if records and self._history_fingerprint(records[-1]) == self._history_fingerprint(record_data):
                self._write_history_items_locked(records)
                return None
            self._write_history_items_locked(records)
            with self.history_path.open("a", encoding="utf-8") as handle:
                handle.write(line + "\n")
        return record

    def load_history(self, hours: int = 24, limit: int | None = None) -> list[dict[str, Any]]:
        if not self.history_path.exists():
            return []

        with self._lock:
            records = self._load_recent_history_items_locked(timedelta(hours=hours))

        if limit is not None and limit >= 0:
            records = records[-limit:]
        return records

    def prune_history_locked(self) -> None:
        self._write_history_items_locked(self._load_recent_history_items_locked(self.history_retention))

    def compact_history(self) -> tuple[int, int]:
        with self._lock:
            records = self._load_recent_history_items_locked(self.history_retention)
            compacted = self._dedupe_history_items(records)
            self._write_history_items_locked(compacted)
            return len(records), len(compacted)

    def _load_recent_history_items_locked(self, retention: timedelta) -> list[dict[str, Any]]:
        if not self.history_path.exists():
            return []

        cutoff = datetime.now(timezone.utc) - retention
        records: list[dict[str, Any]] = []
        for raw_line in self.history_path.read_text(encoding="utf-8").splitlines():
            if not raw_line.strip():
                continue
            try:
                item = json.loads(raw_line)
                timestamp = self._parse_timestamp(item["timestamp"])
            except (json.JSONDecodeError, KeyError, ValueError) as exc:
                logger.warning("Skipping invalid history line in %s: %s", self.history_path, exc)
                continue
            if timestamp >= cutoff:
                records.append(item)
        return records

    def _write_history_items_locked(self, records: list[dict[str, Any]]) -> None:
        lines = [json.dumps(item, ensure_ascii=False) for item in records]
        self.history_path.write_text(("\n".join(lines) + "\n") if lines else "", encoding="utf-8")

    def _dedupe_history_items(self, records: list[dict[str, Any]]) -> list[dict[str, Any]]:
        compacted: list[dict[str, Any]] = []
        previous_fingerprint: str | None = None
        for record in records:
            fingerprint = self._history_fingerprint(record)
            if fingerprint == previous_fingerprint:
                continue
            compacted.append(record)
            previous_fingerprint = fingerprint
        return compacted

    @staticmethod
    def _parse_timestamp(value: str) -> datetime:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))

    @staticmethod
    def _history_fingerprint(record: dict[str, Any]) -> str:
        battery = record.get("battery") or {}
        plugged = battery.get("plugged") or {}
        policy = record.get("policy") or {}
        decision = record.get("decision") or {}
        action = record.get("last_action") or {}
        capability = record.get("control_capability") or {}

        stable = {
            "connection_id": record.get("connection_id"),
            "battery": {
                "level": battery.get("level"),
                "status": battery.get("status"),
                "health": battery.get("health"),
                "temperature_c": battery.get("temperature_c"),
                "present": battery.get("present"),
                "plugged": {
                    "ac": plugged.get("ac"),
                    "usb": plugged.get("usb"),
                    "wireless": plugged.get("wireless"),
                    "dock": plugged.get("dock"),
                    "raw": plugged.get("raw"),
                },
            },
            "is_charging": record.get("is_charging"),
            "power_connected": record.get("power_connected"),
            "policy": policy,
            "decision": {
                "action": decision.get("action"),
                "reason": decision.get("reason"),
                "desired_charging_enabled": decision.get("desired_charging_enabled"),
                "policy_name": decision.get("policy_name"),
            },
            "action_executed": record.get("action_executed"),
            "last_action": {
                "requested_enabled": action.get("requested_enabled"),
                "action": action.get("action"),
                "success": action.get("success"),
                "supported": action.get("supported"),
                "backend": action.get("backend"),
                "message": action.get("message"),
            },
            "requested_charging_enabled": record.get("requested_charging_enabled"),
            "control_capability": {
                "supported": capability.get("supported"),
                "backend": capability.get("backend"),
                "message": capability.get("message"),
            },
            "last_error": record.get("last_error"),
        }
        return json.dumps(stable, sort_keys=True, ensure_ascii=False, separators=(",", ":"))

    def load(self) -> dict[str, Any] | None:
        if not self.path.exists():
            return None
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            logger.warning("Failed to read state file %s: %s", self.path, exc)
            return None
