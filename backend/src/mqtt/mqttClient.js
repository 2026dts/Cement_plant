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

    const item = ITEM_REGISTRY.find(
      (i) => topic === topicValue(i) || topic === topicTargetStatus(i)
    );
    if (!item) return;

    if (topic === topicTargetStatus(item)) {
      const updated = store.setDispenseStatus(item.id, payload.status);
      if (onUpdateCallback) onUpdateCallback(item.id, updated);
      return;
    }

    // Normal live-value update
    const updated = store.setValue(item.id, payload.value, payload.unit || item.unit);
    if (onUpdateCallback) onUpdateCallback(item.id, updated);
  });
}

function isConnected() {
  return !!client && client.connected;
}

// Used by the actuator ON/OFF routes (Feature C, Architecture v5)
function publishCommand(item_id, command) {
  const item = findItem(item_id);
  if (!item) return false;
  client.publish(topicCmd(item), JSON.stringify({ command }));
  return true;
}

// Used by the material dispensing routes (Feature B, Architecture v5)
function publishTarget(item_id, target) {
  const item = findItem(item_id);
  if (!item || !item.dispensable) return false;
  client.publish(topicTargetCmd(item), JSON.stringify({ target }));
  return true;
}

module.exports = { connect, isConnected, publishCommand, publishTarget };
