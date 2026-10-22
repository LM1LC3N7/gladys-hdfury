// -----------------------------------------------------------------------------
// What the integration keeps across restarts, in /data (the one writable
// volume, file mode 0600): the known boxes by serial number (address, port,
// hostname, model, firmware, the features their info page offers, the time
// of their last reboot sent from Gladys), and the time of the last read
// attempt (so a restart never reads sooner than the refresh interval).
//
// The serial numbers come from the network: only valid ones are keys, and
// the tables have no prototype.
// -----------------------------------------------------------------------------

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DEFAULT_PORT, LIMITS } from './constants.js';
import { CAP_KEYS } from './model.js';

export const emptyData = () => ({
  boxes: Object.create(null),
  lastAttempt: 0,
});

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
export const isSerial = (value) => typeof value === 'string' && /^[a-z0-9]{4,32}$/.test(value);
const name = (value, pattern) =>
  typeof value === 'string' && pattern.test(value) ? value : undefined;

/** Times read back are never in the future (a wrong clock never blocks a box). */
function sanitize(data, { now = Date.now() } = {}) {
  const base = emptyData();
  if (!isObject(data)) {
    return base;
  }
  const time = (value) => (Number.isFinite(value) && value > 0 ? Math.min(value, now) : 0);
  if (isObject(data.boxes)) {
    for (const [serial, box] of Object.entries(data.boxes).slice(0, LIMITS.boxes)) {
      if (!isSerial(serial) || !isObject(box) || box.serial !== serial) {
        continue;
      }
      base.boxes[serial] = {
        serial,
        host: typeof box.host === 'string' ? box.host.slice(0, 253) : '',
        port:
          Number.isInteger(box.port) && box.port > 0 && box.port < 65536 ? box.port : DEFAULT_PORT,
        hostname: name(box.hostname, /^[\w .-]{1,40}$/),
        model: name(box.model, /^[\w .]{1,40}$/),
        firmware: name(box.firmware, /^[\w .()-]{1,40}$/),
        caps: Array.isArray(box.caps)
          ? [...new Set(box.caps.filter((c) => CAP_KEYS.includes(c)))]
          : [],
        rebootAt: time(box.rebootAt),
      };
    }
  }
  base.lastAttempt = time(data.lastAttempt);
  return base;
}

export class FileStore {
  constructor({ dir = process.env.DATA_DIR || '/data', name: file = 'hdfury.json' } = {}) {
    this.dir = dir;
    this.path = join(dir, file);
    this.corrupted = false;
  }

  /**
   * The saved data. An unreadable file is moved aside to `hdfury.json.bad`
   * and `corrupted` is set, so the app says so instead of silently starting over.
   */
  async load(options) {
    let text;
    try {
      text = await readFile(this.path, 'utf8');
    } catch {
      return emptyData();
    }
    try {
      return sanitize(JSON.parse(text), options);
    } catch {
      this.corrupted = true;
      const bad = `${this.path}.bad`;
      await rename(this.path, bad).catch(() => {});
      await chmod(bad, 0o600).catch(() => {});
      return emptyData();
    }
  }

  async save(data) {
    await mkdir(this.dir, { recursive: true });
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, JSON.stringify(data), { mode: 0o600 });
    await rename(temporary, this.path);
  }
}

/** For the tests. */
export class MemoryStore {
  constructor(data = emptyData()) {
    this.data = JSON.parse(JSON.stringify(data));
    this.saves = 0;
    this.corrupted = false;
  }

  async load(options) {
    return sanitize(JSON.parse(JSON.stringify(this.data)), options);
  }

  async save(data) {
    // Through JSON, as the file store: what a restart would read back.
    this.data = JSON.parse(JSON.stringify(data));
    this.saves += 1;
  }
}

export { sanitize as sanitizeData };
