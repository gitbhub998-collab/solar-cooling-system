'use strict';

/**
 * SolarCool backend — HTTP + WebSocket server.
 *
 * REST API
 *   GET  /api/health                      service + broker + db status
 *   GET  /api/devices                     known devices with last-seen
 *   GET  /api/latest?deviceId=            newest full snapshot (dashboard boot)
 *   GET  /api/readings?deviceId&panel&from&to&limit   history for charts/analysis
 *   GET  /api/stats?deviceId&hours=24     per-panel aggregates (avg/max/min temp, energy Wh)
 *   GET  /api/commands?deviceId           recent commands
 *   POST /api/commands  {deviceId, fan, pump}         -> MQTT to the ESP32
 *
 * WebSocket  /ws  — every new reading, device status change, and command is
 * pushed to all connected dashboards as JSON {type, deviceId, ...}.
 */

const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const { WebSocketServer } = require('ws');

const config = require('./config');
const db = require('./db');
const mqttBridge = require('./mqtt');

const app = express();
app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',') }));
app.use(express.json());

/* ---------------- REST ---------------- */

app.get('/api/health', (req, res) => {
  res.json({ ok: true, mqtt: mqttBridge.api.connected, db: db.kind, time: Date.now() });
});

app.get('/api/devices', async (req, res) => {
  res.json({ devices: await db.devices() });
});

app.get('/api/latest', async (req, res) => {
  const deviceId = req.query.deviceId || 'esp32-01';
  const snap = await db.latest(deviceId);
  if (!Object.keys(snap.panels).length) return res.status(404).json({ error: 'no data yet for this device' });
  res.json(snap);
});

app.get('/api/readings', async (req, res) => {
  const { deviceId = 'esp32-01', panel, from, to } = req.query;
  const limit = parseInt(req.query.limit || '500', 10);
  res.json({
    deviceId,
    readings: await db.readings({
      deviceId, panel,
      from: from ? Number(from) : undefined,
      to: to ? Number(to) : undefined,
      limit,
    }),
  });
});

app.get('/api/stats', async (req, res) => {
  const { deviceId = 'esp32-01' } = req.query;
  const hours = parseFloat(req.query.hours || '24');
  res.json({ deviceId, hours, stats: await db.stats(deviceId, hours) });
});

app.get('/api/commands', async (req, res) => {
  const { deviceId = 'esp32-01' } = req.query;
  res.json({ deviceId, commands: await db.commands(deviceId) });
});

app.post('/api/commands', async (req, res) => {
  const { deviceId = 'esp32-01', fan, pump } = req.body || {};
  for (const [k, v] of Object.entries({ fan, pump })) {
    if (typeof v !== 'number' || v < 0 || v > 100) {
      return res.status(400).json({ error: `${k} must be a number 0-100` });
    }
  }
  try {
    await mqttBridge.api.publishCommand(deviceId, Math.round(fan), Math.round(pump), req.body.source || 'dashboard');
    broadcast({ type: 'command', deviceId, fan, pump });
    res.json({ ok: true, deviceId, fan, pump });
  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

/* ---------------- WebSocket live feed ---------------- */

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const clients = new Set();

wss.on('connection', ws => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

function broadcast(event) {
  const data = JSON.stringify(event);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

mqttBridge.start(broadcast);

server.listen(config.port, () => {
  console.log(`SolarCool backend on :${config.port} (db=${db.kind}, mqtt=${config.mqtt.url})`);
});
