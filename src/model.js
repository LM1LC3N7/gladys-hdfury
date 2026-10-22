// -----------------------------------------------------------------------------
// Known boxes -> Gladys devices and states (pure). One Gladys device per box,
// keyed by its serial number (as Home Assistant): the address may change, the
// serial does not.
//
// Categories and types of the Gladys core only, no unit: `unknown/binary`
// (read only) for "Online", `text/select` for the operation mode and the
// inputs, `button/push` for "Hotplug" and "Reboot", `text/text` (read only)
// for the signal, audio and display texts. No switch: nothing an "everything
// off" (voice assistants, scenes) could turn into a reboot.
//
// The features of a box follow the keys its info page holds (a VRRoom has
// the dropdowns, a Diva or an Arcana fewer texts), as Home Assistant does;
// the set only grows (`caps`), so a device published again never loses one.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
} from '@gladysassistant/integration-sdk';
import { DEVICE_TYPE, FEATURES } from './constants.js';
import { INFO_TEXTS, SELECT_OPTIONS, optionOf } from './hdfury/protocol.js';

const text = (name) => ({
  name,
  category: C.TEXT,
  type: T.TEXT.TEXT,
  min: 0,
  max: 0,
  read_only: true,
});
const select = (name) => ({
  name,
  category: C.TEXT,
  type: T.TEXT.SELECT,
  min: 0,
  max: 0,
  has_feedback: true,
});
const button = (name) => ({ name, category: C.BUTTON, type: T.BUTTON.PUSH, min: 0, max: 1 });

/** The feature definitions, by frozen key, in their frozen order. */
export const FEATURE_SPECS = Object.freeze({
  [FEATURES.ONLINE]: {
    name: 'Online',
    category: C.UNKNOWN,
    type: T.SENSOR.BINARY,
    min: 0,
    max: 1,
    read_only: true,
    keep_history: true,
  },
  [FEATURES.OPERATION_MODE]: select('Operation mode'),
  [FEATURES.INPUT_TX0]: select('Input of TX0'),
  [FEATURES.INPUT_TX1]: select('Input of TX1'),
  [FEATURES.HOTPLUG]: button('Hotplug'),
  [FEATURES.REBOOT]: button('Reboot'),
  [FEATURES.RX0]: text('Input RX0 signal'),
  [FEATURES.RX1]: text('Input RX1 signal'),
  [FEATURES.TX0]: text('Output TX0 signal'),
  [FEATURES.TX1]: text('Output TX1 signal'),
  [FEATURES.AUD0]: text('Audio TX0'),
  [FEATURES.AUD1]: text('Audio TX1'),
  [FEATURES.AUDOUT]: text('Audio output'),
  [FEATURES.EARCRX]: text('eARC / ARC'),
  [FEATURES.SINK0]: text('Display TX0'),
  [FEATURES.SINK1]: text('Display TX1'),
  [FEATURES.SINK2]: text('Audio device'),
  [FEATURES.EDIDA0]: text('Audio formats TX0'),
  [FEATURES.EDIDA1]: text('Audio formats TX1'),
  [FEATURES.EDIDA2]: text('Audio formats audio output'),
});

/** The features every box has, whatever its info page holds. */
export const ALWAYS = Object.freeze([FEATURES.ONLINE, FEATURES.HOTPLUG, FEATURES.REBOOT]);

/** The features a box offers ("caps" are the feature keys seen in its info page). */
export function featureKeys(box) {
  const caps = new Set(Array.isArray(box.caps) ? box.caps : []);
  return Object.keys(FEATURE_SPECS).filter((key) => ALWAYS.includes(key) || caps.has(key));
}

/** Feature keys that may be caps (not the ones every box has). */
export const CAP_KEYS = Object.freeze(
  Object.keys(FEATURE_SPECS).filter((key) => !ALWAYS.includes(key)),
);

export function deviceName(box) {
  return box.hostname ? `HDFury ${box.hostname}` : `HDFury ${box.serial}`;
}

export function buildDevice(gladys, box) {
  const ids = gladys.externalIds(DEVICE_TYPE, box.serial);
  return {
    name: deviceName(box),
    external_id: ids.device,
    should_poll: false,
    params: [{ name: 'IP_ADDRESS', value: box.host || '' }],
    features: featureKeys(box).map((key) => {
      const { name, ...spec } = FEATURE_SPECS[key];
      return {
        name,
        external_id: ids.feature(key),
        read_only: false,
        has_feedback: false,
        keep_history: false,
        ...spec,
        ...(SELECT_OPTIONS[key]
          ? { supported_options: SELECT_OPTIONS[key].map(({ value, label }) => ({ value, label })) }
          : {}),
      };
    }),
  };
}

/** The feature key of a feature external id of `device`, or undefined. */
export function featureKey(deviceExternalId, featureExternalId) {
  const prefix = `${deviceExternalId}:`;
  return String(featureExternalId ?? '').startsWith(prefix)
    ? String(featureExternalId).slice(prefix.length)
    : undefined;
}

/**
 * The states of a reading. `reading` is null for a box that does not answer
 * (Online 0 only: the last texts stay as they were), undefined when nothing
 * is known (nothing published), else { texts, codes }.
 */
export function stateList(gladys, box, reading) {
  if (reading === undefined) {
    return [];
  }
  const ids = gladys.externalIds(DEVICE_TYPE, box.serial);
  const id = (key) => ids.feature(key);
  if (reading === null) {
    return [{ device_feature_external_id: id(FEATURES.ONLINE), state: 0 }];
  }
  const offered = new Set(featureKeys(box));
  const states = [{ device_feature_external_id: id(FEATURES.ONLINE), state: 1 }];
  for (const key of Object.keys(SELECT_OPTIONS)) {
    const value = optionOf(key, reading.codes?.[key]);
    if (offered.has(key) && value !== undefined) {
      states.push({ device_feature_external_id: id(key), text: value });
    }
  }
  for (const key of Object.values(INFO_TEXTS)) {
    const value = reading.texts?.[key];
    if (offered.has(key) && typeof value === 'string' && value !== '') {
      states.push({ device_feature_external_id: id(key), text: value });
    }
  }
  return states;
}
