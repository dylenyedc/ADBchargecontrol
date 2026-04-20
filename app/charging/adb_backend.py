from __future__ import annotations

import logging
import shlex
import subprocess

from app.adb.client import AdbClient, AdbCommandError
from app.charging.backend import ChargingBackend
from app.models import ConnectionConfig, ControlCapability, ControlResult

logger = logging.getLogger(__name__)


class AdbChargingBackend(ChargingBackend):
    """ADB-backed charging controller.

    The default per-connection backend is unsupported. Configure either a
    sysfs node or explicit shell commands when the target device exposes a
    reliable way to enable/disable charging.
    """

    def capability(self, connection: ConnectionConfig) -> ControlCapability:
        cfg = connection.charging
        if cfg.backend == "sysfs" and cfg.sysfs_path:
            return ControlCapability(supported=True, backend="sysfs", message=f"sysfs node {cfg.sysfs_path}")
        if cfg.backend == "commands" and cfg.enable_command and cfg.disable_command:
            return ControlCapability(supported=True, backend="commands", message="custom adb shell commands configured")
        return ControlCapability(
            supported=False,
            backend=cfg.backend,
            message="no supported charging control configured for this device",
        )

    def _sysfs_command(self, connection: ConnectionConfig, enabled: bool) -> str:
        cfg = connection.charging
        value = cfg.enable_value if enabled else cfg.disable_value
        path = shlex.quote(cfg.sysfs_path or "")
        write_value = shlex.quote(value)
        if cfg.require_su:
            # Some Android builds do not run shell redirection as root even
            # when su is present. Piping into `su -c tee ...` matches the
            # pattern that works on many rooted devices.
            return f"printf '%s\\n' {write_value} | su -c {shlex.quote(f'tee {path}')}"
        return f"printf '%s\\n' {write_value} | tee {path} >/dev/null"

    def _custom_command(self, connection: ConnectionConfig, enabled: bool) -> str:
        cfg = connection.charging
        command = cfg.enable_command if enabled else cfg.disable_command
        return command or ""

    def _run_custom_command(self, connection: ConnectionConfig, command: str) -> None:
        stripped = command.strip()
        args = shlex.split(stripped)
        if args and args[0].endswith("adb"):
            completed = subprocess.run(args, capture_output=True, text=True, timeout=10.0, check=False)
            if completed.returncode != 0:
                raise AdbCommandError(args, completed.returncode, completed.stdout, completed.stderr)
            return
        AdbClient(connection).shell(stripped, timeout=10.0)

    def set_charging_enabled(self, connection: ConnectionConfig, enabled: bool) -> ControlResult:
        capability = self.capability(connection)
        action = "enable_charging" if enabled else "disable_charging"
        if not capability.supported:
            return ControlResult(
                requested_enabled=enabled,
                action=action,
                success=False,
                supported=False,
                backend=capability.backend,
                message=capability.message,
            )

        cfg = connection.charging
        command = self._sysfs_command(connection, enabled) if cfg.backend == "sysfs" else self._custom_command(connection, enabled)
        try:
            if cfg.backend == "commands":
                self._run_custom_command(connection, command)
            else:
                AdbClient(connection).shell(command, timeout=10.0)
            logger.info("Charging command succeeded for %s: %s", connection.id, action)
            return ControlResult(
                requested_enabled=enabled,
                action=action,
                success=True,
                supported=True,
                backend=cfg.backend,
                message="charging control command executed",
            )
        except AdbCommandError as exc:
            logger.warning("Charging command failed for %s: %s", connection.id, exc)
            return ControlResult(
                requested_enabled=enabled,
                action=action,
                success=False,
                supported=True,
                backend=cfg.backend,
                message=str(exc),
            )
