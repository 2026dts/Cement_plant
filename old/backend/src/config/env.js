require("dotenv").config();

module.exports = {
  MQTT_HOST: process.env.MQTT_HOST || "localhost",
  MQTT_PORT: parseInt(process.env.MQTT_PORT || "1883", 10),
  MQTT_USER: process.env.MQTT_USER || "",
  MQTT_PASSWORD: process.env.MQTT_PASSWORD || "",
  PORT: parseInt(process.env.PORT || "4000", 10),
};
