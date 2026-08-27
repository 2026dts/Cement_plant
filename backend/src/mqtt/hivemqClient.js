// MQTT client for the HiveMQ Cloud broker.
// -----------------------------------------------------------------------------
// Mirrors mqttClient.js but connects securely (mqtts://) to HiveMQ Cloud.
// Shares the same in-memory store (store.js) and WebSocket broadcast callback
// so the Dashboard and widgets reflect data from EITHER broker seamlessly.
// REST API command helpers (publishCommand, publishTarget, etc.) publish to
// HiveMQ Cloud -- allowing remote control via any MQTT client connected there.

const mqtt = require("mqtt");
const env = require("../config/env");
const { ITEM_REGISTRY, findItem } = require("../config/itemRegistry");
const store = require("../state/store");

let client = null;
let onUpdateCallback = null;

const ACTUATOR_LOGIC_INVERTED = false;

function invertOnOff(v) {
  if (v === "on") return "off";
  if (v === "off") return "on";
  return v;
}

function topicValue(item)        { return `plant/cement-dubai/${item.source}/${item.id}`; }
function topicCmd(item)          { return `plant/cement-dubai/${item.source}/${item.id}/cmd`; }
function topicTargetCmd(item)    { return `plant/cement-dubai/${item.source}/${item.id}/target/cmd`; }
function topicTargetStatus(item) { return `plant/cement-dubai/${item.source}/${item.id}/target/status`; }

