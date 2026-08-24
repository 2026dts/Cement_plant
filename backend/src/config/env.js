require("dotenv").config();

module.exports = {
  MQTT_HOST: process.env.MQTT_HOST || "localhost",
  MQTT_PORT: parseInt(process.env.MQTT_PORT || "1883", 10),
  MQTT_USER: process.env.MQTT_USER || "",
  MQTT_PASSWORD: process.env.MQTT_PASSWORD || "",
  PORT: parseInt(process.env.PORT || "4000", 10),
  THINGSBOARD_HOST: process.env.THINGSBOARD_HOST || "allcad-chennai.selfip.com",
  THINGSBOARD_MQTT_PORT: parseInt(process.env.THINGSBOARD_MQTT_PORT || "1883", 10),
  THINGSBOARD_URL: process.env.THINGSBOARD_URL || "http://allcad-chennai.selfip.com:8081",
  THINGSBOARD_USERNAME: process.env.THINGSBOARD_USERNAME || "tenant@thingsboard.org",
  THINGSBOARD_PASSWORD: process.env.THINGSBOARD_PASSWORD || "tenant",
  ESP1_DEVICE_ID: process.env.ESP1_DEVICE_ID || "",
  ESP2_DEVICE_ID: process.env.ESP2_DEVICE_ID || "",
};
