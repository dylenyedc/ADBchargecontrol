from app.charging.adb_backend import AdbChargingBackend
from app.models import ChargeControlConfig, ConnectionConfig


def test_sysfs_command_uses_su_tee_for_rooted_android_input_suspend():
    backend = AdbChargingBackend()
    conn = ConnectionConfig(
        id="rooted_tcp_device",
        name="Rooted TCP Device",
        serial="192.0.2.10:5555",
        charging=ChargeControlConfig(
            backend="sysfs",
            sysfs_path="/sys/class/power_supply/battery/input_suspend",
            enable_value="0",
            disable_value="1",
            require_su=True,
        ),
    )

    stop_command = backend._sysfs_command(conn, enabled=False)
    enable_command = backend._sysfs_command(conn, enabled=True)

    assert "printf '%s\\n' 1" in stop_command
    assert "su -c 'tee /sys/class/power_supply/battery/input_suspend'" in stop_command
    assert "printf '%s\\n' 0" in enable_command
    assert "su -c 'tee /sys/class/power_supply/battery/input_suspend'" in enable_command
