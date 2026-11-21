# SolarCool — PV Cooling Comparison System

Graduation project: a live monitoring and control system that compares three
solar panel cooling setups — **water-cooled**, **air-cooled**, and **uncooled**
— in real time.

## System architecture

```
 3 solar panels + sensors        Firebase                 Web dashboard
+------------------+      push    Realtime      live     +------------------+
| ESP32            | -----------> Database  ---------->  | index.html       |
|  - 3x DS18B20    |            (backend)   <----------  | (GitHub Pages)   |
|  - 3x INA219     | <----------- /controls   sliders    |                  |
|  - DHT22 ambient |   fan/pump %                        +------------------+
|  - battery ADC   |
|  - fan PWM       |
|  - pump PWM      |
+------------------+
```

- **Frontend**: `index.html` — single-file live dashboard (temperature cards,
  power charts, battery gauge, fan/pump sliders, Arabic/English toggle).
  Runs on simulated data until Firebase is configured; works offline as a demo.
- **Backend**: Firebase Realtime Database — `firebase/database.rules.json`.
- **Firmware**: `firmware/solar_cooling_esp32/solar_cooling_esp32.ino`.

## Live dashboard

Hosted with GitHub Pages from this repo:
`https://<your-username>.github.io/<repo-name>/`

## Database layout

| Path | Written by | Contents |
|---|---|---|
| `/panels/water` | ESP32 | `{temperature, voltage, current, power}` |
| `/panels/air` | ESP32 | same |
| `/panels/none` | ESP32 | same |
| `/ambient` | ESP32 | `{temperature}` |
| `/battery` | ESP32 | `{voltage, percentage}` |
| `/controls` | dashboard | `{fan: 0-100, pump: 0-100}` — read by the ESP32 |

## Setup (10 minutes)

1. **Firebase**: create a project at https://console.firebase.google.com →
   add a **Realtime Database** → copy `firebase/database.rules.json` into the
   Rules tab → register a **Web App** and copy its config.
2. **Auth for the ESP32**: in Firebase → Authentication → enable
   **Email/Password** → add a user (e.g. `esp32@yourproject.com`).
3. **Dashboard**: paste the web app config into `firebaseConfig` at the top of
   the `<script>` in `index.html`.
4. **Firmware**: install the libraries listed at the top of the `.ino`, fill in
   WiFi + Firebase + auth credentials in section 1, and flash the ESP32.
5. Open the dashboard — the orange **DEMO DATA** badge turns teal
   **LIVE · FIREBASE** once the first reading arrives.

## Wiring (defaults, all changeable in the firmware)

| Component | ESP32 pin |
|---|---|
| DS18B20 x3 (one bus, 4.7kΩ pull-up) | GPIO 4 |
| DHT22 ambient | GPIO 15 |
| INA219 x3 (0x40 / 0x41 / 0x44) | GPIO 21 (SDA), 22 (SCL) |
| Battery divider (100k / 27k) | GPIO 34 |
| Fan MOSFET gate (PWM) | GPIO 25 |
| Pump MOSFET gate (PWM) | GPIO 26 |

The three INA219 addresses are set with their A0/A1 solder jumpers:
0x40 = none bridged, 0x41 = A0, 0x44 = A1.

## Demo mode

Without a Firebase config the dashboard generates realistic simulated data
(hotter uncooled panel, fan/pump sliders visibly affect the temperatures), so
you can rehearse the full presentation before the hardware is connected.

---

شرح الإعداد بالعربي في [README.ar.md](README.ar.md)
