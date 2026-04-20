from __future__ import annotations

from app.models import BatteryStatus, PolicyConfig, PolicyDecision
from app.policy.base import BasePolicy
from app.policy.threshold import ThresholdPolicy


class PolicyEngine:
    def __init__(self) -> None:
        self._policies: dict[str, BasePolicy] = {}
        self.register(ThresholdPolicy())

    def register(self, policy: BasePolicy) -> None:
        self._policies[policy.name] = policy

    def reset(self) -> None:
        for policy in self._policies.values():
            policy.reset()

    def evaluate(self, battery: BatteryStatus | None, config: PolicyConfig) -> PolicyDecision:
        policy = self._policies.get(config.policy_name)
        if policy is None:
            return PolicyDecision(action="hold", reason=f"unknown policy: {config.policy_name}", desired_charging_enabled=None)
        return policy.evaluate(battery, config)

    @property
    def names(self) -> list[str]:
        return sorted(self._policies)