// ============================================================================
// CONNECTION
// ============================================================================
function connect(onUpdate) {
  if (!env.HIVEMQ_HOST) {
    console.log("[HiveMQ] HIVEMQ_HOST not configured -- HiveMQ bridge skipped.");
    return;
  }

  onUpdateCallback = onUpdate;

  const url = `mqtts://${env.HIVEMQ_HOST}:${env.HIVEMQ_PORT}`;
  const options = {
    username: env.HIVEMQ_USER,
    password: env.HIVEMQ_PASSWORD,
    rejectUnauthorized: true,
    reconnectPeriod: 5000,
    connectTimeout: 30 * 1000,
    clientId: `backend-hive-${Date.now()}`,
  };

  console.log(`[HiveMQ] Connecting to HiveMQ Cloud at ${url} ...`);
  client = mqtt.connect(url, options);

  client.on("connect", () => {
    console.log("[HiveMQ] Connected to HiveMQ Cloud Broker successfully.");
    ITEM_REGISTRY.forEach((item) => {
      client.subscribe(topicValue(item));
      if (item.dispensable) client.subscribe(topicTargetStatus(item));
    });
    client.subscribe("plant/cement-dubai/esp1/status");
    client.subscribe("plant/cement-dubai/esp2/status");
    client.subscribe("plant/cement-dubai/esp2/klin/manual_override");
    client.subscribe("plant/cement-dubai/esp2/klin_heater/manual_override");
    client.subscribe("plant/cement-dubai/esp1/version");
    client.subscribe("plant/cement-dubai/esp2/version");
    client.subscribe("plant/cement-dubai/esp1/ota/status");
    client.subscribe("plant/cement-dubai/esp2/ota/status");
    client.subscribe("v1/devices/me/telemetry");
  });

  client.on("reconnect", () => console.log("[HiveMQ] Reconnecting..."));
  client.on("error",     (err) => console.error("[HiveMQ] Error:", err.message));
  client.on("offline",   () => console.warn("[HiveMQ] Client went offline."));

  // ============================================================================
  // MESSAGE HANDLER
  // ============================================================================
  client.on("message", (topic, payloadBuf) => {
    let payload;
    try {
      payload = JSON.parse(payloadBuf.toString());
    } catch (e) {
      console.warn(`[HiveMQ] Non-JSON payload on ${topic}, ignoring`);
      return;
    }

    if (topic === "plant/cement-dubai/esp1/status") {
      const devStatus = store.setDeviceStatus("esp1", payload.value);
      const updated   = store.setValue("esp1_status", payload.value, "");
      if (onUpdateCallback) onUpdateCallback("esp1_status", { ...updated, deviceStatus: devStatus });
      return;
    }

    if (topic === "plant/cement-dubai/esp2/status") {
      const devStatus = store.setDeviceStatus("esp2", payload.value);
      const updated   = store.setValue("esp2_status", payload.value, "");
      if (onUpdateCallback) onUpdateCallback("esp2_status", { ...updated, deviceStatus: devStatus });
      return;
    }

    if (topic === "plant/cement-dubai/esp2/klin/manual_override") {
      const updated = store.setValue("klin_manual_override", payload.value, "");
      if (onUpdateCallback) onUpdateCallback("klin_manual_override", updated);
      return;
    }
    if (topic === "plant/cement-dubai/esp2/klin_heater/manual_override") {
      const updated = store.setValue("klin_heater_manual_override", payload.value, "");
      if (onUpdateCallback) onUpdateCallback("klin_heater_manual_override", updated);
      return;
    }

    if (topic === "plant/cement-dubai/esp1/version" || topic === "plant/cement-dubai/esp2/version") {
      const dev     = topic.includes("esp1") ? "esp1" : "esp2";
      const otaData = store.setOtaStatus(dev, { version: payload.version, title: payload.title });
      if (onUpdateCallback) onUpdateCallback("ota_status", { device: dev, ...otaData });
      return;
    }

    if (topic === "plant/cement-dubai/esp1/ota/status" || topic === "plant/cement-dubai/esp2/ota/status") {
      const dev     = topic.includes("esp1") ? "esp1" : "esp2";
      const otaData = store.setOtaStatus(dev, payload);
      if (onUpdateCallback) onUpdateCallback("ota_status", { device: dev, ...otaData });
      return;
    }

    if (topic === "v1/devices/me/telemetry") {
      if (payload.current_fw_title && payload.current_fw_version) {
        const dev = payload.current_fw_title.includes("esp1") ? "esp1" : "esp2";
        const thingsboardService = require("../services/thingsboardService");
        thingsboardService.sendTelemetry(dev, payload);
        const otaData = store.setOtaStatus(dev, {
          version: payload.current_fw_version,
          status: payload.fw_state ? payload.fw_state.toLowerCase() : "idle",
        });
        if (onUpdateCallback) onUpdateCallback("ota_status", { device: dev, ...otaData });
      }
      return;
    }

    const item = ITEM_REGISTRY.find(
      (i) => topic === topicValue(i) || topic === topicTargetStatus(i)
    );
    if (!item) return;

    const devStatus = store.setDeviceStatus(item.source, "online");

    if (topic === topicTargetStatus(item)) {
      const updated = store.setDispenseStatus(item.id, payload.status);
      if (onUpdateCallback) onUpdateCallback(item.id, { ...updated, deviceSource: item.source, deviceStatus: devStatus });
      return;
    }

    let value = payload.value;
    if (ACTUATOR_LOGIC_INVERTED && item.type === "actuator") value = invertOnOff(value);
    const updated = store.setValue(item.id, value, payload.unit || item.unit);
    if (onUpdateCallback) onUpdateCallback(item.id, { ...updated, deviceSource: item.source, deviceStatus: devStatus });

    if (item.id === "klin_dht_temp") evaluateKilnTempThreshold();
    if (item.id === "klin_dht_temp" || item.id === "klin_heater") {
      const currentTemp  = store.get("klin_dht_temp")?.value ?? null;
      const heaterState  = store.get("klin_heater")?.value ?? "off";
      const kilnTempData = store.updateKilnTemperature({ currentTemp, heaterState });
      if (onUpdateCallback) {
        onUpdateCallback("klin_temp_monitor", {
          item_id: "klin_temp_monitor",
          value: kilnTempData,
          unit: "C",
          ts: Date.now(),
        });
      }
    }
  });
}

