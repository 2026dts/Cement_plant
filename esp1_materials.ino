/*
  ESP32-1 — 5x Load Cell + 5x Servo (Material Dispensing) — Mosquitto MQTT
  ==========================================================================
  Hardware on this board:
    - 5x 20kg load cells (HX711), all sharing ONE common SCK pin, each with
      its own DOUT pin.
    - 5x servo motors, one per load cell, used to hold at max angle while
      material dispenses until the target weight is reached, then the
      servo returns to its home position.

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
  Shared SCK (all 5 load cells): GPIO 32

    Pair 1 - limestone:     DOUT -> GPIO22  | Servo -> GPIO25
    Pair 2 - clay:          DOUT -> GPIO23  | Servo -> GPIO26
    Pair 3 - iron_ore:      DOUT -> GPIO5   | Servo -> GPIO27
    Pair 4 - sand:          DOUT -> GPIO16  | Servo -> GPIO13
    Pair 5 - raw_material:  DOUT -> GPIO19  | Servo -> GPIO14

  MQTT topics (per material, e.g. "limestone"):
    plant/esp1/limestone                 -> published live weight  { "value": 23.4, "unit": "g" }
    plant/esp1/limestone/target/cmd      -> subscribed target      { "target": 50 }
    plant/esp1/limestone/target/status   -> published status       { "status": "dispensing" | "done" }

  ============================= BOOT / TARE BEHAVIOUR =========================
  At boot, all channels (load cell + servo) are initialized back-to-back with
  NO blocking wait for tare. Taring happens independently, in the background,
  inside loop() via serviceTaring(): each load cell is tared the moment its
  own is_ready() goes true, so a slow-to-settle channel never holds up the
  others or blocks boot.

  ============================= DISPENSE BEHAVIOUR ============================
  On a target/cmd for a material:
    - that material's servo moves straight to SERVO_MAX_ANGLE and HOLDS there
      (no oscillation)
    - it stays at SERVO_MAX_ANGLE until that material's load cell reaches the
      target weight
    - only then does that specific servo return to SERVO_HOME_ANGLE
  Every material is independent — one material dispensing does not affect any
  other material's servo/state.
*/

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <HX711.h>
#include <ESP32Servo.h>

// ============================================================================
// ---------------------------- USER CONFIGURATION ---------------------------
// ============================================================================
constexpr char WIFI_SSID[]     = "prakash";
constexpr char WIFI_PASSWORD[] = "12345678";

constexpr char MQTT_BROKER_HOST[] = "10.158.91.91";   // local Mosquitto machine's LAN IP
constexpr uint16_t MQTT_BROKER_PORT = 1883U;
constexpr char MQTT_USER[]     = "";                  // leave empty if allow_anonymous
constexpr char MQTT_PASSWORD[] = "";
constexpr char MQTT_CLIENT_ID[] = "esp1-materials";

constexpr uint32_t TELEMETRY_INTERVAL_MS   = 500UL;   // live weight publish interval
constexpr uint32_t MQTT_RECONNECT_DELAY_MS = 2000UL;

// ---- Kept EXACTLY as supplied - do not change ----
constexpr float CALIBRATION_FACTOR = 96.322f;
constexpr int    SERVO_HOME_ANGLE   = 30;   // original / resting position
constexpr int    SERVO_MAX_ANGLE    = 140;  // held position while dispensing

constexpr uint8_t SHARED_SCK_PIN = 32;

// ============================================================================
// -------------------------- MATERIAL FEED CONFIG ----------------------------
// ============================================================================
struct MaterialFeed {
  const char *item_id;
  uint8_t dout_pin;
  uint8_t servo_pin;

  HX711 loadCell;
  Servo  servo;

  bool  tared        = false;  // set true the moment this channel's own tare completes
  bool  dispensing   = false;
  float targetGrams  = 0.0f;
  float lastWeight   = 0.0f;
};

MaterialFeed materials[5] = {
  { "limestone",    22, 27 },
  { "clay",         23, 26 },
  { "iron_ore",      5, 14 },
  { "sand",         15, 13 },
  { "raw_material", 19, 25 },
};
constexpr uint8_t NUM_MATERIALS = 5;

