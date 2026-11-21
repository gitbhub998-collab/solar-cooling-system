'use strict';

// PostgreSQL driver — selected when DATABASE_URL starts with postgres://.
// `pg` is an optional dependency; it is only required when this driver is used.

const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
});

const ready = pool.query(`
CREATE TABLE IF NOT EXISTS readings (
  id BIGSERIAL PRIMARY KEY,
  device_id TEXT NOT NULL,
  ts BIGINT NOT NULL,
  panel TEXT NOT NULL,
  temperature DOUBLE PRECISION, voltage DOUBLE PRECISION, current DOUBLE PRECISION, power DOUBLE PRECISION
);
CREATE INDEX IF NOT EXISTS idx_readings_dev_ts ON readings(device_id, ts DESC);
CREATE TABLE IF NOT EXISTS env (
  id BIGSERIAL PRIMARY KEY,
  device_id TEXT NOT NULL,
  ts BIGINT NOT NULL,
  ambient_temp DOUBLE PRECISION, battery_voltage DOUBLE PRECISION, battery_pct DOUBLE PRECISION
);
CREATE INDEX IF NOT EXISTS idx_env_dev_ts ON env(device_id, ts DESC);
CREATE TABLE IF NOT EXISTS commands (
  id BIGSERIAL PRIMARY KEY,
  device_id TEXT NOT NULL,
  ts BIGINT NOT NULL,
  fan INTEGER, pump INTEGER, source TEXT
);
CREATE INDEX IF NOT EXISTS idx_commands_dev_ts ON commands(device_id, ts DESC);
`).catch(err => { console.error('DB init failed:', err.message); process.exit(1); });

module.exports = {
  kind: 'postgres',
  ready,

  insertReading: (deviceId, ts, panel, r) =>
    pool.query('INSERT INTO readings (device_id, ts, panel, temperature, voltage, current, power) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [deviceId, ts, panel, r.temperature ?? null, r.voltage ?? null, r.current ?? null, r.power ?? null]),

  insertEnvironment: (deviceId, ts, ambient, battery) =>
    pool.query('INSERT INTO env (device_id, ts, ambient_temp, battery_voltage, battery_pct) VALUES ($1,$2,$3,$4,$5)',
      [deviceId, ts, ambient ?? null, battery?.voltage ?? null, battery?.percentage ?? null]),

  logCommand: (deviceId, ts, fan, pump, source) =>
    pool.query('INSERT INTO commands (device_id, ts, fan, pump, source) VALUES ($1,$2,$3,$4,$5)',
      [deviceId, ts, fan, pump, source]),

  async latest(deviceId) {
    const panels = {};
    const pr = await pool.query(`
      SELECT DISTINCT ON (panel) panel, temperature, voltage, current, power
      FROM readings WHERE device_id=$1 ORDER BY panel, ts DESC`, [deviceId]);
    for (const row of pr.rows) {
      panels[row.panel] = { temperature: row.temperature, voltage: row.voltage, current: row.current, power: row.power };
    }
    const env = (await pool.query('SELECT * FROM env WHERE device_id=$1 ORDER BY ts DESC LIMIT 1', [deviceId])).rows[0];
    const cmd = (await pool.query('SELECT * FROM commands WHERE device_id=$1 ORDER BY ts DESC LIMIT 1', [deviceId])).rows[0];
    const tsr = (await pool.query('SELECT MAX(ts) t FROM readings WHERE device_id=$1', [deviceId])).rows[0];
    return {
      deviceId, ts: Math.max(Number(tsr?.t) || 0, env?.ts || 0),
      panels,
      ambient: env ? { temperature: env.ambient_temp } : null,
      battery: env ? { voltage: env.battery_voltage, percentage: env.battery_pct } : null,
      controls: cmd ? { fan: cmd.fan, pump: cmd.pump } : null,
    };
  },

  async readings({ deviceId, panel, from, to, limit = 500 }) {
    let q = 'SELECT ts, panel, temperature, voltage, current, power FROM readings WHERE device_id=$1';
    const args = [deviceId];
    if (panel) { args.push(panel); q += ` AND panel=$${args.length}`; }
    if (from)  { args.push(from);  q += ` AND ts>=$${args.length}`; }
    if (to)    { args.push(to);    q += ` AND ts<=$${args.length}`; }
    args.push(Math.min(limit, 10000));
    q += ` ORDER BY ts DESC LIMIT $${args.length}`;
    return (await pool.query(q, args)).rows.reverse();
  },

  async stats(deviceId, hours = 24) {
    const since = Date.now() - hours * 3600e3;
    return (await pool.query(`
      SELECT panel, COUNT(*)::int samples,
             ROUND(AVG(temperature)::numeric,2) avg_temp, ROUND(MAX(temperature)::numeric,2) max_temp,
             ROUND(MIN(temperature)::numeric,2) min_temp, ROUND(AVG(power)::numeric,2) avg_power,
             ROUND((SUM(power)*2.0/3600.0)::numeric,2) energy_wh
      FROM readings WHERE device_id=$1 AND ts>=$2 GROUP BY panel`, [deviceId, since])).rows;
  },

  async devices() {
    return (await pool.query(
      'SELECT device_id, MAX(ts) last_seen, COUNT(*)::int readings FROM readings GROUP BY device_id ORDER BY last_seen DESC')).rows;
  },

  async commands(deviceId, limit = 50) {
    return (await pool.query('SELECT ts, fan, pump, source FROM commands WHERE device_id=$1 ORDER BY ts DESC LIMIT $2',
      [deviceId, limit])).rows;
  },
};
