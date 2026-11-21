'use strict';

// Central configuration. Everything overridable through environment variables.
module.exports = {
  port: parseInt(process.env.PORT || '8080', 10),
  mqtt: {
    url: process.env.MQTT_URL || 'mqtt://broker.hivemq.com:1883',
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
  },
  topicPrefix: process.env.TOPIC_PREFIX || 'solarcool',
  // 'sqlite://./data/solarcool.db' (default) or 'postgres://user:pass@host/db'
  databaseUrl: process.env.DATABASE_URL || 'sqlite://./data/solarcool.db',
  corsOrigin: process.env.CORS_ORIGIN || '*',
};
