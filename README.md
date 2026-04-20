# ADB Charge Control

一个运行在 Ubuntu 本地的轻量级 FastAPI 项目，用 ADB 读取 Android 电池状态，并根据可扩展策略决定是否请求启用或停止充电。

项目默认不会假装所有手机都支持充电开关。若未配置设备专用控制方式，Web UI 和 API 会明确返回 `control_capability: unsupported`。读取电池状态、策略评估、多连接切换和自动重连仍可正常工作。

## 功能

- 从 `data/config.json` 读取多个 ADB 连接对象
- 支持不同 `adb_path`、ADB server host/port、设备 serial
- 后台每 5 秒轮询当前 active 连接的 `adb shell dumpsys battery`
- ADB 失败时记录日志、标记连接异常，并按退避间隔重试
- Web UI 显示连接、电池、策略、最近动作，并支持切换 active 连接
- Web UI 可图形化新增、编辑、启用/禁用 ADB 连接对象
- Web UI 可修改充电上限、下限、温度停止/恢复阈值、最低许可电量、开始充电等待秒数，也可开启强制充电，保存后立即生效
- 保存过去 24 小时内的电池历史、策略决策和实际执行情况
- HTTP JSON API 返回统一结构：`{"ok": true, "data": ..., "error": null}`
- 策略系统和充电控制 backend 都预留扩展点
- 本地 JSON 持久化配置与最近状态

## 安装

要求 Python 3.11+，系统中可执行 `adb`。推荐使用 `uv` 创建虚拟环境：

```bash
uv venv .venv --python 3.11
source .venv/bin/activate
uv pip install -r requirements.txt
```

Ubuntu 安装 adb 示例：

```bash
sudo apt update
sudo apt install android-tools-adb
```

## 启动

```bash
./start.sh
```

打开：

```text
http://127.0.0.1:8001
```

接口示例：

```bash
curl http://127.0.0.1:8001/api/status
curl http://127.0.0.1:8001/api/connections
curl http://127.0.0.1:8001/api/history
```

连接配置接口：

```bash
curl -X POST http://127.0.0.1:8001/api/connections \
  -H 'Content-Type: application/json' \
  -d '{"id":"pixel_usb","name":"Pixel USB","adb_path":"adb","server_host":"127.0.0.1","server_port":5037,"serial":"ABCDEFG","enabled":true,"charging":{"backend":"none"}}'

curl -X DELETE http://127.0.0.1:8001/api/connections/pixel_usb
```

启动脚本默认监听 `0.0.0.0:8001`，局域网内其他设备可以通过 Ubuntu 主机 IP 访问：

```text
http://<ubuntu-host-ip>:8001
```

也可以通过环境变量覆盖监听地址或端口：

```bash
ADBCC_HOST=127.0.0.1 ./start.sh
ADBCC_HOST=0.0.0.0 ADBCC_PORT=8001 ./start.sh
```

## 常驻运行

推荐优先使用 systemd。项目提供两种安装方式。

用户级服务，不需要把 unit 写入 `/etc`：

```bash
./scripts/install-user-service.sh
systemctl --user status adb-charge-control.service
journalctl --user -u adb-charge-control.service -f
```

如果希望用户未登录时也保持运行，执行一次：

```bash
sudo loginctl enable-linger "$USER"
```

系统级服务，会安装到 `/etc/systemd/system`，适合真正的开机 daemon：

```bash
./scripts/install-system-service.sh
sudo systemctl status adb-charge-control.service
sudo journalctl -u adb-charge-control.service -f
```

卸载：

```bash
./scripts/uninstall-user-service.sh
./scripts/uninstall-system-service.sh
```

几个方案的取舍：

- 用户级 systemd：安装简单，权限更温和；配合 linger 后可以开机运行。
- 系统级 systemd：最稳定、最符合服务器 daemon 习惯；需要 sudo，unit 中会指定当前用户运行项目。
- cron `@reboot`：最轻，但日志、重启、依赖顺序都弱一些，不推荐作为首选。

## 配置

默认配置位于 `data/config.json`。仓库只提交 `data/config.example.json`，真实运行配置会被 `.gitignore` 忽略。首次运行前可以复制示例配置：

```bash
cp data/config.example.json data/config.json
```

也可以直接启动服务，程序会自动创建一个基础配置。可以通过环境变量指定其他配置文件：

```bash
ADBCC_CONFIG_PATH=/path/to/config.json ./start.sh
```

ADB 连接参数可以直接在 Web UI 的“ADB 设备参数”区域配置并保存。保存后会写回 `data/config.json`，后台轮询无需重启即可使用新参数。

也可以在 Web UI 的“配置文件”区域直接编辑完整 JSON 配置。保存时服务会先校验配置结构，校验通过后写回配置文件并立即生效。

## 历史数据

服务每次成功读取到电池状态后，会在状态发生变化时追加一条历史记录到本地 JSON Lines 文件：

```text
data/history.jsonl
```

历史记录只保留最近 24 小时，不使用数据库。连续相同状态会自动合并，不会每 5 秒重复写入同一条状态。每条记录包含：

- 当时的 active connection
- 电池状态：电量、温度、充电状态、plugged 信息等
- 当时采用的策略配置
- 策略决策与原因
- 是否实际执行了控制动作
- 最近执行动作结果
- 当时是否正在充电、是否接入电源

当策略正在请求充电，但设备明确报告没有接入 AC/USB/无线/底座电源时，最近动作会被标记为执行失败，方便在 Web UI 和历史记录中发现“策略允许充电但物理电源未连接”的情况。

