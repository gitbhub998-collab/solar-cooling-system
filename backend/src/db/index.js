'use strict';

/**
 * Storage layer.
 *
 * One interface, two drivers:
 *   - SQLite (default, zero setup, file-based)         -> sqlite://./data/solarcool.db
 *   - PostgreSQL (managed hosting, e.g. Render/Railway) -> postgres://user:pass@host/db
 *
 * Everything is keyed by device_id, and readings carry a free-form `panel`
 * label, so adding panels or sensors never needs a schema change:
 * a new key in the ESP32 JSON payload becomes a new row with a new label.
 *
 * Tables
 *   readings  (device_id, ts, panel, temperature, voltage, current, power)
 *   env       (device_id, ts, ambient_temp, battery_voltage, battery_pct)
 *   commands  (device_id, ts, fan, pump, source)
 */

const url = require('../config').databaseUrl;
const driver = url.startsWith('postgres') ? require('./postgres') : require('./sqlite');

module.exports = driver;
