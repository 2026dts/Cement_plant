# ESP32 Digital Twin Platform — Code (Architecture v5)

This is the backend + dashboard + widget-page code described in
`ESP32_Digital_Twin_Architecture_v5.pdf`. The ESP32 firmware (Mosquitto MQTT +
per-material servo dispensing) is the sketch you already have — this package
covers everything else in the diagram: Mosquitto's client side (backend),
the live dashboard, and the Cupola-embedded widget/control pages.

## Folder structure

```
backend/              Node.js + Express + mqtt + ws
dashboard-frontend/    React + Vite + Tailwind - live tiles + Material Targets panel
widget-frontend/       Plain HTML/JS - Cupola hotspot pages (no build step)
```

## Prerequisites

- Node.js LTS installed
- Mosquitto already running on your local network (Architecture v4), reachable
  from the machine you run the backend on
- ESP32 boards flashed with the firmware, pointed at the same Mosquitto broker

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
- `http://localhost:PORT/control.html?id=motor_feed&action=on` — fires ON
- `http://localhost:PORT/control.html?id=motor_feed&action=off` — fires OFF

If the widget pages aren't on `localhost:4000` for the backend, edit the
`API_BASE` / `WS_URL` constants near the top of `widget.html` and
`control.html`.

## 4. Configure Cupola

Paste the widget-frontend URLs into each hotspot's embed field, exactly as
you would a YouTube or ThingsBoard link today. See the hotspot -> URL mapping
table in Architecture v5, Section 6, for the full list (every material,
sensor, and the two actuator ON/OFF icons).

## Notes

- No database anywhere — everything is live-only, in-memory, matching the
  Architecture doc's data policy.
- The GET-triggered `/action/on` and `/action/off` routes are convenient for a
  private LAN demo. Before exposing this publicly, add authentication or a
  confirmation step (see Architecture v5, Future Scope).