// ============================================================================
// KILN TEMPERATURE THRESHOLD
// ============================================================================
function evaluateKilnTempThreshold() {
  if (store.isMasterOverrideActive()) {
    console.log("[HiveMQ AUTO] Temp threshold paused: Master Switch override active.");
    return;
  }
  const rawTemp = store.get("klin_dht_temp")?.value;
  if (rawTemp === null || rawTemp === undefined || isNaN(rawTemp)) return;
  const isBelowSetpoint = Number(rawTemp) < 35;

  const heaterOverride = store.get("klin_heater_manual_override")?.value === true;
  if (!heaterOverride) {
    setAutomaticState("klin_heater", isBelowSetpoint ? "on" : "off");
    setAutomaticState("heat_blower", isBelowSetpoint ? "on" : "off");
  }
  const klinOverride = store.get("klin_manual_override")?.value === true;
  if (!klinOverride) {
    setAutomaticState("klin", isBelowSetpoint ? "off" : "on");
  }
}

function setAutomaticState(item_id, command) {
  if (store.get(item_id)?.value === command) return;
  if (!sendDirectCommand(item_id, command, true)) return;
  const updated = store.setValue(item_id, command, "on/off");
  if (onUpdateCallback) onUpdateCallback(item_id, updated);
}

function sendDirectCommand(item_id, command, automatic = false) {
  const item = findItem(item_id);
  if (!item || !client || !client.connected) return false;
  const wireCommand = ACTUATOR_LOGIC_INVERTED ? invertOnOff(command) : command;
  try {
    client.publish(topicCmd(item), JSON.stringify({ command: wireCommand, ...(automatic ? { mode: "auto" } : {}) }));
    return true;
  } catch (e) {
    console.error(`[HiveMQ] sendDirectCommand failed for ${item_id}:`, e.message || e);
    return false;
  }
}

function isConnected() { return !!client && client.connected; }

// ============================================================================
// PUBLISH HELPERS
// ============================================================================
function publishCommand(item_id, command) {
  const item = findItem(item_id);
  if (!item) return false;
  if (item_id === "klin" || item_id === "klin_heater") {
    const upOverride = store.setValue(`${item_id}_manual_override`, true, "");
    if (onUpdateCallback) onUpdateCallback(`${item_id}_manual_override`, upOverride);
  }
  if (!client || !client.connected) {
    console.warn(`[HiveMQ] publishCommand: not connected for ${item_id}`);
    return false;
  }
  const wireCommand = ACTUATOR_LOGIC_INVERTED ? invertOnOff(command) : command;
  try {
    client.publish(topicCmd(item), JSON.stringify({ command: wireCommand }));
    return true;
  } catch (e) {
    console.error(`[HiveMQ] publishCommand failed for ${item_id}:`, e.message || e);
    return false;
  }
}

function publishResumeAuto(item_id) {
  if (item_id !== "klin" && item_id !== "klin_heater") return false;
  store.setMasterOverrideActive(false);
  const upKlin   = store.setValue("klin_manual_override", false, "");
  const upHeater = store.setValue("klin_heater_manual_override", false, "");
  if (onUpdateCallback) {
    onUpdateCallback("klin_manual_override", upKlin);
    onUpdateCallback("klin_heater_manual_override", upHeater);
  }
  if (client && client.connected) {
    const topic = `plant/cement-dubai/esp2/${item_id}/override_cmd`;
    try { client.publish(topic, JSON.stringify({ command: "auto" })); } catch (e) {}
  }
  evaluateKilnTempThreshold();
  return true;
}

function publishTarget(item_id, target) {
  const item = findItem(item_id);
  if (!item || !item.dispensable || typeof target !== "number" || !Number.isFinite(target) || target < 0) return false;
  if (!client || !client.connected) return false;
  try {
    client.publish(topicTargetCmd(item), JSON.stringify({ target }));
    return true;
  } catch (e) {
    console.error(`[HiveMQ] publishTarget failed for ${item_id}:`, e.message || e);
    return false;
  }
}