// ============================================================================
// ------------------------------- MQTT CLIENT --------------------------------
// ============================================================================
WiFiClient   espClient;
PubSubClient mqtt(espClient);

unsigned long lastTelemetryMs        = 0;
unsigned long lastReconnectAttemptMs = 0;

String topicValue(const char *item_id)        { return String("plant/esp1/") + item_id; }
String topicTargetCmd(const char *item_id)    { return String("plant/esp1/") + item_id + "/target/cmd"; }
String topicTargetStatus(const char *item_id) { return String("plant/esp1/") + item_id + "/target/status"; }

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
// ------------------------------ SENSOR READING ------------------------------
// ============================================================================
// ============================================================================
// ------------------------------ SENSOR READING ------------------------------
// ============================================================================
float readLoadCellFast(MaterialFeed &m, uint8_t samples = 1) {
  if (m.loadCell.is_ready()) {
    float w = m.loadCell.get_units(samples); // 1 sample = INSTANT reading (0ms delay)
    if (w < 0.5f) {
      w = 0.0f; // Clamp negative readings and zero-drift noise to 0.0
    }
    return w;
  }
  return (m.lastWeight < 0.0f) ? 0.0f : m.lastWeight;
}

void publishValue(const char *item_id, float value, const char *unit) {
  if (value < 0.0f) {
    value = 0.0f; // Prevent publishing negative sensor values
  }
  StaticJsonDocument<64> doc;
  doc["value"] = value;
  doc["unit"]  = unit;
  char payload[64];
  serializeJson(doc, payload);
  mqtt.publish(topicValue(item_id).c_str(), payload);
}

// ============================================================================
// ----------------------- SERVO / DISPENSING CONTROL --------------------------
// ============================================================================
void publishTargetStatus(MaterialFeed &m, const char *status) {
  StaticJsonDocument<64> doc;
  doc["status"] = status;
  char payload[64];
  serializeJson(doc, payload);
  mqtt.publish(topicTargetStatus(m.item_id).c_str(), payload);
}

void startDispense(MaterialFeed &m, float target) {
  m.targetGrams = target;
  m.dispensing  = true;
  m.servo.write(SERVO_MAX_ANGLE);   // Servo opens / moves to MAX position (140 deg)
  Serial.printf("\n[DISPENSE START] %s: target=%.1fg, servo -> MAX (%d deg)\n",
                m.item_id, target, SERVO_MAX_ANGLE);
  publishTargetStatus(m, "dispensing");
}

void stopDispense(MaterialFeed &m) {
  m.dispensing = false;
  m.servo.write(SERVO_HOME_ANGLE);  // Servo closes / returns to HOME position (30 deg)
  Serial.printf("\n[DISPENSE STOP] %s: target reached (current=%.1fg, target=%.1fg), servo -> HOME (%d deg)\n",
                m.item_id, m.lastWeight, m.targetGrams, SERVO_HOME_ANGLE);
  publishTargetStatus(m, "done");
  publishValue(m.item_id, m.lastWeight, "g");
}

// Dedicated ULTRA-FAST check for active dispensing hoppers.
// Runs every single loop tick to detect target threshold INSTANTLY and close servo immediately.
void checkDispensingFast() {
  for (uint8_t i = 0; i < NUM_MATERIALS; i++) {
    MaterialFeed &m = materials[i];
    if (m.dispensing) {
      if (m.loadCell.is_ready()) {
        m.lastWeight = readLoadCellFast(m, 1); // 1 sample for instant measurement
        publishValue(m.item_id, m.lastWeight, "g");
        Serial.printf("[DISPENSING FAST] %s: %.1fg / %.1fg\n", m.item_id, m.lastWeight, m.targetGrams);
        if (m.lastWeight >= m.targetGrams) {
          stopDispense(m);
        }
      }
    }
  }
}

// Background telemetry for idle hoppers
void readAndPublishTelemetry() {
  for (uint8_t i = 0; i < NUM_MATERIALS; i++) {
    MaterialFeed &m = materials[i];
    if (m.dispensing) continue; // dispensing channels are handled instantly by checkDispensingFast()

    m.lastWeight = readLoadCellFast(m, 1);
    publishValue(m.item_id, m.lastWeight, "g");
  }
}

