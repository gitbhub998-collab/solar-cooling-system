'use strict';

// SQLite driver (default). One file, no server, survives restarts.

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');

const file = config.databaseUrl.replace(/^sqlite:\/\//, '');
fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
const db = new Database(file);
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  panel TEXT NOT NULL,
  temperature REAL, voltage REAL, current REAL, power REAL
);
CREATE INDEX IF NOT EXISTS idx_readings_dev_ts ON readings(device_id, ts DESC);
CREATE TABLE IF NOT EXISTS env (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  ambient_temp REAL, battery_voltage REAL, battery_pct REAL
);
CREATE INDEX IF NOT EXISTS idx_env_dev_ts ON env(device_id, ts DESC);
CREATE TABLE IF NOT EXISTS commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  fan INTEGER, pump INTEGER, source TEXT
);
CREATE INDEX IF NOT EXISTS idx_commands_dev_ts ON commands(device_id, ts DESC);
`);

const insReading = db.prepare(
  'INSERT INTO readings (device_id, ts, panel, temperature, voltage, current, power) VALUES (?,?,?,?,?,?,?)');
const insEnv = db.prepare(
  'INSERT INTO env (device_id, ts, ambient_temp, battery_voltage, battery_pct) VALUES (?,?,?,?,?)');
const insCommand = db.prepare(
  'INSERT INTO commands (device_id, ts, fan, pump, source) VALUES (?,?,?,?,?)');

module.exports = {
  kind: 'sqlite',

  insertReading: (deviceId, ts, panel, r) =>
    insReading.run(deviceId, ts, panel, r.temperature ?? null, r.voltage ?? null, r.current ?? null, r.power ?? null),

  insertEnvironment: (deviceId, ts, ambient, battery) =>
    insEnv.run(deviceId, ts, ambient ?? null, battery?.voltage ?? null, battery?.percentage ?? null),

  logCommand: (deviceId, ts, fan, pump, source) =>
    insCommand.run(deviceId, ts, fan, pump, source),

  // Latest full snapshot, reassembled for the dashboard
  latest(deviceId) {
    const panels = {};
    for (const row of db.prepare(`
      SELECT r.* FROM readings r
      JOIN (SELECT panel, MAX(ts) mts FROM readings WHERE device_id=? GROUP BY panel) m
        ON r.panel=m.panel AND r.ts=m.mts AND r.device_id=?`).all(deviceId, deviceId)) {
      panels[row.panel] = { temperature: row.temperature, voltage: row.voltage, current: row.current, power: row.power };
    }
    const env = db.prepare('SELECT * FROM env WHERE device_id=? ORDER BY ts DESC LIMIT 1').get(deviceId);
    const cmd = db.prepare('SELECT * FROM commands WHERE device_id=? ORDER BY ts DESC LIMIT 1').get(deviceId);
    const ts = Math.max(0, ...Object.values(panels).length
      ? [db.prepare('SELECT MAX(ts) t FROM readings WHERE device_id=?').get(deviceId).t || 0] : [0], env?.ts || 0);
    return {
      deviceId, ts,
      panels,
      ambient: env ? { temperature: env.ambient_temp } : null,
      battery: env ? { voltage: env.battery_voltage, percentage: env.battery_pct } : null,
      controls: cmd ? { fan: cmd.fan, pump: cmd.pump } : null,
    };
  },

  readings({ deviceId, panel, from, to, limit = 500 }) {
    let q = 'SELECT ts, panel, temperature, voltage, current, power FROM readings WHERE device_id=?';
    const args = [deviceId];
    if (panel) { q += ' AND panel=?'; args.push(panel); }
    if (from)  { q += ' AND ts>=?';  args.push(from); }
    if (to)    { q += ' AND ts<=?';  args.push(to); }
    q += ' ORDER BY ts DESC LIMIT ?'; args.push(Math.min(limit, 10000));
    return db.prepare(q).all(...args).reverse();
  },

  stats(deviceId, hours = 24) {
    const since = Date.now() - hours * 3600e3;
    return db.prepare(`
      SELECT panel,
             COUNT(*) samples,
             ROUND(AVG(temperature),2) avg_temp, ROUND(MAX(temperature),2) max_temp, ROUND(MIN(temperature),2) min_temp,
             ROUND(AVG(power),2) avg_power, ROUND(SUM(power)*2.0/3600.0,2) energy_wh
      FROM readings WHERE device_id=? AND ts>=? GROUP BY panel`).all(deviceId, since);
  },

  devices() {
    return db.prepare(`
      SELECT device_id, MAX(ts) last_seen, COUNT(*) readings FROM readings GROUP BY device_id ORDER BY last_seen DESC`).all();
  },

  commands(deviceId, limit = 50) {
    return db.prepare('SELECT ts, fan, pump, source FROM commands WHERE device_id=? ORDER BY ts DESC LIMIT ?')
      .all(deviceId, limit);
  },
};
