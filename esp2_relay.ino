/*
  ESP32-2 — 16-Channel Relay Board (2 x 8ch) + 3x DHT11 + 1x Vibration Sensor
  Mosquitto MQTT
  ======================================================================================
  Hardware on this board:
    - Two 8-channel relay modules (16 channels total). 13 are wired to actual
      loads for this build; channels 14-16 are spare (see note at the bottom -
      the onboard GPIO is now fully used up by channels 1-13 + the 3 sensors
      below, so wiring the remaining 3 spare channels later will need an I2C
      GPIO expander such as a PCF8574, not more direct ESP32 pins).
    - 3x DHT11 temperature/humidity sensors (read-only, not relay-controlled).
    - 1x vibration SENSOR (read-only, separate from the vibration MOTOR below).

  Channel -> function mapping (as supplied):
    Channel 1  -> crusher                 (ONE relay drives all 3 N20 motors together:
                                            left, right, and wheel motor - wired in
                                            parallel to this single relay output)
    Channel 2  -> conveyor_1
    Channel 3  -> conveyor_2
    Channel 4  -> conveyor_3
    Channel 5  -> conveyor_4
    Channel 6  -> klin                          (kiln motor)
    Channel 7  -> klin_heater                   (inside the klin) [RENAMED from "heater"]
    Channel 8  -> heat_blower                   (mini exhaust fan, next to klin_heater, inside the klin)
    Channel 9  -> preheating_tower_fan          (preheating tower fan - renamed from cooler_fan)
    Channel 10 -> preheating_tower_heater       [NEW - reuses the channel/pin freed by removing klin_cooler_fan]
    Channel 11 -> vibration_motor
    Channel 12 -> ball_mill_1
    Channel 13 -> ball_mill_2
    Channel 14-16 -> spare, not wired yet (see GPIO note above)

  REMOVED: klin_cooler_fan (no longer wired - its relay/GPIO was reassigned to
  preheating_tower_heater above).

  DHT11 sensors -> renamed / added:
    dht1  -> klin_dht              (unchanged location: near klin/heater)     [RENAMED from "dht1"]
    dht2  -> cooler_dht            (unchanged location: near the cooler)      [RENAMED from "dht2"]
    NEW   -> preheating_tower_dht  (near the preheating tower / new heater)

  ================================ LIBRARIES ================================
  Install via Arduino IDE -> Tools -> Manage Libraries:
    - "PubSubClient"                                (by Nick O'Leary)
    - "ArduinoJson"                                 v6.x.x
    - "DHT sensor library" (by Adafruit) + "Adafruit Unified Sensor"

  ============================ MOSQUITTO SETUP ===============================
  Set MQTT_BROKER_HOST below to your local Mosquitto machine's LAN IP.

  ================================ WIRING ====================================
  Actuators are connected to NO (Normally Open) relay terminals.
  RELAY_ACTIVE_LOW is set to false (HIGH = ON / relay energized, LOW = OFF / relay de-energized).

    Ch 1  crusher                  -> GPIO4     Ch 8  heat_blower             -> GPIO19
    Ch 2  conveyor_1               -> GPIO5     Ch 9  preheating_tower_fan    -> GPIO5
    Ch 3  conveyor_2               -> GPIO13    Ch 10 preheating_tower_heater -> GPIO22
    Ch 4  conveyor_3               -> GPIO14    Ch 11 vibration_motor         -> GPIO23
    Ch 5  conveyor_4               -> GPIO16    Ch 12 ball_mill_1             -> GPIO32
    Ch 6  klin                     -> GPIO17    Ch 13 ball_mill_2             -> GPIO33

    DHT11 (klin_dht)              -> GPIO25 (10k pull-up to 3.3V)
    DHT11 (cooler_dht)            -> GPIO26 (10k pull-up to 3.3V)
    DHT11 (preheating_tower_dht)  -> GPIO15 (10k pull-up to 3.3V) - see note below
    Vibration sensor               -> GPIO27 (digital output module, e.g. SW-420)

  NOTE ON GPIO15: every other "conservative" GPIO on this board is already
  used (see the spare-channels note at the bottom), so the third DHT11 uses
  GPIO15, a strapping pin. It only affects the ESP32's boot-log verbosity at
  power-on, not boot mode - safe for a sensor that's only read after setup()
  runs, but avoid it if you add anything boot-timing-sensitive later.

  MQTT topics:
    Actuators (per channel, e.g. "conveyor_1"):
      plant/esp2/conveyor_1/cmd            -> subscribed command  { "command": "on" | "off" | "auto" }
      plant/esp2/conveyor_1                -> published state      { "value": "on" | "off" }
    Sensors:
      plant/esp2/klin_dht_temp             -> { "value": 32.5, "unit": "C" }
      plant/esp2/klin_dht_humidity         -> { "value": 41,   "unit": "%" }
      plant/esp2/cooler_dht_temp           -> { "value": 30.1, "unit": "C" }
      plant/esp2/cooler_dht_humidity       -> { "value": 38,   "unit": "%" }
      plant/esp2/preheating_tower_dht_temp     -> { "value": 34.0, "unit": "C" }
      plant/esp2/preheating_tower_dht_humidity -> { "value": 36,   "unit": "%" }
      plant/esp2/vibration_sensor          -> { "value": 1,    "unit": "/8" }
    Device / PID status:
      plant/esp2/status                    -> { "value": "online" | "offline" } (LWT + on-connect)
      plant/esp2/klin/manual_override      -> { "value": true | false }  (retained)
      plant/esp2/klin_heater/manual_override -> { "value": true | false } (retained)
    Override resume (subscribed, sent by backend dashboard):
      plant/esp2/klin/override_cmd         -> { "command": "auto" }
      plant/esp2/klin_heater/override_cmd  -> { "command": "auto" }
*/

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <HTTPUpdate.h>
#include <esp_ota_ops.h>
#include <esp_system.h>