function publishMasterCommand(command) {
  if (command !== "on" && command !== "off") return { count: 0, success: false };
  store.setMasterOverrideActive(true);
  store.setValue("klin_manual_override", true, "");
  store.setValue("klin_heater_manual_override", true, "");
  const actuators = ITEM_REGISTRY.filter((item) => item.type === "actuator" && !item.gate);
  let publishedCount = 0;
  actuators.forEach((item) => {
    const wireCommand = ACTUATOR_LOGIC_INVERTED ? invertOnOff(command) : command;
    if (client && client.connected) {
      try { client.publish(topicCmd(item), JSON.stringify({ command: wireCommand })); publishedCount++; } catch (e) {}
    }
    const updated = store.setValue(item.id, command, "on/off");
    if (onUpdateCallback) onUpdateCallback(item.id, { ...updated, deviceSource: item.source });
  });
  return { count: publishedCount, total: actuators.length, success: publishedCount > 0 };
}

function publishOtaCommand(target, firmwareTitle, firmwareVersion) {
  if (!client || !client.connected) return false;
  const host = env.THINGSBOARD_URL ? env.THINGSBOARD_URL.replace(/\/$/, "") : `http://${env.MQTT_HOST || "localhost"}:8080`;
  try {
    if (target === "esp1" || target === "all") {
      const title = (target === "all") ? "esp1_materials" : (firmwareTitle || "esp1_materials");
      const ver   = firmwareVersion || "1.0.1";
      const fwUrl = `${host}/api/v1/esp1/firmware?title=${encodeURIComponent(title)}&version=${encodeURIComponent(ver)}`;
      client.publish("v1/devices/me/attributes", JSON.stringify({ fw_title: title, fw_version: ver, fw_url: fwUrl, target_fw_title: title, target_fw_version: ver }));
      store.setOtaStatus("esp1", { status: "INITIATED", progress: 0, title, targetVersion: ver });
    }
    if (target === "esp2" || target === "all") {
      const title = (target === "all") ? "esp2_relay" : (firmwareTitle || "esp2_relay");
      const ver   = firmwareVersion || "1.0.1";
      const fwUrl = `${host}/api/v1/esp2/firmware?title=${encodeURIComponent(title)}&version=${encodeURIComponent(ver)}`;
      client.publish("v1/devices/me/attributes", JSON.stringify({ fw_title: title, fw_version: ver, fw_url: fwUrl, target_fw_title: title, target_fw_version: ver }));
      store.setOtaStatus("esp2", { status: "INITIATED", progress: 0, title, targetVersion: ver });
    }
    if (onUpdateCallback) onUpdateCallback("ota_status", { device: target, all: store.allOtaStatus() });
    return true;
  } catch (e) {
    console.error("[HiveMQ] publishOtaCommand error:", e.message || e);
    return false;
  }
}

function publishRebootCommand(target) {
  if (!client || !client.connected) return false;
  const payload = JSON.stringify({ command: "reboot" });
  try {
    if (target === "esp1" || target === "all") {
      client.publish("plant/cement-dubai/esp1/cmd/reboot", payload);
      client.publish("v1/devices/me/rpc/request/1", JSON.stringify({ method: "reboot", params: {} }));
      store.setDeviceStatus("esp1", "rebooting");
    }
    if (target === "esp2" || target === "all") {
      client.publish("plant/cement-dubai/esp2/cmd/reboot", payload);
      client.publish("v1/devices/me/rpc/request/2", JSON.stringify({ method: "reboot", params: {} }));
      store.setDeviceStatus("esp2", "rebooting");
    }
    if (onUpdateCallback) onUpdateCallback("reboot_status", { target, status: "rebooting" });
    return true;
  } catch (e) {
    console.error("[HiveMQ] publishRebootCommand error:", e.message || e);
    return false;
  }
}

module.exports = {
  connect, isConnected,
  publishCommand, publishMasterCommand,
  publishResumeAuto, publishTarget,
  publishOtaCommand, publishRebootCommand,
};
