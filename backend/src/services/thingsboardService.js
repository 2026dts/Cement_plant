const env = require("../config/env");

let jwtToken = null;
let tokenExpiry = 0;

// ---- Authenticate with ThingsBoard REST API ----
async function authenticate() {
  if (!env.THINGSBOARD_URL || !env.THINGSBOARD_USERNAME) {
    return null;
  }

  if (jwtToken && Date.now() < tokenExpiry) {
    return jwtToken;
  }

  try {
    const url = `${env.THINGSBOARD_URL.replace(/\/$/, "")}/api/auth/login`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: env.THINGSBOARD_USERNAME,
        password: env.THINGSBOARD_PASSWORD,
      }),
    });

    if (!res.ok) {
      console.warn(`[ThingsBoard API] Auth failed (${res.status}): ${res.statusText}`);
      return null;
    }

    const data = await res.json();
    if (data.token) {
      jwtToken = data.token;
      tokenExpiry = Date.now() + 2 * 60 * 60 * 1000;
      console.log("[ThingsBoard API] Authenticated successfully with Dubai server.");
      return jwtToken;
    }
  } catch (err) {
    console.warn("[ThingsBoard API] Network error authenticating:", err.message);
  }
  return null;
}

// ---- GET /api/otaPackages -> List firmware packages from ThingsBoard ----
async function getOtaPackages() {
  const token = await authenticate();

  const fallback = {
    esp1: [
      { title: "esp1_materials", version: "1.0.0" },
      { title: "esp1_materials", version: "1.0.1" },
    ],
    esp2: [
      { title: "esp2_relay", version: "1.0.0" },
      { title: "esp2_relay", version: "1.0.1" },
    ],
  };

  if (!token) {
    return fallback;
  }

  try {
    const url = `${env.THINGSBOARD_URL.replace(/\/$/, "")}/api/otaPackages?pageSize=50&page=0`;
    const res = await fetch(url, {
      headers: { "X-Authorization": `Bearer ${token}` },
    });

    if (!res.ok) {
      return fallback;
    }

    const data = await res.json();
    const packages = data.data || [];

    const esp1Pkgs = [];
    const esp2Pkgs = [];

    packages.forEach((pkg) => {
      if (pkg.type === "FIRMWARE" || !pkg.type) {
        const item = {
          id: pkg.id?.id,
          title: pkg.title,
          version: pkg.version,
          checksum: pkg.checksum,
          checksumAlgorithm: pkg.checksumAlgorithm,
          dataSize: pkg.dataSize,
          fileName: pkg.fileName,
        };
        if (pkg.title && pkg.title.includes("esp1")) {
          esp1Pkgs.push(item);
        } else if (pkg.title && pkg.title.includes("esp2")) {
          esp2Pkgs.push(item);
        } else {
          esp1Pkgs.push(item);
          esp2Pkgs.push(item);
        }
      }
    });

    return {
      esp1: esp1Pkgs.length > 0 ? esp1Pkgs : fallback.esp1,
      esp2: esp2Pkgs.length > 0 ? esp2Pkgs : fallback.esp2,
    };
  } catch (err) {
    console.warn("[ThingsBoard API] Error fetching otaPackages:", err.message);
    return fallback;
  }
}