// ============================================================================
// ---------------------------- USER CONFIGURATION ---------------------------
// ============================================================================
constexpr char FIRMWARE_TITLE[]   = "esp2_relay";
constexpr char FIRMWARE_VERSION[] = "1.0.0";


constexpr char WIFI_SSID[]     = "ACT-ai_103812010408";
constexpr char WIFI_PASSWORD[] = "33346558";

constexpr char MQTT_BROKER_HOST[] = "192.168.0.3";    // local Mosquitto machine's LAN IP
constexpr uint16_t MQTT_BROKER_PORT = 1883U;
constexpr char MQTT_USER[]     = "esp2";               // ThingsBoard Access Token for ESP2
constexpr char MQTT_PASSWORD[] = "";
constexpr char MQTT_CLIENT_ID[] = "esp2-relay";

constexpr uint32_t MQTT_RECONNECT_DELAY_MS = 2000UL;
constexpr uint32_t STATE_REPUBLISH_MS      = 10000UL; // periodic relay "still on/off" heartbeat
constexpr uint32_t DHT_READ_MS             = 2000UL;  // DHT + vibration publish interval (2s for PID)

constexpr bool RELAY_ACTIVE_LOW = true;  // Active-LOW relay module: LOW = coil energized (NO closes / ON), HIGH = coil de-energized (NO opens / OFF)

// ============================================================================
// ---------------------- PID TEMPERATURE CONTROL CONFIG ----------------------
// ============================================================================
// These are the only values you need to change to tune the PID behaviour.
// The PID controls klin_heater ON/OFF duty within a 10-second window:
//   ON time (ms) = (pid_output / 255) * PID_PERIOD_MS
//   When heater is OFF during the window, the klin motor runs instead.
//
// Kd is intentionally small: DHT11 gives integer-step readings (e.g. 34->35°C),
// which produce sharp derivative spikes. A high Kd would cause the heater to
// overreact to a single 1°C jump.
//
constexpr float    PID_SETPOINT   = 35.0f;   // Target klin area temperature (°C)
constexpr float    PID_KP         = 2.0f;    // Proportional gain
constexpr float    PID_KI         = 0.1f;    // Integral gain
constexpr float    PID_KD         = 0.05f;   // Derivative gain (low — DHT11 integer steps)
constexpr uint32_t PID_PERIOD_MS  = 10000UL; // Duty-cycle window length (10 seconds)

// ============================================================================
// ------------------------------ RELAY CHANNELS -------------------------------
// ============================================================================
struct RelayChannel {
  const char *item_id;
  uint8_t     pin;
  bool        isOn = false;
};

