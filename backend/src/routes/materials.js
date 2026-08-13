// Material dispensing routes - Architecture v5, Section 4.3 (Feature B).
//
// POST /api/materials/targets
//   { "limestone": 50, "clay": 50, "iron_ore": 50, "sand": 50 }
//   Used by the Dashboard's "Material Targets Configuration" panel - one
//   request applies all target values at once.
//
// POST /api/item/:id/target
//   { "target": 50 }
//   Single-item variant, in case any other UI needs to set just one target.

const express = require("express");
const router = express.Router();
const { findItem, dispensableItems } = require("../config/itemRegistry");
const mqttClient = require("../mqtt/mqttClient");

router.post("/materials/targets", (req, res) => {
  console.log(`[API] POST /api/materials/targets - body: ${JSON.stringify(req.body)}`);
  const accepted = [];
  const rejected = [];

  for (const [item_id, target] of Object.entries(req.body || {})) {
    const item = findItem(item_id);
    if (item && item.dispensable && typeof target === "number") {
      const ok = mqttClient.publishTarget(item_id, target);
      if (ok) {
        accepted.push(item_id);
      } else {
        rejected.push(item_id);
      }
    } else {
      rejected.push(item_id);
    }
  }

  res.json({ accepted, rejected });
});

router.post("/item/:id/target", (req, res) => {
  console.log(`[API] POST /api/item/${req.params.id}/target - body: ${JSON.stringify(req.body)}`);
  const item = findItem(req.params.id);
  if (!item) return res.status(404).json({ error: "Unknown item_id" });
  if (!item.dispensable) return res.status(400).json({ error: `${item.id} is not dispensable` });

  const { target } = req.body;
  if (typeof target !== "number") {
    return res.status(400).json({ error: "target must be a number" });
  }

  mqttClient.publishTarget(item.id, target);
  const ok = mqttClient.publishTarget(item.id, target);
  if (!ok) return res.status(500).json({ error: "Failed to publish target to MQTT broker" });
  res.json({ item_id: item.id, target });
});

// Handy for the dashboard to know which materials support targets at all.
router.get("/materials/dispensable", (req, res) => {
  res.json(dispensableItems().map((i) => i.id));
});

module.exports = router;
