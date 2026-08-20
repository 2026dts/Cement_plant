import { API_BASE } from "../config.js";

function TempBar({ value, max = 100 }) {
  const pct = value !== null ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  const color =
    pct > 80 ? "bg-red-500" : pct > 50 ? "bg-orange-400" : pct > 25 ? "bg-yellow-400" : "bg-blue-400";
  return (
    <div className="w-full bg-gray-100 rounded-full h-2 mt-1.5">
      <div
        className={`${color} h-2 rounded-full transition-all duration-700`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default function KilnTemperatureMonitor({ kilnTemperature, onReset }) {
  const { startingTemp, afterHeaterTemp, startingTs } = kilnTemperature || {};

  const hasStarting = startingTemp !== null && startingTemp !== undefined;
  const hasAfter = afterHeaterTemp !== null && afterHeaterTemp !== undefined;
  const delta = hasStarting && hasAfter ? (afterHeaterTemp - startingTemp).toFixed(1) : null;
  const isHeating = hasAfter && hasStarting && afterHeaterTemp > startingTemp;

  const startedAt = startingTs
    ? new Date(startingTs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;

  return (
    <div className="bg-white rounded-2xl shadow-md p-4 border border-orange-100">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-xl">🌡️</span>
          <div>
            <h3 className="font-bold text-sm text-gray-800">Kiln Temperature Monitor</h3>
            <p className="text-[10px] text-gray-400">
              Dynamic tracking — Starting vs After Heater · Live from ESP32
            </p>
          </div>
        </div>
        <button
          onClick={onReset}
          className="text-[10px] font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2.5 py-1.5 rounded-lg transition-colors border border-blue-200"
        >
          ↺ Reset Baseline
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {/* Starting Temperature */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
          <p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wider mb-1">
            Starting Temp
          </p>
          <p className="text-2xl font-bold text-blue-700">
            {hasStarting ? `${Number(startingTemp).toFixed(1)}°C` : "—"}
          </p>
          <p className="text-[10px] text-blue-400 mt-1">
            {startedAt ? `Captured at ${startedAt}` : "Waiting for heater ON…"}
          </p>
          <TempBar value={startingTemp} max={80} />
        </div>

        {/* After Heater Temperature */}
        <div className={`border rounded-xl p-3 ${isHeating ? "bg-orange-50 border-orange-200" : "bg-gray-50 border-gray-200"}`}>
          <p className={`text-[10px] font-semibold uppercase tracking-wider mb-1 ${isHeating ? "text-orange-500" : "text-gray-400"}`}>
            After Heater Temp
          </p>
          <p className={`text-2xl font-bold ${isHeating ? "text-orange-600" : "text-gray-500"}`}>
            {hasAfter ? `${Number(afterHeaterTemp).toFixed(1)}°C` : "—"}
          </p>
          <p className="text-[10px] text-gray-400 mt-1">
            {hasAfter ? "Live reading" : "Heater not active"}
          </p>
          <TempBar value={afterHeaterTemp} max={80} />
        </div>

        {/* Delta / Gain */}
        <div className={`border rounded-xl p-3 ${delta !== null && Number(delta) > 0 ? "bg-emerald-50 border-emerald-200" : "bg-gray-50 border-gray-200"}`}>
          <p className={`text-[10px] font-semibold uppercase tracking-wider mb-1 ${delta !== null && Number(delta) > 0 ? "text-emerald-600" : "text-gray-400"}`}>
            Temp Gain (ΔT)
          </p>
          <p className={`text-2xl font-bold ${delta !== null && Number(delta) > 0 ? "text-emerald-600" : delta !== null && Number(delta) < 0 ? "text-red-500" : "text-gray-400"}`}>
            {delta !== null ? `${Number(delta) > 0 ? "+" : ""}${delta}°C` : "—"}
          </p>
          <p className="text-[10px] text-gray-400 mt-1">
            {delta !== null
              ? Number(delta) > 0
                ? "Kiln heating up 🔥"
                : Number(delta) < 0
                ? "Cooling down ❄"
                : "No change"
              : "Awaiting data"}
          </p>
          {delta !== null && (
            <TempBar value={Math.abs(Number(delta))} max={40} />
          )}
        </div>
      </div>

      {/* Status footer */}
      {!hasStarting && (
        <p className="mt-3 text-center text-xs text-gray-400 bg-gray-50 rounded-lg py-2">
          ℹ Turn ON the <span className="font-semibold text-gray-600">Kiln Heater</span> to capture the starting temperature baseline automatically
        </p>
      )}
    </div>
  );
}
