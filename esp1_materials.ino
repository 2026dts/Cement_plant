/*
  ESP32-1 — 4x Load Cell + 5x Servo (Material Dispensing + Raw Gate) — Mosquitto MQTT
  ==========================================================================
  Hardware on this board:
    - 4x 20kg load cells (HX711), all sharing ONE common SCK pin, each with
      its own DOUT pin.
    - 4x servo motors, one per load cell, used to hold at max angle while
      material dispenses until the target weight is reached, then the
      servo returns to its home position.
    - 1x raw-material gate servo on GPIO25, controlled independently with
      open/close commands.

  Calibration factor (96.322) is kept EXACTLY as supplied — do not change
  this value, only re-use it per load cell / servo pair below.

  ================================ LIBRARIES ================================
  Install via Arduino IDE -> Tools -> Manage Libraries:
    - "PubSubClient"           (by Nick O'Leary)
    - "ArduinoJson"            v6.x.x
    - "HX711 Arduino Library"  (by Bogdan Necula)
    - "ESP32Servo"             (by Kevin Harrington)

  ============================ MOSQUITTO SETUP ===============================
  Set MQTT_BROKER_HOST below to your local Mosquitto machine's LAN IP.

  ================================ WIRING ====================================
  Shared SCK (all 4 load cells): GPIO 32

    Pair 1 - gypsum:        DOUT -> GPIO22  | Servo -> GPIO27
    Pair 2 - clay:          DOUT -> GPIO23  | Servo -> GPIO26
    Pair 3 - iron_ore:      DOUT -> GPIO5   | Servo -> GPIO14
    Pair 4 - sand:          DOUT -> GPIO15  | Servo -> GPIO13
    Lime stone gate:                           Servo -> GPIO25

  MQTT topics (common, identity in payload):
    plant/cement-dubai/esp1/command           -> SUB material cmd { "material","action","target" }
    plant/cement-dubai/esp1/values            -> PUB live weight  { "type":"material","material","value","unit" }
    plant/cement-dubai/esp1/status            -> PUB device LWT   { "value":"online"|"offline"|"rebooting" }
                                              -> PUB dispense     { "type":"material","material","target","status" }
    plant/cement-dubai/esp1/actuator/command  -> SUB gate cmd     { "actuator":"lime_stone","command":"open"|"close" }
    plant/cement-dubai/esp1/actuator/state    -> PUB gate state   { "actuator":"lime_stone","value":"open"|"close" }

  ============================= BOOT / TARE BEHAVIOUR =========================
  At boot, each channel's HX711 is brought up with a bounded timeout instead
  of an unbounded blocking wait. If a particular load cell's chip never
  responds (bad wiring / no power / floating DOUT), that ONE channel is
  marked failed and skipped — it will NOT hang the other 4 channels or the
  rest of setup(). Failed channels are retried automatically later from
  loop() via serviceTaring().

  ============================= DISPENSE BEHAVIOUR ============================
  On a target/cmd for a material:
    - that material's servo moves straight to SERVO_MAX_ANGLE and HOLDS there
      (no oscillation)
    - it stays at SERVO_MAX_ANGLE until that material's load cell reaches the
      target weight
    - only then does that specific servo return to SERVO_HOME_ANGLE
  Every material is independent — one material dispensing does not affect any
  other material's servo/state. The raw-material gate is controlled separately.
*/

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <HX711.h>
#include <ESP32Servo.h>
#include <HTTPUpdate.h>
#include <esp_ota_ops.h>
#include <esp_system.h>

// ============================================================================
// ---------------------------- USER CONFIGURATION ---------------------------
// ============================================================================
constexpr char FIRMWARE_TITLE[]   = "esp1_materials";
constexpr char FIRMWARE_VERSION[] = "1.0.0";


constexpr char WIFI_SSID[]     = "ACT-ai_103812010408";
constexpr char WIFI_PASSWORD[] = "33346558";

constexpr char MQTT_BROKER_HOST[] = "192.168.0.3";   // local Mosquitto machine's LAN IP
constexpr uint16_t MQTT_BROKER_PORT = 1883U;
constexpr char MQTT_USER[]     = "esp1";              // ThingsBoard Access Token for ESP1
constexpr char MQTT_PASSWORD[] = "";
constexpr char MQTT_CLIENT_ID[] = "esp1-materials";
constexpr char TB_HTTP_BASE[]     = "http://allcad-chennai.selfip.com:8081";
constexpr char TB_DEVICE_TOKEN[]  = "esp1";

