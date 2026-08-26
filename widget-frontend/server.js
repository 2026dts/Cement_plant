const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const port = Number(process.env.PORT || 4173);

// Cupola runs on a different origin and fetches control.html URLs.
app.use(cors());

app.use(express.static(__dirname));

app.listen(port, "0.0.0.0", () => {
  console.log(`[Widget] Listening on http://0.0.0.0:${port}`);
});