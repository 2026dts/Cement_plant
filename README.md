# ESP32 Digital Twin Platform — Full Code (Hardware Revision: 4x Load Cell/Servo + Raw Gate + 16ch Relay + Sensors)

Everything needed to run the platform end-to-end on the current hardware:

- **ESP32-1**: 4 load cells (common SCK) + 4 dispensing servos — gypsum, clay,
  iron_ore, and sand — plus a raw-material gate servo on GPIO25 with open/close
  control.
- **ESP32-2**: 16-channel relay board (2x8), 13 channels wired — crusher (gangs
  3 N20 motors), conveyor_1-4, clin, clin_heater, heat_blower, preheating_tower_fan,
  preheating_tower_heater, vibration_motor, ball_mill_1, ball_mill_2 — plus 3x
  DHT11 and 1x vibration sensor (read-only, not relay-controlled).
- Both boards talk directly to your local Mosquitto broker — no cloud, no
  ThingsBoard.

## Folder structure

```
esp32/esp1-materials/   ESP32-1 firmware (.ino) - load cells + servo dispensing
esp32/esp2-relay/       ESP32-2 firmware (.ino) - 16ch relay ON/OFF
backend/                Node.js + Express + mqtt + ws
dashboard-frontend/     React + Vite + Tailwind - live tiles + Material Targets panel
widget-frontend/        Plain HTML/JS - Cupola hotspot pages (no build step)
```

## 0. Flash the ESP32 boards

Open `esp32/esp1-materials/esp1_materials.ino` and
`esp32/esp2-relay/esp2_relay.ino` in the Arduino IDE. In each file, edit:

- `WIFI_SSID` / `WIFI_PASSWORD`
- `MQTT_BROKER_HOST` — your Mosquitto machine's LAN IP
- On ESP32-2 only: `RELAY_ACTIVE_LOW` — flip to `false` if your relays energize
  on HIGH instead of LOW (test one channel first before wiring everything up)

Install the libraries listed at the top of each `.ino` file, then upload.
Wiring/pin tables are in the comment block at the top of each file.

## Prerequisites

- Node.js LTS installed
- Mosquitto already running on your local network (Architecture v4), reachable
  from the machine you run the backend on
- ESP32 boards flashed with the firmware, pointed at the same Mosquitto broker

## Run everything with one command (Windows)

From the project root, run:

```powershell
.\start.ps1
```

The script installs missing Node dependencies, then starts the backend, dashboard,
and widget server together. Open `http://localhost:5173` for the dashboard and
use `http://localhost:4173/widget.html?id=iron_ore` for a widget page. Press
`Ctrl+C` once to stop all three services.

Use `.\start.ps1 -SkipInstall` after dependencies have already been installed.

## 1. Backend

```bash
cd backend
npm install
cp .env.example .env       # then edit MQTT_HOST to your Mosquitto machine's LAN IP
npm run dev
```

Verify: open `http://localhost:4000/api/items` — you should get JSON with
every item, and live values once the ESP32 boards are publishing.

## 2. Dashboard

```bash
cd dashboard-frontend
npm install
npm run dev
```

Open the printed localhost URL. Tiles should update live, and the
"Material Targets Configuration" panel lets you enter a target weight per
material and click "Apply Material Targets" to trigger dispensing.

If your backend isn't on `localhost:4000`, edit `src/config.js` first.

## 3. Widget pages (for Cupola)

No build step — serve the folder with any static server:

```bash
cd widget-frontend
npx serve .
```

Open these directly in a browser tab first, on their own, to confirm they
work standalone before pasting the URLs into Cupola:

- `http://localhost:PORT/widget.html?id=iron_ore` — live value label
- `http://localhost:PORT/control.html?id=crusher&action=on` — fires ON
- `http://localhost:PORT/control.html?id=crusher&action=off` — fires OFF

If the widget pages aren't on `localhost:4000` for the backend, edit the
`API_BASE` / `WS_URL` constants near the top of `widget.html` and
`control.html`.

## 4. Configure Cupola

Paste the widget-frontend URLs into each hotspot's embed field, exactly as
you would a YouTube or ThingsBoard link today. Full endpoint reference,
request/response shapes, and both control.html hotspot styles are documented
in `API_DOCUMENTATION.md`.

## Cupola hotspot URLs (current item list)

Material value labels (inline, plain text):
```
widget.html?id=gypsum
widget.html?id=clay
widget.html?id=iron_ore
widget.html?id=sand
control.html?id=lime_stone&action=open
control.html?id=lime_stone&action=close
```

Sensor value labels (inline, plain text):
```
widget.html?id=clin_dht_temp
widget.html?id=clin_dht_humidity
widget.html?id=cooler_dht_temp
widget.html?id=cooler_dht_humidity
widget.html?id=preheating_tower_dht_temp
widget.html?id=preheating_tower_dht_humidity
widget.html?id=vibration_sensor
```

Actuator ON/OFF (two hotspots per actuator — swap `crusher` for any of:
conveyor_1, conveyor_2, conveyor_3, conveyor_4, clin, clin_heater, heat_blower,
preheating_tower_fan, preheating_tower_heater, vibration_motor, ball_mill_1, ball_mill_2):
```
control.html?id=crusher&action=on
control.html?id=crusher&action=off
```

## Notes

- No database anywhere — everything is live-only, in-memory, matching the
  Architecture doc's data policy.
- The GET-triggered `/action/on` and `/action/off` routes are convenient for a
  private LAN demo. Before exposing this publicly, add authentication or a
  confirmation step (see Architecture v5, Future Scope).
- `crusher` fires all 3 N20 motors (left, right, wheel) together — they're
  wired in parallel to one relay, so there's only ever one ON/OFF for it, not
  three separate controls.
- `control.html` supports two Cupola hotspot styles (persistent embed with
  live-highlighted buttons, or a link that fires immediately on open) — see
  Section 4 of `API_DOCUMENTATION.md` for exactly how each one behaves.
- `clin_dht_*` is near the clin/`clin_heater` section, `cooler_dht_*` is near
  the cooler section, and `preheating_tower_dht_*` is near the
  `preheating_tower_heater` — rename any of these (in both `esp2_relay.ino`
  and `backend/src/config/itemRegistry.js`) if a sensor moves.
- Channels 14-16 on the relay board are spare. `ball_mill_1`/`ball_mill_2`
  and the third DHT11 (`preheating_tower_dht`, on GPIO15) used up the last
  free GPIOs, so the board's GPIO budget is now fully used by channels 1-13 +
  the 3 sensors — wiring the remaining 3 channels later needs an I2C GPIO
  expander (e.g. PCF8574), not more direct ESP32 pins — see the note at the
  bottom of `esp2_relay.ino`.
- Calibration factor (96.322) and servo oscillation range (90-195) on ESP32-1
  were kept exactly as supplied. Recalibrate a specific pair individually in
  `materials[]` if its readings drift, rather than changing the shared constant.
