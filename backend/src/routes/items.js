// GET /api/items             -> snapshot of every item's current value (Dashboard initial load)
// GET /api/item/:id          -> snapshot of one item (Widget page initial load, before WS connects)
// GET /api/refresh           -> same as /api/items but signals the frontend it was an explicit refresh
// GET /api/klin-temperature  -> current kiln temperature monitoring data (starting + after-heater)
// POST /api/klin-temperature/reset -> reset the kiln temperature baseline

const express = require("express");
const router = express.Router();
const store = require("../state/store");
const { findItem } = require("../config/itemRegistry");

router.get("/items", (req, res) => {
  res.json(store.all());
});

router.get("/item/:id", (req, res) => {
  const item = findItem(req.params.id);
  if (!item) return res.status(404).json({ error: "Unknown item_id" });
  res.json({ item_id: req.params.id, ...store.get(req.params.id) });
});

router.get("/devices", (req, res) => {
  res.json(store.allDevices());
});

// Explicit refresh — returns a full data snapshot + device status in one round-trip.
// The frontend Refresh button calls this instead of the backend restart workaround.
router.get("/refresh", (req, res) => {
  res.json({
    items: store.all(),
    devices: store.allDevices(),
    kilnTemperature: store.getKilnTemperature(),
    ts: Date.now(),
  });
});

// Kiln temperature monitoring data
router.get("/klin-temperature", (req, res) => {
  res.json(store.getKilnTemperature());
});

// Reset kiln temperature baseline (e.g. before a new heating cycle)
router.post("/klin-temperature/reset", (req, res) => {
  const reset = store.resetKilnBaseline();
  res.json({ status: "reset", kilnTemperature: reset, ts: Date.now() });
});

module.exports = router;

