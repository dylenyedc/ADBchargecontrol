from __future__ import annotations

import logging
import subprocess
from dataclasses import dataclass

from app.models import ConnectionConfig

logger = logging.getLogger(__name__)


class AdbCommandError(RuntimeError):
    def __init__(self, command: list[str], returncode: int, stdout: str, stderr: str):
        self.command = command
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr
        message = stderr.strip() or stdout.strip() or f"adb exited with code {returncode}"
        super().__init__(message)


@dataclass(frozen=True)
class AdbClient:
    connection: ConnectionConfig

    def _prefix(self, include_serial: bool = True) -> list[str]:
        cmd = [self.connection.adb_path]
        if self.connection.server_host:
            cmd.extend(["-H", self.connection.server_host])
        if self.connection.server_port:
            cmd.extend(["-P", str(self.connection.server_port)])
        if include_serial and self.connection.serial:
            cmd.extend(["-s", self.connection.serial])
        return cmd

    def run(self, args: list[str], timeout: float = 10.0, include_serial: bool = True) -> str:
        command = self._prefix(include_serial=include_serial) + args
        logger.debug("Running adb command: %s", " ".join(command))
        try:
            completed = subprocess.run(
                command,
                capture_output=True,
                text=True,
                timeout=timeout,
                check=False,
            )
        except FileNotFoundError as exc:
            raise AdbCommandError(command, 127, "", str(exc)) from exc
        except subprocess.TimeoutExpired as exc:
            stdout = exc.stdout if isinstance(exc.stdout, str) else ""
            stderr = exc.stderr if isinstance(exc.stderr, str) else "adb command timed out"
            raise AdbCommandError(command, 124, stdout, stderr) from exc

        if completed.returncode != 0:
            raise AdbCommandError(command, completed.returncode, completed.stdout, completed.stderr)
        return completed.stdout.strip()

    def start_server(self) -> str:
        return self.run(["start-server"], timeout=10.0, include_serial=False)

    def connect(self, target: str) -> str:
        return self.run(["connect", target], timeout=10.0, include_serial=False)

    def get_state(self) -> str:
        output = self.run(["get-state"], timeout=5.0)
        return output.strip().lower()

    def dumpsys_battery(self) -> str:
        return self.run(["shell", "dumpsys", "battery"], timeout=10.0)

    def shell(self, command: str, timeout: float = 10.0) -> str:
        return self.run(["shell", command], timeout=timeout)

    def read_sysfs_value(self, path: str, timeout: float = 5.0) -> str:
        return self.shell(f"cat {path}", timeout=timeout)
