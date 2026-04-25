import json
from datetime import timedelta

from app.config import model_to_dict
from app.models import BatteryStatus, ConnectionConfig, PolicyConfig, PolicyDecision, RuntimeSnapshot, utc_now
from app.services.state_store import StateStore


def make_snapshot(level=55, timestamp=None):
    return RuntimeSnapshot(
        active_connection=ConnectionConfig(id="test_phone", name="Test Phone", serial="192.0.2.10:5555"),
        battery=BatteryStatus(
            level=level,
            status="charging",
            temperature_c=35.5,
            current_now_ua=1250000,
            charge_counter_uah=456000,
            max_charging_current_ua=2000000,
            max_charging_voltage_uv=12000000,
            technology="Li-poly",
        ),
        policy=PolicyConfig(charge_upper_limit=80, charge_lower_limit=40),
        decision=PolicyDecision(action="hold", reason="battery within configured range"),
        requested_charging_enabled=True,
        timestamp=timestamp or utc_now(),
    )


def test_history_snapshot_is_appended_and_loaded(tmp_path):
    store = StateStore(path=tmp_path / "state.json", history_path=tmp_path / "history.jsonl")

    record = store.append_history_snapshot(make_snapshot(), action_executed=True)
    records = store.load_history(hours=24)

    assert record is not None
    assert len(records) == 1
    assert records[0]["connection_id"] == "test_phone"
    assert records[0]["battery"]["level"] == 55
    assert records[0]["battery"]["current_now_ua"] == 1250000
    assert records[0]["battery"]["technology"] == "Li-poly"
    assert records[0]["is_charging"] is True
    assert records[0]["action_executed"] is True
    assert records[0]["policy"]["charge_lower_limit"] == 40


def test_history_skips_unchanged_consecutive_state(tmp_path):
    store = StateStore(path=tmp_path / "state.json", history_path=tmp_path / "history.jsonl")

    first = store.append_history_snapshot(make_snapshot(level=55), action_executed=False)
    second = store.append_history_snapshot(make_snapshot(level=55), action_executed=False)
    changed = store.append_history_snapshot(make_snapshot(level=56), action_executed=False)
    records = store.load_history(hours=24)

    assert first is not None
    assert second is None
    assert changed is not None
    assert [item["battery"]["level"] for item in records] == [55, 56]


def test_history_keeps_only_retention_window(tmp_path):
    store = StateStore(path=tmp_path / "state.json", history_path=tmp_path / "history.jsonl")

    store.append_history_snapshot(make_snapshot(level=10, timestamp=utc_now() - timedelta(hours=25)))
    store.append_history_snapshot(make_snapshot(level=60, timestamp=utc_now()))
    records = store.load_history(hours=24)

    assert len(records) == 1
    assert records[0]["battery"]["level"] == 60


def test_history_skips_snapshot_without_battery(tmp_path):
    store = StateStore(path=tmp_path / "state.json", history_path=tmp_path / "history.jsonl")
    snapshot = RuntimeSnapshot(active_connection=ConnectionConfig(id="test_phone", name="Test Phone"), battery=None, policy=PolicyConfig())

    record = store.append_history_snapshot(snapshot)

    assert record is None
    assert store.load_history(hours=24) == []


def test_compact_history_removes_existing_unchanged_runs(tmp_path):
    store = StateStore(path=tmp_path / "state.json", history_path=tmp_path / "history.jsonl")

    record_a = store.append_history_snapshot(make_snapshot(level=55))
    record_c = store.append_history_snapshot(make_snapshot(level=60, timestamp=utc_now() + timedelta(seconds=10)))
    duplicate_a = model_to_dict(record_a)
    duplicate_a["timestamp"] = (utc_now() + timedelta(seconds=5)).isoformat()
    # Write duplicate lines directly to simulate an older noisy history file.
    lines = [
        json.dumps(model_to_dict(record_a), ensure_ascii=False),
        json.dumps(duplicate_a, ensure_ascii=False),
        json.dumps(model_to_dict(record_c), ensure_ascii=False),
    ]
    (tmp_path / "history.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")

    before, after = store.compact_history()
    records = store.load_history(hours=24)

    assert before == 3
    assert after == 2
    assert [item["battery"]["level"] for item in records] == [55, 60]
