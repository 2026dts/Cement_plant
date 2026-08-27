# ESP32 Digital Twin Platform — API Documentation

Base URL (default local dev): `http://localhost:4000`

MQTT topic prefix: `plant/cement-dubai/`
WebSocket URL (default local dev): `ws://localhost:4000/ws`

All data is live-only — nothing is stored to disk. Every value shown anywhere
(dashboard, Cupola widgets) reflects the current in-memory state, sourced from
MQTT messages published by the two ESP32 boards.

---

## 1. Item Registry (what exists)

Every material, sensor, and actuator the backend knows about. Full source of
truth: `backend/src/config/itemRegistry.js`.

### Materials (ESP32-1 — load cell + servo, dispensable)

| item_id | unit |
|---|---|
| `gypsum` | g |
| `clay` | g |
| `iron_ore` | g |
| `sand` | g |
### Gate actuator (ESP32-1 — servo)

| item_id | unit | commands |
|---|---|---|
| `lime_stone` | open/close | `open`, `close` |

### Sensors (ESP32-2 — read-only, not relay-controlled)

| item_id | unit | notes |
|---|---|---|
| `klin_dht_temp` | C | near klin / klin_heater |
| `klin_dht_humidity` | % | near klin / klin_heater |
| `cooler_dht_temp` | C | near cooler section |
| `cooler_dht_humidity` | % | near cooler section |
| `preheating_tower_dht_temp` | C | near preheating tower / preheating_tower_heater |
| `preheating_tower_dht_humidity` | % | near preheating tower / preheating_tower_heater |
| `vibration_sensor` | /8 | separate from `vibration_motor` actuator below |

### Actuators (ESP32-2 — 13 relay channels wired)

| item_id | notes |
|---|---|
| `crusher` | fires all 3 N20 motors (left, right, wheel) together — one relay |
| `conveyor_1` | |
| `conveyor_2` | |
| `conveyor_3` | |
| `conveyor_4` | |
| `klin` | kiln motor |
| `klin_heater` | inside the klin (renamed from `heater`) |
| `heat_blower` | mini exhaust fan, inside the klin |
| `preheating_tower_fan` | preheating tower fan (renamed from `cooler_fan`) |
| `preheating_tower_heater` | NEW — replaces `klin_cooler_fan` (removed) |
| `vibration_motor` | feeder vibration motor |
| `ball_mill_1` | |
| `ball_mill_2` | |

---

## 2. REST Endpoints

### `GET /api/items`
Snapshot of every item's current value. Used by the Dashboard on initial load.

**Response 200**
```json
{
  "gypsum": { "value": 23.4, "unit": "g", "ts": 1732870000000 },
  "crusher": { "value": "on", "unit": "on/off", "ts": 1732870001000 },
  "...": "one entry per item in the registry"
}
```

### `GET /api/item/:id`
Snapshot of one item. Used by widget pages on initial load, before the
WebSocket connects.

**Response 200**
```json
{ "item_id": "iron_ore", "value": 52, "unit": "g", "ts": 1732870000000 }
```
**Response 404** — unknown `item_id`.

---

### `POST /api/item/:id/action`
Send an ON/OFF command to a relay actuator, or OPEN/CLOSE to the raw-material
gate. Used by the Dashboard, where a real
button exists to click.

**Body**
```json
{ "command": "on" }
```
`command` must be `"on"` or `"off"` for relay actuators, or `"open"` or
`"close"` for `lime_stone`.

**Response 200**
```json
{ "item_id": "crusher", "command": "on" }
```
**Response 400** — bad/missing `command`, or `:id` is not an actuator.
**Response 404** — unknown `item_id`.

---

### `GET /api/item/:id/action/on`
### `GET /api/item/:id/action/off`
### `GET /api/item/:id/action/open`
### `GET /api/item/:id/action/close`
### `GET /api/item/:id/on`
### `GET /api/item/:id/off`
### `GET /api/item/:id/open`
### `GET /api/item/:id/close`
Fire an ON, OFF, OPEN, or CLOSE command immediately. Built for Cupola:

- **Separate Widget Pages (`widget-frontend/`)**:
  - `on.html?id=<item_id>` -> Dedicated single ON button widget.
  - `off.html?id=<item_id>` -> Dedicated single OFF button widget.
  - `open.html?id=<item_id>` -> Dedicated single OPEN button widget.
  - `close.html?id=<item_id>` -> Dedicated single CLOSE button widget.
- **Link-type hotspot**: paste this URL directly into the hotspot's embed field. Opening the URL fires the command and shows a short confirmation.

**Response 200** (`text/plain`)
```
CRUSHER: ON
```
**Response 400** — `:id` is not an actuator or unsupported action.
**Response 404** — unknown `item_id`.

> **Security note**: these are plain GET requests that change state — fine
> for a private LAN demo, but add authentication or a confirmation step
> before exposing this publicly.

---

### `POST /api/materials/targets`
Set a dispensing target (grams) for one or more materials in a single call.
Used by the Dashboard's "Material Targets Configuration" panel.

**Body**
```json
{ "gypsum": 50, "clay": 50, "iron_ore": 50, "sand": 50 }
```

**Response 200**
```json
{ "accepted": ["gypsum", "clay", "iron_ore", "sand"], "rejected": [] }
```
An `item_id` lands in `rejected` if it's unknown, not dispensable, or its
value isn't a number.

### `POST /api/item/:id/target`
Single-item variant of the above.

**Body**
```json
{ "target": 50 }
```
**Response 200**
```json
{ "item_id": "gypsum", "target": 50 }
```
**Response 400** — `:id` is not dispensable, or `target` isn't a number.
**Response 404** — unknown `item_id`.

