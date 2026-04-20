from app.adb.manager import ConnectionManager
from app.config import ConfigStore
from app.models import AppConfig, ChargeControlConfig, ConnectionConfig, PolicyConfig
from app.services.runtime import RuntimeStore


def test_connection_switch_persists_and_resets_requested_state(tmp_path):
    config_path = tmp_path / "config.json"
    store = ConfigStore(config_path)
    store.save(
        AppConfig(
            connections=[
                ConnectionConfig(id="one", name="One"),
                ConnectionConfig(id="two", name="Two", serial="XYZ"),
            ],
            active_connection_id="one",
            policy=PolicyConfig(),
        )
    )
    runtime = RuntimeStore(policy=store.config.policy, active_connection=store.active_connection())
    runtime.set_requested_charging_enabled(False)
    manager = ConnectionManager(store, runtime)

    active = manager.set_active("two")

    assert active.id == "two"
    assert store.config.active_connection_id == "two"
    assert runtime.snapshot().active_connection.id == "two"
    assert runtime.requested_charging_enabled() is None


def test_switch_to_disabled_connection_fails(tmp_path):
    config_path = tmp_path / "config.json"
    store = ConfigStore(config_path)
    store.save(
        AppConfig(
            connections=[
                ConnectionConfig(id="one", name="One"),
                ConnectionConfig(id="two", name="Two", enabled=False),
            ],
            active_connection_id="one",
            policy=PolicyConfig(),
        )
    )
    runtime = RuntimeStore(policy=store.config.policy, active_connection=store.active_connection())
    manager = ConnectionManager(store, runtime)

    try:
        manager.set_active("two")
    except ValueError as exc:
        assert "disabled" in str(exc)
    else:
        raise AssertionError("disabled connection switch should fail")


def test_upsert_connection_adds_and_persists_device_parameters(tmp_path):
    config_path = tmp_path / "config.json"
    store = ConfigStore(config_path)
    store.save(
        AppConfig(
            connections=[ConnectionConfig(id="one", name="One")],
            active_connection_id="one",
            policy=PolicyConfig(),
        )
    )

    config = store.upsert_connection(
        ConnectionConfig(
            id="tcp_phone",
            name="TCP Phone",
            adb_path="/opt/android/adb",
            server_host="10.0.0.2",
            server_port=5038,
            serial="192.0.2.20:5555",
            note="desk phone",
            charging=ChargeControlConfig(
                backend="sysfs",
                sysfs_path="/sys/class/power_supply/battery/charging_enabled",
                enable_value="1",
                disable_value="0",
                require_su=True,
            ),
        )
    )

    saved = next(conn for conn in config.connections if conn.id == "tcp_phone")
    assert saved.adb_path == "/opt/android/adb"
    assert saved.server_host == "10.0.0.2"
    assert saved.server_port == 5038
    assert saved.serial == "192.0.2.20:5555"
    assert saved.charging.backend == "sysfs"
    assert saved.charging.require_su is True
    assert store.config.active_connection_id == "one"


def test_disabling_active_connection_selects_next_enabled(tmp_path):
    config_path = tmp_path / "config.json"
    store = ConfigStore(config_path)
    store.save(
        AppConfig(
            connections=[
                ConnectionConfig(id="one", name="One"),
                ConnectionConfig(id="two", name="Two"),
            ],
            active_connection_id="one",
            policy=PolicyConfig(),
        )
    )

    config = store.upsert_connection(ConnectionConfig(id="one", name="One", enabled=False))

    assert config.active_connection_id == "two"


def test_delete_active_connection_selects_next_enabled(tmp_path):
    config_path = tmp_path / "config.json"
    store = ConfigStore(config_path)
    store.save(
        AppConfig(
            connections=[
                ConnectionConfig(id="one", name="One"),
                ConnectionConfig(id="two", name="Two"),
            ],
            active_connection_id="one",
            policy=PolicyConfig(),
        )
    )

    config = store.delete_connection("one")

    assert config.active_connection_id == "two"
    assert [conn.id for conn in config.connections] == ["two"]


def test_rename_active_connection_preserves_active_target(tmp_path):
    config_path = tmp_path / "config.json"
    store = ConfigStore(config_path)
    store.save(
        AppConfig(
            connections=[
                ConnectionConfig(id="one", name="One"),
                ConnectionConfig(id="two", name="Two"),
            ],
            active_connection_id="one",
            policy=PolicyConfig(),
        )
    )

    config = store.upsert_connection(ConnectionConfig(id="renamed", name="Renamed"), original_id="one")

    assert config.active_connection_id == "renamed"
    assert [conn.id for conn in config.connections] == ["renamed", "two"]


def test_replace_config_reselects_enabled_active_connection(tmp_path):
    config_path = tmp_path / "config.json"
    store = ConfigStore(config_path)

    config = store.replace_config(
        AppConfig(
            connections=[
                ConnectionConfig(id="disabled", name="Disabled", enabled=False),
                ConnectionConfig(id="enabled", name="Enabled"),
            ],
            active_connection_id="disabled",
            policy=PolicyConfig(charge_upper_limit=85, charge_lower_limit=25),
        )
    )

    assert config.active_connection_id == "enabled"
    assert store.config.policy.charge_upper_limit == 85
