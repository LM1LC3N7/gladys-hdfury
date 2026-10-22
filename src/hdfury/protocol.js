// -----------------------------------------------------------------------------
// The HTTP API of the HDFury boxes (VRRoom, Vertex2, Diva, Arcana...), ported
// from the `hdfury` library (glenndehaan/python-hdfury 1.6.1, MIT, see
// THIRD_PARTY_NOTICES.md), the one behind the Home Assistant HDFury
// integration:
//
//   GET /ssi/brdinfo.ssi        board: hostname, serial, version ("FW: 0.61"), pcbv
//   GET /ssi/infopage.ssi       live info: opmode, portseltx0/1, RX0, TX0, AUDOUT...
//   GET /cmd?<name>=<value>     a command: reboot, hotplug, opmode, insel ("<tx0> <tx1>")
//
// Pure functions: everything the box sends is untrusted. Only the fields
// listed here are read (`Object.hasOwn`), bounded and stripped of control
// characters; codes are mapped through fixed tables.
// -----------------------------------------------------------------------------

import { LIMITS } from '../constants.js';

export const PATHS = Object.freeze({
  BOARD: '/ssi/brdinfo.ssi',
  INFO: '/ssi/infopage.ssi',
});

/** The operation modes of the VRRoom (the reference library's OPERATION_MODES). */
export const OPERATION_MODES = Object.freeze([
  { value: 'mode0', code: '0', label: 'Mode 0 - Splitter TX0/TX1 FRL5 VRR' },
  { value: 'mode1', code: '1', label: 'Mode 1 - Splitter TX0/TX1 UPSCALE FRL5' },
  { value: 'mode2', code: '2', label: 'Mode 2 - Matrix TMDS' },
  { value: 'mode3', code: '3', label: 'Mode 3 - Matrix FRL->TMDS' },
  { value: 'mode4', code: '4', label: 'Mode 4 - Matrix DOWNSCALE' },
  { value: 'mode5', code: '5', label: 'Mode 5 - Matrix RX0:FRL5 + RX1-3:TMDS' },
]);

const inputs = (copy) =>
  Object.freeze([
    { value: 'input0', code: '0', label: 'Input 0' },
    { value: 'input1', code: '1', label: 'Input 1' },
    { value: 'input2', code: '2', label: 'Input 2' },
    { value: 'input3', code: '3', label: 'Input 3' },
    { value: copy.value, code: '4', label: copy.label },
  ]);

/** The inputs of each output (the reference library's TX0_INPUT_PORTS / TX1_INPUT_PORTS). */
export const TX0_INPUTS = inputs({ value: 'copy_tx1', label: 'Copy TX1' });
export const TX1_INPUTS = inputs({ value: 'copy_tx0', label: 'Copy TX0' });

/** The read-only texts of the info page: key in the answer -> feature key. */
export const INFO_TEXTS = Object.freeze({
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

/** The info page keys that give a dropdown. */
export const INFO_SELECTS = Object.freeze({
  opmode: 'operation_mode',
  portseltx0: 'input_tx0',
  portseltx1: 'input_tx1',
});

/** The answer must be a plain JSON object; nothing else is read. */
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const field = (record, key) =>
  isRecord(record) && Object.hasOwn(record, key) ? record[key] : undefined;

/** A text of the box: printable, single spaces, `max` characters at most; undefined when empty. */
export function cleanText(raw, max = LIMITS.text) {
  if (typeof raw !== 'string' && !(typeof raw === 'number' && Number.isFinite(raw))) {
    return undefined;
  }
  const text = String(raw)
    .slice(0, max * 4)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
    .trim();
  return text === '' ? undefined : text;
}

/** The serial number as an external id: 4 to 32 letters or digits, lowercased. */
export function parseSerial(raw) {
  const text = typeof raw === 'number' && Number.isSafeInteger(raw) ? String(raw) : raw;
  if (typeof text !== 'string') {
    return undefined;
  }
  const serial = text.trim();
  return /^[A-Za-z0-9]{4,32}$/.test(serial) ? serial.toLowerCase() : undefined;
}

/** A code of the box: a single digit, as a string. */
const parseCode = (raw) => {
  const text = typeof raw === 'number' && Number.isInteger(raw) ? String(raw) : raw;
  return typeof text === 'string' && /^\d$/.test(text.trim()) ? text.trim() : undefined;
};

/**
 * The board page.
 * @returns {{ serial?: string, hostname?: string, model?: string, firmware?: string }}
 */
export function parseBoard(answer) {
  if (!isRecord(answer)) {
    return {};
  }
  const hostname = cleanText(field(answer, 'hostname'), 40);
  const safeHostname = hostname && /^[\w .-]{1,40}$/.test(hostname) ? hostname : undefined;
  const firmware = cleanText(field(answer, 'version'), 40)?.replace(/^FW:\s*/i, '');
  return {
    serial: parseSerial(field(answer, 'serial')),
    hostname: safeHostname,
    // As Home Assistant: the model is the hostname before its first dash ("VRROOM-02").
    model: safeHostname?.split('-')[0] || undefined,
    firmware: firmware && /^[\w .()-]{1,40}$/.test(firmware) ? firmware : undefined,
  };
}

/**
 * The info page: its texts by feature key, the codes of its dropdowns, and
 * the keys it holds (they decide which features a box offers).
 * @returns {{ texts: Record<string, string>, codes: Record<string, string>, keys: string[] }}
 */
export function parseInfo(answer) {
  const texts = Object.create(null);
  const codes = Object.create(null);
  const keys = [];
  if (!isRecord(answer)) {
    return { texts, codes, keys };
  }
  for (const [name, feature] of Object.entries(INFO_TEXTS)) {
    if (Object.hasOwn(answer, name)) {
      keys.push(feature);
      const text = cleanText(answer[name]);
      if (text !== undefined) {
        texts[feature] = text;
      }
    }
  }
  for (const [name, feature] of Object.entries(INFO_SELECTS)) {
    if (Object.hasOwn(answer, name)) {
      keys.push(feature);
      const code = parseCode(answer[name]);
      if (code !== undefined) {
        codes[feature] = code;
      }
    }
  }
  return { texts, codes, keys };
}

/** The options of a dropdown feature. */
export const SELECT_OPTIONS = Object.freeze({
  operation_mode: OPERATION_MODES,
  input_tx0: TX0_INPUTS,
  input_tx1: TX1_INPUTS,
});

/** The option value of a code read from the box, or undefined. */
export const optionOf = (feature, code) =>
  (SELECT_OPTIONS[feature] ?? []).find((o) => o.code === code)?.value;

/** The code of an option value asked by Gladys, or undefined. */
export const codeOf = (feature, value) =>
  (SELECT_OPTIONS[feature] ?? []).find((o) => o.value === value)?.code;

/**
 * The path of a command (`/cmd?<name>=<value>`), as the reference library
 * builds it: the value of `insel` holds a space, sent as `%20`. Only the
 * commands used here, with single-digit values.
 */
export function commandPath(name, value = '') {
  const allowed = {
    reboot: /^$/,
    hotplug: /^$/,
    opmode: /^\d$/,
    insel: /^\d \d$/,
  };
  if (!Object.hasOwn(allowed, name) || !allowed[name].test(value)) {
    throw new Error(`Command ${String(name).slice(0, 16)} refused`);
  }
  return `/cmd?${name}=${value.replace(' ', '%20')}`;
}
