from app.models import BatteryStatus, PolicyConfig
from app.policy.threshold import ThresholdPolicy


def evaluate(
    level,
    temp,
    *,
    lower=30,
    stop_temp=42.0,
    resume_temp=40.0,
    minimum=20,
    force=False,
    force_stop=95,
):
    return ThresholdPolicy().evaluate(
        BatteryStatus(level=level, temperature_c=temp),
        PolicyConfig(
            charge_upper_limit=80,
            charge_lower_limit=lower,
            temperature_stop_threshold_c=stop_temp,
            temperature_resume_threshold_c=resume_temp,
            minimum_allowed_battery_percent=minimum,
            force_charge_enabled=force,
            force_charge_stop_percent=force_stop,
        ),
    )


def test_upper_limit_stops_charging():
    decision = evaluate(80, 35)

    assert decision.action == "stop_charging"
    assert decision.desired_charging_enabled is False
    assert decision.reason == "reached upper limit"


def test_lower_limit_allows_charging():
    decision = evaluate(30, 35)

    assert decision.action == "allow_charging"
    assert decision.desired_charging_enabled is True
    assert decision.reason == "below lower limit"


def test_temperature_threshold_has_priority():
    decision = evaluate(50, 42.0)

    assert decision.action == "stop_charging"
    assert decision.desired_charging_enabled is False
    assert decision.reason == "temperature threshold exceeded"


def test_minimum_allowed_battery_overrides_high_temperature_stop():
    decision = evaluate(20, 45.0)

    assert decision.action == "allow_charging"
    assert decision.desired_charging_enabled is True
    assert decision.reason == "battery below minimum allowed percent despite high temperature"


def test_temperature_resume_band_without_prior_stop_uses_battery_thresholds():
    decision = evaluate(40, 41.0, lower=40)

    assert decision.action == "allow_charging"
    assert decision.desired_charging_enabled is True
    assert decision.reason == "below lower limit"


def test_temperature_hysteresis_waits_after_stop_until_resume_threshold():
    policy = ThresholdPolicy()
    config = PolicyConfig(
        charge_upper_limit=80,
        charge_lower_limit=40,
        temperature_stop_threshold_c=42.0,
        temperature_resume_threshold_c=40.0,
        minimum_allowed_battery_percent=20,
    )

    stop = policy.evaluate(BatteryStatus(level=40, temperature_c=42.0), config)
    waiting = policy.evaluate(BatteryStatus(level=40, temperature_c=41.0), config)
    resumed = policy.evaluate(BatteryStatus(level=40, temperature_c=40.0), config)

    assert stop.action == "stop_charging"
    assert stop.reason == "temperature threshold exceeded"
    assert waiting.action == "hold"
    assert waiting.desired_charging_enabled is None
    assert waiting.reason == "temperature protection active; waiting for resume threshold"
    assert resumed.action == "allow_charging"
    assert resumed.desired_charging_enabled is True
    assert resumed.reason == "below lower limit"


def test_temperature_hysteresis_resumes_at_resume_threshold_without_lower_limit():
    policy = ThresholdPolicy()
    config = PolicyConfig(
        charge_upper_limit=80,
        charge_lower_limit=30,
        temperature_stop_threshold_c=42.0,
        temperature_resume_threshold_c=40.0,
        minimum_allowed_battery_percent=20,
    )

    policy.evaluate(BatteryStatus(level=50, temperature_c=42.0), config)
    decision = policy.evaluate(BatteryStatus(level=50, temperature_c=40.0), config)

    assert decision.action == "hold"
    assert decision.desired_charging_enabled is None
    assert decision.reason == "battery within configured range"


def test_minimum_allowed_battery_overrides_temperature_hysteresis_band():
    decision = evaluate(20, 41.0, lower=40)

    assert decision.action == "allow_charging"
    assert decision.desired_charging_enabled is True
    assert decision.reason == "battery at or below minimum allowed percent"


def test_missing_temperature_uses_battery_thresholds():
    decision = evaluate(85, None)

    assert decision.action == "stop_charging"
    assert decision.reason == "reached upper limit"


def test_force_charge_overrides_temperature_and_upper_limit():
    decision = evaluate(90, 45.0, force=True)

    assert decision.action == "allow_charging"
    assert decision.desired_charging_enabled is True
    assert decision.reason == "force charge enabled"


def test_force_charge_stops_at_force_stop_percent():
    decision = evaluate(95, 35.0, force=True)

    assert decision.action == "stop_charging"
    assert decision.desired_charging_enabled is False
    assert decision.reason == "force charge stop percent reached"


def test_force_charge_holds_when_battery_level_unavailable():
    decision = evaluate(None, 35.0, force=True)

    assert decision.action == "hold"
    assert decision.desired_charging_enabled is None
    assert decision.reason == "force charge enabled but battery level unavailable"
