const express = require("express");
const store = require("../state/store");
const env = require("../config/env");
const thingsboardService = require("../services/thingsboardService");
const mqttClient = require("../mqtt/mqttClient");
const hivemqClient = require("../mqtt/hivemqClient");

function publishOtaToBrokers(target, title, version, extra) {
  const localOk = mqttClient.publishOtaCommand(target, title, version, extra);
  const cloudOk = hivemqClient.publishOtaCommand(target, title, version, extra);
  return localOk || cloudOk;
}

function publishRebootToBrokers(target) {
  const localOk = mqttClient.publishRebootCommand(target);
  const cloudOk = hivemqClient.publishRebootCommand(target);
  return localOk || cloudOk;
}

const router = express.Router();

// GET /api/ota/status -> Live firmware versions & ThingsBoard OTA status for esp1 & esp2
router.get("/status", (req, res) => {
  res.json({
    success: true,
    devices: store.allOtaStatus(),
  });
});

// GET /api/ota/firmwares -> List available firmware packages from ThingsBoard REST API
router.get("/firmwares", async (req, res) => {
  try {
    const firmwares = await thingsboardService.getOtaPackages();
    res.json({
      success: true,
      firmwares,
    });
  } catch (err) {
    console.error("[OTA API] Error in /api/ota/firmwares:", err.message);
    res.json({
      success: true,
      firmwares: {
        esp1: [{ title: "esp1_materials", version: "1.0.1" }],
        esp2: [{ title: "esp2_relay", version: "1.0.1" }],
      },
    });
  }
});

// POST /api/ota/trigger -> Trigger ThingsBoard Native OTA update
router.post("/trigger", express.json(), async (req, res) => {
  const { target, esp1Version, esp2Version, esp1Title, esp2Title, firmwareTitle, firmwareVersion } = req.body || {};

  if (!target) {
    return res.status(400).json({ success: false, error: "Missing required field: target" });
  }

  const v1 = esp1Version || firmwareVersion || "1.0.1";
  const v2 = esp2Version || firmwareVersion || "1.0.1";
  const t1 = esp1Title || firmwareTitle || "esp1_materials";
  const t2 = esp2Title || firmwareTitle || "esp2_relay";

  const results = [];

  // ---- ESP1 Trigger ----
  if (target === "esp1" || target === "all") {
    const tbRes1 = await thingsboardService.assignOtaPackage({
      deviceId: env.ESP1_DEVICE_ID,
      title: t1,
      version: v1,
      deviceToken: env.ESP1_ACCESS_TOKEN,
    });
    const title1 = tbRes1.title || t1;
    const mqttOk1 = publishOtaToBrokers("esp1", title1, v1, {
      url: tbRes1.fwUrl,
      checksum: tbRes1.checksum,
    });
    results.push({ device: "esp1", title: title1, version: v1, tbSuccess: tbRes1.success, mqttSuccess: mqttOk1 });
  }

  // ---- ESP2 Trigger ----
  if (target === "esp2" || target === "all") {
    const tbRes2 = await thingsboardService.assignOtaPackage({
      deviceId: env.ESP2_DEVICE_ID,
      title: t2,
      version: v2,
      deviceToken: env.ESP2_ACCESS_TOKEN,
    });
    const title2 = tbRes2.title || t2;
    const mqttOk2 = publishOtaToBrokers("esp2", title2, v2, {
      url: tbRes2.fwUrl,
      checksum: tbRes2.checksum,
    });
    results.push({ device: "esp2", title: title2, version: v2, tbSuccess: tbRes2.success, mqttSuccess: mqttOk2 });
  }

  res.json({
    success: true,
    message: `ThingsBoard OTA triggered for ${target}`,
    target,
    results,
  });
});

// POST /api/system/reboot -> ThingsBoard Server-Side RPC Remote Reboot command
router.post("/reboot", express.json(), async (req, res) => {
  const { target } = req.body || {};
  const targetDevice = target || "all";

  const results = [];

  if (targetDevice === "esp1" || targetDevice === "all") {
    const tbOk1 = await thingsboardService.sendRpcReboot(env.ESP1_DEVICE_ID);
    const mqttOk1 = publishRebootToBrokers("esp1");
    results.push({ device: "esp1", tbSuccess: tbOk1, mqttSuccess: mqttOk1 });
  }

  if (targetDevice === "esp2" || targetDevice === "all") {
    const tbOk2 = await thingsboardService.sendRpcReboot(env.ESP2_DEVICE_ID);
    const mqttOk2 = publishRebootToBrokers("esp2");
    results.push({ device: "esp2", tbSuccess: tbOk2, mqttSuccess: mqttOk2 });
  }

  res.json({
    success: true,
    message: `ThingsBoard RPC reboot command sent to ${targetDevice}`,
    target: targetDevice,
    results,
  });
});

module.exports = router;