constexpr uint32_t TELEMETRY_INTERVAL_MS   = 500UL;   // live weight publish interval
constexpr uint32_t MQTT_RECONNECT_DELAY_MS = 2000UL;

// ---- Kept EXACTLY as supplied - do not change ----
constexpr float CALIBRATION_FACTOR = 96.322f;
constexpr int    SERVO_HOME_ANGLE   = 30;   // original / resting position
constexpr int    SERVO_MAX_ANGLE    = 140;  // held position while dispensing

constexpr uint8_t SHARED_SCK_PIN = 32;

// How long to wait for a single HX711 chip to signal ready before giving up
// on that ONE channel (does not block the others).
constexpr uint32_t HX711_INIT_TIMEOUT_MS = 3000UL;

// How often (ms) a still-uninitialized HX711 channel is retried from loop().
constexpr uint32_t HX711_RETRY_INTERVAL_MS = 5000UL;

// ============================================================================
// -------------------------- MATERIAL FEED CONFIG ----------------------------
// ============================================================================
struct MaterialFeed {
  const char *item_id;
  uint8_t dout_pin;
  uint8_t servo_pin;

  HX711 loadCell;
  Servo  servo;

  bool  hxReady      = false;  // true once loadCell.begin() has actually succeeded
  bool  tared        = false;  // set true the moment this channel's own tare completes
  bool  dispensing   = false;
  float targetGrams  = 0.0f;
  float lastWeight   = 0.0f;
  unsigned long lastInitAttemptMs = 0;
};

MaterialFeed materials[4] = {
  { "gypsum",       22, 27 },
  { "clay",         23, 26 },
  { "iron_ore",      5, 14 },
  { "sand",          15, 13 },
};
constexpr uint8_t NUM_MATERIALS = 4;

Servo limeStoneGate;
bool limeStoneGateOpen = false;

// ============================================================================
// ------------------------------- MQTT CLIENT --------------------------------
// ============================================================================
WiFiClient   espClient;
PubSubClient mqtt(espClient);

unsigned long lastTelemetryMs        = 0;
unsigned long lastReconnectAttemptMs = 0;

String commandTopic()                         { return "plant/cement-dubai/esp1/command"; }
String valuesTopic()                           { return "plant/cement-dubai/esp1/values"; }
String statusTopic()                           { return "plant/cement-dubai/esp1/status"; }
String actuatorCommandTopic()                  { return "plant/cement-dubai/esp1/actuator/command"; }
String actuatorStateTopic()                    { return "plant/cement-dubai/esp1/actuator/state"; }

// ============================================================================
// --------------------------------- WIFI -------------------------------------
// ============================================================================
void initWiFi() {
  Serial.print("Connecting to WiFi");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected, IP: " + WiFi.localIP().toString());
}

bool reconnectWiFiIfNeeded() {
  if (WiFi.status() == WL_CONNECTED) return true;
  initWiFi();
  return true;
}

// ============================================================================
// --------------------------- HX711 SAFE INIT --------------------------------
// ============================================================================
// Brings up ONE HX711 channel with a bounded timeout instead of the library's
// own unbounded blocking wait inside begin()->set_gain()->read(). If the chip
// never pulls DOUT low within HX711_INIT_TIMEOUT_MS, we give up on just this
// channel and return false so the caller can move on to the next material.
bool beginLoadCellWithTimeout(MaterialFeed &m, uint32_t timeoutMs = HX711_INIT_TIMEOUT_MS) {
  pinMode(SHARED_SCK_PIN, OUTPUT);
  pinMode(m.dout_pin, INPUT);
  digitalWrite(SHARED_SCK_PIN, LOW);

  uint32_t start = millis();
  while (digitalRead(m.dout_pin) == HIGH) {   // mirrors HX711::is_ready()
    if (millis() - start > timeoutMs) {
      Serial.printf("[HX711] %s: NOT responding on DOUT=GPIO%d (timeout) - skipping for now\n",
                     m.item_id, m.dout_pin);
      return false;
    }
    yield();
  }

  m.loadCell.begin(m.dout_pin, SHARED_SCK_PIN);  // chip is ready, this call is now instant
  m.loadCell.set_scale(CALIBRATION_FACTOR);
  m.hxReady = true;
  Serial.printf("[HX711] %s: ready on DOUT=GPIO%d\n", m.item_id, m.dout_pin);
  return true;
}

