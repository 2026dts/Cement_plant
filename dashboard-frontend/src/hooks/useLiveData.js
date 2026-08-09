import { useEffect, useRef, useState } from "react";
import { API_BASE, WS_URL } from "../config.js";

// Connects once to the WebSocket (default subscription = all items, per
// Architecture v5 Section 4.2) and keeps a live map of item_id -> latest value.
// Also does an initial REST snapshot so tiles aren't empty before the first
// MQTT message arrives.
export function useLiveData() {
  const [items, setItems] = useState({});
  const [connected, setConnected] = useState(false);
  const wsRef = useRef(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/items`)
      .then((r) => r.json())
      .then((snapshot) => setItems(snapshot))
      .catch((err) => console.error("Initial snapshot failed:", err));

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = (err) => console.error("WebSocket error:", err);

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type !== "update") return;
      setItems((prev) => ({
        ...prev,
        [msg.item_id]: { ...prev[msg.item_id], ...msg },
      }));
    };

    return () => ws.close();
  }, []);

  return { items, connected };
}
