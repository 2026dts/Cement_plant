import { useState } from "react";
import { useLiveData } from "./hooks/useLiveData.js";
import Tile from "./components/Tile.jsx";
import MaterialTargets from "./components/MaterialTargets.jsx";
import ActuatorControl from "./components/ActuatorControl.jsx";
import MasterSwitch from "./components/MasterSwitch.jsx";
import KilnTemperatureMonitor from "./components/KilnTemperatureMonitor.jsx";
import OtaManagement from "./components/OtaManagement.jsx";

const SENSOR_TILES = [
  { id: "gypsum", label: "Gypsum", source: "esp1" },
  { id: "clay", label: "Clay", source: "esp1" },
  { id: "iron_ore", label: "Iron Ore", source: "esp1" },
  { id: "sand", label: "Sand", source: "esp1" },
  { id: "klin_dht_temp", label: "Klin Area Temp", source: "esp2" },
  { id: "klin_dht_humidity", label: "Klin Area Humidity", source: "esp2" },
  { id: "cooler_dht_temp", label: "Cooler Area Temp", source: "esp2" },
  { id: "cooler_dht_humidity", label: "Cooler Area Humidity", source: "esp2" },
  { id: "preheating_tower_dht_temp", label: "Preheating Tower Temp", source: "esp2" },
  { id: "preheating_tower_dht_humidity", label: "Preheating Tower Humidity", source: "esp2" },
  { id: "vibration_sensor", label: "Vibration Sensor", source: "esp2" },
];

const ACTUATORS = [
  { id: "lime_stone", label: "Lime Stone", commands: ["open", "close"] },
  { id: "crusher", label: "Crusher (3x N20 ganged)" },
  { id: "conveyor_1", label: "Conveyor 1" },
  { id: "conveyor_2", label: "Conveyor 2" },
  { id: "conveyor_3", label: "Conveyor 3" },
  { id: "conveyor_4", label: "Conveyor 4" },
  { id: "klin", label: "Klin" },
  { id: "klin_heater", label: "Klin Heater" },
  { id: "heat_blower", label: "Heat Blower (Klin)" },
  { id: "preheating_tower_fan", label: "Preheating Tower Fan" },
  { id: "preheating_tower_heater", label: "Preheating Tower Heater" },
  { id: "vibration_motor", label: "Vibration Motor" },
  { id: "ball_mill_1", label: "Ball Mill 1" },
  { id: "ball_mill_2", label: "Ball Mill 2" },
];

function formatLastSeen(ts) {
  if (!ts) return "Never";
  const diffSec = Math.floor((Date.now() - ts) / 1000);
  if (diffSec < 5) return "just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  return new Date(ts).toLocaleTimeString();
}

