import { useState, useEffect } from "react";
import { API_BASE } from "../config.js";

export default function ActuatorControl({ id, label, isManualOverride, currentState }) {
  const [sending, setSending] = useState(false);
  const [notification, setNotification] = useState(null);

  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => setNotification(null), 4000);
    return () => clearTimeout(timer);
  }, [notification]);

  async function send(command) {
    setSending(true);
    try {
      await fetch(`${API_BASE}/api/item/${id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      });
      setNotification(`Manual ${command.toUpperCase()} Triggered`);
    } catch (err) {
      console.error(err);
    } finally {
      setSending(false);
    }
  }

  async function resumeAuto() {
    setSending(true);
    try {
      await fetch(`${API_BASE}/api/item/${id}/resume-auto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      setNotification("Auto PID Resumed");
    } catch (err) {
      console.error(err);
    } finally {
      setSending(false);
    }
  }

  const isOn = currentState === "on";

  return (
    <div className="bg-white rounded-xl shadow-md p-4 flex flex-col gap-2 relative">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              isOn ? "bg-emerald-500 animate-pulse" : "bg-gray-300"
            }`}
            title={isOn ? "Active (ON)" : "Inactive (OFF)"}
          />
          <span className="font-medium text-sm">{label}</span>
        </div>

        <div className="flex items-center gap-2">
          {notification && (
            <span className="text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full border border-amber-300 animate-bounce">
              ⚡ {notification}
            </span>
          )}
          <button
            disabled={sending}
            onClick={() => send("on")}
            className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
          >
            ON
          </button>
          <button
            disabled={sending}
            onClick={() => send("off")}
            className="bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
          >
            OFF
          </button>
        </div>
      </div>

      {isManualOverride && (
        <div className="mt-1 pt-2 border-t border-amber-200 flex items-center justify-between text-xs bg-amber-50 rounded-lg p-2">
          <span className="text-amber-800 font-medium flex items-center gap-1">
            🔒 Manual Override Active (PID Paused)
          </span>
          <button
            disabled={sending}
            onClick={resumeAuto}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold text-[11px] px-2.5 py-1 rounded transition-colors"
          >
            Resume Auto PID
          </button>
        </div>
      )}
    </div>
  );
}
