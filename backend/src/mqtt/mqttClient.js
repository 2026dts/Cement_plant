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

    // Kiln temperature threshold control (Backend replacement for PID):
    // Priority order:
    //   1. Master ON/OFF Switch (Highest Priority)
    //   2. Manual Control (Second Priority)
    //   3. Automatic Temperature Threshold Control (Lowest Priority)
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
  const isMasterActive = store.isMasterOverrideActive();
  const isKlinManual = store.get("klin_manual_override")?.value === true || store.get("klin_manual_override")?.value === "true";
  const isHeaterManual = store.get("klin_heater_manual_override")?.value === true || store.get("klin_heater_manual_override")?.value === "true";

  // Priority 1 & 2: Do NOT run auto temp control if Master switch or Manual control is active!
  if (isMasterActive || isKlinManual || isHeaterManual) {
    return;
  }

  // Priority 3: Automatic Temperature Control
  const rawTemp = store.get("klin_dht_temp")?.value;
  if (rawTemp === null || rawTemp === undefined || isNaN(rawTemp)) return;

  const tempInt = Math.floor(Number(rawTemp));
  if (tempInt < 35) {
    if (store.get("klin_heater")?.value !== "on") {
      sendDirectCommand("klin_heater", "on");
      const upHeater = store.setValue("klin_heater", "on", "on/off");
      if (onUpdateCallback) onUpdateCallback("klin_heater", upHeater);
    }
    if (store.get("klin")?.value !== "off") {
      sendDirectCommand("klin", "off");
      const upKlin = store.setValue("klin", "off", "on/off");
      if (onUpdateCallback) onUpdateCallback("klin", upKlin);
    }
  } else {
    if (store.get("klin_heater")?.value !== "off") {
      sendDirectCommand("klin_heater", "off");
      const upHeater = store.setValue("klin_heater", "off", "on/off");
      if (onUpdateCallback) onUpdateCallback("klin_heater", upHeater);
    }
    if (store.get("klin")?.value !== "on") {
      sendDirectCommand("klin", "on");
      const upKlin = store.setValue("klin", "on", "on/off");
      if (onUpdateCallback) onUpdateCallback("klin", upKlin);
    }
  }
}

function sendDirectCommand(item_id, command) {
  const item = findItem(item_id);
  if (!item || !client || !client.connected) return false;
  const wireCommand = ACTUATOR_LOGIC_INVERTED ? invertOnOff(command) : command;
  try {
    client.publish(topicCmd(item), JSON.stringify({ command: wireCommand }));
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

module.exports = { connect, isConnected, publishCommand, publishMasterCommand, publishResumeAuto, publishTarget };