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
  { id: "clin_dht_temp", label: "Clin Area Temp", source: "esp2" },
  { id: "clin_dht_humidity", label: "Clin Area Humidity", source: "esp2" },
  { id: "cooler_dht_temp", label: "Cooler Area Temp", source: "esp2" },
  { id: "cooler_dht_humidity", label: "Cooler Area Humidity", source: "esp2" },
  { id: "preheating_tower_dht_temp", label: "Preheating Tower Temp", source: "esp2" },
  { id: "preheating_tower_dht_humidity", label: "Preheating Tower Humidity", source: "esp2" },
  { id: "vibration_sensor", label: "Vibration Sensor", source: "esp2" },
];

const ACTUATORS = [
  { id: "crusher", label: "Crusher (3x N20 ganged)" },
  { id: "conveyor_1", label: "Conveyor 1" },
  { id: "conveyor_2", label: "Conveyor 2" },
  { id: "conveyor_3", label: "Conveyor 3" },
  { id: "conveyor_4", label: "Conveyor 4" },
  { id: "clin", label: "Clin" },
  { id: "clin_heater", label: "Clin Heater" },
  { id: "heat_blower", label: "Heat Blower (Clin)" },
  { id: "cooler_fan", label: "Cooler Exhaust Fan" },
  { id: "preheating_tower_heater", label: "Preheating Tower Heater" },
  { id: "preheating_tower_exhaust_fan", label: "Preheating Tower Exhaust Fan" },
  { id: "vibration_motor", label: "Vibration Motor" },
  { id: "ball_mill_1", label: "Ball Mill 1" },
  { id: "ball_mill_2", label: "Ball Mill 2" },
];

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

      <div className="mt-6">
        <h2 className="font-semibold text-lg mb-3">Actuators (ESP2 - 16ch Relay)</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {ACTUATORS.map((a) => (
            <ActuatorControl key={a.id} id={a.id} label={a.label} />
          ))}
        </div>
      </div>
    </div>
  );
}