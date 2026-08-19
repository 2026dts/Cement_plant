const COLORS = [
  "from-blue-500 to-blue-600",
  "from-purple-500 to-purple-600",
  "from-pink-500 to-pink-600",
  "from-orange-500 to-orange-600",
  "from-emerald-500 to-emerald-600",
  "from-red-500 to-red-600",
  "from-cyan-500 to-cyan-600",
  "from-teal-500 to-teal-600",
];

export default function Tile({ id, label, source, value, unit, colorIndex }) {
  let display = value === null || value === undefined ? "--" : value;
  if (typeof display === "number") {
    if (display < 0) display = 0;
    if (!Number.isInteger(display)) {
      display = display.toFixed(2);
    }
  }
  const gradient = COLORS[colorIndex % COLORS.length];

  return (
    <div className={`rounded-xl p-4 text-white shadow-md bg-gradient-to-br ${gradient}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold tracking-wide uppercase opacity-90">{label}</span>
        {source && (
          <span className="text-[10px] bg-white/25 rounded px-1.5 py-0.5 font-medium">
            {source.toUpperCase()}
          </span>
        )}
      </div>
      <div className="text-3xl font-bold leading-tight">{display}</div>
      <div className="text-xs opacity-90 mt-1">{unit || ""}</div>
    </div>
  );
}