// MQTT client for the local Mosquitto broker (Architecture v4/v5).
// -----------------------------------------------------------------------------
// This is the ONLY module that speaks MQTT. It:
//   - subscribes to every item's live-value topic:      plant/<source>/<id>
//   - subscribes to every dispensable item's status:    plant/<source>/<id>/target/status
//   - exposes publish helpers used by the REST routes to send commands/targets

const mqtt = require("mqtt");
const env = require("../config/env");
const { ITEM_REGISTRY, findItem } = require("../config/itemRegistry");
const store = require("../state/store");

let client = null;
let onUpdateCallback = null; // wired up by server.js -> broadcasts over WebSocket

// Relay ON/OFF logic alignment (ESP32 firmware handles active-low hardware logic natively)
const ACTUATOR_LOGIC_INVERTED = false;

function invertOnOff(v) {
  if (v === "on") return "off";
  if (v === "off") return "on";
  return v; // not an on/off value (e.g. a numeric sensor reading) - leave as-is
}

function topicValue(item) {
  return `plant/${item.source}/${item.id}`;
}
function topicCmd(item) {
  return `plant/${item.source}/${item.id}/cmd`;
}
function topicTargetCmd(item) {
  return `plant/${item.source}/${item.id}/target/cmd`;
}
function topicTargetStatus(item) {
  return `plant/${item.source}/${item.id}/target/status`;
}

