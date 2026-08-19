import { useEffect, useRef, useState } from "react";
import { API_BASE, WS_URL } from "../config.js";

// Connects once to the WebSocket (default subscription = all items, per
// Architecture v5 Section 4.2) and keeps a live map of item_id -> latest value.
// Also does an initial REST snapshot so tiles aren't empty before the first
// MQTT message arrives.
export function useLiveData() {
  const [items, setItems] = useState({});
  const [connected, setConnected] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState({
    esp1: { status: "unknown", lastSeen: null },
    esp2: { status: "unknown", lastSeen: null },
  });
  const wsRef = useRef(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/items`)
      .then((r) => r.json())
      .then((snapshot) => setItems(snapshot))
      .catch((err) => console.error("Initial snapshot failed:", err));

    fetch(`${API_BASE}/api/devices`)
      .then((r) => r.json())
      .then((devs) => {
        if (devs) {
          setDeviceStatus((prev) => ({
            ...prev,
            ...(devs.esp1 ? { esp1: devs.esp1 } : {}),
            ...(devs.esp2 ? { esp2: devs.esp2 } : {}),
          }));
        }
      })
      .catch((err) => console.error("Initial devices fetch failed:", err));

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = (err) => console.error("WebSocket error:", err);

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type !== "update") return;

      if (msg.deviceSource && msg.deviceStatus) {
        setDeviceStatus((prev) => ({
          ...prev,
          [msg.deviceSource]: msg.deviceStatus,
        }));
      }

      if (msg.item_id === "esp1_status") {
        if (msg.deviceStatus) {
          setDeviceStatus((prev) => ({ ...prev, esp1: msg.deviceStatus }));
        } else {
          setDeviceStatus((prev) => ({
            ...prev,
            esp1: { status: msg.value, lastSeen: msg.ts || Date.now() },
          }));
        }
      }

      if (msg.item_id === "esp2_status") {
        if (msg.deviceStatus) {
          setDeviceStatus((prev) => ({ ...prev, esp2: msg.deviceStatus }));
        } else {
          setDeviceStatus((prev) => ({
            ...prev,
            esp2: { status: msg.value, lastSeen: msg.ts || Date.now() },
          }));
        }
      }

      setItems((prev) => ({
        ...prev,
        [msg.item_id]: { ...prev[msg.item_id], ...msg },
      }));
    };

    return () => ws.close();
  }, []);

  const manualOverrides = {
    klin: items.klin_manual_override?.value === true || items.klin_manual_override?.value === "true",
    klin_heater: items.klin_heater_manual_override?.value === true || items.klin_heater_manual_override?.value === "true",
  };

  return { items, connected, deviceStatus, manualOverrides };
}