// ============================================================================
// ------------------------------ SENSOR READING ------------------------------
// ============================================================================
float readLoadCellFast(MaterialFeed &m, uint8_t samples = 1) {
  if (!m.hxReady) return (m.lastWeight < 0.0f) ? 0.0f : m.lastWeight;
  if (m.loadCell.is_ready()) {
    float w = m.loadCell.get_units(samples); // 1 sample = INSTANT reading (0ms delay)
    if (w < 0.5f) {
      w = 0.0f; // Clamp negative readings and zero-drift noise to 0.0
    }
    return w;
  }
  return (m.lastWeight < 0.0f) ? 0.0f : m.lastWeight;
}

void publishAllMaterials() {
  StaticJsonDocument<256> doc;
  doc["type"] = "materials";
  JsonObject values = doc.createNestedObject("values");
  for (uint8_t i = 0; i < NUM_MATERIALS; i++) {
    float w = readLoadCellFast(materials[i], 1);
    if (w < 0.0f) w = 0.0f;
    materials[i].lastWeight = w;
    values[materials[i].item_id] = w;
  }
  doc["unit"] = "g";
  char payload[256];
  serializeJson(doc, payload);
  mqtt.publish(valuesTopic().c_str(), payload);
}

void publishValue(const char *item_id, float value, const char *unit) {
  if (value < 0.0f) {
    value = 0.0f; // Prevent publishing negative sensor values
  }
  StaticJsonDocument<128> doc;
  doc["type"] = "material";
  doc["material"] = item_id;
  doc["value"] = value;
  doc["unit"]  = unit;
  char payload[192];
  serializeJson(doc, payload);
  mqtt.publish(valuesTopic().c_str(), payload);
}

void publishAllActuators() {
  StaticJsonDocument<256> doc;
  doc["type"] = "actuators";
  JsonObject values = doc.createNestedObject("values");
  values["lime_stone"] = limeStoneGateOpen ? "open" : "close";
  char payload[256];
  serializeJson(doc, payload);
  mqtt.publish(actuatorStateTopic().c_str(), payload, true); // retained
}

void setLimeStoneGate(bool open) {
  limeStoneGateOpen = open;
  limeStoneGate.write(open ? SERVO_MAX_ANGLE : SERVO_HOME_ANGLE);
  Serial.printf("[LIME STONE GATE] %s -> %d degrees\n",
                open ? "open" : "close",
                open ? SERVO_MAX_ANGLE : SERVO_HOME_ANGLE);
  publishAllActuators();
}

// ============================================================================
// ----------------------- SERVO / DISPENSING CONTROL --------------------------
// ============================================================================
void publishTargetStatus(MaterialFeed &m, const char *status) {
  StaticJsonDocument<128> doc;
  doc["type"] = "material";
  doc["material"] = m.item_id;
  doc["target"] = m.targetGrams;
  doc["status"] = status;
  char payload[192];
  serializeJson(doc, payload);
  mqtt.publish(statusTopic().c_str(), payload);
}

void startDispense(MaterialFeed &m, float target) {
  if (!m.hxReady) {
    Serial.printf("[DISPENSE BLOCKED] %s: load cell not ready yet, ignoring target/cmd\n", m.item_id);
    return;
  }
  float currentWeight = readLoadCellFast(m, 1);
  if (currentWeight < 0.0f) currentWeight = 0.0f;
  
  // Calculate cumulative cutoff target so existing material on load cell is preserved
  // (e.g., 5g existing + 5g new target = 10g total cutoff weight)
  m.targetGrams = currentWeight + target;
  m.dispensing  = true;
  m.servo.write(SERVO_MAX_ANGLE);   // Servo opens / moves to MAX position (140 deg)
  Serial.printf("\n[DISPENSE START] %s: added target=%.1fg, initial weight=%.1fg, cumulative target=%.1fg, servo -> MAX (%d deg)\n",
                m.item_id, target, currentWeight, m.targetGrams, SERVO_MAX_ANGLE);
  publishTargetStatus(m, "dispensing");
}

void stopDispense(MaterialFeed &m) {
  m.dispensing = false;
  m.servo.write(SERVO_HOME_ANGLE);  // Servo closes / returns to HOME position (30 deg)
  Serial.printf("\n[DISPENSE STOP] %s: target reached (current=%.1fg, target=%.1fg), servo -> HOME (%d deg)\n",
                m.item_id, m.lastWeight, m.targetGrams, SERVO_HOME_ANGLE);
  publishTargetStatus(m, "done");
  publishAllMaterials();
}

