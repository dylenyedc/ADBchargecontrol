from __future__ import annotations

from abc import ABC, abstractmethod

from app.models import BatteryStatus, PolicyConfig, PolicyDecision


class BasePolicy(ABC):
    name: str

    @abstractmethod
    def evaluate(self, battery: BatteryStatus | None, config: PolicyConfig) -> PolicyDecision:
        raise NotImplementedError

    def reset(self) -> None:
        return None