// ---- Assign OTA package & publish attributes in ThingsBoard ----
async function assignOtaPackage({ deviceId, title, version, deviceToken }) {
  const token = await authenticate();
  const host = env.THINGSBOARD_URL ? env.THINGSBOARD_URL.replace(/\/$/, "") : "http://localhost:8080";

  let packageId = null;
  let checksum = "";
  let checksumAlgorithm = "SHA-256";
  let dataSize = 0;

  // 1. Search for matching otaPackage in ThingsBoard repository
  if (token) {
    try {
      const pkgRes = await fetch(`${host}/api/otaPackages?pageSize=50&page=0`, {
        headers: { "X-Authorization": `Bearer ${token}` },
      });
      if (pkgRes.ok) {
        const pkgData = await pkgRes.json();
        const found = (pkgData.data || []).find(p => p.title === title && p.version === version);
        if (found) {
          packageId = found.id?.id;
          checksum = found.checksum || "";
          checksumAlgorithm = found.checksumAlgorithm || "SHA-256";
          dataSize = found.dataSize || 0;
          console.log(`[ThingsBoard API] Found matching OTA package ${title} v${version} (ID: ${packageId})`);
        }
      }
    } catch (e) {
      console.warn("[ThingsBoard API] Failed fetching package details:", e.message);
    }
  }

  // 2. Assign firmwareId directly to Device in ThingsBoard REST API
  if (token && deviceId && packageId) {
    try {
      const devRes = await fetch(`${host}/api/device/${deviceId}`, {
        headers: { "X-Authorization": `Bearer ${token}` },
      });
      if (devRes.ok) {
        const devObj = await devRes.json();
        devObj.firmwareId = { entityType: "OTA_PACKAGE", id: packageId };
        const saveRes = await fetch(`${host}/api/device`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify(devObj),
        });
        if (saveRes.ok) {
          console.log(`[ThingsBoard API] Successfully assigned firmwareId ${packageId} to Device ${deviceId}`);
        }
      }
    } catch (e) {
      console.warn("[ThingsBoard API] Failed assigning firmwareId to device:", e.message);
    }
  }

  // 3. Construct ThingsBoard device HTTP download URL (/api/v1/$TOKEN/firmware)
  const tokenPath = deviceToken || env.MQTT_USER || "esp1_token";
  const fwUrl = `${host}/api/v1/${tokenPath}/firmware?title=${encodeURIComponent(title)}&version=${encodeURIComponent(version)}`;

  const attributes = {
    fw_title: title,
    fw_version: version,
    fw_checksum: checksum,
    fw_checksum_algorithm: checksumAlgorithm,
    fw_size: dataSize,
    fw_url: fwUrl,
    target_fw_title: title,
    target_fw_version: version,
  };

  if (token && deviceId) {
    try {
      await fetch(`${host}/api/plugins/telemetry/DEVICE/${deviceId}/SHARED_SCOPE`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify(attributes),
      });
      console.log(`[ThingsBoard API] Published SHARED_SCOPE attributes to device ${deviceId}`);
    } catch (err) {
      console.warn("[ThingsBoard API] Error publishing attributes:", err.message);
    }
  }

  return { success: true, attributes, fwUrl };
}

// ---- Send ThingsBoard Server-Side RPC reboot request ----
async function sendRpcReboot(deviceId) {
  const token = await authenticate();
  if (token && deviceId) {
    try {
      const host = env.THINGSBOARD_URL.replace(/\/$/, "");
      const url = `${host}/api/plugins/telemetry/DEVICE/${deviceId}/rpc/request`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          method: "reboot",
          params: {},
          timeout: 5000,
        }),
      });

      if (res.ok) {
        console.log(`[ThingsBoard API] Sent RPC reboot to device ${deviceId}`);
        return true;
      }
    } catch (err) {
      console.warn(`[ThingsBoard API] RPC reboot error for ${deviceId}:`, err.message);
    }
  }
  return false;
}

// ---- Forward device telemetry to ThingsBoard ----
async function sendTelemetry(deviceToken, telemetry) {
  if (!env.THINGSBOARD_URL) return false;
  try {
    const host = env.THINGSBOARD_URL.replace(/\/$/, "");
    const url = `${host}/api/v1/${deviceToken}/telemetry`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(telemetry),
    });

    if (res.ok) {
      console.log(`[ThingsBoard API] Forwarded telemetry to device token: ${deviceToken}`);
      return true;
    } else {
      console.warn(`[ThingsBoard API] Failed to forward telemetry (${res.status}): ${res.statusText}`);
    }
  } catch (err) {
    console.warn(`[ThingsBoard API] Error forwarding telemetry for ${deviceToken}:`, err.message);
  }
  return false;
}

module.exports = {
  authenticate,
  getOtaPackages,
  assignOtaPackage,
  sendRpcReboot,
  sendTelemetry,
};