// Dedicated ULTRA-FAST check for active dispensing feeds.
// Runs every single loop tick to detect target threshold INSTANTLY and close servo immediately.
void checkDispensingFast() {
  for (uint8_t i = 0; i < NUM_MATERIALS; i++) {
    MaterialFeed &m = materials[i];
    if (m.dispensing) {
      if (m.loadCell.is_ready()) {
        m.lastWeight = readLoadCellFast(m, 1); // 1 sample for instant measurement
        publishAllMaterials();
        Serial.printf("[DISPENSING FAST] %s: %.1fg / %.1fg\n", m.item_id, m.targetGrams);
        if (m.lastWeight >= m.targetGrams) {
          stopDispense(m);
        }
      }
    }
  }
}

// Background telemetry for idle material feeds
void readAndPublishTelemetry() {
  publishAllMaterials();
}

// Retries any HX711 channel that failed to come up during setup(), without
// ever blocking the rest of loop(). Runs on a slow interval per channel.
void serviceTaring() {
  unsigned long now = millis();
  for (uint8_t i = 0; i < NUM_MATERIALS; i++) {
    MaterialFeed &m = materials[i];

    if (!m.hxReady) {
      if (now - m.lastInitAttemptMs >= HX711_RETRY_INTERVAL_MS) {
        m.lastInitAttemptMs = now;
        beginLoadCellWithTimeout(m, 500UL); // short timeout on retries, non-blocking to the rest
      }
      continue;
    }

    if (!m.tared && m.loadCell.is_ready()) {
      m.loadCell.tare();
      m.tared = true;
      Serial.printf("[TARE] %s tared and ready!\n", m.item_id);
    }
  }
}

// ============================================================================
// -------------------------- OTA & REBOOT MANAGEMENT -------------------------
// ============================================================================
void publishFwVersion() {
  StaticJsonDocument<128> doc;
  doc["title"]   = FIRMWARE_TITLE;
  doc["version"] = FIRMWARE_VERSION;
  char payload[128];
  serializeJson(doc, payload);
  mqtt.publish("plant/cement-dubai/esp1/version", payload, true);

  StaticJsonDocument<192> tbDoc;
  tbDoc["current_fw_title"]   = FIRMWARE_TITLE;
  tbDoc["current_fw_version"] = FIRMWARE_VERSION;
  tbDoc["fw_state"]           = "UPDATED";
  char tbPayload[192];
  serializeJson(tbDoc, tbPayload);
  mqtt.publish("v1/devices/me/telemetry", tbPayload);
}

#include <Update.h>

void publishOtaStatus(const char *tbState, int progress, const char *msg) {
  StaticJsonDocument<256> doc;
  doc["title"]    = FIRMWARE_TITLE;
  doc["version"]  = FIRMWARE_VERSION;
  doc["status"]   = tbState;
  doc["progress"] = progress;
  doc["message"]  = msg;
  char payload[256];
  serializeJson(doc, payload);
  mqtt.publish("plant/cement-dubai/esp1/ota/status", payload, true);

  // Native ThingsBoard OTA Telemetry format
  StaticJsonDocument<256> tbDoc;
  tbDoc["current_fw_title"]   = FIRMWARE_TITLE;
  tbDoc["current_fw_version"] = FIRMWARE_VERSION;
  tbDoc["fw_state"]           = tbState;
  tbDoc["fw_progress"]        = progress;
  tbDoc["fw_message"]         = msg;
  char tbPayload[256];
  serializeJson(tbDoc, tbPayload);
  mqtt.publish("v1/devices/me/telemetry", tbPayload);
}

void stopActuatorsSafely() {
  setLimeStoneGate(false);
  for (uint8_t i = 0; i < NUM_MATERIALS; i++) {
    materials[i].dispensing = false;
    materials[i].servo.write(SERVO_HOME_ANGLE);
    mqtt.publish(statusTopic().c_str(), "{\"type\":\"material\",\"material\":\"all\",\"status\":\"done\"}");
  }
  Serial.println("[SAFETY] ESP1 actuators safely stopped (raw gate closed, servos homed).");
}

