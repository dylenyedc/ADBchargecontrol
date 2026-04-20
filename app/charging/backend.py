from __future__ import annotations

from abc import ABC, abstractmethod

from app.models import ConnectionConfig, ControlCapability, ControlResult


class ChargingBackend(ABC):
    @abstractmethod
    def capability(self, connection: ConnectionConfig) -> ControlCapability:
        raise NotImplementedError

    @abstractmethod
    def set_charging_enabled(self, connection: ConnectionConfig, enabled: bool) -> ControlResult:
        raise NotImplementedError

