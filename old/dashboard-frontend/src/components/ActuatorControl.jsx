import { useState } from "react";
import { API_BASE } from "../config.js";

// Dashboard-side actuator control: a real button + click handler, using the
// generic POST /api/item/:id/action endpoint (Architecture v5, Section 5).
// The split GET on/off URLs are for Cupola hotspots only - see widget-frontend.
export default function ActuatorControl({ id, label }) {
  const [sending, setSending] = useState(false);

  async function send(command) {
    setSending(true);
    try {
      await fetch(`${API_BASE}/api/item/${id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command }),
      });
    } catch (err) {
      console.error(err);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-md p-4 flex items-center justify-between">
      <span className="font-medium text-sm">{label}</span>
      <div className="flex gap-2">
        <button
          disabled={sending}
          onClick={() => send("on")}
          className="bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg"
        >
          ON
        </button>
        <button
          disabled={sending}
          onClick={() => send("off")}
          className="bg-red-500 hover:bg-red-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg"
        >
          OFF
        </button>
      </div>
    </div>
  );
}
