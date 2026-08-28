// MQTT client for the HiveMQ Cloud broker.
// -----------------------------------------------------------------------------
// Same common-topic contract as mqttClient.js (identity in JSON payload).
// Connects over mqtts:// when HIVEMQ_HOST is set; otherwise this module is a no-op.

const mqtt = require("mqtt");
const env = require("../config/env");
const { ITEM_REGISTRY, findItem, dispensableItems } = require("../config/itemRegistry");
const store = require("../state/store");

let client = null;
let onUpdateCallback = null;

const ACTUATOR_LOGIC_INVERTED = false;
const PREFIX = "plant/cement-dubai";

function invertOnOff(v) {
  if (v === "on") return "off";
  if (v === "off") return "on";
  return v;
}

function topicCommand(source)         { return `${PREFIX}/${source}/command`; }
function topicValues(source)          { return `${PREFIX}/${source}/values`; }
function topicStatus(source)          { return `${PREFIX}/${source}/status`; }
function topicActuatorCommand(source) { return `${PREFIX}/${source}/actuator/command`; }
function topicActuatorState(source)   { return `${PREFIX}/${source}/actuator/state`; }
function topicOverrideCommand()       { return `${PREFIX}/esp2/override/command`; }
function topicOverrideStatus()        { return `${PREFIX}/esp2/override/status`; }

function itemIdFromPayload(payload) {
  return payload.material || payload.sensor || payload.actuator || payload.item_id || null;
}

function payloadValue(payload) {
  if (payload.value !== undefined) return payload.value;
  if (payload.state !== undefined) return payload.state;
  return undefined;
}

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
    client.subscribe(topicValues("esp1"));
    client.subscribe(topicStatus("esp1"));
    client.subscribe(topicActuatorState("esp1"));
    client.subscribe(topicValues("esp2"));
    client.subscribe(topicStatus("esp2"));
    client.subscribe(topicActuatorState("esp2"));
    client.subscribe(topicOverrideStatus());
    client.subscribe(`${PREFIX}/esp1/version`);
    client.subscribe(`${PREFIX}/esp2/version`);
    client.subscribe(`${PREFIX}/esp1/ota/status`);
    client.subscribe(`${PREFIX}/esp2/ota/status`);
    client.subscribe("v1/devices/me/telemetry");
  });

  client.on("reconnect", () => console.log("[HiveMQ] Reconnecting..."));
  client.on("error",     (err) => console.error("[HiveMQ] Error:", err.message));
  client.on("offline",   () => console.warn("[HiveMQ] Client went offline."));

  client.on("message", (topic, payloadBuf) => {
    let payload;
    try {
      payload = JSON.parse(payloadBuf.toString());
    } catch (e) {
      console.warn(`[HiveMQ] Non-JSON payload on ${topic}, ignoring`);
      return;
    }
    handleIncoming(topic, payload);
  });
}