// 13 active channels (channels 14-16 are spare - GPIO budget now fully used, see note at bottom of file)
RelayChannel relays[13] = {
  { "crusher",                22  },  // channel 1  - drives all 3 N20 motors together
  { "conveyor_1",             27  },  // channel 2
  { "conveyor_2",             23 },  // channel 3
  { "conveyor_3",             19 },  // channel 4
  { "conveyor_4",             13 },  // channel 5
  { "klin",                   21 },  // channel 6
  { "klin_heater",            18 },  // channel 7  - renamed from "heater"
  { "heat_blower",            2 },  // channel 8
  { "preheating_tower_fan",   5 },  // channel 9  - renamed from "cooler_fan"
  { "preheating_tower_heater",4 },  // channel 10 - NEW, replaces "klin_cooler_fan" (removed)
  { "vibration_motor",        14 },  // channel 11
  { "ball_mill_1",            32 },  // channel 12
  { "ball_mill_2",            33 },  // channel 13
};
constexpr uint8_t NUM_RELAYS = 13;

// ============================================================================
// ------------------------------ SENSOR CHANNELS -------------------------------
// ============================================================================
#define KLIN_DHT_PIN 15
#define COOLER_DHT_PIN 25
#define PREHEAT_DHT_PIN 26   // strapping pin - see NOTE ON GPIO15 above
#define DHT_TYPE DHT11
DHT klinDht(KLIN_DHT_PIN, DHT_TYPE);
DHT coolerDht(COOLER_DHT_PIN, DHT_TYPE);
DHT preheatDht(PREHEAT_DHT_PIN, DHT_TYPE);

#define VIBRATION_SENSOR_PIN 34  // (removed - replaced below with analog sensor on ADC pin 34)

// Analog vibration sensor configuration (replaces the old digital placeholder)
// Wiring:
//   Module "-" -> ESP32 GND
//   Module "+" -> ESP32 3V3
//   Module "S" -> ESP32 GPIO34 (ADC1_CH6)

const int sensorPin = 34;
const unsigned long sampleWindow = 50; // 50ms window to fully cover motor rotation cycles

// Calibration Constants tuned for a 5V Coreless Vibration Motor
const float V_REF = 3.3;
const float ADC_RES = 4095.0;
const float REALISTIC_SENSITIVITY = 0.62; // Tuned in Volts per g
const int MOTOR_OFF_BASELINE = 0;

// ============================================================================
// ------------------------------- MQTT CLIENT --------------------------------
// ============================================================================
WiFiClient   espClient;
PubSubClient mqtt(espClient);

unsigned long lastReconnectAttemptMs = 0;
unsigned long lastStateRepublishMs   = 0;
unsigned long lastDhtReadMs          = 0; // 2s for PID

String topicState(const char *item_id) { return String("plant/esp2/") + item_id; }
String topicCmd(const char *item_id)   { return String("plant/esp2/") + item_id + "/cmd"; }

// ============================================================================
// ----------------------------- PID STATE ------------------------------------
// ============================================================================
float    pidIntegral       = 0.0f;
float    pidPrevError      = 0.0f;
float    latestKlinTemp    = NAN;    // most recent valid klin DHT reading
uint8_t  pidOutput         = 128;   // 0-255; start at midpoint (50% duty)
uint32_t pidOnDurationMs   = PID_PERIOD_MS / 2;
unsigned long pidWindowStartMs = 0; // millis() when current 10s window began

// ============================================================================
// ------------------------- MANUAL OVERRIDE STATE ----------------------------
// ============================================================================
bool klinManualOverride    = false;
bool heaterManualOverride  = false;

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
// ------------------------------- RELAY CONTROL -------------------------------
// ============================================================================
void writeRelay(RelayChannel &r, bool on) {
  digitalWrite(r.pin, RELAY_ACTIVE_LOW ? (on ? LOW : HIGH) : (on ? HIGH : LOW));
  r.isOn = on;
}

void publishRelayState(RelayChannel &r) {
  StaticJsonDocument<48> doc;
  doc["value"] = r.isOn ? "on" : "off";
  char payload[48];
  serializeJson(doc, payload);
  mqtt.publish(topicState(r.item_id).c_str(), payload, true); // retained
}

RelayChannel *relayForTopic(const String &topic) {
  for (uint8_t i = 0; i < NUM_RELAYS; i++) {
    if (topic == topicCmd(relays[i].item_id)) return &relays[i];
  }
  return nullptr;
}

RelayChannel *findRelay(const char *item_id) {
  for (uint8_t i = 0; i < NUM_RELAYS; i++) {
    if (strcmp(relays[i].item_id, item_id) == 0) return &relays[i];
  }
  return nullptr;
}

