import { useState, useEffect } from "react";
import { API_BASE } from "../config.js";

export default function OtaManagement({ otaStatus = {}, isEsp1Online, isEsp2Online, onClose }) {
  const [target, setTarget] = useState("all"); // 'esp1', 'esp2', 'all'
  const [firmwares, setFirmwares] = useState({ esp1: [], esp2: [] });
  const [selectedEsp1Fw, setSelectedEsp1Fw] = useState("1.0.1");
  const [selectedEsp2Fw, setSelectedEsp2Fw] = useState("1.0.1");
  const [triggering, setTriggering] = useState(false);
  const [rebooting, setRebooting] = useState(false);
  const [message, setMessage] = useState(null);

  const esp1Ota = otaStatus.esp1 || { version: "1.0.0", status: "IDLE", progress: 0, message: "Ready" };
  const esp2Ota = otaStatus.esp2 || { version: "1.0.0", status: "IDLE", progress: 0, message: "Ready" };

  // ---- Fetch Available Firmware Packages from ThingsBoard REST API ----
  useEffect(() => {
    fetch(`${API_BASE}/api/ota/firmwares`)
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.firmwares) {
          setFirmwares(data.firmwares);
          if (data.firmwares.esp1 && data.firmwares.esp1.length > 0) {
            const last = data.firmwares.esp1[data.firmwares.esp1.length - 1];
            setSelectedEsp1Fw(last.version);
          }
          if (data.firmwares.esp2 && data.firmwares.esp2.length > 0) {
            const last = data.firmwares.esp2[data.firmwares.esp2.length - 1];
            setSelectedEsp2Fw(last.version);
          }
        }
      })
      .catch((err) => console.error("Error fetching ThingsBoard OTA packages:", err));
  }, []);

  // ---- Handle Master / Individual Reboot Button Click (ThingsBoard RPC) ----
  const handleReboot = async (deviceTarget) => {
    const label = deviceTarget === "all" ? "BOTH ESP32s" : deviceTarget.toUpperCase();
    if (!window.confirm(`Are you sure you want to REBOOT ${label}? All active processes will restart.`)) {
      return;
    }
    setRebooting(true);
    setMessage({ type: "info", text: `Sending ThingsBoard RPC reboot command to ${label}...` });
    try {
      const res = await fetch(`${API_BASE}/api/system/reboot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: deviceTarget }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: "success", text: `ThingsBoard RPC reboot command sent to ${label} successfully!` });
      } else {
        setMessage({ type: "error", text: data.error || "Failed to trigger reboot" });
      }
    } catch (err) {
      setMessage({ type: "error", text: "Network error triggering reboot" });
    } finally {
      setRebooting(false);
    }
  };

  // ---- Trigger ThingsBoard Remote OTA Update ----
  const handleTriggerOta = async () => {
    const targetLabel = target === "all" ? "BOTH ESP32 BOARDS" : target.toUpperCase();
    const targetVer = target === "esp1" ? `ESP1 v${selectedEsp1Fw}` : target === "esp2" ? `ESP2 v${selectedEsp2Fw}` : `ESP1 v${selectedEsp1Fw} & ESP2 v${selectedEsp2Fw}`;

    if (!window.confirm(`Trigger ThingsBoard Native OTA update for ${targetLabel} (${targetVer})?`)) {
      return;
    }

    setTriggering(true);
    setMessage({ type: "info", text: `Initiating ThingsBoard OTA update sequence for ${targetLabel}...` });

    try {
      const res = await fetch(`${API_BASE}/api/ota/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target,
          esp1Title: "esp1_materials",
          esp1Version: selectedEsp1Fw,
          esp2Title: "esp2_relay",
          esp2Version: selectedEsp2Fw,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setMessage({
          type: "success",
          text: `ThingsBoard OTA package assigned! Devices are receiving update notifications now.`,
        });
      } else {
        setMessage({ type: "error", text: data.error || "Failed to trigger OTA update" });
      }
    } catch (err) {
      setMessage({ type: "error", text: "Network error triggering OTA update" });
    } finally {
      setTriggering(false);
    }
  };

  const getBadgeColor = (status) => {
    const s = String(status || "").toUpperCase();
    switch (s) {
      case "INITIATED":
      case "DOWNLOADING":
      case "DOWNLOADED":
      case "VERIFIED":
      case "UPDATING":
        return "bg-amber-100 text-amber-800 border-amber-300 animate-pulse";
      case "UPDATED":
      case "SUCCESS":
        return "bg-emerald-100 text-emerald-800 border-emerald-300";
      case "FAILED":
        return "bg-red-100 text-red-800 border-red-300";
      default:
        return "bg-blue-50 text-blue-800 border-blue-200";
    }
  };

  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-gray-200 mb-6">
      {/* Header & Reboot Section */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 pb-4 mb-5">
        <div>
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <span>&#9889;</span> ThingsBoard Remote OTA &amp; System Control
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Native ThingsBoard Firmware OTA Repository &amp; Server-Side RPC Reboot
          </p>
        </div>

        {/* Action Buttons: Reboot + Close */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleReboot("all")}
            disabled={rebooting}
            className="flex items-center gap-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-bold px-4 py-2 rounded-xl transition-all shadow-sm hover:shadow"
          >
            <span>&#128260;</span>
            <span>{rebooting ? "Rebooting..." : "Reboot Both ESP32s"}</span>
          </button>

          {onClose && (
            <button
              onClick={onClose}
              title="Close/Hide OTA Section"
              className="bg-gray-100 hover:bg-gray-200 border border-gray-300 text-gray-600 hover:text-gray-900 text-xs font-bold px-3 py-2 rounded-xl transition-all"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Alert / Feedback message */}
      {message && (
        <div
          className={`mb-4 p-3 rounded-xl text-xs font-medium border flex items-center justify-between ${
            message.type === "error"
              ? "bg-red-50 text-red-800 border-red-200"
              : message.type === "success"
              ? "bg-emerald-50 text-emerald-800 border-emerald-200"
              : "bg-blue-50 text-blue-800 border-blue-200"
          }`}
        >
          <span>{message.text}</span>
          <button onClick={() => setMessage(null)} className="text-xs font-bold opacity-60 hover:opacity-100 ml-2">
            ✕
          </button>
        </div>
      )}

      {/* Firmware Status Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* ESP1 Status Card */}
        <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/50">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-xs text-gray-800 flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${isEsp1Online ? "bg-emerald-500" : "bg-red-500"}`} />
              ESP1 (Materials Feeder)
            </span>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-blue-100 text-blue-800 border border-blue-200">
              v{esp1Ota.version || "1.0.0"}
            </span>
          </div>

          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-gray-500">OTA State:</span>
            <span className={`font-semibold px-2 py-0.5 rounded border text-[11px] uppercase ${getBadgeColor(esp1Ota.status)}`}>
              {esp1Ota.status || "IDLE"}
            </span>
          </div>

          {esp1Ota.progress > 0 && esp1Ota.progress < 100 && (
            <div className="w-full bg-gray-200 rounded-full h-2 mb-2 overflow-hidden">
              <div
                className="bg-amber-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${esp1Ota.progress}%` }}
              />
            </div>
          )}

          <div className="flex items-center justify-between text-[11px] text-gray-500 mt-2 pt-2 border-t border-gray-200/60">
            <span className="truncate pr-2">{esp1Ota.message || "Ready"}</span>
            <button
              onClick={() => handleReboot("esp1")}
              disabled={rebooting}
              className="text-red-600 hover:text-red-700 font-semibold underline text-[11px] shrink-0"
            >
              Reboot ESP1
            </button>
          </div>
        </div>

        {/* ESP2 Status Card */}
        <div className="p-4 rounded-xl border border-gray-200 bg-gray-50/50">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-xs text-gray-800 flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${isEsp2Online ? "bg-emerald-500" : "bg-red-500"}`} />
              ESP2 (16ch Relay Board)
            </span>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-blue-100 text-blue-800 border border-blue-200">
              v{esp2Ota.version || "1.0.0"}
            </span>
          </div>

          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-gray-500">OTA State:</span>
            <span className={`font-semibold px-2 py-0.5 rounded border text-[11px] uppercase ${getBadgeColor(esp2Ota.status)}`}>
              {esp2Ota.status || "IDLE"}
            </span>
          </div>

          {esp2Ota.progress > 0 && esp2Ota.progress < 100 && (
            <div className="w-full bg-gray-200 rounded-full h-2 mb-2 overflow-hidden">
              <div
                className="bg-amber-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${esp2Ota.progress}%` }}
              />
            </div>
          )}

          <div className="flex items-center justify-between text-[11px] text-gray-500 mt-2 pt-2 border-t border-gray-200/60">
            <span className="truncate pr-2">{esp2Ota.message || "Ready"}</span>
            <button
              onClick={() => handleReboot("esp2")}
              disabled={rebooting}
              className="text-red-600 hover:text-red-700 font-semibold underline text-[11px] shrink-0"
            >
              Reboot ESP2
            </button>
          </div>
        </div>
      </div>

      {/* Native ThingsBoard OTA Upgrade Form */}
      <div className="bg-blue-50/40 p-4 rounded-xl border border-blue-100">
        <h3 className="font-semibold text-xs text-blue-900 mb-3 flex items-center gap-1.5">
          <span>&#128228;</span> Remote Firmware Update (ThingsBoard Native OTA)
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          {/* Target Select */}
          <div>
            <label className="block text-[11px] font-semibold text-gray-700 mb-1">Target Device</label>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="w-full text-xs p-2 rounded-lg border border-gray-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">Both ESP32 Boards (ESP1 &amp; ESP2)</option>
              <option value="esp1">ESP1 (Materials Feeder)</option>
              <option value="esp2">ESP2 (16ch Relay Board)</option>
            </select>
          </div>

          {/* ESP1 Firmware Package Selection */}
          {(target === "esp1" || target === "all") && (
            <div>
              <label className="block text-[11px] font-semibold text-gray-700 mb-1">ESP1 Firmware Package</label>
              <select
                value={selectedEsp1Fw}
                onChange={(e) => setSelectedEsp1Fw(e.target.value)}
                className="w-full text-xs p-2 rounded-lg border border-gray-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {firmwares.esp1.map((fw) => (
                  <option key={fw.version} value={fw.version}>
                    {fw.title} - v{fw.version}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* ESP2 Firmware Package Selection */}
          {(target === "esp2" || target === "all") && (
            <div>
              <label className="block text-[11px] font-semibold text-gray-700 mb-1">ESP2 Firmware Package</label>
              <select
                value={selectedEsp2Fw}
                onChange={(e) => setSelectedEsp2Fw(e.target.value)}
                className="w-full text-xs p-2 rounded-lg border border-gray-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {firmwares.esp2.map((fw) => (
                  <option key={fw.version} value={fw.version}>
                    {fw.title} - v{fw.version}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-blue-100 pt-3">
          <div className="text-[11px] text-gray-600">
            Current Versions: <span className="font-semibold text-gray-800">ESP1 v{esp1Ota.version || "1.0.0"}</span> |{" "}
            <span className="font-semibold text-gray-800">ESP2 v{esp2Ota.version || "1.0.0"}</span>
          </div>

          <button
            onClick={handleTriggerOta}
            disabled={triggering}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold px-6 py-2.5 rounded-xl transition-all shadow-sm hover:shadow"
          >
            <span>{target === "all" ? "UPDATE BOTH" : "UPDATE"}</span>
            {triggering && <span className="animate-spin text-sm">↻</span>}
          </button>
        </div>
      </div>
    </div>
  );
}