function connect(onUpdate) {
  onUpdateCallback = onUpdate;

  const url = `mqtt://${env.MQTT_HOST}:${env.MQTT_PORT}`;
  const options = {};
  if (env.MQTT_USER) {
    options.username = env.MQTT_USER;
    options.password = env.MQTT_PASSWORD;
  }

  console.log(`[MQTT] Connecting to Mosquitto at ${url} ...`);
  client = mqtt.connect(url, options);

  client.on("connect", () => {
    console.log("[MQTT] Connected to Mosquitto.");
    ITEM_REGISTRY.forEach((item) => {
      client.subscribe(topicValue(item));
      if (item.dispensable) {
        client.subscribe(topicTargetStatus(item));
      }
    });
    // Subscribe to status and override topics
    client.subscribe("plant/esp1/status");
    client.subscribe("plant/esp2/status");
    client.subscribe("plant/esp2/klin/manual_override");
    client.subscribe("plant/esp2/klin_heater/manual_override");
    // Subscribe to OTA version and status topics
    client.subscribe("plant/esp1/version");
    client.subscribe("plant/esp2/version");
    client.subscribe("plant/esp1/ota/status");
    client.subscribe("plant/esp2/ota/status");
    client.subscribe("v1/devices/me/telemetry");
  });

  client.on("reconnect", () => console.log("[MQTT] Reconnecting..."));
  client.on("error", (err) => console.error("[MQTT] Error:", err.message));

  client.on("message", (topic, payloadBuf) => {
    let payload;
    try {
      payload = JSON.parse(payloadBuf.toString());
    } catch (e) {
      console.warn(`[MQTT] Non-JSON payload on ${topic}, ignoring`);
      return;
    }

    // Handle ESP1 LWT / device status topic
    if (topic === "plant/esp1/status") {
      const devStatus = store.setDeviceStatus("esp1", payload.value);
      const updated = store.setValue("esp1_status", payload.value, "");
      if (onUpdateCallback) onUpdateCallback("esp1_status", { ...updated, deviceStatus: devStatus });
      return;
    }

    // Handle ESP2 LWT / device status topic
    if (topic === "plant/esp2/status") {
      const devStatus = store.setDeviceStatus("esp2", payload.value);
      const updated = store.setValue("esp2_status", payload.value, "");
      if (onUpdateCallback) onUpdateCallback("esp2_status", { ...updated, deviceStatus: devStatus });
      return;
    }

    // Handle klin / klin_heater manual override topics
    if (topic === "plant/esp2/klin/manual_override") {
      const updated = store.setValue("klin_manual_override", payload.value, "");
      if (onUpdateCallback) onUpdateCallback("klin_manual_override", updated);
      return;
    }
    if (topic === "plant/esp2/klin_heater/manual_override") {
      const updated = store.setValue("klin_heater_manual_override", payload.value, "");
      if (onUpdateCallback) onUpdateCallback("klin_heater_manual_override", updated);
      return;
    }

    // Handle ESP1 & ESP2 version topics
    if (topic === "plant/esp1/version" || topic === "plant/esp2/version") {
      const dev = topic.includes("esp1") ? "esp1" : "esp2";
      const otaData = store.setOtaStatus(dev, { version: payload.version, title: payload.title });
      if (onUpdateCallback) onUpdateCallback("ota_status", { device: dev, ...otaData });
      return;
    }

    // Handle ESP1 & ESP2 OTA status topics
    if (topic === "plant/esp1/ota/status" || topic === "plant/esp2/ota/status") {
      const dev = topic.includes("esp1") ? "esp1" : "esp2";
      const otaData = store.setOtaStatus(dev, payload);
      if (onUpdateCallback) onUpdateCallback("ota_status", { device: dev, ...otaData });
      return;
    }

    // Handle ThingsBoard telemetry topic
    if (topic === "v1/devices/me/telemetry") {
      if (payload.current_fw_title && payload.current_fw_version) {
        const dev = payload.current_fw_title.includes("esp1") ? "esp1" : "esp2";
        
        // Forward the telemetry to ThingsBoard HTTP API using device token (esp1 or esp2)
        const thingsboardService = require("../services/thingsboardService");
        thingsboardService.sendTelemetry(dev, payload);

        const otaData = store.setOtaStatus(dev, {
          version: payload.current_fw_version,
          status: payload.fw_state ? payload.fw_state.toLowerCase() : "idle"
        });
        if (onUpdateCallback) onUpdateCallback("ota_status", { device: dev, ...otaData });
      }
      return;
    }

    const item = ITEM_REGISTRY.find(
      (i) => topic === topicValue(i) || topic === topicTargetStatus(i)
    );
    if (!item) return;

    // Whenever any telemetry or status message arrives from a device (esp1 or esp2),
    // mark that device as online and record its lastSeen timestamp!
    const devStatus = store.setDeviceStatus(item.source, "online");

    if (topic === topicTargetStatus(item)) {
      const updated = store.setDispenseStatus(item.id, payload.status);
      if (onUpdateCallback) onUpdateCallback(item.id, { ...updated, deviceSource: item.source, deviceStatus: devStatus });
      return;
    }

    // Normal live-value update. For actuators, undo the relay board's
    // inversion so the stored/broadcast state matches reality.
    let value = payload.value;
    if (ACTUATOR_LOGIC_INVERTED && item.type === "actuator") {
      value = invertOnOff(value);
    }
    const updated = store.setValue(item.id, value, payload.unit || item.unit);
    if (onUpdateCallback) onUpdateCallback(item.id, { ...updated, deviceSource: item.source, deviceStatus: devStatus });

    // Heater safety control always runs. Master/manual state is still exposed
    // to the dashboard, but it must not allow a heater to remain on at 35 C.
    if (item.id === "klin_dht_temp") {
      evaluateKilnTempThreshold();
    }

    // Kiln temperature tracking: whenever klin_dht_temp or klin_heater changes,
    // update the baseline/live tracking and broadcast the full kiln temp object.
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
  });
}

function evaluateKilnTempThreshold() {
  if (store.isMasterOverrideActive()) {
    console.log("[AUTO] Temperature threshold control paused: Master Switch override is active.");
    return;
  }

  const rawTemp = store.get("klin_dht_temp")?.value;
  if (rawTemp === null || rawTemp === undefined || isNaN(rawTemp)) return;

  const isBelowSetpoint = Number(rawTemp) < 35;
  
  // Only control heater & blower if manual override for heater is not active
  const heaterOverride = store.get("klin_heater_manual_override")?.value === true;
  if (!heaterOverride) {
    setAutomaticState("klin_heater", isBelowSetpoint ? "on" : "off");
    setAutomaticState("heat_blower", isBelowSetpoint ? "on" : "off");
  }

  // Only control kiln motor if manual override for kiln is not active
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
    console.error(`[MQTT] sendDirectCommand: failed for ${item_id}:`, e.message || e);
    return false;
  }
}

