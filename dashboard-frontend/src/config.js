// Use the dashboard host so the UI also works from another laptop on the LAN.
const backendProtocol = window.location.protocol === "https:" ? "https:" : "http:";
const websocketProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
export const API_BASE = `${backendProtocol}//${window.location.hostname}:4000`;
export const WS_URL = `${websocketProtocol}//${window.location.hostname}:4000/ws`;