function handleIncoming(topic, payload) {
  if (topic === topicStatus("esp1")) {
    handleEsp1Status(payload);
    return;
  }

  if (topic === topicStatus("esp2")) {
    const devStatus = store.setDeviceStatus("esp2", payload.value);
    const updated = store.setValue("esp2_status", payload.value, "");
    if (onUpdateCallback) onUpdateCallback("esp2_status", { ...updated, deviceStatus: devStatus });
    return;
  }

  if (topic === topicOverrideStatus()) {
    if (payload.type === "overrides" && payload.values) {
      for (const [actuatorId, flag] of Object.entries(payload.values)) {
        const updated = store.setValue(`${actuatorId}_manual_override`, flag, "");
        if (onUpdateCallback) onUpdateCallback(`${actuatorId}_manual_override`, updated);
      }
    } else {
      // Backwards compatibility for single overrides
      const actuatorId = payload.actuator;
      if (actuatorId) {
        const flag = payload.manual_override === true || payload.value === true;
        const updated = store.setValue(`${actuatorId}_manual_override`, flag, "");
        if (onUpdateCallback) onUpdateCallback(`${actuatorId}_manual_override`, updated);
      }
    }
    return;
  }

  if (topic === `${PREFIX}/esp1/version` || topic === `${PREFIX}/esp2/version`) {
    const dev = topic.includes("esp1") ? "esp1" : "esp2";
    const otaData = store.setOtaStatus(dev, { version: payload.version, title: payload.title });
    if (onUpdateCallback) onUpdateCallback("ota_status", { device: dev, ...otaData });
    return;
  }

  if (topic === `${PREFIX}/esp1/ota/status` || topic === `${PREFIX}/esp2/ota/status`) {
    const dev = topic.includes("esp1") ? "esp1" : "esp2";
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

  if (
    topic === topicValues("esp1") ||
    topic === topicValues("esp2") ||
    topic === topicActuatorState("esp1") ||
    topic === topicActuatorState("esp2")
  ) {
    applyLivePayload(payload);
  }
}

function handleEsp1Status(payload) {
  if (payload.type === "material" || payload.material) {
    const ids = payload.material === "all"
      ? dispensableItems().map((item) => item.id)
      : [payload.material];
    ids.forEach((id) => {
      const item = findItem(id);
      if (!item) return;
      const updated = store.setDispenseStatus(item.id, payload.status);
      const devStatus = store.setDeviceStatus("esp1", "online");
      if (onUpdateCallback) {
        onUpdateCallback(item.id, { ...updated, deviceSource: "esp1", deviceStatus: devStatus });
      }
    });
    return;
  }

  const devStatus = store.setDeviceStatus("esp1", payload.value);
  const updated = store.setValue("esp1_status", payload.value, "");
  if (onUpdateCallback) onUpdateCallback("esp1_status", { ...updated, deviceStatus: devStatus });
}

function applyLivePayload(payload) {
  // --- Handlers for unified payloads ---
  if (payload.type === "actuators" && payload.values) {
    const devSource = payload.values.lime_stone !== undefined ? "esp1" : "esp2";
    const devStatus = store.setDeviceStatus(devSource, "online");
    for (const [actuatorId, val] of Object.entries(payload.values)) {
      const item = findItem(actuatorId);
      if (!item) continue;
      
      let finalVal = val;
      if (ACTUATOR_LOGIC_INVERTED && item.type === "actuator") {
        finalVal = invertOnOff(finalVal);
      }
      const updated = store.setValue(item.id, finalVal, payload.unit || item.unit);
      if (onUpdateCallback) onUpdateCallback(item.id, { ...updated, deviceSource: item.source, deviceStatus: devStatus });
    }
    return;
  }

  if (payload.type === "materials" && payload.values) {
    const devStatus = store.setDeviceStatus("esp1", "online");
    for (const [matId, val] of Object.entries(payload.values)) {
      const item = findItem(matId);
      if (!item) continue;
      const updated = store.setValue(item.id, val, payload.unit || item.unit);
      if (onUpdateCallback) onUpdateCallback(item.id, { ...updated, deviceSource: item.source, deviceStatus: devStatus });
    }
    return;
  }

  if (payload.type === "sensors" && payload.values) {
    const devStatus = store.setDeviceStatus("esp2", "online");
    for (const [sensorId, val] of Object.entries(payload.values)) {
      const item = findItem(sensorId);
      if (!item) continue;
      const updated = store.setValue(item.id, val, payload.unit || item.unit);
      if (onUpdateCallback) onUpdateCallback(item.id, { ...updated, deviceSource: item.source, deviceStatus: devStatus });
      
      // Keep existing special logic for kiln temperature threshold evaluation
      if (item.id === "klin_dht_temp") {
        evaluateKilnTempThreshold();
      }
      if (item.id === "klin_dht_temp" || item.id === "klin_heater") {
        const currentTemp = store.get("klin_dht_temp")?.value ?? null;
        const heaterState = store.get("klin_heater")?.value ?? "off";
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
    }
    return;
  }

  // --- Fallback for old single payloads (backwards compatible) ---
  const itemId = itemIdFromPayload(payload);
  const item = findItem(itemId);
  if (!item) return;

  const devStatus = store.setDeviceStatus(item.source, "online");
  let value = payloadValue(payload);
  if (ACTUATOR_LOGIC_INVERTED && item.type === "actuator") {
    value = invertOnOff(value);
  }
  const updated = store.setValue(item.id, value, payload.unit || item.unit);
  if (onUpdateCallback) onUpdateCallback(item.id, { ...updated, deviceSource: item.source, deviceStatus: devStatus });

  if (item.id === "klin_dht_temp") {
    evaluateKilnTempThreshold();
  }
  if (item.id === "klin_dht_temp" || item.id === "klin_heater") {
    const currentTemp = store.get("klin_dht_temp")?.value ?? null;
    const heaterState = store.get("klin_heater")?.value ?? "off";
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
}

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
    client.publish(topicActuatorCommand(item.source), JSON.stringify({
      type: "actuator",
      actuator: item.id,
      command: wireCommand,
      ...(automatic ? { mode: "auto" } : {}),
    }));
    return true;
  } catch (e) {
    console.error(`[HiveMQ] sendDirectCommand failed for ${item_id}:`, e.message || e);
    return false;
  }
}

function isConnected() { return !!client && client.connected; }

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
    client.publish(topicActuatorCommand(item.source), JSON.stringify({
      type: "actuator",
      actuator: item.id,
      command: wireCommand,
    }));
    return true;
  } catch (e) {
    console.error(`[HiveMQ] publishCommand failed for ${item_id}:`, e.message || e);
    return false;
  }
}