function isConnected() {
  return !!client && client.connected;
}

// Used by the actuator ON/OFF routes - triggers Priority 2 (Manual Control)
function publishCommand(item_id, command) {
  const item = findItem(item_id);
  if (!item) return false;

  // Set Priority 2 (Manual Override) for kiln motor / kiln heater when manually triggered
  if (item_id === "klin" || item_id === "klin_heater") {
    const upOverride = store.setValue(`${item_id}_manual_override`, true, "");
    if (onUpdateCallback) onUpdateCallback(`${item_id}_manual_override`, upOverride);
  }

  if (!client || !client.connected) {
    console.warn(`[MQTT] publishCommand: MQTT client not connected, cannot send command for ${item_id}`);
    return false;
  }
  const wireCommand = ACTUATOR_LOGIC_INVERTED ? invertOnOff(command) : command;
  try {
    client.publish(topicCmd(item), JSON.stringify({ command: wireCommand }));
    return true;
  } catch (e) {
    console.error(`[MQTT] publishCommand: failed to publish for ${item_id}:`, e.message || e);
    return false;
  }
}

// Used to resume automatic PID/Threshold control for klin / klin_heater
function publishResumeAuto(item_id) {
  if (item_id !== "klin" && item_id !== "klin_heater") return false;

  // Clear Master Switch override & manual override for klin and heater
  store.setMasterOverrideActive(false);
  const upKlin = store.setValue("klin_manual_override", false, "");
  const upHeater = store.setValue("klin_heater_manual_override", false, "");
  if (onUpdateCallback) {
    onUpdateCallback("klin_manual_override", upKlin);
    onUpdateCallback("klin_heater_manual_override", upHeater);
  }

  if (client && client.connected) {
    const topic = `plant/esp2/${item_id}/override_cmd`;
    try {
      client.publish(topic, JSON.stringify({ command: "auto" }));
      console.log(`[MQTT] Published resume auto to ${topic}`);
    } catch (e) {
      console.error(`[MQTT] publishResumeAuto: failed to publish for ${item_id}:`, e.message || e);
    }
  }

  // Immediately evaluate temperature threshold logic upon resuming auto mode
  evaluateKilnTempThreshold();
  return true;
}

// Used by the material target routes to start a dispense cycle
function publishTarget(item_id, target) {
  const item = findItem(item_id);
  if (!item || !item.dispensable || typeof target !== "number" || !Number.isFinite(target) || target < 0) {
    return false;
  }
  if (!client || !client.connected) {
    console.warn(`[MQTT] publishTarget: MQTT client not connected, cannot publish target for ${item_id}`);
    return false;
  }
  try {
    client.publish(topicTargetCmd(item), JSON.stringify({ target }));
    return true;
  } catch (e) {
    console.error(`[MQTT] publishTarget: failed to publish for ${item_id}:`, e.message || e);
    return false;
  }
}

// Used by the Master Switch route to control all actuators at once - triggers Priority 1
function publishMasterCommand(command) {
  if (command !== "on" && command !== "off") return { count: 0, success: false };

  // Set Priority 1 (Master Switch Override)
  store.setMasterOverrideActive(true);
  const upKlin = store.setValue("klin_manual_override", true, "");
  const upHeater = store.setValue("klin_heater_manual_override", true, "");
  if (onUpdateCallback) {
    onUpdateCallback("klin_manual_override", upKlin);
    onUpdateCallback("klin_heater_manual_override", upHeater);
  }

  const actuators = ITEM_REGISTRY.filter((item) => item.type === "actuator" && !item.gate);
  let publishedCount = 0;

  actuators.forEach((item) => {
    const wireCommand = ACTUATOR_LOGIC_INVERTED ? invertOnOff(command) : command;
    if (client && client.connected) {
      try {
        client.publish(topicCmd(item), JSON.stringify({ command: wireCommand }));
        publishedCount++;
      } catch (e) {
        console.error(`[MQTT] publishMasterCommand failed for ${item.id}:`, e.message || e);
      }
    }
    // Update local state and trigger WebSocket broadcast for immediate UI response
    const updated = store.setValue(item.id, command, "on/off");
    if (onUpdateCallback) {
      onUpdateCallback(item.id, { ...updated, deviceSource: item.source });
    }
  });

  console.log(`[MQTT] Master Switch executed: ${command.toUpperCase()} on ${publishedCount}/${actuators.length} actuators`);
  return { count: publishedCount, total: actuators.length, success: publishedCount > 0 };
}

