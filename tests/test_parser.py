from app.adb.parser import parse_dumpsys_battery


def test_parse_common_dumpsys_battery_output():
    output = """
Current Battery Service state:
  AC powered: false
  USB powered: true
  Wireless powered: false
  status: 2
  health: 2
  present: true
  level: 81
  scale: 100
  voltage: 4101
  temperature: 313
"""
    status = parse_dumpsys_battery(output)

    assert status.level == 81
    assert status.status == "charging"
    assert status.health == "good"
    assert status.present is True
    assert status.plugged.usb is True
    assert status.temperature_c == 31.3


def test_parse_missing_temperature_safely():
    output = """
  level: 50
  status: discharging
  plugged: 0
"""
    status = parse_dumpsys_battery(output)

    assert status.level == 50
    assert status.status == "discharging"
    assert status.temperature_c is None
    assert status.plugged.ac is False
    assert status.plugged.usb is False
    assert status.plugged.wireless is False


def test_parse_plugged_bitmask():
    status = parse_dumpsys_battery("level: 45\nplugged: 3\ntemperature: 42.5\n")

    assert status.plugged.ac is True
    assert status.plugged.usb is True
    assert status.plugged.wireless is False
    assert status.temperature_c == 42.5

