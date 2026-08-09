// GET /api/health -> backend + MQTT connection status (ops/debugging)

const express = require("express");
const router = express.Router();
const mqttClient = require("../mqtt/mqttClient");

router.get("/health", (req, res) => {
  res.json({
    backend: "ok",
    mqtt_connected: mqttClient.isConnected(),
    ts: Date.now(),
  });
});

module.exports = router;
