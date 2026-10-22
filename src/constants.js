// -----------------------------------------------------------------------------
// Frozen keys (external ids, features, manifest actions), limits and timings.
// Every key here is stored by Gladys or by its users: never rename one.
// -----------------------------------------------------------------------------

/**
 * `gladys.externalIds(DEVICE_TYPE, <serial number of the box>)`: the `serial`
 * of `/ssi/brdinfo.ssi` (Home Assistant's unique id), lowercased, letters and
 * digits only. A box whose serial is unreadable is not added.
 */
export const DEVICE_TYPE = 'hdfury';

export const FEATURES = Object.freeze({
  /** Read only: 1 when the box answered the last read, 0 otherwise. */
  ONLINE: 'online',
  /** Dropdown: the operation mode (`opmode`, VRRoom). */
  OPERATION_MODE: 'operation_mode',
  /** Dropdown: the input routed to the TX0 output (`portseltx0`). */
  INPUT_TX0: 'input_tx0',
  /** Dropdown: the input routed to the TX1 output (`portseltx1`). */
  INPUT_TX1: 'input_tx1',
  /** Push button: HDMI hotplug (the sources and displays handshake again). */
  HOTPLUG: 'hotplug',
  /** Push button: reboot the box. Refused unless "Allow rebooting" is on. */
  REBOOT: 'reboot',
  // Read-only texts of /ssi/infopage.ssi (the sensors of Home Assistant).
  RX0: 'rx0',
  RX1: 'rx1',
  TX0: 'tx0',
  TX1: 'tx1',
  AUD0: 'aud0',
  AUD1: 'aud1',
  AUDOUT: 'audout',
  EARCRX: 'earcrx',
  SINK0: 'sink0',
  SINK1: 'sink1',
  SINK2: 'sink2',
  EDIDA0: 'edida0',
  EDIDA1: 'edida1',
  EDIDA2: 'edida2',
});

export const ACTIONS = Object.freeze({
  CHECK: 'check_boxes',
});

export const DEFAULT_PORT = 80;

export const POLL_INTERVAL = Object.freeze({ min: 15, max: 600, default: 30 });

export const TIMINGS = Object.freeze({
  /** One HTTP request of a background read (the reference library: 10 s; a LAN box answers fast). */
  requestTimeout: 4_000,
  /** One background read of a box (board, then info page), waits included. */
  pollBudget: 10_000,
  /**
   * Gladys waits 5 s for the ack of a command: the whole command (wait in the
   * queue, reads just before, the command) gets `commandBudget`, the reads
   * before `preRead` of it.
   */
  commandBudget: 3_500,
  preRead: 1_800,
  /** The reference library waits 2 s after a command before reading the box again. */
  debounce: 2_000,
  /** After a command, the box is read again this much later (after the debounce). */
  recheckDelay: 2_500,
  /** After a reboot, the box is read again this much later. */
  rebootRecheck: 45_000,
  /** Two reboots of a box are at least this far apart. */
  rebootSpacing: 120_000,
  /** A typed address where no box answered yet is asked again at most this often. */
  probeRetry: 60_000,
  /** The time of the last read attempt is written to /data at most this often. */
  attemptPersist: 60_000,
  /** Writes to /data are grouped. */
  persistDelay: 1_000,
  /** A box read less than `pollInterval - readTolerance` ago is not read again. */
  readTolerance: 1_000,
});

export const LIMITS = Object.freeze({
  boxes: 10,
  addresses: 10,
  /** Bytes read at most from one answer (the info page is a few hundred bytes). */
  responseBytes: 32 * 1024,
  /** Characters kept from one text value of the box. */
  text: 200,
  /** States published per minute by the integration, all boxes (the core allows 300). */
  statesPerMinute: 240,
});