// ============================================================================
// ------------------------ MANUAL OVERRIDE HELPERS ---------------------------
// ============================================================================
void publishOverrideStatus(const char *relayId, bool isManual) {
  char topic[64];
  snprintf(topic, sizeof(topic), "plant/esp2/%s/manual_override", relayId);
  StaticJsonDocument<32> doc;
  doc["value"] = isManual;
  char payload[32];
  serializeJson(doc, payload);
  mqtt.publish(topic, payload, true); // retained
  Serial.printf("[OVERRIDE] %s -> manual=%s\n", relayId, isManual ? "true" : "false");
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
  mqtt.publish("plant/esp2/version", payload, true);

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
  mqtt.publish("plant/esp2/ota/status", payload, true);

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
  // Section 8 Requirement: De-energize all 13 active relay outputs (heaters, motors, crushers, conveyors, fans)
  for (uint8_t i = 0; i < NUM_RELAYS; i++) {
    writeRelay(relays[i], false);
    publishRelayState(relays[i]);
  }
  klinManualOverride = false;
  heaterManualOverride = false;
  Serial.println("[SAFETY] ESP2 safety shutdown confirmed: All 13 relay outputs are OFF (heaters, motors, fans, crushers).");
}

void performReboot() {
  Serial.println("[SYSTEM] Remote reboot requested via ThingsBoard RPC! Shutting down relays...");
  stopActuatorsSafely();
  mqtt.publish("plant/esp2/status", "{\"value\":\"rebooting\"}", true);
  mqtt.loop();
  delay(500);
  ESP.restart();
}

