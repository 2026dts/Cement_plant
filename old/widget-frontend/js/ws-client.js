// Shared WebSocket connection logic for widget-frontend pages.
// Subscribes to a single item_id (Architecture v5, Section 4.2) and calls
// onUpdate(data) every time a matching "update" message arrives. Auto-reconnects
// with a short backoff if the connection drops.

function connectWidgetSocket(wsUrl, itemId, onUpdate) {
  let socket;

  function connect() {
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: "subscribe", item_id: itemId }));
    };

    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "update" && msg.item_id === itemId) {
        onUpdate(msg);
      }
    };

    socket.onclose = () => {
      setTimeout(connect, 2000);
    };

    socket.onerror = () => {
      socket.close();
    };
  }

  connect();
}