// ============================================================================
// -------------------------------- MQTT CALLBACK ------------------------------
// ============================================================================
MaterialFeed *materialForTopic(const String &topic) {
  for (uint8_t i = 0; i < NUM_MATERIALS; i++) {
    if (topic == topicTargetCmd(materials[i].item_id)) return &materials[i];
  }
  return nullptr;
}

void mqttCallback(char *topic, byte *payload, unsigned int length) {
  Serial.printf("[MQTT RX] %s -> %.*s\n", topic, length, (char *)payload);
  String topicStr(topic);
  MaterialFeed *m = materialForTopic(topicStr);
  if (m == nullptr) return;

  StaticJsonDocument<64> doc;
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) {
    Serial.printf("[MQTT] Bad JSON on %s: %s\n", topic, err.c_str());
    return;
  }

  float target = doc["target"] | -1.0f;
  if (target < 0) {
    Serial.println("[MQTT] target/cmd missing a valid \"target\" field");
    return;
  }
  startDispense(*m, target);
}

// ============================================================================
// -------------------------------- MQTT CONNECT -------------------------------
// ============================================================================
bool mqttConnect() {
  Serial.printf("Connecting to Mosquitto (%s:%u)...\n", MQTT_BROKER_HOST, MQTT_BROKER_PORT);
  String clientId = String(MQTT_CLIENT_ID) + "-" + WiFi.macAddress();
  const char *cid = clientId.c_str();
  bool ok;
  if (strlen(MQTT_USER) > 0) {
    ok = mqtt.connect(cid, MQTT_USER, MQTT_PASSWORD);
  } else {
    ok = mqtt.connect(cid);
  }

  if (!ok) {
    Serial.printf("[MQTT] Connect failed, rc=%d\n", mqtt.state());
    return false;
  }

  Serial.println("[MQTT] Connected to Mosquitto.");
  for (uint8_t i = 0; i < NUM_MATERIALS; i++) {
    mqtt.subscribe(topicTargetCmd(materials[i].item_id).c_str());
    Serial.printf("[MQTT] Subscribed: %s\n", topicTargetCmd(materials[i].item_id).c_str());
  }
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
  Serial.println("\n=== ESP32-1 Materials Node (5x Load Cell + Servo) - Booting ===");

  // ---- Step 1: WiFi first ----
  initWiFi();

  // ---- Step 2: MQTT broker next ----
  mqtt.setServer(MQTT_BROKER_HOST, MQTT_BROKER_PORT);
  mqtt.setCallback(mqttCallback);
  mqttConnect();

  // ---- Step 3: Initialize Servos and Load Cells ----
  for (uint8_t i = 0; i < NUM_MATERIALS; i++) {
    MaterialFeed &m = materials[i];

    Serial.printf("\nInitializing %s...\n", m.item_id);
    Serial.printf("DOUT = GPIO%d, Servo = GPIO%d, SCK = GPIO%d\n", m.dout_pin, m.servo_pin, SHARED_SCK_PIN);

    m.loadCell.begin(m.dout_pin, SHARED_SCK_PIN);
    m.loadCell.set_scale(CALIBRATION_FACTOR);

    m.servo.attach(m.servo_pin);
    m.servo.write(SERVO_HOME_ANGLE); // Every feeder starts at resting home position (30 deg)
  }

  // ---- Step 4: Calibrated Tare (2 second settling delay as per reference code) ----
  Serial.println("\n------------------------------------------------");
  Serial.println("Taring scale... Keep all scales completely empty!");
  Serial.println("------------------------------------------------");
  delay(2000);

  for (uint8_t i = 0; i < NUM_MATERIALS; i++) {
    MaterialFeed &m = materials[i];
    m.loadCell.tare();
    m.tared = true;
    Serial.printf("[TARE] %s tared and ready!\n", m.item_id);
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
}

/*
  ============================= CALIBRATION NOTE =============================
  The 96.322 calibration factor was measured for one specific load cell. If a
  particular pair's readings look off, recalibrate just that one entry in
  `materials[]` (raw_reading_with_50g / 50) rather than changing the shared
  constant, since each HX711 module can differ slightly.
*/