import { useState } from "react";
import { API_BASE } from "../config.js";

export default function MasterSwitch({ items }) {
  const [sending, setSending] = useState(false);
  const [lastCommand, setLastCommand] = useState(null);
  const [notification, setNotification] = useState(null);

  // Count how many actuators are currently ON
  const ACTUATOR_IDS = [
    "crusher", "conveyor_1", "conveyor_2", "conveyor_3", "conveyor_4",
    "klin", "klin_heater", "heat_blower",
    "preheating_tower_fan", "preheating_tower_heater",
    "vibration_motor", "ball_mill_1", "ball_mill_2",
  ];
  const activeCount = ACTUATOR_IDS.filter((id) => items[id]?.value === "on").length;

  async function sendMasterCommand(command) {
    setSending(true);
    try {
      const res = await fetch(`${API_BASE}/api/actuators/master`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      });
      const data = await res.json();
      setLastCommand(command);
      setNotification(
        `Master ${command.toUpperCase()} sent to ${data.publishedCount ?? ACTUATOR_IDS.length} actuators`
      );
      setTimeout(() => setNotification(null), 5000);
    } catch (err) {
      console.error("Master switch error:", err);
      setNotification("⚠ Master command failed — check backend");
      setTimeout(() => setNotification(null), 5000);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="bg-gradient-to-r from-slate-800 to-slate-900 rounded-2xl shadow-lg p-4 border border-slate-700">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">⚡</span>
          <div>
            <h3 className="text-white font-bold text-sm tracking-wide">MASTER SWITCH</h3>
            <p className="text-slate-400 text-[10px]">
              Controls ALL {ACTUATOR_IDS.length} actuators simultaneously · Highest priority
            </p>
          </div>
        </div>

        {/* Active count badge */}
        <div className="flex items-center gap-1.5 bg-slate-700 px-3 py-1.5 rounded-xl border border-slate-600">
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              activeCount > 0 ? "bg-emerald-400 animate-pulse" : "bg-slate-500"
            }`}
          />
          <span className="text-slate-200 text-xs font-semibold">
            {activeCount} / {ACTUATOR_IDS.length} ON
          </span>
        </div>
      </div>

      {/* Notification banner */}
      {notification && (
        <div className="mb-3 px-3 py-2 bg-amber-500/20 border border-amber-500/40 rounded-lg text-amber-300 text-xs font-medium">
          ⚡ {notification}
        </div>
      )}

      {/* Buttons */}
      <div className="flex gap-3">
        <button
          disabled={sending}
          onClick={() => sendMasterCommand("on")}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all
            ${lastCommand === "on"
              ? "bg-emerald-500 shadow-lg shadow-emerald-500/30 text-white scale-[1.02]"
              : "bg-emerald-600 hover:bg-emerald-500 text-white"
            }
            disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <span className="text-lg">🟢</span>
          {sending && lastCommand !== "off" ? "Sending…" : "MASTER ON"}
        </button>

        <button
          disabled={sending}
          onClick={() => sendMasterCommand("off")}
          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all
            ${lastCommand === "off"
              ? "bg-red-500 shadow-lg shadow-red-500/30 text-white scale-[1.02]"
              : "bg-red-600 hover:bg-red-500 text-white"
            }
            disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          <span className="text-lg">🔴</span>
          {sending && lastCommand !== "on" ? "Sending…" : "MASTER OFF"}
        </button>
      </div>

      {/* Priority note */}
      <p className="mt-2 text-center text-[10px] text-slate-500">
        ⚠ Master Switch overrides PID auto-control and individual actuator states
      </p>
    </div>
  );
}
