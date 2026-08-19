// Actuator control routes - Architecture v5, Section 5 (Feature C).
//
// POST /api/item/:id/action   { command: "on" | "off" }
//   Used by the Dashboard, where a real button + click handler exists.
//
// GET /api/item/:id/action/on
// GET /api/item/:id/action/off
//   Used by Cupola hotspots. Cupola simply opens a URL when a hotspot is
//   clicked - there's no button to tap inside the embedded page - so these
//   GET endpoints fire the action immediately and return a short status line
//   that the widget-frontend page displays.
//
// NOTE (Future Scope): a GET request that changes state can be triggered by
// anything that loads the URL. Fine for a private LAN demo; add a
// confirmation step or short-lived token before exposing this publicly.

const express = require("express");
const router = express.Router();
const { findItem } = require("../config/itemRegistry");
const mqttClient = require("../mqtt/mqttClient");

function assertActuator(req, res) {
  const item = findItem(req.params.id);
  if (!item) {
    res.status(404).json({ error: "Unknown item_id" });
    return null;
  }
  if (item.type !== "actuator") {
    res.status(400).json({ error: `${req.params.id} is not an actuator` });
    return null;
  }
  return item;
}

router.post("/item/:id/action", (req, res) => {
  const item = assertActuator(req, res);
  if (!item) return;

  const { command } = req.body;
  if (command !== "on" && command !== "off") {
    return res.status(400).json({ error: 'command must be "on" or "off"' });
  }

  mqttClient.publishCommand(item.id, command);
  res.json({ item_id: item.id, command });
});

router.get("/item/:id/action/on", (req, res) => {
  const item = assertActuator(req, res);
  if (!item) return;
  mqttClient.publishCommand(item.id, "on");
  res.type("text/plain").send(`${item.id.toUpperCase()}: ON`);
});

router.get("/item/:id/action/off", (req, res) => {
  const item = assertActuator(req, res);
  if (!item) return;
  mqttClient.publishCommand(item.id, "off");
  res.type("text/plain").send(`${item.id.toUpperCase()}: OFF`);
});

router.post("/item/:id/resume-auto", (req, res) => {
  const item = assertActuator(req, res);
  if (!item) return;
  if (item.id !== "klin" && item.id !== "klin_heater") {
    return res.status(400).json({ error: "Only klin and klin_heater support auto PID mode" });
  }
  mqttClient.publishResumeAuto(item.id);
  res.json({ item_id: item.id, status: "auto_resumed" });
});

module.exports = router;
