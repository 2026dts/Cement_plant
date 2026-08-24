// ESP32 Digital Twin Platform - Backend (Architecture v5)
// -----------------------------------------------------------------------------
// The only component that speaks MQTT. Maintains in-memory live state, exposes
// REST endpoints for snapshots/commands/targets, and pushes live updates over
// WebSocket to both the Dashboard and the Cupola-embedded Widget pages.

const express = require("express");
const cors = require("cors");
const http = require("http");

const env = require("./src/config/env");
const mqttClient = require("./src/mqtt/mqttClient");
const wsServer = require("./src/ws/wsServer");

const itemsRoutes = require("./src/routes/items");
const actionRoutes = require("./src/routes/action");
const materialsRoutes = require("./src/routes/materials");
const healthRoutes = require("./src/routes/health");
const otaRoutes = require("./src/routes/ota");

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api", itemsRoutes);
app.use("/api", actionRoutes);
app.use("/api", materialsRoutes);
app.use("/api", healthRoutes);
app.use("/api/ota", otaRoutes);
app.use("/api/system", otaRoutes);

const server = http.createServer(app);
wsServer.attach(server);

// Every MQTT update flows through here and is immediately broadcast to
// whichever WebSocket clients care about that item (Dashboard = all,
// Widget pages = just their own item_id).
mqttClient.connect((item_id, updated) => {
  wsServer.broadcast(item_id, updated);
});

server.listen(env.PORT, () => {
  console.log(`[Backend] Listening on http://localhost:${env.PORT}`);
  console.log(`[Backend] WebSocket endpoint: ws://localhost:${env.PORT}/ws`);
});
