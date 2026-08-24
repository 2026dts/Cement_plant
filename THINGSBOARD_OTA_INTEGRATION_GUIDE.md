# Native ThingsBoard OTA & Server-Side RPC System Control Guide

This document defines the complete architecture, setup, and operation procedure for **Native ThingsBoard Over-The-Air (OTA) Firmware Updates** and **Dual-ESP32 Server-Side RPC Reboot**.

---

## 1. Complete System Architecture

```text
                         INDIA
                      Developer
                          │
                          │ HTTPS Upload .bin
                          ▼
                 ┌───────────────────┐
                 │    ThingsBoard    │
                 │   Firmware OTA    │
                 │      DUBAI        │
                 └─────────┬─────────┘
                           │
                 Firmware package
                 title/version/checksum
                           │
                           ▼
        ┌──────────────────┴──────────────────┐
        │                                     │
        ▼                                     ▼
┌───────────────┐                     ┌───────────────┐
│ Your Backend  │                     │ Your Frontend │
│    DUBAI      │                     │    DUBAI      │
└───────┬───────┘                     └───────┬───────┘
        │                                     │
        │          UPDATE button              │
        └──────────────────┬──────────────────┘
                           │
                           ▼
                    ThingsBoard
                           │
                      MQTT OTA
                           │
                ┌──────────┴──────────┐
                │                     │
                ▼                     ▼
             ESP1                  ESP2
             DUBAI                 DUBAI
```

---

## 2. Firmware Repository & Package Setup in ThingsBoard (AE Dubai Server)

Developer (in India) compiles binary `.bin` in Arduino IDE (`Sketch → Export Compiled Binary`) and uploads it to **ThingsBoard OTA Management** on the AE Dubai Server via HTTPS:

1. Log in to ThingsBoard Web UI (`http://<DUBAI_SERVER_IP>:8080`).
2. Go to **Advanced Features → OTA Updates** (or **Firmware Repository**).
3. Click **+ Add Package**:
   - **For ESP1**:
     - Title: `esp1_materials`
     - Version: `1.0.1`
     - Type: `Firmware`
     - Upload: `esp1_materials.ino.bin`
   - **For ESP2**:
     - Title: `esp2_relay`
     - Version: `1.0.1`
     - Type: `Firmware`
     - Upload: `esp2_relay.ino.bin`
4. ThingsBoard automatically stores the binary and generates title, version, and SHA-256 / MD5 checksums.

---

## 3. End-to-End Operation Flow

1. **Frontend Dashboard (Dubai)**:
   - Fetches available firmware packages from ThingsBoard via `GET /api/ota/firmwares`.
   - Displays target device selector (`ESP1`, `ESP2`, or `Both ESP32 Boards`) and version dropdown.
   - User clicks **`[ UPDATE ]`** (or **`[ UPDATE BOTH ]`**).
2. **Backend Processing (Dubai)**:
   - Backend calls `POST /api/ota/trigger` with `{ target, firmwareTitle, firmwareVersion }`.
   - Backend updates device shared attributes in ThingsBoard (`v1/devices/me/attributes` -> `fw_title`, `fw_version`, `fw_url`).
3. **ESP32 Notification & Safe Hardware Shutdown**:
   - **ESP1**:
     - Receives `v1/devices/me/attributes` notification.
     - **Safety Sequence**: Immediately stops material dispensing, homes all 4 servos (`SERVO_HOME_ANGLE` = 30°), and closes the raw material gate (`GPIO25` = LOW).
   - **ESP2**:
     - Receives `v1/devices/me/attributes` notification.
     - **Safety Sequence**: Immediately de-energizes all 13 active relay outputs (turning OFF heaters, kiln motors, crushers, conveyors, and fans).
4. **Firmware Download & Flash**:
   - ESP32 reports OTA State `DOWNLOADING` to `v1/devices/me/telemetry`.
   - ESP32 downloads the firmware over HTTP/HTTPS from ThingsBoard.
   - ESP32 verifies the **MD5 hash** against the downloaded binary.
   - ESP32 writes the binary into the inactive OTA partition.
   - Reports `VERIFIED` -> `UPDATING`.
5. **Reboot & Boot Validation**:
   - ESP32 reboots into the new partition.
   - Calls `esp_ota_mark_app_valid_cancel_rollback()` in `setup()` to confirm partition validity.
   - Reports `current_fw_version` and `fw_state`: `UPDATED` to ThingsBoard telemetry.

---

## 4. Server-Side RPC Reboot Protocol

Remote reboot is kept strictly separate from OTA:

1. Dashboard user clicks **`[ Reboot Both ESP32s ]`** (or individual reboot buttons).
2. Backend calls `POST /api/system/reboot` with target.
3. Backend sends ThingsBoard Server-Side RPC request:
   `{"method": "reboot", "params": {}}`
4. ESP32 receives RPC method `reboot`, shuts down actuators safely, and calls `ESP.restart()`.

---

## 5. ThingsBoard Telemetry OTA States

- `QUEUED`: Firmware assignment initiated.
- `INITIATED`: Device notified, hardware safe shutdown active.
- `DOWNLOADING`: Downloading firmware binary chunks.
- `DOWNLOADED`: Binary download completed.
- `VERIFIED`: MD5 / SHA-256 checksum hash verified.
- `UPDATING`: Inactive partition flashed, reboot pending.
- `UPDATED`: Device booted successfully into new firmware.
- `FAILED`: Checksum mismatch or download failed; previous working firmware partition restored.