function publishResumeAuto(item_id) {
  if (item_id !== "klin" && item_id !== "klin_heater") return false;
  store.setMasterOverrideActive(false);
  const upKlin = store.setValue("klin_manual_override", false, "");
  const upHeater = store.setValue("klin_heater_manual_override", false, "");
  if (onUpdateCallback) {
    onUpdateCallback("klin_manual_override", upKlin);
    onUpdateCallback("klin_heater_manual_override", upHeater);
  }
  if (client && client.connected) {
    try {
      client.publish(topicOverrideCommand(), JSON.stringify({
        type: "override",
        actuator: item_id,
        command: "auto",
      }));
    } catch (e) {
      console.error(`[HiveMQ] publishResumeAuto failed for ${item_id}:`, e.message || e);
    }
  }
  evaluateKilnTempThreshold();
  return true;
}

function publishTarget(item_id, target) {
  const item = findItem(item_id);
  if (!item || !item.dispensable || typeof target !== "number" || !Number.isFinite(target) || target < 0) return false;
  if (!client || !client.connected) return false;
  try {
    client.publish(topicCommand("esp1"), JSON.stringify({
      type: "material",
      material: item.id,
      action: "target",
      target,
    }));
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
      try {
        client.publish(topicActuatorCommand(item.source), JSON.stringify({
          type: "actuator",
          actuator: item.id,
          command: wireCommand,
        }));
        publishedCount++;
      } catch (e) {}
    }
    const updated = store.setValue(item.id, command, "on/off");
    if (onUpdateCallback) onUpdateCallback(item.id, { ...updated, deviceSource: item.source });
  });
  return { count: publishedCount, total: actuators.length, success: publishedCount > 0 };
}

function publishOtaCommand(target, firmwareTitle, firmwareVersion, extra = {}) {
  if (!client || !client.connected) return false;
  const host = env.THINGSBOARD_URL ? env.THINGSBOARD_URL.replace(/\/$/, "") : `http://${env.MQTT_HOST || "localhost"}:8080`;
  try {
    const publishDeviceOta = (device, title, ver, token) => {
      const fwUrl = extra.url || `${host}/api/v1/${token}/firmware?title=${encodeURIComponent(title)}&version=${encodeURIComponent(ver)}`;
      const checksum = extra.checksum || "";
      client.publish(`${PREFIX}/${device}/ota/cmd`, JSON.stringify({ url: fwUrl, checksum, version: ver }));
      client.publish("v1/devices/me/attributes", JSON.stringify({
        fw_title: title,
        fw_version: ver,
        fw_url: fwUrl,
        fw_checksum: checksum,
        target_fw_title: title,
        target_fw_version: ver,
      }));
      store.setOtaStatus(device, { status: "INITIATED", progress: 0, message: "OTA command published to device", title, targetVersion: ver });
    };
    if (target === "esp1" || target === "all") {
      publishDeviceOta("esp1", firmwareTitle || "esp1_materials", firmwareVersion || "1.0.1", env.ESP1_ACCESS_TOKEN || "esp1");
    }
    if (target === "esp2" || target === "all") {
      publishDeviceOta("esp2", firmwareTitle || "esp2_relay", firmwareVersion || "1.0.1", env.ESP2_ACCESS_TOKEN || "esp2");
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
      client.publish(`${PREFIX}/esp1/cmd/reboot`, payload);
      client.publish("v1/devices/me/rpc/request/1", JSON.stringify({ method: "reboot", params: {} }));
      store.setDeviceStatus("esp1", "rebooting");
    }
    if (target === "esp2" || target === "all") {
      client.publish(`${PREFIX}/esp2/cmd/reboot`, payload);
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
