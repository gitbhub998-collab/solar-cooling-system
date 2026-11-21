'use strict';

/**
 * MQTT bridge.
 *
 * Topic layout (prefix configurable, default "solarcool"):
 *   solarcool/<deviceId>/readings   <- ESP32 publishes one JSON snapshot:
 *       { "ts": 1732310000000,                       (optional, server stamps it)
 *         "panels": { "water": {"temperature":..,"voltage":..,"current":..,"power":..},
 *                     "air":   { ... }, "none": { ... } },   <- any key works, extensible
 *         "ambient": { "temperature": 33.2 },
 *         "battery": { "voltage": 12.4, "percentage": 78 } }
 *   solarcool/<deviceId>/status     <- "online"/"offline" (LWT keeps it honest)
 *   solarcool/<deviceId>/commands   -> server publishes {fan,pump} (retained,
 *                                       so a rebooting ESP32 re-applies the last setpoints)
 */

const mqtt = require('mqtt');
const config = require('./config');
const db = require('./db');

let client = null;
let broadcast = () => {};

function start(onEvent) {
  broadcast = onEvent || broadcast;
  const p = config.topicPrefix;

  client = mqtt.connect(config.mqtt.url, {
    username: config.mqtt.username,
    password: config.mqtt.password,
    reconnectPeriod: 5000,
    clientId: `solarcool-backend-${Math.random().toString(16).slice(2, 8)}`,
  });

  client.on('connect', () => {
    console.log('MQTT connected:', config.mqtt.url);
    client.subscribe([`${p}/+/readings`, `${p}/+/status`], err => {
      if (err) console.error('MQTT subscribe failed:', err.message);
    });
  });
  client.on('reconnect', () => console.log('MQTT reconnecting...'));
  client.on('error', err => console.error('MQTT error:', err.message));

  client.on('message', async (topic, payload) => {
    const parts = topic.split('/');           // [prefix, deviceId, channel]
    if (parts.length !== 3 || parts[0] !== p) return;
    const [, deviceId, channel] = parts;

    if (channel === 'status') {
      broadcast({ type: 'status', deviceId, status: payload.toString() });
      return;
    }
    if (channel !== 'readings') return;

    let msg;
    try { msg = JSON.parse(payload.toString()); }
    catch { console.error('Bad JSON from', deviceId); return; }

    const ts = typeof msg.ts === 'number' ? msg.ts : Date.now();
    try {
      for (const [panel, r] of Object.entries(msg.panels || {})) {
        await db.insertReading(deviceId, ts, panel, r);
      }
      if (msg.ambient || msg.battery) {
        await db.insertEnvironment(deviceId, ts, msg.ambient?.temperature, msg.battery);
      }
      broadcast({ type: 'reading', deviceId, ts, panels: msg.panels || {}, ambient: msg.ambient, battery: msg.battery });
    } catch (err) {
      console.error('Store failed:', err.message);
    }
  });

  return api;
}

const api = {
  // Publishes a retained command so the device picks it up even after a reboot.
  publishCommand(deviceId, fan, pump, source = 'dashboard') {
    if (!client?.connected) throw new Error('MQTT not connected');
    const topic = `${config.topicPrefix}/${deviceId}/commands`;
    client.publish(topic, JSON.stringify({ fan, pump }), { retain: true, qos: 1 });
    return db.logCommand(deviceId, Date.now(), fan, pump, source);
  },
  get connected() { return !!client?.connected; },
};

module.exports = { start, api };