export default function App() {
  const {
    items, connected, deviceStatus, manualOverrides,
    kilnTemperature, refresh, refreshing, resetKilnBaseline,
    otaStatus,
  } = useLiveData();

  const [showOtaSection, setShowOtaSection] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const esp1Info = deviceStatus?.esp1 || { status: "unknown", lastSeen: null };
  const esp1LastSeen = esp1Info.lastSeen || items.esp1_status?.ts;
  const isEsp1Online = (esp1Info.status === "online" || items.esp1_status?.value === "online" || !!esp1LastSeen) &&
    esp1LastSeen && (Date.now() - esp1LastSeen < 15000);

  const esp2Info = deviceStatus?.esp2 || { status: "unknown", lastSeen: null };
  const esp2LastSeen = esp2Info.lastSeen || items.esp2_status?.ts;
  const isEsp2Online = (esp2Info.status === "online" || items.esp2_status?.value === "online" || !!esp2LastSeen) &&
    esp2LastSeen && (Date.now() - esp2LastSeen < 15000);

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6 bg-white rounded-2xl p-4 shadow-sm">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <span className="text-blue-600">&#128200;</span> Cement Plant Control Dashboard
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">Live PID Control &amp; Hardware Status Monitoring</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Refresh Button */}
          <button
            onClick={refresh}
            disabled={refreshing}
            title="Refresh all dashboard data from backend"
            className="flex items-center gap-1.5 bg-blue-50 hover:bg-blue-100 disabled:opacity-60 border border-blue-200 px-3 py-1.5 rounded-xl transition-colors"
          >
            <span
              className={`text-blue-600 text-sm font-bold inline-block ${refreshing ? "animate-spin" : ""}`}
              style={{ display: "inline-block" }}
            >
              ↻
            </span>
            <span className="text-xs font-semibold text-blue-700">
              {refreshing ? "Refreshing…" : "Refresh"}
            </span>
          </button>

          {/* Backend WS Status */}
          <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 px-3 py-1.5 rounded-xl">
            <span className={`w-2 h-2 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500"}`} />
            <span className="text-xs font-semibold text-gray-700">
              WS: {connected ? "Connected" : "Disconnected"}
            </span>
          </div>

          {/* ESP1 Device Status Badge (LWT) */}
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold ${
              isEsp1Online
                ? "bg-emerald-50 border-emerald-300 text-emerald-800"
                : "bg-red-50 border-red-300 text-red-800"
            }`}
          >
            <span className={`w-2.5 h-2.5 rounded-full ${isEsp1Online ? "bg-emerald-500 animate-pulse" : "bg-red-500"}`} />
            <div className="flex flex-col leading-tight">
              <span>ESP1 (Materials): {isEsp1Online ? "ONLINE" : "OFFLINE"}</span>
              <span className="text-[10px] font-normal opacity-80">
                Last seen: {formatLastSeen(esp1Info.lastSeen || items.esp1_status?.ts)}
              </span>
            </div>
          </div>

          {/* ESP2 Device Status Badge (LWT) */}
          <div
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold ${
              isEsp2Online
                ? "bg-emerald-50 border-emerald-300 text-emerald-800"
                : "bg-red-50 border-red-300 text-red-800"
            }`}
          >
            <span className={`w-2.5 h-2.5 rounded-full ${isEsp2Online ? "bg-emerald-500 animate-pulse" : "bg-red-500"}`} />
            <div className="flex flex-col leading-tight">
              <span>ESP2 (Relays): {isEsp2Online ? "ONLINE" : "OFFLINE"}</span>
              <span className="text-[10px] font-normal opacity-80">
                Last seen: {formatLastSeen(esp2Info.lastSeen || items.esp2_status?.ts)}
              </span>
            </div>
          </div>

          {/* Top Right System Menu Button */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex items-center gap-1.5 bg-gray-100 hover:bg-gray-200 border border-gray-300 text-gray-800 px-3.5 py-1.5 rounded-xl transition-all font-semibold text-xs shadow-sm"
            >
              <span>⚙ Options Menu</span>
              <span className="text-[10px] text-gray-500">{menuOpen ? "▲" : "▼"}</span>
            </button>

            {menuOpen && (
              <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-gray-200 py-1.5 z-50">
                <button
                  onClick={() => {
                    setShowOtaSection(!showOtaSection);
                    setMenuOpen(false);
                  }}
                  className="w-full text-left px-4 py-2.5 text-xs font-semibold text-gray-800 hover:bg-blue-50 hover:text-blue-600 flex items-center justify-between transition-colors"
                >
                  <span className="flex items-center gap-2">
                    <span>⚡</span> Firmware OTA &amp; System Update
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                      showOtaSection ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800"
                    }`}
                  >
                    {showOtaSection ? "ACTIVE" : "SHOW"}
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Hidden OTA Firmware Upgrade & System Management Panel */}
      {showOtaSection && (
        <OtaManagement
          otaStatus={otaStatus}
          isEsp1Online={isEsp1Online}
          isEsp2Online={isEsp2Online}
          onClose={() => setShowOtaSection(false)}
        />
      )}

      {/* Sensor Tiles Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {SENSOR_TILES.map((tile, i) => (
          <Tile
            key={tile.id}
            id={tile.id}
            label={tile.label}
            source={tile.source}
            value={items[tile.id]?.value}
            unit={items[tile.id]?.unit}
            colorIndex={i}
          />
        ))}
      </div>

      {/* Kiln Temperature Monitor */}
      <div className="mb-6">
        <KilnTemperatureMonitor
          kilnTemperature={kilnTemperature}
          onReset={resetKilnBaseline}
        />
      </div>

      {/* Material Targets Section */}
      <MaterialTargets />

      {/* Actuators Control Grid */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-lg">Actuators (ESP2 - 16ch Relay Board)</h2>
          <span className="text-xs text-gray-500 font-medium">
            PID Auto-Control Active for Klin &amp; Klin Heater (Target 35°C)
          </span>
        </div>

        {/* Master Switch — highest priority control */}
        <div className="mb-4">
          <MasterSwitch items={items} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {ACTUATORS.map((a) => (
            <ActuatorControl
              key={a.id}
              id={a.id}
              label={a.label}
              commands={a.commands}
              isManualOverride={manualOverrides[a.id]}
              currentState={items[a.id]?.value}
            />
          ))}
        </div>
      </div>
    </div>
  );
}