开始充电命令执行后，部分手机需要数秒才会在 `dumpsys battery` 中从 `discharging` 切到 `charging`。服务会先等待 `charge_start_timeout_seconds`，期间显示等待确认；超过该时长仍未报告充电，才会标记执行失败。

查询接口：

```bash
curl http://127.0.0.1:8001/api/history
curl 'http://127.0.0.1:8001/api/history?hours=4&limit=120'
```

Web UI 的“历史记录”区域可在 1h、2h、4h、12h、24h 之间切换，并绘制电量曲线：曲线颜色表示温度黄到红，曲线下方面积只表示当时充电状态，绿色为充电中、无填充为未充电、黄色为未知。

连接对象示例：

```json
{
  "id": "pixel_usb",
  "name": "Pixel USB",
  "adb_path": "adb",
  "server_host": "127.0.0.1",
  "server_port": 5037,
  "serial": "ABCDEFG",
  "enabled": true,
  "charging": {
    "backend": "none"
  }
}
```

策略配置：

```json
{
  "charge_upper_limit": 80,
  "charge_lower_limit": 30,
  "temperature_stop_threshold_c": 42.0,
  "temperature_resume_threshold_c": 40.0,
  "minimum_allowed_battery_percent": 20,
  "force_charge_enabled": false,
  "force_charge_stop_percent": 95,
  "charge_start_timeout_seconds": 30,
  "policy_name": "threshold"
}
```

默认阈值策略：

- `force_charge_enabled = true` 且电量低于 `force_charge_stop_percent`：强制允许充电，无视普通上下限和温度保护
- `force_charge_enabled = true` 且电量 `>= force_charge_stop_percent`：停止充电
- 电量 `>= charge_upper_limit`：停止充电
- 电量 `<= charge_lower_limit`：允许充电
- 电量 `<= minimum_allowed_battery_percent`：强制允许继续充电，避免过度掉电
- 温度 `>= temperature_stop_threshold_c` 且电量高于最低许可电量：停止充电
- 温度停止后，必须降到 `temperature_resume_threshold_c` 或以下，才会重新按普通上下限恢复充电
- 温度字段缺失时安全跳过温度保护，仅按电量阈值判断

## 充电控制 backend

由于 Android 没有统一的“停止充电”ADB 标准命令，默认 backend 是 `none`，API 会返回：

```json
{
  "supported": false,
  "backend": "none",
  "message": "no supported charging control configured for this device"
}
```

若你的设备已 root，并确认 sysfs 节点可用，可以为连接配置：

```json
{
  "charging": {
    "backend": "sysfs",
    "sysfs_path": "/sys/class/power_supply/battery/charging_enabled",
    "enable_value": "1",
    "disable_value": "0",
    "require_su": true
  }
}
```

部分 rooted 设备可用的 `input_suspend` 配置示例：

```json
{
  "id": "rooted_tcp_device",
  "name": "Rooted TCP Device",
  "adb_path": "adb",
  "server_host": "127.0.0.1",
  "server_port": 5037,
  "serial": "192.0.2.10:5555",
  "enabled": true,
  "charging": {
    "backend": "sysfs",
    "sysfs_path": "/sys/class/power_supply/battery/input_suspend",
    "enable_value": "0",
    "disable_value": "1",
    "require_su": true
  }
}
```

这个 backend 会通过类似下面的设备内 shell 命令写入节点：

```bash
adb -s <DEVICE_SERIAL> shell "echo 1 | su -c 'tee /sys/class/power_supply/battery/input_suspend'"
adb -s <DEVICE_SERIAL> shell "echo 0 | su -c 'tee /sys/class/power_supply/battery/input_suspend'"
```

也可以使用设备专用 shell 命令：

```json
{
  "charging": {
    "backend": "commands",
    "enable_command": "cmd battery set status 2",
    "disable_command": "cmd battery set status 4"
  }
}
```

注意：上面的命令只是结构示例，不保证适用于你的设备。接入前请先手动验证命令安全、有效、可逆。

新增 backend 的推荐方式：

1. 在 `app/charging/` 新增实现类，继承 `ChargingBackend`
2. 实现 `capability()` 和 `set_charging_enabled()`
3. 在 `app/main.py` 的 `build_services()` 中替换或包装当前 `AdbChargingBackend`

## 策略扩展

策略接口位于 `app/policy/base.py`：

- 新增策略类继承 `BasePolicy`
- 实现 `evaluate(battery, config)`
- 在 `PolicyEngine.register()` 注册
- 将配置里的 `policy_name` 指向新策略名

后续可加入：

- 按时间段限制充电
- 按电池健康度限制
- 手动强制充电或禁止充电
- 更复杂的温度回滞策略

## 测试

```bash
pytest
```

当前测试覆盖：

- `dumpsys battery` 常见格式解析
- 温度缺失安全处理
- plugged bitmask 解析
- 阈值策略与高温最低电量例外
- active connection 切换与禁用连接保护

## 已知限制

- 真正启停充电高度依赖设备、内核、权限和厂商实现，本项目默认不内置危险的通用假命令。
- `adb get-state` 在未指定 serial 且存在多台设备时可能失败，建议多设备场景明确配置 `serial`。
- 后台轮询只对 active 连接读取完整电池状态；其他连接主要维护健康状态。
- JSON 文件适合轻量本地使用，不适合多进程同时写入。