void performReboot() {
  Serial.println("[SYSTEM] Remote reboot requested via ThingsBoard RPC! Shutting down actuators...");
  stopActuatorsSafely();
  mqtt.publish("plant/cement-dubai/esp1/status", "{\"value\":\"rebooting\"}", true);
  mqtt.loop();
  delay(500);
  ESP.restart();
}

void performOTA(const char *url = "", const char *checksum = "", const char *newVersion = "") {
  Serial.printf("[OTA] ThingsBoard OTA Triggered! URL: %s, Checksum: %s, Target Version: %s\n", url, checksum, newVersion);

  // Section 7 Requirement: ESP1 Safety Sequence before OTA download
  stopActuatorsSafely();
  publishOtaStatus("INITIATED", 0, "Actuators secured. Initiating firmware download...");
  delay(300);

  publishOtaStatus("DOWNLOADING", 5, "Downloading firmware from ThingsBoard...");

  if (strlen(checksum) == 32) {
    Serial.printf("[OTA] Setting MD5 Checksum: %s\n", checksum);
    httpUpdate.setMD5sum(checksum);
  }

  httpUpdate.onStart([]() {
    Serial.println("[OTA] Update flash process started...");
  });

  httpUpdate.onEnd([]() {
    Serial.println("[OTA] Firmware binary download and flash completed!");
  });

  httpUpdate.onProgress([](int cur, int total) {
    int pct = (total > 0) ? (cur * 100) / total : 0;
    Serial.printf("[OTA] Progress: %d%%\n", pct);
  });

  String downloadUrl = String(url);
  if (downloadUrl.length() == 0) {
    String tokenStr = strlen(MQTT_USER) > 0 ? String(MQTT_USER) : "esp1";
    downloadUrl = String("http://") + MQTT_BROKER_HOST + ":8080/api/v1/" + tokenStr + "/firmware?title=" + String(FIRMWARE_TITLE) + "&version=" + String(newVersion);
  }

  Serial.printf("[OTA] Downloading firmware binary from: %s\n", downloadUrl.c_str());
  t_httpUpdate_return ret = httpUpdate.update(espClient, downloadUrl.c_str());

  switch (ret) {
    case HTTP_UPDATE_FAILED: {
      String errStr = String(httpUpdate.getLastErrorString());
      Serial.printf("[OTA] Failed! Error (%d): %s\n", httpUpdate.getLastError(), errStr.c_str());
      publishOtaStatus("FAILED", 0, errStr.c_str());
      break;
    }
    case HTTP_UPDATE_NO_UPDATES:
      Serial.println("[OTA] HTTP_UPDATE_NO_UPDATES");
      publishOtaStatus("FAILED", 0, "No firmware package found");
      break;
    case HTTP_UPDATE_OK:
      Serial.println("[OTA] HTTP_UPDATE_OK - Verified! Rebooting device...");
      publishOtaStatus("DOWNLOADED", 90, "Download completed. Verifying partition...");
      delay(200);
      publishOtaStatus("VERIFIED", 95, "Checksum verified. Flashing partition...");
      delay(200);
      publishOtaStatus("UPDATING", 99, "Partition written. Rebooting device...");
      mqtt.loop();
      delay(1000);
      ESP.restart();
      break;
  }
}

// ============================================================================
// -------------------------------- MQTT CALLBACK ------------------------------
// ============================================================================
MaterialFeed *materialForId(const char *materialId) {
  for (uint8_t i = 0; i < NUM_MATERIALS; i++) {
    if (strcmp(materialId, materials[i].item_id) == 0) return &materials[i];
  }
  return nullptr;
}