function publishOtaCommand(target, firmwareTitle, firmwareVersion) {
  if (!client || !client.connected) {
    console.warn("[MQTT] publishOtaCommand: MQTT client not connected!");
    return false;
  }
  const host = env.THINGSBOARD_URL ? env.THINGSBOARD_URL.replace(/\/$/, "") : `http://${env.MQTT_HOST || "localhost"}:8080`;
  try {
    if (target === "esp1" || target === "all") {
      const title = (target === "all") ? "esp1_materials" : (firmwareTitle || "esp1_materials");
      const ver = firmwareVersion || "1.0.1";
      const token = env.MQTT_USER || "esp1";
      const fwUrl = `${host}/api/v1/${token}/firmware?title=${encodeURIComponent(title)}&version=${encodeURIComponent(ver)}`;
      const payload = JSON.stringify({
        fw_title: title,
        fw_version: ver,
        fw_url: fwUrl,
        target_fw_title: title,
        target_fw_version: ver
      });
      client.publish("v1/devices/me/attributes", payload);
      store.setOtaStatus("esp1", { status: "INITIATED", progress: 0, message: "ThingsBoard OTA package assigned", title, targetVersion: ver });
    }
    if (target === "esp2" || target === "all") {
      const title = (target === "all") ? "esp2_relay" : (firmwareTitle || "esp2_relay");
      const ver = firmwareVersion || "1.0.1";
      const token = env.MQTT_USER || "esp2";
      const fwUrl = `${host}/api/v1/${token}/firmware?title=${encodeURIComponent(title)}&version=${encodeURIComponent(ver)}`;
      const payload = JSON.stringify({
        fw_title: title,
        fw_version: ver,
        fw_url: fwUrl,
        target_fw_title: title,
        target_fw_version: ver
      });
      client.publish("v1/devices/me/attributes", payload);
      store.setOtaStatus("esp2", { status: "INITIATED", progress: 0, message: "ThingsBoard OTA package assigned", title, targetVersion: ver });
    }
    if (onUpdateCallback) {
      onUpdateCallback("ota_status", { device: target, all: store.allOtaStatus() });
    }
    return true;
  } catch (e) {
    console.error("[MQTT] publishOtaCommand error:", e.message || e);
    return false;
  }
}

function publishRebootCommand(target) {
  if (!client || !client.connected) {
    console.warn("[MQTT] publishRebootCommand: Client not connected!");
    return false;
  }
  const payload = JSON.stringify({ command: "reboot" });
  try {
    if (target === "esp1" || target === "all") {
      client.publish("plant/esp1/cmd/reboot", payload);
      client.publish("v1/devices/me/rpc/request/1", JSON.stringify({ method: "reboot", params: {} }));
      store.setDeviceStatus("esp1", "rebooting");
      store.setOtaStatus("esp1", { status: "rebooting", message: "Reboot triggered" });
    }
    if (target === "esp2" || target === "all") {
      client.publish("plant/esp2/cmd/reboot", payload);
      client.publish("v1/devices/me/rpc/request/2", JSON.stringify({ method: "reboot", params: {} }));
      store.setDeviceStatus("esp2", "rebooting");
      store.setOtaStatus("esp2", { status: "rebooting", message: "Reboot triggered" });
    }
    if (onUpdateCallback) {
      onUpdateCallback("reboot_status", { target, status: "rebooting" });
    }
    return true;
  } catch (e) {
    console.error("[MQTT] publishRebootCommand error:", e.message || e);
    return false;
  }
}

module.exports = {
  connect, isConnected, publishCommand, publishMasterCommand,
  publishResumeAuto, publishTarget, publishOtaCommand, publishRebootCommand
};