import { useLiveData } from "./hooks/useLiveData.js";
import Tile from "./components/Tile.jsx";
import MaterialTargets from "./components/MaterialTargets.jsx";
import ActuatorControl from "./components/ActuatorControl.jsx";

// Registry of what to show on the dashboard. Kept in sync with the backend's
// item registry (Architecture v5, Section 7); duplicating a small display-only
// copy here keeps the frontend simple (no build-time coupling to the backend).
const SENSOR_TILES = [
  { id: "limestone", label: "Limestone", source: "esp1" },
  { id: "clay", label: "Clay", source: "esp1" },
  { id: "iron_ore", label: "Iron Ore", source: "esp1" },
  { id: "sand", label: "Sand", source: "esp1" },
  { id: "raw_material", label: "Raw Material", source: "esp1" },
  { id: "kiln_temp", label: "Kiln Temp", source: "esp1" },
  { id: "kiln_humidity", label: "Kiln Humidity", source: "esp1" },
  { id: "preheat_temp", label: "Preheating Tower Temp", source: "esp2" },
  { id: "preheat_humidity", label: "Preheating Tower Humidity", source: "esp2" },
  { id: "pulley_temp", label: "Pulley Temp", source: "esp2" },
  { id: "vibration", label: "Vibration", source: "esp2" },
];

const ACTUATORS = [{ id: "motor_feed", label: "Feed Motor" }];

export default function App() {
  const { items, connected } = useLiveData();

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <span className="text-blue-600">&#128200;</span> Live Sensor Data
        </h1>
        <span
          className={`text-xs font-semibold px-2 py-1 rounded-full ${
            connected ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
          }`}
        >
          {connected ? "Connected" : "Disconnected"}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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

      <MaterialTargets />

      <div className="mt-6 space-y-3">
        <h2 className="font-semibold text-lg mb-2">Actuators</h2>
        {ACTUATORS.map((a) => (
          <ActuatorControl key={a.id} id={a.id} label={a.label} />
        ))}
      </div>
    </div>
  );
}
