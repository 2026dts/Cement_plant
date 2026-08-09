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
  { id: "limestone",         type: "material", source: "esp1", unit: "g",      dispensable: true },
  { id: "clay",              type: "material", source: "esp1", unit: "g",      dispensable: true },
  { id: "iron_ore",          type: "material", source: "esp1", unit: "g",      dispensable: true },
  { id: "sand",              type: "material", source: "esp1", unit: "g",      dispensable: true },
  { id: "raw_material",      type: "material", source: "esp1", unit: "g",      dispensable: false },

  { id: "kiln_temp",         type: "sensor",   source: "esp1", unit: "C" },
  { id: "kiln_humidity",     type: "sensor",   source: "esp1", unit: "%" },
  { id: "preheat_temp",      type: "sensor",   source: "esp2", unit: "C" },
  { id: "preheat_humidity",  type: "sensor",   source: "esp2", unit: "%" },
  { id: "pulley_temp",       type: "sensor",   source: "esp2", unit: "C" },
  { id: "vibration",         type: "sensor",   source: "esp1", unit: "/8" },

  { id: "motor_feed",        type: "actuator", source: "esp2", unit: "on/off" },
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
