import { useState } from "react";
import { API_BASE } from "../config.js";

// Matches the reference screenshot: one numeric input per dispensable
// material + a single "Apply Material Targets" button that sends all four
// values in one request (Architecture v5, Section 4.4).
const MATERIALS = [
  { id: "limestone", label: "Limestone Target (g)" },
  { id: "clay", label: "Clay Target (g)" },
  { id: "iron_ore", label: "Iron Ore Target (g)" },
  { id: "sand", label: "Sand Target (g)" },
  { id: "raw_material", label: "Raw Material Target (g)" },
];

export default function MaterialTargets() {
  const [targets, setTargets] = useState({
    limestone: 50,
    clay: 50,
    iron_ore: 50,
    sand: 50,
    raw_material: 50,
  });
  const [status, setStatus] = useState(null);

  function updateField(id, value) {
    setTargets((prev) => ({ ...prev, [id]: Number(value) }));
  }

  async function applyTargets() {
    setStatus("sending");
    try {
      const res = await fetch(`${API_BASE}/api/materials/targets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(targets),
      });
      const data = await res.json();
      setStatus(`applied: ${data.accepted.join(", ")}`);
    } catch (err) {
      setStatus("error sending targets");
      console.error(err);
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-md p-6 mt-6">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-blue-600">&#9678;</span>
        <h2 className="font-semibold text-lg">Material Targets Configuration</h2>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
        {MATERIALS.map((m) => (
          <div key={m.id}>
            <label className="text-xs text-gray-500 flex items-center gap-1 mb-1">
              {m.label}
              <span className="text-[10px] bg-gray-100 rounded px-1 py-0.5">ESP1</span>
            </label>
            <input
              type="number"
              value={targets[m.id]}
              onChange={(e) => updateField(m.id, e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
        ))}
      </div>

      <button
        onClick={applyTargets}
        className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-2 rounded-lg flex items-center gap-2"
      >
        <span>&#10148;</span> Apply Material Targets
      </button>

      {status && <p className="text-xs text-gray-500 mt-2">{status}</p>}
    </div>
  );
}
