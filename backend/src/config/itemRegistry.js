// Item Registry (Data Model) - Architecture v5, Section 6/7
// -----------------------------------------------------------------------------
// One entry per material, sensor, and actuator. Drives:
//   - which MQTT topics the backend subscribes to / publishes commands on
//   - the dashboard tile list
//   - which widget URL gets pasted into each Cupola hotspot
//
// `source` is the ESP board segment used in common MQTT topics:
// plant/cement-dubai/<source>/command|values|status|actuator/...
// Item identity is in the JSON payload (material / sensor / actuator), not the topic.
// `dispensable` marks materials that have a servo + load-cell closed loop
// and therefore accept a target command on the ESP1 command topic.

const ITEM_REGISTRY = [
  // ---- ESP1: 4 load-cell + servo pairs (all dispensable) ----
  { id: "gypsum",       type: "material", source: "esp1", unit: "g", dispensable: true },
  { id: "clay",         type: "material", source: "esp1", unit: "g", dispensable: true },
  { id: "iron_ore",     type: "material", source: "esp1", unit: "g", dispensable: true },
  { id: "sand",         type: "material", source: "esp1", unit: "g", dispensable: true },
  { id: "lime_stone",    type: "actuator", source: "esp1", unit: "open/close", gate: true },

  // ---- ESP2: 16-channel relay board (2x8), 14 channels wired ----
  // Matches esp32/esp2-relay/esp2_relay.ino exactly. Channels 15-16 are spare.
  { id: "crusher",                type: "actuator", source: "esp2", unit: "on/off", relayChannel: 1 },  // gangs 3 N20 motors (left/right/wheel) on one relay
  { id: "conveyor_1",             type: "actuator", source: "esp2", unit: "on/off", relayChannel: 2 },
  { id: "conveyor_2",             type: "actuator", source: "esp2", unit: "on/off", relayChannel: 3 },
  { id: "conveyor_3",             type: "actuator", source: "esp2", unit: "on/off", relayChannel: 4 },
  { id: "conveyor_4",             type: "actuator", source: "esp2", unit: "on/off", relayChannel: 5 },
  { id: "klin",                   type: "actuator", source: "esp2", unit: "on/off", relayChannel: 6 },  // kiln motor
  { id: "klin_heater",            type: "actuator", source: "esp2", unit: "on/off", relayChannel: 7 },  // inside the klin (renamed from "heater")
  { id: "heat_blower",            type: "actuator", source: "esp2", unit: "on/off", relayChannel: 8 },  // mini exhaust fan, inside the klin
  { id: "preheating_tower_fan",   type: "actuator", source: "esp2", unit: "on/off", relayChannel: 9 },  // preheating tower fan (renamed from "cooler_fan")
  { id: "preheating_tower_heater",type: "actuator", source: "esp2", unit: "on/off", relayChannel: 10 }, // replaces "klin_cooler_fan" (removed)
  { id: "vibration_motor",        type: "actuator", source: "esp2", unit: "on/off", relayChannel: 11 }, // feeder vibration motor (not the vibration sensor below)
  { id: "ball_mill_1",            type: "actuator", source: "esp2", unit: "on/off", relayChannel: 12 },
  { id: "ball_mill_2",            type: "actuator", source: "esp2", unit: "on/off", relayChannel: 13 },

  // ---- ESP2: sensors (not relay-controlled) ----
  // klin_dht = near the klin/klin_heater section (renamed from "dht1").
  // cooler_dht = near the cooler section (renamed from "dht2").
  // preheating_tower_dht = near the preheating tower / preheating_tower_heater.
  { id: "klin_dht_temp",                  type: "sensor", source: "esp2", unit: "C" },
  { id: "klin_dht_humidity",              type: "sensor", source: "esp2", unit: "%" },
  { id: "cooler_dht_temp",                type: "sensor", source: "esp2", unit: "C" },
  { id: "cooler_dht_humidity",            type: "sensor", source: "esp2", unit: "%" },
  { id: "preheating_tower_dht_temp",      type: "sensor", source: "esp2", unit: "C" },
  { id: "preheating_tower_dht_humidity",  type: "sensor", source: "esp2", unit: "%" },
  { id: "vibration_sensor",               type: "sensor", source: "esp2", unit: "g" },
  // ---- ESP1 / ESP2 status and manual override virtual items ----
  { id: "esp1_status",                    type: "sensor", source: "esp1", unit: "" },
  { id: "esp2_status",                    type: "sensor", source: "esp2", unit: "" },
  { id: "klin_manual_override",         type: "sensor", source: "esp2", unit: "" },
  { id: "klin_heater_manual_override",  type: "sensor", source: "esp2", unit: "" },
];

function findItem(id) {
  return ITEM_REGISTRY.find((item) => item.id === id) || null;
}

function allItemIds() {
  return ITEM_REGISTRY.map((item) => item.id);
}

function dispensableItems() {
  return ITEM_REGISTRY.filter((item) => item.dispensable);
}

module.exports = { ITEM_REGISTRY, findItem, allItemIds, dispensableItems };