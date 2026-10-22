// -----------------------------------------------------------------------------
// The integration: the HDFury boxes it knows (typed addresses, identified by
// their serial number), the Gladys devices built from them, the polling (the
// board page then the info page, one box at a time per address, never faster
// than the refresh interval, restarts and buttons included), the commands
// (validated before anything is queued, serialized per box, the identity of
// the box read again just before acting, each answered within the 5 s Gladys
// waits for its ack) and the "Check the boxes" button. index.js only wires
// the SDK handlers to it (src/handlers.js).
//
// Reboot is a push button, refused unless the "Allow rebooting the boxes"
// option is on (checked when asked and again just before sending), at most
// one per box every 2 minutes. No switch anywhere.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { addressKey, normalizeConfig } from './config.js';
import { DEVICE_TYPE, FEATURES, LIMITS, TIMINGS } from './constants.js';
import { ERROR_KINDS, HdfuryError, request, requestJson } from './hdfury/client.js';
import {
  INFO_SELECTS,
  PATHS,
  codeOf,
  commandPath,
  parseBoard,
  parseInfo,
} from './hdfury/protocol.js';
import { T } from './i18n.js';
import { CAP_KEYS, buildDevice, deviceName, featureKey, stateList } from './model.js';
import { FileStore, emptyData, isSerial } from './store.js';

const NOTHING_SENT = 'nothing sent';
const SENT_UNCONFIRMED = 'Sent, without confirmation from the box';
const short = (value) => String(value).slice(0, 32);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/** Queue priorities: the commands first, then the background reads. */
const PRIORITY = Object.freeze({ COMMAND: 0, BACKGROUND: 1 });

const SELECT_FEATURES = new Set(Object.values(INFO_SELECTS));

/** An error of a command, in words that say whether it may have reached the box. */
function commandError(err) {
  if (err?.sent) {
    return new HdfuryError(ERROR_KINDS.TIMEOUT, SENT_UNCONFIRMED, { sent: true });
  }
  const message = String(err?.message ?? err);
  return message.includes(NOTHING_SENT) || message.startsWith('The box answered')
    ? err
    : new HdfuryError(err?.kind ?? ERROR_KINDS.INVALID, `${message}: ${NOTHING_SENT}`);
}

/** Changed since the epoch was taken, or the box moved: what was read is dropped. */
class Stale extends Error {}