void mqttCallback(char *topic, byte *payload, unsigned int length) {
  Serial.printf("[MQTT RX] %s -> %.*s\n", topic, length, (char *)payload);
  String topicStr(topic);

  // ---- Reboot commands ----
  if (topicStr == "plant/cement-dubai/esp1/cmd/reboot" || topicStr == "plant/cement-dubai/cmd/reboot/all") {
    performReboot();
    return;
  }

  // ---- OTA Update commands ----
  if (topicStr == "plant/cement-dubai/esp1/ota/cmd" || topicStr == "plant/cement-dubai/ota/cmd/all") {
    StaticJsonDocument<256> otaDoc;
    DeserializationError err = deserializeJson(otaDoc, payload, length);
    if (!err) {
      const char *url      = otaDoc["url"] | "";
      const char *checksum = otaDoc["checksum"] | "";
      const char *ver      = otaDoc["version"] | "";
      performOTA(url, checksum, ver);
    }
    return;
  }

  // ---- ThingsBoard RPC / Shared Attributes ----
  if (topicStr.startsWith("v1/devices/me/rpc/request/")) {
    StaticJsonDocument<256> rpcDoc;
    DeserializationError err = deserializeJson(rpcDoc, payload, length);
    if (!err) {
      const char *method = rpcDoc["method"] | "";
      if (strcmp(method, "reboot") == 0) {
        performReboot();
        return;
      } else if (strcmp(method, "firmware_update") == 0) {
        const char *url      = rpcDoc["params"]["url"] | rpcDoc["url"] | "";
        const char *checksum = rpcDoc["params"]["checksum"] | rpcDoc["checksum"] | "";
        const char *ver      = rpcDoc["params"]["version"] | rpcDoc["version"] | "";
        performOTA(url, checksum, ver);
        return;
      }
    }
  }

  if (topicStr == "v1/devices/me/attributes" || topicStr.startsWith("v1/devices/me/attributes/response/")) {
    StaticJsonDocument<512> attrDoc;
    DeserializationError err = deserializeJson(attrDoc, payload, length);
    if (!err) {
      const char *fwTitle    = attrDoc["fw_title"] | attrDoc["target_fw_title"] | "";
      const char *fwVer      = attrDoc["fw_version"] | attrDoc["target_fw_version"] | "";
      const char *fwChecksum = attrDoc["fw_checksum"] | attrDoc["target_fw_checksum"] | "";
      const char *fwUrl      = attrDoc["fw_url"] | "";
      if ((strcmp(fwTitle, FIRMWARE_TITLE) == 0 || strlen(fwTitle) == 0) && strlen(fwVer) > 0 && strcmp(fwVer, FIRMWARE_VERSION) != 0) {
        performOTA(fwUrl, fwChecksum, fwVer);
        return;
      }
    }
  }

  if (topicStr != commandTopic() && topicStr != actuatorCommandTopic()) return;

  StaticJsonDocument<128> doc;
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) {
    Serial.printf("[MQTT] Bad JSON on %s: %s\n", topic, err.c_str());
    return;
  }

  if (topicStr == actuatorCommandTopic()) {
    const char *actuatorId = doc["actuator"] | "";
    const char *command = doc["command"] | "";
    if (strcmp(actuatorId, "lime_stone") != 0) return;
    if (strcmp(command, "open") == 0) setLimeStoneGate(true);
    else if (strcmp(command, "close") == 0) setLimeStoneGate(false);
    return;
  }

  const char *materialId = doc["material"] | "";
  const char *action = doc["action"] | "target";
  float target = doc["target"] | -1.0f;
  if (strcmp(action, "target") != 0 || target < 0) return;
  MaterialFeed *m = materialForId(materialId);
  if (m == nullptr) return;
  startDispense(*m, target);
}

// ============================================================================
// -------------------------------- MQTT CONNECT -------------------------------
// ============================================================================
bool mqttConnect() {
  Serial.printf("Connecting to Mosquitto (%s:%u)...\n", MQTT_BROKER_HOST, MQTT_BROKER_PORT);
  String clientId = String(MQTT_CLIENT_ID) + "-" + WiFi.macAddress();
  const char *cid = clientId.c_str();

  const char *willTopic  = "plant/cement-dubai/esp1/status";
  const char *willMsg    = "{\"value\":\"offline\"}";
  uint8_t     willQos    = 1;
  boolean     willRetain = true;

  bool ok = strlen(MQTT_USER) > 0
              ? mqtt.connect(cid, MQTT_USER, MQTT_PASSWORD, willTopic, willQos, willRetain, willMsg)
              : mqtt.connect(cid, willTopic, willQos, willRetain, willMsg);

  if (!ok) {
    Serial.printf("[MQTT] Connect failed, rc=%d\n", mqtt.state());
    return false;
  }

  Serial.println("[MQTT] Connected to Mosquitto.");

  // Announce online status & firmware version immediately (retained)
  mqtt.publish("plant/cement-dubai/esp1/status", "{\"value\":\"online\"}", true);
  publishOtaStatus("UPDATED", 100, "Firmware is running");
  publishFwVersion();
  Serial.println("[MQTT] Published: plant/cement-dubai/esp1/status = online");

  mqtt.subscribe(commandTopic().c_str());
  mqtt.subscribe(actuatorCommandTopic().c_str());
  mqtt.subscribe("plant/cement-dubai/esp1/ota/cmd");
  mqtt.subscribe("plant/cement-dubai/ota/cmd/all");
  mqtt.subscribe("plant/cement-dubai/esp1/cmd/reboot");
  mqtt.subscribe("plant/cement-dubai/cmd/reboot/all");
  mqtt.subscribe("v1/devices/me/attributes");
  mqtt.subscribe("v1/devices/me/attributes/response/+");
  mqtt.subscribe("v1/devices/me/rpc/request/+");

  return true;
}

