import { useEffect, useRef, useState, useCallback } from "react";
import { API_BASE, WS_URL } from "../config.js";

// Connects once to the WebSocket (default subscription = all items, per
// Architecture v5 Section 4.2) and keeps a live map of item_id -> latest value.
// Also does an initial REST snapshot so tiles aren't empty before the first
// MQTT message arrives.
//
// New in this version:
//  - refresh()         : manually re-fetches all data from GET /api/refresh
//  - kilnTemperature   : { startingTemp, afterHeaterTemp, startingTs } from backend
//  - resetKilnBaseline : calls POST /api/klin-temperature/reset
export function useLiveData() {
  const [items, setItems] = useState({});
  const [connected, setConnected] = useState(false);
  const [deviceStatus, setDeviceStatus] = useState({
    esp1: { status: "unknown", lastSeen: null },
    esp2: { status: "unknown", lastSeen: null },
  });
  const [kilnTemperature, setKilnTemperature] = useState({
    startingTemp: null,
    afterHeaterTemp: null,
    startingTs: null,
    heaterWasOn: false,
  });
  const [refreshing, setRefreshing] = useState(false);
  const wsRef = useRef(null);

  // ---- Helper: fetch and apply the full snapshot from backend ----
  const applySnapshot = useCallback((snapshot) => {
    if (snapshot.items) setItems(snapshot.items);
    if (snapshot.devices) {
      setDeviceStatus((prev) => ({
        ...prev,
        ...(snapshot.devices.esp1 ? { esp1: snapshot.devices.esp1 } : {}),
        ...(snapshot.devices.esp2 ? { esp2: snapshot.devices.esp2 } : {}),
      }));
    }
    if (snapshot.kilnTemperature) {
      setKilnTemperature(snapshot.kilnTemperature);
    }
  }, []);

  // ---- Refresh button handler — calls GET /api/refresh ----
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch(`${API_BASE}/api/refresh`);
      const data = await res.json();
      applySnapshot(data);
    } catch (err) {
      console.error("Refresh failed:", err);
    } finally {
      setRefreshing(false);
    }
  }, [applySnapshot]);

  // ---- Reset kiln temperature baseline ----
  const resetKilnBaseline = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/klin-temperature/reset`, { method: "POST" });
      const data = await res.json();
      if (data.kilnTemperature) setKilnTemperature(data.kilnTemperature);
    } catch (err) {
      console.error("Kiln baseline reset failed:", err);
    }
  }, []);

  useEffect(() => {
    // Initial full snapshot
    fetch(`${API_BASE}/api/refresh`)
      .then((r) => r.json())
      .then((data) => applySnapshot(data))
      .catch((err) => console.error("Initial snapshot failed:", err));

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

      // Kiln temperature monitor broadcast from backend
      if (msg.item_id === "klin_temp_monitor" && msg.value) {
        setKilnTemperature(msg.value);
        return; // don't put this in items map
      }

      setItems((prev) => ({
        ...prev,
        [msg.item_id]: { ...prev[msg.item_id], ...msg },
      }));
    };

    return () => ws.close();
  }, [applySnapshot]);

  const manualOverrides = {
    klin: items.klin_manual_override?.value === true || items.klin_manual_override?.value === "true",
    klin_heater: items.klin_heater_manual_override?.value === true || items.klin_heater_manual_override?.value === "true",
  };

  return {
    items, connected, deviceStatus, manualOverrides,
    kilnTemperature, refresh, refreshing, resetKilnBaseline,
  };
}