export class HdfuryApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'hdfury' }),
    store = new FileStore(),
    now = Date.now,
    timers = globalThis,
    timings = TIMINGS,
    http = { request, requestJson },
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.store = store;
    this.now = now;
    this.timers = timers;
    this.timings = timings;
    this.http = http;
    this.config = normalizeConfig();
    this.data = undefined;
    /** serial -> null (not reachable) | undefined (unknown) | { texts, codes } */
    this.readings = new Map();
    /** serial -> time of the last read attempt (this run) */
    this.readAt = new Map();
    /** serial -> time of the last command written to the box */
    this.lastCommandAt = new Map();
    /** queue key -> { running, items } */
    this.queues = new Map();
    /** serials of the devices created in Gladys */
    this.created = new Set();
    this.createdStale = false;
    /** addressKey -> time of the last probe of a typed address */
    this.probes = new Map();
    /** addressKey -> kind of the last probe failure ('no_serial' or an error kind) */
    this.probeErrors = new Map();
    /** serials with a background read queued */
    this.readQueued = new Set();
    /** feature external id -> last value Gladys accepted from us */
    this.sentStates = new Map();
    /** times of the states sent in the last minute (all boxes) */
    this.stateWindow = [];
    this.attemptSavedAt = -Infinity;
    this.restoredAttempt = 0;
    this.loading = undefined;
    this.rounding = undefined;
    this.pollTimer = undefined;
    this.pollTimerInterval = undefined;
    this.persistTimer = undefined;
    this.backgroundTimers = new Set();
    /** Bumped by stop() and by a change of the typed addresses: older reads publish nothing. */
    this.epoch = 0;
    this.lastStatus = undefined;
    this.warned = new Set();
    this.started = false;
  }

  // --- Lifecycle -------------------------------------------------------------

  /**
   * (Re)start with a configuration: on every connection to Gladys
   * (`connected`) and on every configuration save (`saved`). A connection
   * publishes again what is known (the core forgot it) without asking the
   * boxes; a save reads only what is due (a new address at once); a save of
   * an unchanged configuration reads nothing.
   */
  async start(raw = {}, { connected = false, saved = false } = {}) {
    const previous = this.config;
    this.config = normalizeConfig(raw);
    const addressesChanged =
      JSON.stringify(previous.addresses) !== JSON.stringify(this.config.addresses);
    const changed = addressesChanged || JSON.stringify(previous) !== JSON.stringify(this.config);
    if (addressesChanged && this.started) {
      this.epoch += 1;
    }
    this.started = true;
    // The round timer is kept while its interval does not change: frequent
    // reconnections to Gladys never starve the rounds.
    if (this.pollTimer === undefined || this.pollTimerInterval !== this.config.pollInterval) {
      this.timers.clearInterval(this.pollTimer);
      this.pollTimer = this.timers.setInterval(() => this.tick(), this.config.pollInterval * 1000);
      this.pollTimerInterval = this.config.pollInterval;
    }
    if (connected) {
      this.lastStatus = undefined;
      this.sentStates.clear();
      this.gladys.forgetPublishedStates?.();
    }
    let first = false;
    if (!this.data) {
      // Two starts at once (connected + configuration saved) share one load.
      const mine = !this.loading;
      this.loading ??= this.load();
      await this.loading;
      first = mine;
    }
    if (first) {
      // A restart reads nothing sooner than the interval after the last attempt.
      for (const address of this.config.addresses) {
        if (this.data.lastAttempt > 0) {
          this.probes.set(addressKey(address), this.data.lastAttempt);
        }
      }
      const wait = this.data.lastAttempt + this.config.pollInterval * 1000 - this.now();
      if (wait > 0) {
        this.later(() => this.tick(), wait + 50);
      }
    }
    await this.step('read the Gladys devices', () => this.refreshCreated());
    await this.step('publish the devices', () => this.publishDevices());
    await this.step('publish the states', () => this.publishAllStates());
    if (first || (saved && changed)) {
      await this.step('read the boxes', () => this.round());
    }
    await this.step('publish the status', () => this.updateStatus());
  }

  async load() {
    let data;
    try {
      data = await this.store.load({ now: this.now() });
    } catch {
      data = emptyData();
    }
    if (this.store.corrupted) {
      this.logger.warn('Unreadable /data/hdfury.json moved to hdfury.json.bad');
    }
    this.data = data;
    /** The last attempt of the previous run: boxes not read yet in this run wait an interval after it. */
    this.restoredAttempt = data.lastAttempt;
  }

  async step(name, task) {
    try {
      await task();
    } catch (err) {
      this.logger.warn(`Start: could not ${name}: ${err.message}`);
    }
  }

  stop() {
    this.started = false;
    this.epoch += 1;
    this.timers.clearInterval(this.pollTimer);
    this.pollTimer = undefined;
    this.pollTimerInterval = undefined;
    for (const handle of this.backgroundTimers) {
      this.timers.clearTimeout(handle);
    }
    this.backgroundTimers.clear();
    if (this.persistTimer) {
      this.timers.clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
      return this.store.save(this.data).catch(() => {});
    }
    return Promise.resolve();
  }

  tick() {
    if (!this.data || !this.started) {
      return Promise.resolve();
    }
    return this.round().catch((err) => this.logger.warn(`Polling failed: ${err.message}`));
  }

  /** One round: the created devices if unread, the typed addresses, the boxes due, the status. */
  round() {
    if (!this.rounding) {
      this.rounding = (async () => {
        if (this.createdStale) {
          await this.refreshCreated().catch(() => {});
        }
        if (await this.probeAddresses()) {
          await this.publishDevices().catch((err) =>
            this.logger.warn(`Could not publish the devices: ${err.message}`),
          );
        }
        await this.poll();
        await this.updateStatus();
      })().finally(() => {
        this.rounding = undefined;
      });
    }
    return this.rounding;
  }

  /** Background work, dropped by stop(). */
  later(task, ms) {
    const epoch = this.epoch;
    const handle = this.timers.setTimeout(() => {
      this.backgroundTimers.delete(handle);
      if (epoch === this.epoch && this.started) {
        Promise.resolve()
          .then(task)
          .catch((err) => this.logger.debug?.(`Background task failed: ${err.message}`));
      }
    }, ms);
    this.backgroundTimers.add(handle);
  }

  persist() {
    if (this.persistTimer) {
      return;
    }
    this.persistTimer = this.timers.setTimeout(() => {
      this.persistTimer = undefined;
      this.store
        .save(this.data)
        .catch((err) => this.logger.warn(`Could not save /data: ${err.message}`));
    }, this.timings.persistDelay);
  }

  /**
   * The time of a read attempt, written to /data BEFORE the read (at most
   * once per `attemptPersist`), so a restart never reads sooner than the
   * interval.
   */
  async markAttempt() {
    const now = this.now();
    this.data.lastAttempt = now;
    if (now - this.attemptSavedAt < this.timings.attemptPersist) {
      return;
    }
    this.attemptSavedAt = now;
    if (this.persistTimer) {
      this.timers.clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    try {
      await this.store.save(this.data);
    } catch (err) {
      this.logger.warn(`Could not save /data: ${err.message}`);
    }
  }

  warnOnce(key, message) {
    if (!this.warned.has(key)) {
      this.warned.add(key);
      this.logger.warn(message);
    }
  }

  /** The queue of one box: one request at a time, commands before background reads. */
  enqueue(key, task, priority) {
    let queue = this.queues.get(key);
    if (!queue) {
      queue = { running: false, items: [] };
      this.queues.set(key, queue);
    }
    return new Promise((resolve, reject) => {
      const item = { task, resolve, reject, priority };
      const index = queue.items.findIndex((i) => i.priority > priority);
      queue.items.splice(index === -1 ? queue.items.length : index, 0, item);
      this.drain(queue);
    });
  }

  async drain(queue) {
    if (queue.running) {
      return;
    }
    queue.running = true;
    while (queue.items.length > 0) {
      const item = queue.items.shift();
      try {
        item.resolve(await item.task());
      } catch (err) {
        item.reject(err);
      }
    }
    queue.running = false;
  }

  // --- Known boxes -------------------------------------------------------------

  get boxes() {
    return Object.values(this.data?.boxes ?? {});
  }

  boxOf(gladysDevice) {
    return this.boxes.find(
      (b) => this.gladys.externalIds(DEVICE_TYPE, b.serial).device === gladysDevice?.external_id,
    );
  }

  addressOf(box) {
    return Object.freeze({ host: box.host, port: box.port });
  }

  keyOf(box) {
    return addressKey(this.addressOf(box));
  }

  /** The queue of a box: its address (one box per address), or its own when it has none. */
  queueOf(box) {
    return box.host ? this.keyOf(box) : `lost:${box.serial}`;
  }

  /**
   * Remembers the box answering at `address` by its serial. Another box that
   * had this address lost it (DHCP): never commanded at an address that is
   * no longer its own.
   */
  remember(board, keys, address) {
    const serial = board.serial;
    if (!isSerial(serial)) {
      return undefined;
    }
    const table = this.data.boxes;
    let box = Object.hasOwn(table, serial) ? table[serial] : undefined;
    if (!box) {
      if (Object.keys(table).length >= LIMITS.boxes) {
        this.warnOnce('boxes', `More than ${LIMITS.boxes} boxes: the next ones are ignored`);
        return undefined;
      }
      box = { serial, host: '', port: address.port, caps: [], rebootAt: 0 };
      table[serial] = box;
      this.persist();
    }
    for (const other of this.boxes) {
      if (other.serial !== serial && other.host === address.host && other.port === address.port) {
        this.addressLost(other, address);
      }
    }
    if (box.host !== address.host || box.port !== address.port) {
      box.host = address.host;
      box.port = address.port;
      this.persist();
    }
    this.noteBoard(box, board);
    this.mergeCaps(box, keys);
    return box;
  }

  /** Hostname, model and firmware as the board page gives them. True when the name changed. */
  noteBoard(box, board) {
    let renamed = false;
    for (const key of ['hostname', 'model', 'firmware']) {
      if (board[key] && board[key] !== box[key]) {
        renamed ||= key === 'hostname';
        box[key] = board[key];
        this.persist();
      }
    }
    return renamed;
  }

  /** The features a box offers only grow. True when they grew. */
  mergeCaps(box, keys) {
    const caps = new Set(box.caps);
    const before = caps.size;
    for (const key of keys) {
      if (CAP_KEYS.includes(key)) {
        caps.add(key);
      }
    }
    if (caps.size === before) {
      return false;
    }
    box.caps = [...caps];
    this.persist();
    return true;
  }

  /**
   * The features of the device created in Gladys (`gladys.devices`, kept up
   * to date by the SDK), merged into the known box: features seen before a
   * reset of /data are never dropped.
   */
  mergeCreatedCaps(box) {
    const externalId = this.gladys.externalIds(DEVICE_TYPE, box.serial).device;
    const created = (Array.isArray(this.gladys.devices) ? this.gladys.devices : []).find(
      (d) => d?.external_id === externalId,
    );
    const keys = (Array.isArray(created?.features) ? created.features : [])
      .map((f) => featureKey(externalId, f?.external_id))
      .filter((key) => key !== undefined);
    this.mergeCaps(box, keys);
  }

  /** Its address went to another box (DHCP): never read nor commanded there again. */
  addressLost(box, address) {
    this.logger.warn(`${deviceName(box)}: another box answers at ${addressKey(address)}`);
    box.host = '';
    this.readings.set(box.serial, null);
    this.persist();
    this.probes.delete(addressKey(address));
    this.publishStates(box).catch(() => {});
  }

  async publishDevices() {
    if (!this.data) {
      return;
    }
    const boxes = this.boxes;
    boxes.forEach((b) => this.mergeCreatedCaps(b));
    await this.gladys.publishDiscoveredDevices(boxes.map((b) => buildDevice(this.gladys, b)));
  }

  /**
   * The devices created in Gladys. When `getDevices` fails, the list the SDK
   * keeps (`gladys.devices`) is used, and the call is made again at every
   * round until it works.
   */
  async refreshCreated() {
    let list;
    try {
      list = await this.gladys.getDevices();
      this.createdStale = false;
    } catch (err) {
      this.createdStale = true;
      if (!Array.isArray(this.gladys.devices)) {
        throw err;
      }
      this.logger.warn(`Could not read the Gladys devices (${err.message}): using the last list`);
      list = this.gladys.devices;
    }
    const byExternalId = new Map(
      this.boxes.map((b) => [this.gladys.externalIds(DEVICE_TYPE, b.serial).device, b.serial]),
    );
    this.created = new Set(
      (Array.isArray(list) ? list : [])
        .map((d) => byExternalId.get(d?.external_id))
        .filter(Boolean),
    );
  }

  // --- Reads ---------------------------------------------------------------------

  /** Throws Stale when the epoch moved or the box left `address` during an await. */
  checkFresh(epoch, box, address) {
    if (epoch !== this.epoch || (box && (box.host !== address.host || box.port !== address.port))) {
      throw new Stale('stale');
    }
  }

  /** Waits until the debounce after the last command of `serial` is over, before `until`. */
  async debounce(serial, until) {
    const wait = (this.lastCommandAt.get(serial) ?? -Infinity) + this.timings.debounce - this.now();
    if (wait <= 0) {
      return;
    }
    if (this.now() + wait >= until) {
      throw new HdfuryError(
        ERROR_KINDS.BUDGET,
        `The box is still busy with the previous command, ${NOTHING_SENT}`,
      );
    }
    await sleep(wait);
  }

  /** Board and info page of the box at `address`, before `until`. */
  async readPages(address, until, { epoch, box } = {}) {
    const board = parseBoard(
      await this.http.requestJson(address, PATHS.BOARD, { timeout: until - this.now() }),
    );
    this.checkFresh(epoch, box, address);
    if (box && board.serial && board.serial !== box.serial) {
      return { board, other: true };
    }
    if (this.now() >= until) {
      throw new HdfuryError(ERROR_KINDS.TIMEOUT, 'no time left for the info page');
    }
    const info = parseInfo(
      await this.http.requestJson(address, PATHS.INFO, { timeout: until - this.now() }),
    );
    this.checkFresh(epoch, box, address);
    return { board, info };
  }

  /** The typed addresses where no known box is: asked once, then every minute at most. */
  async probeAddresses() {
    let changed = false;
    const spacing = Math.max(this.timings.probeRetry, this.config.pollInterval * 1000);
    const due = this.config.addresses.filter((address) => {
      const key = addressKey(address);
      if (this.boxes.some((b) => b.host && this.keyOf(b) === key)) {
        this.probeErrors.delete(key);
        return false;
      }
      return !(this.now() - (this.probes.get(key) ?? -Infinity) < spacing);
    });
    if (due.length === 0) {
      return false;
    }
    await this.markAttempt();
    const epoch = this.epoch;
    await Promise.all(
      due.map(async (address) => {
        const key = addressKey(address);
        this.probes.set(key, this.now());
        try {
          const { board, info } = await this.enqueue(
            key,
            () => this.readPages(address, this.now() + this.timings.pollBudget, { epoch }),
            PRIORITY.BACKGROUND,
          );
          if (!board.serial) {
            this.probeErrors.set(key, 'no_serial');
            this.warnOnce(
              `serial:${key}`,
              `${key}: a box answers, its serial number is unreadable`,
            );
            return;
          }
          const box = this.remember(board, info.keys, address);
          this.probeErrors.delete(key);
          if (box) {
            changed = true;
            // What the probe read is the first reading: no second read for it.
            this.readings.set(box.serial, { texts: info.texts, codes: info.codes });
            this.readAt.set(box.serial, this.now());
            this.logger.info(`${deviceName(box)} found at ${key}`);
            await this.publishStates(box);
          }
        } catch (err) {
          if (err instanceof Stale) {
            return;
          }
          this.probeErrors.set(key, err.kind ?? ERROR_KINDS.INVALID);
          this.logger.debug?.(`${key}: ${err.message}`);
        }
      }),
    );
    return changed;
  }

  /** True when the box was not read for an interval (memory, else /data after a restart). */
  isDue(box) {
    const last = this.readAt.get(box.serial) ?? this.restoredAttempt;
    return this.now() - last >= this.config.pollInterval * 1000 - this.timings.readTolerance;
  }

  async poll() {
    const due = this.boxes.filter((b) => this.created.has(b.serial) && b.host && this.isDue(b));
    if (due.length === 0) {
      return;
    }
    await this.markAttempt();
    await Promise.all(due.map((b) => this.queueRead(b)));
  }

  /** One background read of a box; one at most waiting per box. */
  queueRead(box) {
    if (this.readQueued.has(box.serial) || !box.host) {
      return Promise.resolve();
    }
    this.readQueued.add(box.serial);
    return this.enqueue(
      this.queueOf(box),
      () => {
        this.readQueued.delete(box.serial);
        return this.readBox(box);
      },
      PRIORITY.BACKGROUND,
    ).catch((err) => this.logger.debug?.(`${deviceName(box)}: ${err.message}`));
  }

  /**
   * Reads a box (from its queue): the board page (its serial must still be
   * this box's: DHCP), then the info page. A late answer (configuration
   * changed, box moved) publishes nothing.
   */
  async readBox(box) {
    if (!box.host) {
      return undefined;
    }
    const address = this.addressOf(box);
    const epoch = this.epoch;
    const until = this.now() + this.timings.pollBudget;
    this.readAt.set(box.serial, this.now());
    let reading;
    try {
      await this.debounce(box.serial, until);
      const pages = await this.readPages(address, until, { epoch, box });
      if (pages.other) {
        this.addressLost(box, address);
        await this.updateStatus();
        return null;
      }
      if (!pages.board.serial) {
        // Unreadable is no proof of another box: the address is kept.
        this.warnOnce(
          `noserial:${box.serial}`,
          `${deviceName(box)}: serial number not readable, its identity not checked then`,
        );
      }
      const renamed = this.noteBoard(box, pages.board);
      const grew = this.mergeCaps(box, pages.info.keys);
      if (renamed || grew) {
        await this.publishDevices().catch(() => {});
      }
      reading = { texts: pages.info.texts, codes: pages.info.codes };
    } catch (err) {
      if (err instanceof Stale) {
        return undefined;
      }
      this.logger.debug?.(`${deviceName(box)}: ${err.message}`);
      reading = null;
    }
    if (epoch !== this.epoch || box.host !== address.host || box.port !== address.port) {
      return undefined;
    }
    this.readings.set(box.serial, reading);
    await this.publishStates(box);
    await this.updateStatus();
    return reading;
  }

  // --- States ----------------------------------------------------------------------

  /**
   * The states of a box that changed since Gladys last accepted them, within
   * the budget of LIMITS.statesPerMinute for the whole integration (counted
   * before the request, so simultaneous publications share it). What does
   * not fit is published at a later read.
   */
  async publishStates(box) {
    if (!this.created.has(box.serial)) {
      return;
    }
    const changed = stateList(this.gladys, box, this.readings.get(box.serial)).filter((s) => {
      const value = s.text ?? s.state;
      return this.sentStates.get(s.device_feature_external_id) !== value;
    });
    if (changed.length === 0) {
      return;
    }
    const now = this.now();
    this.stateWindow = this.stateWindow.filter((t) => now - t < 60_000);
    const room = Math.max(0, LIMITS.statesPerMinute - this.stateWindow.length);
    const states = changed.slice(0, room);
    if (states.length < changed.length) {
      this.warnOnce('budget', `More than ${LIMITS.statesPerMinute} states a minute: some wait`);
    }
    if (states.length === 0) {
      return;
    }
    for (let i = 0; i < states.length; i += 1) {
      this.stateWindow.push(now);
    }
    try {
      await this.gladys.publishChangedStates(states);
      for (const s of states) {
        this.sentStates.set(s.device_feature_external_id, s.text ?? s.state);
      }
    } catch (err) {
      this.logger.warn(`Could not publish the states of ${deviceName(box)}: ${err.message}`);
    }
  }

  async publishAllStates() {
    for (const box of this.boxes) {
      await this.publishStates(box);
    }
  }

  /** The states Gladys holds for a box are forgotten (the SDK forgets them on create / update). */
  forgetStates(box) {
    const prefix = `${this.gladys.externalIds(DEVICE_TYPE, box.serial).device}:`;
    for (const key of this.sentStates.keys()) {
      if (key.startsWith(prefix)) {
        this.sentStates.delete(key);
      }
    }
  }

  // --- Commands --------------------------------------------------------------------

  /** Refusals of a reboot, checked when asked and again just before sending. */
  rebootRefusal(box) {
    if (!this.config.allowReboot) {
      return `Reboot is disabled in the configuration (option "Allow rebooting the boxes"), ${NOTHING_SENT}`;
    }
    if (box.rebootAt > 0 && this.now() - box.rebootAt < this.timings.rebootSpacing) {
      return `A reboot was sent to this box less than 2 minutes ago, ${NOTHING_SENT}`;
    }
    return undefined;
  }

  /** Validates a command before anything is queued or sent. */
  validate(box, key, value) {
    if (key === FEATURES.HOTPLUG) {
      return undefined;
    }
    if (key === FEATURES.REBOOT) {
      const refusal = this.rebootRefusal(box);
      if (refusal) {
        throw new Error(refusal);
      }
      return undefined;
    }
    if (SELECT_FEATURES.has(key)) {
      if (!box.caps.includes(key)) {
        throw new Error(`This box does not offer "${key}", ${NOTHING_SENT}`);
      }
      const code = typeof value === 'string' ? codeOf(key, value) : undefined;
      if (code === undefined) {
        throw new Error(`Unknown option "${short(value)}" for ${key}, ${NOTHING_SENT}`);
      }
      return code;
    }
    throw new Error(`Feature "${short(key)}" cannot be commanded, ${NOTHING_SENT}`);
  }

  async setValue(gladysDevice, feature, value) {
    const box = this.boxOf(gladysDevice);
    if (!box) {
      throw new Error(`Unknown box ${short(gladysDevice?.external_id)}, ${NOTHING_SENT}`);
    }
    const key = featureKey(gladysDevice.external_id, feature?.external_id);
    const code = this.validate(box, key, value);
    // The budget runs from the request of Gladys, the wait in the queue included.
    const started = this.now();
    let late = false;
    // Set just before the request leaves: from then on it may have reached the box.
    const context = { mayHaveSent: false };
    const run = this.enqueue(
      this.queueOf(box),
      async () => {
        if (late || this.remaining(started) < 50) {
          // Gladys stopped waiting while this command was queued: dropped, never sent late.
          late = true;
          throw new HdfuryError(
            ERROR_KINDS.BUDGET,
            `No time left for this command, ${NOTHING_SENT}`,
          );
        }
        try {
          return await this.command(box, key, code, started, context);
        } catch (err) {
          throw commandError(err);
        }
      },
      PRIORITY.COMMAND,
    );
    // Wall-clock deadline (not the injectable timers): the ack Gladys waits for.
    let timer;
    const deadline = new Promise((resolve, reject) => {
      timer = setTimeout(
        () => {
          late = true;
          reject(
            context.mayHaveSent
              ? new HdfuryError(ERROR_KINDS.TIMEOUT, SENT_UNCONFIRMED, { sent: true })
              : new HdfuryError(
                  ERROR_KINDS.BUDGET,
                  `No time left for this command (box busy), ${NOTHING_SENT}`,
                ),
          );
        },
        Math.max(0, this.remaining(started)) + 100,
      );
    });
    run.catch(() => {});
    try {
      return await Promise.race([run, deadline]);
    } finally {
      clearTimeout(timer);
    }
  }

  remaining(started) {
    return this.timings.commandBudget - (this.now() - started);
  }

  /**
   * One command, from the queue of the box: its board page read again (the
   * serial must be this box's), the info page for an input change (the other
   * output is sent back as it is), then the command, if time allows.
   */
  async command(box, key, code, started, context) {
    if (!box.host) {
      throw new HdfuryError(
        ERROR_KINDS.UNREACHABLE,
        `${deviceName(box)}: address unknown, type its new address in the configuration`,
      );
    }
    const address = this.addressOf(box);
    const epoch = this.epoch;
    const deadline = started + this.timings.commandBudget;
    const until = Math.min(deadline, this.now() + this.timings.preRead);
    await this.debounce(box.serial, until);
    let board;
    try {
      board = parseBoard(
        await this.http.requestJson(address, PATHS.BOARD, { timeout: until - this.now() }),
      );
    } catch (err) {
      throw new HdfuryError(err.kind, `Box not read before the command (${err.message})`);
    }
    this.checkCommandFresh(epoch, box, address);
    if (board.serial && board.serial !== box.serial) {
      this.addressLost(box, address);
      this.updateStatus().catch(() => {});
      throw new Error(`${deviceName(box)}: another box answers at its address, ${NOTHING_SENT}`);
    }
    if (!board.serial) {
      throw new Error(
        `${deviceName(box)}: serial number unreadable, identity not checked, ${NOTHING_SENT}`,
      );
    }
    let path;
    if (key === FEATURES.INPUT_TX0 || key === FEATURES.INPUT_TX1) {
      let info;
      try {
        info = parseInfo(
          await this.http.requestJson(address, PATHS.INFO, {
            timeout: Math.max(1, until - this.now()),
          }),
        );
      } catch (err) {
        throw new HdfuryError(err.kind, `Inputs not read before the command (${err.message})`);
      }
      this.checkCommandFresh(epoch, box, address);
      const tx0 = key === FEATURES.INPUT_TX0 ? code : info.codes[FEATURES.INPUT_TX0];
      const tx1 = key === FEATURES.INPUT_TX1 ? code : info.codes[FEATURES.INPUT_TX1];
      if (tx0 === undefined || tx1 === undefined) {
        throw new Error(`The input of the other output is unknown, ${NOTHING_SENT}`);
      }
      if (info.codes[key] === code) {
        return undefined;
      }
      path = commandPath('insel', `${tx0} ${tx1}`);
    } else if (key === FEATURES.OPERATION_MODE) {
      path = commandPath('opmode', code);
    } else if (key === FEATURES.HOTPLUG) {
      path = commandPath('hotplug');
    } else {
      path = commandPath('reboot');
    }
    // Just before the request: the option, the configuration and the deadline again.
    if (key === FEATURES.REBOOT) {
      const refusal = this.rebootRefusal(box);
      if (refusal) {
        throw new Error(refusal);
      }
    }
    this.checkCommandFresh(epoch, box, address);
    const left = deadline - this.now();
    if (left < 300) {
      throw new HdfuryError(ERROR_KINDS.BUDGET, `No time left for this command, ${NOTHING_SENT}`);
    }
    context.mayHaveSent = true;
    this.lastCommandAt.set(box.serial, this.now());
    if (key === FEATURES.REBOOT) {
      // The guard is set before the first byte, and kept in /data.
      box.rebootAt = this.now();
      this.persist();
    }
    try {
      await this.http.request(address, path, { timeout: left - 100 });
    } catch (err) {
      if (err.kind === ERROR_KINDS.HTTP) {
        throw new Error(`The box answered HTTP ${err.status} to the command`, { cause: err });
      }
      if (!err.sent) {
        context.mayHaveSent = false;
        if (key === FEATURES.REBOOT) {
          box.rebootAt = 0;
          this.persist();
        }
      }
      throw err;
    } finally {
      if (context.mayHaveSent) {
        this.later(
          () => this.queueRead(box),
          key === FEATURES.REBOOT ? this.timings.rebootRecheck : this.timings.recheckDelay,
        );
      }
    }
    this.logger.info(`${deviceName(box)}: ${key} sent`);
    return undefined;
  }

  checkCommandFresh(epoch, box, address) {
    try {
      this.checkFresh(epoch, box, address);
    } catch {
      throw new Error(`The configuration changed meanwhile, ${NOTHING_SENT}`);
    }
  }

  // --- Device lifecycle --------------------------------------------------------------

  /** A created (or updated) device: what is known is published again, nothing is read. */
  async deviceCreated(gladysDevice) {
    const box = this.boxOf(gladysDevice);
    if (!box) {
      return;
    }
    this.created.add(box.serial);
    this.forgetStates(box);
    await this.publishStates(box);
    await this.updateStatus();
  }

  async deviceDeleted(gladysDevice) {
    const box = this.boxOf(gladysDevice);
    if (box) {
      this.created.delete(box.serial);
      this.forgetStates(box);
      await this.updateStatus();
    }
  }

  // --- Configuration screen button -------------------------------------------------

  /**
   * Each known box: read now when it is due (that read is its round),
   * otherwise what the last read said, with its age: the button never reads
   * faster than the refresh interval.
   */
  async checkBoxes() {
    if (this.boxes.length === 0 && this.config.addresses.length === 0) {
      return T.noBox;
    }
    const lines = [];
    const due = this.boxes.filter((b) => b.host && this.isDue(b));
    if (due.length > 0) {
      await this.markAttempt();
      await Promise.all(due.map((b) => this.queueRead(b)));
    }
    for (const box of this.boxes) {
      const label = `${deviceName(box)} (${box.host ? this.keyOf(box) : '?'})`;
      if (!box.host) {
        lines.push(T.checkLine(label, { error: 'unknown_address' }));
        continue;
      }
      const reading = this.readings.get(box.serial);
      if (reading === null) {
        lines.push(T.checkLine(label, { error: 'unreachable' }));
      } else if (reading === undefined) {
        lines.push(T.checkLine(label, { unknown: true }));
      } else {
        const at = this.readAt.get(box.serial);
        lines.push(
          T.checkLine(label, {
            tx0: reading.texts?.tx0,
            ageSeconds: at === undefined ? undefined : Math.round((this.now() - at) / 1000),
          }),
        );
      }
    }
    for (const address of this.config.addresses) {
      const key = addressKey(address);
      if (!this.boxes.some((b) => b.host && this.keyOf(b) === key) && this.probeErrors.has(key)) {
        lines.push(T.checkLine(key, { error: 'unreachable' }));
      }
    }
    return lines.length === 0 ? T.noBox : T.check(lines, this.config.pollInterval);
  }

  // --- Status ---------------------------------------------------------------------

  async updateStatus() {
    if (!this.started || !this.data) {
      return;
    }
    const epoch = this.epoch;
    const notes = [];
    if (this.store.corrupted) {
      notes.push(T.dataReset);
    }
    if (this.config.invalid.length > 0) {
      notes.push(T.invalidEntries(this.config.invalid));
    }
    const typed = this.config.addresses
      .map(addressKey)
      .filter((key) => !this.boxes.some((b) => b.host && this.keyOf(b) === key));
    const noSerial = typed.filter((key) => this.probeErrors.get(key) === 'no_serial');
    const silent = typed.filter(
      (key) => this.probeErrors.has(key) && this.probeErrors.get(key) !== 'no_serial',
    );
    if (silent.length > 0) {
      notes.push(T.noAnswerAt(silent));
    }
    if (noSerial.length > 0) {
      notes.push(T.noSerialAt(noSerial));
    }
    const lost = this.boxes.filter((b) => this.created.has(b.serial) && !b.host);
    if (lost.length > 0) {
      notes.push(T.addressUnknown(lost.map(deviceName)));
    }
    const off = this.boxes
      .filter((b) => this.created.has(b.serial) && b.host && this.readings.get(b.serial) === null)
      .map(deviceName);
    if (off.length > 0) {
      notes.push(T.unreachable(off));
    }
    // A local integration without an account: "connected" means running.
    const status = { connected: true };
    if (notes.length > 0) {
      status.message = {
        en: notes.map((n) => n.en).join(' '),
        fr: notes.map((n) => n.fr).join(' '),
      };
    }
    const key = JSON.stringify(status);
    if (key === this.lastStatus || epoch !== this.epoch || !this.started) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.lastStatus = key;
    } catch (err) {
      this.logger.warn(`Could not publish the status: ${err.message}`);
    }
  }
}