void maintainMqttConnection() {
  if (mqtt.connected()) return;
  unsigned long now = millis();
  if (now - lastReconnectAttemptMs < MQTT_RECONNECT_DELAY_MS) return;
  lastReconnectAttemptMs = now;
  mqttConnect();
}

// ============================================================================
// ---------------------------------- SETUP -----------------------------------
// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n=== ESP32-1 Materials Node (4x Load Cell + Raw Gate) - Booting ===");

  // ---- Validate current running app partition & cancel rollback ----
  esp_ota_mark_app_valid_cancel_rollback();

  // ---- Step 1: WiFi first ----
  initWiFi();

  // ---- Step 2: MQTT broker next ----
  mqtt.setServer(MQTT_BROKER_HOST, MQTT_BROKER_PORT);
  mqtt.setCallback(mqttCallback);
  mqttConnect();

  // ---- Step 3: Initialize Raw Gate Servo ----
  limeStoneGate.attach(25);
  setLimeStoneGate(false);

  // ---- Step 4: Initialize Material Servos and Load Cells ----
  // Each HX711 gets a bounded timeout so ONE dead/unwired channel can never
  // hang the other 4 or the rest of boot. Failed channels are retried later
  // from loop() via serviceTaring().
  for (uint8_t i = 0; i < NUM_MATERIALS; i++) {
    MaterialFeed &m = materials[i];

    Serial.printf("\nInitializing %s...\n", m.item_id);
    Serial.printf("DOUT = GPIO%d, Servo = GPIO%d, SCK = GPIO%d\n", m.dout_pin, m.servo_pin, SHARED_SCK_PIN);

    m.servo.attach(m.servo_pin);
    m.servo.write(SERVO_HOME_ANGLE); // Every feeder starts at resting home position (30 deg)

    m.lastInitAttemptMs = millis();
    beginLoadCellWithTimeout(m); // non-blocking to the other channels even on failure
  }

  Serial.println("\n------------------------------------------------");
  Serial.println("Taring scales that came up ready... (others will retry + tare in background)");
  Serial.println("------------------------------------------------");
  delay(2000);

  for (uint8_t i = 0; i < NUM_MATERIALS; i++) {
    MaterialFeed &m = materials[i];
    if (m.hxReady) {
      m.loadCell.tare();
      m.tared = true;
      Serial.printf("[TARE] %s tared and ready!\n", m.item_id);
    } else {
      Serial.printf("[TARE] %s SKIPPED - HX711 not ready, will auto-retry every %lus in loop()\n",
                     m.item_id, HX711_RETRY_INTERVAL_MS / 1000UL);
    }
  }

  Serial.println("\n=== Setup complete ===\n");
}

// ============================================================================
// ----------------------------------- LOOP ------------------------------------
// ============================================================================
void loop() {
  if (!reconnectWiFiIfNeeded()) {
    delay(500);
    return;
  }

  maintainMqttConnection();
  if (mqtt.connected()) {
    mqtt.loop(); // processes incoming target/cmd messages via mqttCallback()
  }

  // 1. FAST PRIORITY DISPENSE CHECK (runs every loop tick for instant servo response!)
  checkDispensingFast();

  // 2. Periodic background telemetry for idle channels
  unsigned long now = millis();
  if (now - lastTelemetryMs >= 150UL) { // 150ms telemetry refresh rate
    lastTelemetryMs = now;
    readAndPublishTelemetry();
  }

  // 3. Retry any HX711 channel that failed at boot, and tare any channel
  //    that has become ready since then. Non-blocking, cheap check per tick.
  serviceTaring();
}

/*
  ============================= CALIBRATION NOTE =============================
  The 96.322 calibration factor was measured for one specific load cell. If a
  particular pair's readings look off, recalibrate just that one entry in
  `materials[]` (raw_reading_with_50g / 50) rather than changing the shared
  constant, since each HX711 module can differ slightly.
*/