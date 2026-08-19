// GET /api/items      -> snapshot of every item's current value (Dashboard initial load)
// GET /api/item/:id    -> snapshot of one item (Widget page initial load, before WS connects)

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

module.exports = router;
