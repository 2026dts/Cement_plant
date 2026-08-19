// In-memory live state store.
// -----------------------------------------------------------------------------
// Architecture v5 keeps a "live-only, no history" data policy: this is the ONLY
// place values are held, and it is wiped on every backend restart by design.

const { allItemIds } = require("../config/itemRegistry");

const state = new Map(); // item_id -> { value, unit, ts, dispensing?, target? }

// Pre-populate every registered item so /api/items always returns a full
// snapshot, even before the first MQTT message arrives.
allItemIds().forEach((id) => {
  state.set(id, { value: null, unit: null, ts: null });
});

function setValue(item_id, value, unit) {
  const existing = state.get(item_id) || {};
  const updated = { ...existing, value, unit, ts: Date.now() };
  state.set(item_id, updated);
  return updated;
}

function setDispenseStatus(item_id, status) {
  const existing = state.get(item_id) || {};
  const updated = { ...existing, dispensing: status === "dispensing", ts: Date.now() };
  state.set(item_id, updated);
  return updated;
}

const deviceState = new Map(); // device -> { status, lastSeen }

function setDeviceStatus(device, status) {
  const updated = { status, lastSeen: Date.now() };
  deviceState.set(device, updated);
  return updated;
}

function getDeviceStatus(device) {
  return deviceState.get(device) || { status: "unknown", lastSeen: null };
}

function allDevices() {
  const out = {};
  for (const [device, status] of deviceState.entries()) out[device] = status;
  return out;
}

function get(item_id) {
  return state.get(item_id) || null;
}

function all() {
  const out = {};
  for (const [id, val] of state.entries()) out[id] = val;
  return out;
}

module.exports = { setValue, setDispenseStatus, setDeviceStatus, getDeviceStatus, allDevices, get, all };