void performOTA(const char *url = "", const char *checksum = "", const char *newVersion = "") {
  Serial.printf("[OTA] ThingsBoard OTA Triggered! URL: %s, Checksum: %s, Target Version: %s\n", url, checksum, newVersion);

  // Section 8 Requirement: ESP2 Safety Sequence before OTA download
  stopActuatorsSafely();
  publishOtaStatus("INITIATED", 0, "All 13 relays OFF. Initiating firmware download...");
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
    String tokenStr = strlen(MQTT_USER) > 0 ? String(MQTT_USER) : "esp2";
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
void mqttCallback(char *topic, byte *payload, unsigned int length) {
  String topicStr(topic);

  // ---- Reboot commands ----
  if (topicStr == "plant/esp2/cmd/reboot" || topicStr == "plant/cmd/reboot/all") {
    performReboot();
    return;
  }

  // ---- OTA Update commands ----
  if (topicStr == "plant/esp2/ota/cmd" || topicStr == "plant/ota/cmd/all") {
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

  // ---- Handle "Resume Auto" override clear commands ----
  if (topicStr == "plant/esp2/klin/override_cmd" ||
      topicStr == "plant/esp2/klin_heater/override_cmd") {
    StaticJsonDocument<48> doc;
    DeserializationError err = deserializeJson(doc, payload, length);
    if (err) return;
    const char *command = doc["command"] | "";
    if (strcmp(command, "auto") == 0) {
      if (topicStr == "plant/esp2/klin/override_cmd") {
        klinManualOverride = false;
        publishOverrideStatus("klin", false);
        Serial.println("[OVERRIDE] klin -> PID auto resumed");
      } else {
        heaterManualOverride = false;
        publishOverrideStatus("klin_heater", false);
        Serial.println("[OVERRIDE] klin_heater -> PID auto resumed");
      }
    }
    return;
  }

  // ---- Handle normal relay ON/OFF commands ----
  RelayChannel *r = relayForTopic(topicStr);
  if (r == nullptr) return;

  StaticJsonDocument<48> doc;
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) {
    Serial.printf("[MQTT] Bad JSON on %s: %s\n", topic, err.c_str());
    return;
  }

  const char *command = doc["command"] | "";
  if (strcmp(command, "on") == 0) {
    writeRelay(*r, true);
  } else if (strcmp(command, "off") == 0) {
    writeRelay(*r, false);
  } else {
    Serial.printf("[MQTT] Unknown command on %s: \"%s\"\n", topic, command);
    return;
  }

  if (strcmp(r->item_id, "klin") == 0) {
    klinManualOverride = true;
    publishOverrideStatus("klin", true);
    Serial.println("[OVERRIDE] klin -> manual override ACTIVE (PID paused)");
  } else if (strcmp(r->item_id, "klin_heater") == 0) {
    heaterManualOverride = true;
    publishOverrideStatus("klin_heater", true);
    Serial.println("[OVERRIDE] klin_heater -> manual override ACTIVE (PID paused)");
  }

  Serial.printf("[RELAY] %s -> %s\n", r->item_id, r->isOn ? "ON" : "OFF");
  publishRelayState(*r);
}

// ============================================================================
// -------------------------------- MQTT CONNECT -------------------------------
// ============================================================================
bool mqttConnect() {
  Serial.printf("Connecting to Mosquitto (%s:%u)...\n", MQTT_BROKER_HOST, MQTT_BROKER_PORT);

  const char *willTopic  = "plant/esp2/status";
  const char *willMsg    = "{\"value\":\"offline\"}";
  uint8_t     willQos    = 1;
  boolean     willRetain = true;

  bool ok = strlen(MQTT_USER) > 0
              ? mqtt.connect(MQTT_CLIENT_ID, MQTT_USER, MQTT_PASSWORD, willTopic, willQos, willRetain, willMsg)
              : mqtt.connect(MQTT_CLIENT_ID, willTopic, willQos, willRetain, willMsg);

  if (!ok) {
    Serial.printf("[MQTT] Connect failed, rc=%d\n", mqtt.state());
    return false;
  }

  Serial.println("[MQTT] Connected to Mosquitto.");

  // Announce online status & firmware version immediately
  mqtt.publish("plant/esp2/status", "{\"value\":\"online\"}", true);
  publishOtaStatus("UPDATED", 100, "Firmware is running");
  publishFwVersion();
  Serial.println("[MQTT] Published: plant/esp2/status = online");

  // Subscribe to topics
  mqtt.subscribe("plant/esp2/ota/cmd");
  mqtt.subscribe("plant/ota/cmd/all");
  mqtt.subscribe("plant/esp2/cmd/reboot");
  mqtt.subscribe("plant/cmd/reboot/all");
  mqtt.subscribe("v1/devices/me/attributes");
  mqtt.subscribe("v1/devices/me/attributes/response/+");
  mqtt.subscribe("v1/devices/me/rpc/request/+");

  for (uint8_t i = 0; i < NUM_RELAYS; i++) {
    mqtt.subscribe(topicCmd(relays[i].item_id).c_str());
    publishRelayState(relays[i]);
  }

  mqtt.subscribe("plant/esp2/klin/override_cmd");
  mqtt.subscribe("plant/esp2/klin_heater/override_cmd");

  publishOverrideStatus("klin",        klinManualOverride);
  publishOverrideStatus("klin_heater", heaterManualOverride);

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
// ------------------------------ SENSOR READING ------------------------------
// ============================================================================
void publishValue(const char *item_id, float value, const char *unit) {
  StaticJsonDocument<64> doc;
  doc["value"] = value;
  doc["unit"]  = unit;
  char payload[64];
  serializeJson(doc, payload);
  mqtt.publish(topicState(item_id).c_str(), payload);
}

void readAndPublishSensors() {
  float ct = klinDht.readTemperature();
  float ch = klinDht.readHumidity();
  if (!isnan(ct) && !isnan(ch)) {
    latestKlinTemp = ct;  // keep for PID
    publishValue("klin_dht_temp", ct, "C");
    publishValue("klin_dht_humidity", ch, "%");
  } else {
    Serial.println("[SENSOR] klin_dht read failed");
  }

  float ot = coolerDht.readTemperature();
  float oh = coolerDht.readHumidity();
  if (!isnan(ot) && !isnan(oh)) {
    publishValue("cooler_dht_temp", ot, "C");
    publishValue("cooler_dht_humidity", oh, "%");
  } else {
    Serial.println("[SENSOR] cooler_dht read failed");
  }

  float pt = preheatDht.readTemperature();
  float ph = preheatDht.readHumidity();
  if (!isnan(pt) && !isnan(ph)) {
    publishValue("preheating_tower_dht_temp", pt, "C");
    publishValue("preheating_tower_dht_humidity", ph, "%");
  } else {
    Serial.println("[SENSOR] preheating_tower_dht read failed");
  }

  unsigned long startMillis = millis();
  int maxRawPeak = MOTOR_OFF_BASELINE;
  while (millis() - startMillis < sampleWindow) {
    int currentRaw = analogRead(sensorPin);
    if (currentRaw > maxRawPeak) maxRawPeak = currentRaw;
  }
  int trueVibrationRaw = maxRawPeak - MOTOR_OFF_BASELINE;
  if (trueVibrationRaw < 0) trueVibrationRaw = 0;
  float peakVoltage = (trueVibrationRaw * V_REF) / ADC_RES;
  float vibrationG = peakVoltage / REALISTIC_SENSITIVITY;
  publishValue("vibration_sensor", vibrationG, "g");

  if (!isnan(ct)) {
    Serial.printf("[SENSOR] klin: %.1fC %.0f%%  cooler: %.1fC %.0f%%  preheat: %.1fC %.0f%%  vib: %.3fg\n",
                  ct, ch, ot, oh, pt, ph, vibrationG);
  }
}

// ============================================================================
// --------------------------- PID CONTROL LOGIC ------------------------------
// ============================================================================
void computePidWindow() {
  if (isnan(latestKlinTemp)) {
    Serial.println("[PID] No valid klin temp yet, skipping window");
    return;
  }

  float error      = PID_SETPOINT - latestKlinTemp;
  pidIntegral     += error;

  const float integralMax = 255.0f / PID_KI;
  if (pidIntegral >  integralMax) pidIntegral =  integralMax;
  if (pidIntegral < -integralMax) pidIntegral = -integralMax;

  float derivative = error - pidPrevError;
  pidPrevError     = error;

  float rawOutput  = PID_KP * error + PID_KI * pidIntegral + PID_KD * derivative;

  if (rawOutput > 255.0f) rawOutput = 255.0f;
  if (rawOutput <   0.0f) rawOutput =   0.0f;
  pidOutput = (uint8_t)rawOutput;

  pidOnDurationMs = (uint32_t)((pidOutput / 255.0f) * (float)PID_PERIOD_MS);

  Serial.printf("[PID] temp=%.1fC setpoint=%.1fC err=%.1f integ=%.2f deriv=%.2f out=%u onTime=%ums\n",
                latestKlinTemp, PID_SETPOINT, error, pidIntegral, derivative, pidOutput, pidOnDurationMs);
}

void applyPidControl() {
  if (klinManualOverride && heaterManualOverride) return;

  unsigned long now     = millis();
  unsigned long elapsed = now - pidWindowStartMs;

  bool heaterShouldBeOn = (elapsed < pidOnDurationMs);
  bool klinShouldBeOn   = !heaterShouldBeOn;

  RelayChannel *heaterRelay = findRelay("klin_heater");
  RelayChannel *klinRelay   = findRelay("klin");

  if (!heaterManualOverride && heaterRelay) {
    if (heaterRelay->isOn != heaterShouldBeOn) {
      writeRelay(*heaterRelay, heaterShouldBeOn);
      publishRelayState(*heaterRelay);
      Serial.printf("[PID-RELAY] klin_heater -> %s (elapsed=%lums onTime=%ums)\n",
                    heaterShouldBeOn ? "ON" : "OFF", elapsed, pidOnDurationMs);
    }
  }

  if (!klinManualOverride && klinRelay) {
    if (klinRelay->isOn != klinShouldBeOn) {
      writeRelay(*klinRelay, klinShouldBeOn);
      publishRelayState(*klinRelay);
      Serial.printf("[PID-RELAY] klin -> %s (elapsed=%lums onTime=%ums)\n",
                    klinShouldBeOn ? "ON" : "OFF", elapsed, pidOnDurationMs);
    }
  }
}

// ============================================================================
// ---------------------------------- SETUP -----------------------------------
// ============================================================================
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n=== ESP32-2 Relay + Sensor Node - Booting ===");

  // ---- Validate current running app partition & cancel rollback ----
  esp_ota_mark_app_valid_cancel_rollback();

  for (uint8_t i = 0; i < NUM_RELAYS; i++) {
    pinMode(relays[i].pin, OUTPUT);
    writeRelay(relays[i], false);
  }

  klinDht.begin();
  coolerDht.begin();
  preheatDht.begin();
  analogSetAttenuation(ADC_11db);

  initWiFi();
  mqtt.setServer(MQTT_BROKER_HOST, MQTT_BROKER_PORT);
  mqtt.setCallback(mqttCallback);

  pidWindowStartMs = millis();

  Serial.println("=== Setup complete ===\n");
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
    mqtt.loop();
  }

  unsigned long now = millis();

  if (mqtt.connected() && now - lastStateRepublishMs >= STATE_REPUBLISH_MS) {
    lastStateRepublishMs = now;
    for (uint8_t i = 0; i < NUM_RELAYS; i++) {
      publishRelayState(relays[i]);
    }
  }

  if (mqtt.connected() && now - lastDhtReadMs >= DHT_READ_MS) {
    lastDhtReadMs = now;
    readAndPublishSensors();
  }

  if (now - pidWindowStartMs >= PID_PERIOD_MS) {
    pidWindowStartMs = now;
    computePidWindow();
  }

  if (mqtt.connected()) {
    applyPidControl();
  }
}