### `GET /api/materials/dispensable`
List of item_ids that accept a target.

**Response 200**
```json
["gypsum", "clay", "iron_ore", "sand"]
```

---

### `GET /api/health`
Backend + MQTT connection status. For ops/debugging.

**Response 200**
```json
{ "backend": "ok", "mqtt_connected": true, "ts": 1732870000000 }
```

---

## 3. WebSocket Protocol

Connect to `ws://<host>:<port>/ws`.

**Default behaviour**: a freshly-connected client receives updates for
**every** item (this is what the Dashboard uses — no message needs to be sent).

**Scoping to one item** (what widget/control pages use): send a subscribe
message right after connecting.
```json
{ "type": "subscribe", "item_id": "iron_ore" }
```
From then on, that connection only receives updates for `iron_ore`.

**Update messages** (server -> client), sent whenever a new MQTT message
changes that item's state:
```json
{ "type": "update", "item_id": "iron_ore", "value": 52, "unit": "g", "ts": 1732870000000 }
```
For actuators, `value` is `"on"` or `"off"`. For materials mid-dispense, an
extra `dispensing: true|false` field may also be present.

---

## 4. Cupola Integration (widget-frontend)

Two static HTML pages, no build step, served from `widget-frontend/`.

### `widget.html?id=<item_id>`
Inline live value label — plain text, transparent background, no card. Use
for every material and sensor. Works the same way regardless of hotspot type
(embed or link) since it's meant to be visible continuously either way.

```
widget.html?id=iron_ore        ->  "iron_ore: 52 g"
widget.html?id=clin_dht_temp   ->  "clin_dht_temp: 32.5 C"
```

### `richinfo.html?id=<item_id>` — for Rich Info Hotspot Popups / Cards
Styled rich card layout (dark theme, live status badge, formatted title, large live value, alarm alert) for embedding inside Cupola360 Rich Info popups or iFrames.

```
richinfo.html?id=iron_ore
richinfo.html?id=klin_dht_temp
```

### `control.html?id=<item_id>` — for actuators, TWO usage styles

**Style A — embed-type hotspot** (Cupola keeps the page visible in place, the
way a YouTube embed stays visible):
```
control.html?id=crusher
```
Shows a green ON button and a red OFF button, stacked vertically. Whichever
one matches the actuator's actual current state is highlighted (opacity 1);
the other stays dimmed. Tapping a button calls the corresponding
`GET /api/item/:id/action/on|off` route and the highlight updates live over
WebSocket. Paste **one URL per actuator** for this style.

**Style B — link-type hotspot** (clicking a Cupola icon just opens a URL,
which fires immediately with no page interaction):
```
control.html?id=crusher&action=on
control.html?id=crusher&action=off
```
Fires the command the instant the page loads, shows a one-line confirmation
(`"CRUSHER: ON"`), no buttons rendered. Paste **two URLs per actuator** for
this style — one for a green icon, one for a red icon.

If you're not sure which hotspot type your Cupola build uses, Style A
(`control.html?id=<item_id>`, no `action`) is the safer default — it still
works fine even if Cupola only ever "opens" the URL once, since the user then
sees both buttons and can tap the one they want.

### Full hotspot URL list (current item set)

```
Materials / sensors (inline value):
  widget.html?id=gypsum
  widget.html?id=clay
  widget.html?id=iron_ore
  widget.html?id=sand
  widget.html?id=klin_dht_temp
  widget.html?id=klin_dht_humidity
  widget.html?id=cooler_dht_temp
  widget.html?id=cooler_dht_humidity
  widget.html?id=preheating_tower_dht_temp
  widget.html?id=preheating_tower_dht_humidity
  widget.html?id=vibration_sensor

Gate Actuator (separate ON/OFF/OPEN/CLOSE URLs):
  open.html?id=lime_stone
  cd cd 

Actuators (separate ON/OFF URLs per actuator):
  on.html?id=crusher
  off.html?id=crusher
  (available for: crusher, conveyor_1, conveyor_2, conveyor_3, conveyor_4,
   klin, klin_heater, heat_blower, preheating_tower_fan, preheating_tower_heater,
   vibration_motor, ball_mill_1, ball_mill_2)

Combined dual-button control (optional):
  control.html?id=<item_id>
```

---

## 5. MQTT Topics (backend <-> ESP32, via Mosquitto)

Not called directly by any frontend — documented here for reference when
debugging with `mosquitto_sub`/`mosquitto_pub`.

| Topic pattern | Direction | Payload | Used for |
|---|---|---|---|
| `plant/<esp>/<item_id>` | ESP32 -> backend | `{ "value": 52, "unit": "g" }` | live sensor/material readings, and relay state |
| `plant/<esp>/<item_id>/cmd` | backend -> ESP32 | `{ "command": "on" \| "off" }` | actuator ON/OFF |
| `plant/<esp>/<item_id>/target/cmd` | backend -> ESP32 | `{ "target": 50 }` | start dispensing (materials only) |
| `plant/<esp>/<item_id>/target/status` | ESP32 -> backend | `{ "status": "dispensing" \| "done" }` | dispensing progress |

`<esp>` is `esp1` for materials, `esp2` for everything on the relay/sensor board.

---

## 6. Quick Test Recipe

```bash
# Snapshot everything
curl http://localhost:4000/api/items

# Turn the crusher on, then off
curl http://localhost:4000/api/item/crusher/action/on
curl http://localhost:4000/api/item/crusher/action/off

# Start dispensing 50g of gypsum
curl -X POST http://localhost:4000/api/materials/targets \
  -H "Content-Type: application/json" \
  -d '{"gypsum": 50}'

# Health check
curl http://localhost:4000/api/health
```
