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

// ---- Kiln Temperature Baseline Tracking -----------------------------------
// startingTemp is captured the moment klin_heater is turned ON for the first
// time (or when the dashboard explicitly resets the baseline).
// afterHeaterTemp is updated continuously from MQTT klin_dht_temp readings.
let kilnTemperature = {
  startingTemp: null,    // °C — snapshot taken just before heater kicked in
  afterHeaterTemp: null, // °C — continuously updated live reading
  startingTs: null,      // timestamp when baseline was captured
  heaterWasOn: false,    // track previous heater state to detect ON edge
};

function updateKilnTemperature({ currentTemp, heaterState }) {
  // Detect heater turning ON → capture baseline if not already set
  const heaterNowOn = heaterState === "on";
  if (heaterNowOn && !kilnTemperature.heaterWasOn && kilnTemperature.startingTemp === null) {
    kilnTemperature.startingTemp = currentTemp;
    kilnTemperature.startingTs = Date.now();
  }
  kilnTemperature.heaterWasOn = heaterNowOn;

  // Always update the live after-heater reading when heater is on
  if (heaterNowOn && currentTemp !== null) {
    kilnTemperature.afterHeaterTemp = currentTemp;
  }

  return { ...kilnTemperature };
}

function resetKilnBaseline() {
  kilnTemperature.startingTemp = null;
  kilnTemperature.startingTs = null;
  kilnTemperature.afterHeaterTemp = null;
  kilnTemperature.heaterWasOn = false;
  return { ...kilnTemperature };
}

function getKilnTemperature() {
  return { ...kilnTemperature };
}

let masterOverrideActive = false;

function setMasterOverrideActive(active) {
  masterOverrideActive = !!active;
  return masterOverrideActive;
}

function isMasterOverrideActive() {
  return masterOverrideActive;
}

// ---- OTA Firmware & System Reboot State Storage -----------------------------
const otaState = new Map(); // device -> { version, status, progress, message, ts }

function setOtaStatus(device, data) {
  const existing = otaState.get(device) || { version: "1.0.0", status: "idle", progress: 0, message: "Ready", ts: Date.now() };
  const updated = { ...existing, ...data, ts: Date.now() };
  otaState.set(device, updated);
  return updated;
}

function getOtaStatus(device) {
  return otaState.get(device) || { version: "1.0.0", status: "idle", progress: 0, message: "Ready", ts: null };
}

function allOtaStatus() {
  return {
    esp1: getOtaStatus("esp1"),
    esp2: getOtaStatus("esp2"),
  };
}

module.exports = {
  setValue, setDispenseStatus,
  setDeviceStatus, getDeviceStatus, allDevices,
  get, all,
  updateKilnTemperature, resetKilnBaseline, getKilnTemperature,
  setMasterOverrideActive, isMasterOverrideActive,
  setOtaStatus, getOtaStatus, allOtaStatus,
};


