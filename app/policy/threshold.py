from __future__ import annotations

from app.models import BatteryStatus, PolicyConfig, PolicyDecision
from app.policy.base import BasePolicy


class ThresholdPolicy(BasePolicy):
    name = "threshold"

    def __init__(self) -> None:
        self._temperature_protection_active = False

    def reset(self) -> None:
        self._temperature_protection_active = False

    def evaluate(self, battery: BatteryStatus | None, config: PolicyConfig) -> PolicyDecision:
        if battery is None:
            return PolicyDecision(action="hold", reason="battery status unavailable", desired_charging_enabled=None)

        level = battery.level
        temperature = battery.temperature_c

        if config.force_charge_enabled:
            self._temperature_protection_active = False
            if level is None:
                return PolicyDecision(
                    action="hold",
                    reason="force charge enabled but battery level unavailable",
                    desired_charging_enabled=None,
                    policy_name=self.name,
                )
            if level >= config.force_charge_stop_percent:
                return PolicyDecision(
                    action="stop_charging",
                    reason="force charge stop percent reached",
                    desired_charging_enabled=False,
                    policy_name=self.name,
                )
            return PolicyDecision(
                action="allow_charging",
                reason="force charge enabled",
                desired_charging_enabled=True,
                policy_name=self.name,
            )

        if level is not None and level <= config.minimum_allowed_battery_percent:
            reason = "battery at or below minimum allowed percent"
            if temperature is not None and temperature >= config.temperature_stop_threshold_c:
                reason = "battery below minimum allowed percent despite high temperature"
            return PolicyDecision(
                action="allow_charging",
                reason=reason,
                desired_charging_enabled=True,
                policy_name=self.name,
            )

        if temperature is not None and temperature >= config.temperature_stop_threshold_c:
            self._temperature_protection_active = True
            return PolicyDecision(
                action="stop_charging",
                reason="temperature threshold exceeded",
                desired_charging_enabled=False,
                policy_name=self.name,
            )

        if self._temperature_protection_active:
            if temperature is not None and temperature <= config.temperature_resume_threshold_c:
                self._temperature_protection_active = False
            else:
                return PolicyDecision(
                    action="hold",
                    reason="temperature protection active; waiting for resume threshold",
                    desired_charging_enabled=None,
                    policy_name=self.name,
                )

        if level is None:
            return PolicyDecision(action="hold", reason="battery level unavailable", desired_charging_enabled=None)

        if level >= config.charge_upper_limit:
            return PolicyDecision(
                action="stop_charging",
                reason="reached upper limit",
                desired_charging_enabled=False,
                policy_name=self.name,
            )

        if level <= config.charge_lower_limit:
            return PolicyDecision(
                action="allow_charging",
                reason="below lower limit",
                desired_charging_enabled=True,
                policy_name=self.name,
            )

        return PolicyDecision(
            action="hold",
            reason="battery within configured range",
            desired_charging_enabled=None,
            policy_name=self.name,
        )
