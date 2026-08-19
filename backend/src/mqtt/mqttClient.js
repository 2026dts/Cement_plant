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
  });
}

function isConnected() {
  return !!client && client.connected;
}

// Used by the actuator ON/OFF routes (Feature C, Architecture v5)
function publishCommand(item_id, command) {
  const item = findItem(item_id);
  if (!item) return false;
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

// Used to resume automatic PID control for klin / klin_heater
function publishResumeAuto(item_id) {
  if (item_id !== "klin" && item_id !== "klin_heater") return false;
  if (!client || !client.connected) {
    console.warn(`[MQTT] publishResumeAuto: MQTT client not connected, cannot resume auto for ${item_id}`);
    return false;
  }
  const topic = `plant/esp2/${item_id}/override_cmd`;
  try {
    client.publish(topic, JSON.stringify({ command: "auto" }));
    console.log(`[MQTT] Published resume auto to ${topic}`);
    return true;
  } catch (e) {
    console.error(`[MQTT] publishResumeAuto: failed to publish for ${item_id}:`, e.message || e);
    return false;
  }
}

// Used by the material dispensing routes (Feature B, Architecture v5)
function publishTarget(item_id, target) {
  const item = findItem(item_id);
  if (!item || !item.dispensable) return false;
  if (!client || !client.connected) {
    console.warn(`[MQTT] publishTarget: MQTT client not connected, cannot send target for ${item_id}`);
    return false;
  }
  try {
    client.publish(topicTargetCmd(item), JSON.stringify({ target }));
    console.log(`[MQTT] Published target ${target} to ${topicTargetCmd(item)}`);
    return true;
  } catch (e) {
    console.error(`[MQTT] publishTarget: failed to publish for ${item_id}:`, e.message || e);
    return false;
  }
}

module.exports = { connect, isConnected, publishCommand, publishResumeAuto, publishTarget };