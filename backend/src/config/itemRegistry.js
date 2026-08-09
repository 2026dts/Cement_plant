// Item Registry (Data Model) - Architecture v5, Section 6/7
// -----------------------------------------------------------------------------
// One entry per material, sensor, and actuator. Drives:
//   - which MQTT topics the backend subscribes to / publishes commands on
//   - the dashboard tile list
//   - which widget URL gets pasted into each Cupola hotspot
//
// `source` is the ESP topic segment used in MQTT topics: plant/<source>/<id>
// (matches the topic naming already used in the ESP32 firmware).
// `dispensable` marks materials that have a servo + load-cell closed loop
// (Feature B in Architecture v5) and therefore accept a `/target/cmd` message.

const ITEM_REGISTRY = [
  // ---- ESP1: 5 load-cell + servo pairs (all dispensable) ----
  { id: "limestone",    type: "material", source: "esp1", unit: "g", dispensable: true },
  { id: "clay",         type: "material", source: "esp1", unit: "g", dispensable: true },
  { id: "iron_ore",     type: "material", source: "esp1", unit: "g", dispensable: true },
  { id: "sand",         type: "material", source: "esp1", unit: "g", dispensable: true },
  { id: "raw_material", type: "material", source: "esp1", unit: "g", dispensable: true },

  // ---- ESP2: 16-channel relay board (2x8), 11 channels wired ----
  // Matches esp32/esp2-relay/esp2_relay.ino exactly. Channels 12-16 are spare.
  { id: "crusher",         type: "actuator", source: "esp2", unit: "on/off", relayChannel: 1 },  // gangs 3 N20 motors (left/right/wheel) on one relay
  { id: "conveyor_1",      type: "actuator", source: "esp2", unit: "on/off", relayChannel: 2 },
  { id: "conveyor_2",      type: "actuator", source: "esp2", unit: "on/off", relayChannel: 3 },
  { id: "conveyor_3",      type: "actuator", source: "esp2", unit: "on/off", relayChannel: 4 },
  { id: "conveyor_4",      type: "actuator", source: "esp2", unit: "on/off", relayChannel: 5 },
  { id: "clin",            type: "actuator", source: "esp2", unit: "on/off", relayChannel: 6 },  // kiln motor
  { id: "heater",          type: "actuator", source: "esp2", unit: "on/off", relayChannel: 7 },  // inside the clin
  { id: "heat_blower",     type: "actuator", source: "esp2", unit: "on/off", relayChannel: 8 },  // mini exhaust fan, inside the clin
  { id: "cooler_fan",      type: "actuator", source: "esp2", unit: "on/off", relayChannel: 9 },  // cooler's own exhaust mini fan
  { id: "clin_cooler_fan", type: "actuator", source: "esp2", unit: "on/off", relayChannel: 10 }, // separate inbuilt cooler fan, attached to the clin
  { id: "vibration_motor", type: "actuator", source: "esp2", unit: "on/off", relayChannel: 11 }, // feeder vibration motor (not the vibration sensor below)
  { id: "ball_mill_1",     type: "actuator", source: "esp2", unit: "on/off", relayChannel: 12 },
  { id: "ball_mill_2",     type: "actuator", source: "esp2", unit: "on/off", relayChannel: 13 },

  // ---- ESP2: sensors (not relay-controlled) ----
  // ASSUMPTION: dht1 = near the clin/heater section, dht2 = near the cooler
  // section. Rename if the two DHT11s are actually mounted elsewhere.
  { id: "dht1_temp",        type: "sensor", source: "esp2", unit: "C" },
  { id: "dht1_humidity",    type: "sensor", source: "esp2", unit: "%" },
  { id: "dht2_temp",        type: "sensor", source: "esp2", unit: "C" },
  { id: "dht2_humidity",    type: "sensor", source: "esp2", unit: "%" },
  { id: "vibration_sensor", type: "sensor", source: "esp2", unit: "/8" },
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
