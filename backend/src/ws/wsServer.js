// WebSocket server.
// -----------------------------------------------------------------------------
// Single endpoint, e.g. ws://<host>:<port>/ws (Architecture v5, Section 4.2).
//   - Dashboard connects and receives updates for every item (no subscribe
//     message needed - default behaviour is "all").
//   - Widget pages send { type: "subscribe", item_id } right after connecting
//     and from then on only receive updates for that one item.

const WebSocket = require("ws");

// ws -> Set of item_ids the client wants ("*" means "everything")
const subscriptions = new Map();

function attach(server) {
  const wss = new WebSocket.Server({ server, path: "/ws" });

  wss.on("connection", (ws) => {
    subscriptions.set(ws, new Set(["*"])); // default: dashboard-style, receive all

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch (e) {
        return;
      }
      if (msg.type === "subscribe" && msg.item_id) {
        subscriptions.set(ws, new Set([msg.item_id])); // widget page: scope to one item
      }
    });

    ws.on("close", () => subscriptions.delete(ws));
  });

  return wss;
}

function broadcast(item_id, data) {
  const message = JSON.stringify({ type: "update", item_id, ...data });

  for (const [ws, wanted] of subscriptions.entries()) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    if (wanted.has("*") || wanted.has(item_id)) {
      ws.send(message);
    }
  }
}

module.exports = { attach, broadcast };
