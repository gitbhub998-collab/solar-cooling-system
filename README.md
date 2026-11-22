# SolarCool — PV Cooling Comparison System

Graduation project: a complete IoT system that compares three solar panel
cooling setups — **water-cooled**, **air-cooled**, and **uncooled** — with
live monitoring, historical storage, and remote control.

## Architecture

```
  sensors + actuators            MQTT                 backend                dashboard
+--------------------+    publish   broker    subscribe  +---------------+    WebSocket  +-------------+
| ESP32              | ----------> (any MQTT ----------> | Node.js       | ---------->   | index.html  |
|  - 3x DS18B20 temp |  readings   broker)               |  - REST API   |             | (GitHub     |
|  - 3x INA219 power |            ---------->            |  - WebSocket  | <---------- |  Pages)     |
|  - DHT22 ambient   | <---------- commands              |  - SQLite or  |   REST      +-------------+
|  - battery monitor | subscribe                         |    Postgres   |
|  - fan PWM         |                                   +---------------+
|  - pump PWM        |
+--------------------+
```

Every reading is stored with its timestamp, so the project has full history
for analysis and defense-day graphs — not just a live view.

### Why MQTT + a real backend

- **MQTT is the industry standard for IoT** — lightweight, pub/sub, built for
  unreliable networks, and every serious platform speaks it.
- **Decoupled**: the ESP32, the backend, and the dashboard each know nothing
  about the others' internals. Swap or extend any piece independently.
- **Extensible**: a new panel, sensor, or even a second ESP32 just publishes
  under a new key or device ID — no schema or code changes anywhere else.
- **Retained commands**: the last fan/pump setpoints survive device reboots.

## Repo layout

| Path | What it is |
|---|---|
| `index.html` | The dashboard (single file, EN/عربي, live charts, fan/pump control) |
| `firmware/solar_cooling_esp32/` | ESP32 firmware (MQTT publisher/subscriber) |
| `backend/` | Node.js backend: MQTT ingest, REST API, WebSocket, SQLite/Postgres |
| `broker/mosquitto.conf` | Local MQTT broker config |
| `docker-compose.yml` | One-command local stack (broker + backend [+ Postgres]) |
| `render.yaml` | One-click free cloud deploy of the backend on Render |

## MQTT topics

| Topic | Direction | Payload |
|---|---|---|
| `solarcool/<deviceId>/readings` | ESP32 → backend | JSON snapshot (below) |
| `solarcool/<deviceId>/status` | ESP32 (LWT) | `online` / `offline` |
| `solarcool/<deviceId>/commands` | backend → ESP32 | `{"fan":0-100,"pump":0-100}` (retained) |

Readings payload — panel keys are free-form, so adding a panel is adding a key:

```json
{
  "panels": {
    "water": { "temperature": 44.1, "voltage": 16.6, "current": 5.4, "power": 90.1 },
    "air":   { "temperature": 49.8, "voltage": 16.2, "current": 5.4, "power": 88.0 },
    "none":  { "temperature": 60.5, "voltage": 15.4, "current": 5.4, "power": 83.4 }
  },
  "ambient": { "temperature": 33.1 },
  "battery": { "voltage": 12.4, "percentage": 78 }
}
```

## REST API

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | service, broker and DB status |
| `GET /api/devices` | known devices + last seen |
| `GET /api/latest?deviceId=` | newest full snapshot (dashboard boot) |
| `GET /api/readings?deviceId=&panel=&from=&to=&limit=` | raw history |
| `GET /api/stats?deviceId=&hours=24` | per-panel averages, peaks, energy (Wh) |
| `POST /api/commands` `{deviceId, fan, pump}` | → MQTT to the ESP32 |
| `WS /ws` | live stream of readings/status/commands |

## Run it locally (10 minutes)

```bash
# 1. broker accounts + certs (one time, see broker/README.md)
# 2. start the stack
MQTT_PASSWORD=... OPERATOR_TOKEN=... COMMAND_KEY=... docker compose up
```

Dashboard: open `index.html`, set `BACKEND.restUrl`, `BACKEND.wsUrl` only. Never put an operator credential in this public file. Full step-by-step in [docs/GO-LIVE.md](docs/GO-LIVE.md).

## Deploy for free

1. **Broker**: create a free cluster on HiveMQ Cloud or EMQX Serverless
   (or keep Mosquitto on a Raspberry Pi at the demo bench).
2. **Backend**: Render → New → Blueprint → pick this repo — `render.yaml`
   wires the web service and a free Postgres automatically; fill in the
   MQTT env vars plus `OPERATOR_TOKEN` and `COMMAND_KEY`.
3. **Dashboard**: already on GitHub Pages from this repo. Set `restUrl`/`wsUrl`
   in `index.html` to the Render URL and commit.

Free-tier note: Render's free web service sleeps when idle. The ESP32 keeps
publishing; the backend catches up when it wakes. For an always-on demo,
run the stack on a Raspberry Pi with `docker compose up`.

## Wiring (defaults, changeable in firmware)

| Component | ESP32 pin |
|---|---|
| DS18B20 x3 (one bus, 4.7kΩ pull-up) | GPIO 4 |
| DHT22 ambient | GPIO 15 |
| INA219 x3 (0x40 / 0x41 / 0x44) | GPIO 21 (SDA), 22 (SCL) |
| Battery divider (100k / 27k) | GPIO 34 |
| Fan MOSFET gate (PWM) | GPIO 25 |
| Pump MOSFET gate (PWM) | GPIO 26 |

## Demo mode

Without a backend URL the dashboard generates realistic simulated data
(hotter uncooled panel; the sliders visibly affect the temperatures), so the
full presentation can be rehearsed before any hardware is connected.

## Security (built in, on by default)

- **Private broker**: anonymous access disabled, TLS on 8883, per-device ACLs
  (`broker/acl`) — a device can publish only its own readings and read only
  its own command topic. Setup: [broker/README.md](broker/README.md).
- **Operator auth**: `POST /api/commands` requires a bearer token
  (`OPERATOR_TOKEN`); read-only endpoints stay open for viewers.
- **Device interlock**: the ESP32 ignores any command without `COMMAND_KEY`
  and clamps outputs to hardware limits (`FAN_MAX_PCT` / `PUMP_MAX_PCT`).

The public anonymous test brokers are for early development only — never for
the demo.

---

شرح الإعداد بالعربي في [README.ar.md](README.ar.md)


Security: public live dashboard is read-only. Hardware control requires a trusted local/private interface, a server-only operator credential, and a network block on the public command route. No authenticated operator web interface is implemented yet. See docs/GO-LIVE.md.
