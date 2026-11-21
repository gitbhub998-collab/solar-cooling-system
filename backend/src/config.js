'use strict';

// Central configuration. Everything overridable through environment variables.
module.exports = {
  port: parseInt(process.env.PORT || '8080', 10),
  mqtt: {
    // mqtts://host:8883 in production; mqtt:// only on a trusted bench network
    url: process.env.MQTT_URL || 'mqtts://localhost:8883',
    username: process.env.MQTT_USERNAME || 'backend',
    password: process.env.MQTT_PASSWORD || undefined,
    // Path to the CA certificate that signed the broker's cert.
    // Leave empty for public-CA brokers (e.g. HiveMQ Cloud, Let's Encrypt).
    ca: process.env.MQTT_CA || '',
    // Dev escape hatch for self-signed setups without CA distribution.
    rejectUnauthorized: process.env.MQTT_REJECT_UNAUTHORIZED !== 'false',
  },
  topicPrefix: process.env.TOPIC_PREFIX || 'solarcool',
  // 'sqlite://./data/solarcool.db' (default) or 'postgres://user:pass@host/db'
  databaseUrl: process.env.DATABASE_URL || 'sqlite://./data/solarcool.db',
  corsOrigin: process.env.CORS_ORIGIN || '*',

  // --- Command-path security ---
  // Operator auth: when set, POST /api/commands requires
  //   Authorization: Bearer <OPERATOR_TOKEN>
  // Read-only endpoints stay open so the dashboard can be watched freely.
  operatorToken: process.env.OPERATOR_TOKEN || '',
  // Device-side interlock: commands must carry this key or the ESP32
  // ignores them. Must match COMMAND_KEY in the firmware.
  commandKey: process.env.COMMAND_KEY || 'change-me-command-key',
};
