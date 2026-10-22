// -----------------------------------------------------------------------------
// HdfuryApp with the SDK's fake Gladys, the exact handlers of the container
// (src/handlers.js), a memory store and the fake box on the loopback
// interface. The polling timer never fires: the tests drive the rounds, and
// a clock offset makes a box due.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { HdfuryApp } from '../src/app.js';
import { TIMINGS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { MemoryStore } from '../src/store.js';
import { SERIAL, closedPort, startFakeBox } from './fixtures/fakeBox.js';

const SELECTOR = 'hdfury';
const id = (key, serial = SERIAL) => `ext:${SELECTOR}:hdfury:${serial}${key ? `:${key}` : ''}`;
const BOARD = '/ssi/brdinfo.ssi';
const INFO = '/ssi/infopage.ssi';

/** No polling round; real (short) background timers. */
const timers = {
  setInterval: () => 1,
  clearInterval: () => {},
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
};

const FAST = {
  ...TIMINGS,
  requestTimeout: 500,
  pollBudget: 1_500,
  commandBudget: 900,
  preRead: 500,
  debounce: 120,
  recheckDelay: 150,
  rebootRecheck: 200,
  persistDelay: 5,
  readTolerance: 0,
};

const INTERVAL = 30_000;

async function waitFor(predicate, what, timeout = 3_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`timed out waiting for ${what}`);
}

const settle = (ms = 80) => new Promise((resolve) => setTimeout(resolve, ms));

function makeClock() {
  const clock = { offset: 0 };
  clock.now = () => Date.now() + clock.offset;
  clock.advance = (ms) => {
    clock.offset += ms;
  };
  return clock;
}

async function setup(
  t,
  {
    fakeOptions,
    config,
    timings = {},
    store = new MemoryStore(),
    clock = makeClock(),
    box,
    devices,
  } = {},
) {
  const fake = box ?? (await startFakeBox(fakeOptions));
  t.after(() => fake.close());
  const gladys = createFakeGladys({
    selector: SELECTOR,
    ...(devices ? { devices } : {}),
    config: config ?? { addresses: `127.0.0.1:${fake.port}` },
  });
  const logs = [];
  const logger = Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(`${level} ${args.map((a) => a?.message ?? a).join(' ')}`),
    ]),
  );
  const app = new HdfuryApp({
    gladys,
    logger,
    store,
    timers,
    now: clock.now,
    timings: { ...FAST, ...timings },
  });
  registerHandlers(gladys, app, logger);
  t.after(() => app.stop());
  await gladys.connect();
  return { fake, gladys, app, logs, store, clock };
}

async function discovered(gladys, serial = SERIAL) {
  await waitFor(
    () => gladys.fake.discoveredDevices.some((d) => d.external_id === id(undefined, serial)),
    'the box in the Discovery tab',
  );
  return gladys.fake.discoveredDevices.find((d) => d.external_id === id(undefined, serial));
}

async function createDevice(gladys) {
  const device = await discovered(gladys);
  await gladys.fake.deviceCreated(device);
  await waitFor(() => gladys.fake.lastState(id('online')) !== undefined, 'the online state');
  return device;
}

const press = (gladys, device, key, value = 1) =>
  gladys.fake.setValue(
    device,
    device.features.find((f) => f.external_id === id(key)),
    value,
  );

test('a typed address becomes a Gladys device, identified by its serial; states from the probe', async (t) => {
  const { gladys, fake } = await setup(t);
  const device = await discovered(gladys);
  assert.equal(device.name, 'HDFury VRROOM-02');
  assert.deepEqual(device.params, [{ name: 'IP_ADDRESS', value: '127.0.0.1' }]);
  const keys = device.features.map((f) => f.external_id.slice(id().length + 1));
  assert.deepEqual(keys, [
    'online',
    'operation_mode',
    'input_tx0',
    'input_tx1',
    'hotplug',
    'reboot',
    'rx0',
    'rx1',
    'tx0',
    'tx1',
    'aud0',
    'aud1',
    'audout',
    'earcrx',
    'sink0',
    'sink1',
    'sink2',
    'edida0',
    'edida1',
    'edida2',
  ]);
  const byKey = Object.fromEntries(device.features.map((f) => [f.external_id.split(':').pop(), f]));
  // No switch, nothing an "everything off" could command.
  assert.ok(device.features.every((f) => f.category !== 'switch'));
  assert.ok(device.features.every((f) => f.unit === undefined));
  assert.deepEqual(
    [byKey.online.category, byKey.online.type, byKey.online.read_only],
    ['unknown', 'binary', true],
  );
  assert.deepEqual([byKey.reboot.category, byKey.reboot.type], ['button', 'push']);
  assert.deepEqual([byKey.hotplug.category, byKey.hotplug.type], ['button', 'push']);
  assert.deepEqual(
    [byKey.tx0.category, byKey.tx0.type, byKey.tx0.read_only],
    ['text', 'text', true],
  );
  assert.deepEqual(
    byKey.input_tx0.supported_options.map((o) => o.value),
    ['input0', 'input1', 'input2', 'input3', 'copy_tx1'],
  );
  assert.equal(byKey.operation_mode.supported_options.length, 6);
  assert.equal(gladys.fake.states.length, 0, 'no state before the device is created');

  await createDevice(gladys);
  assert.equal(gladys.fake.lastState(id('online')), 1);
  assert.equal(gladys.fake.lastState(id('tx0')), '4K59.937 593MHz 422 BT2020 12b 2.2');
  assert.equal(gladys.fake.lastState(id('input_tx0')), 'input0');
  assert.equal(gladys.fake.lastState(id('input_tx1')), 'copy_tx0');
  assert.equal(gladys.fake.lastState(id('operation_mode')), 'mode0');
  assert.equal(gladys.fake.lastState(id('sink2')), 'Bose CineMate: 4K60 420');
  // The creation published what the probe read: no second read.
  assert.equal(fake.reads(INFO), 1);
  assert.equal(fake.commands.length, 0, 'reading never sends a command');
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
});

test('a box with fewer info keys offers fewer features (Diva-like)', async (t) => {
  const box = await startFakeBox();
  box.info = { TX0: '1080p60', AUDOUT: 'PCM 48kHz' };
  const { gladys } = await setup(t, { box });
  const device = await discovered(gladys);
  const keys = device.features.map((f) => f.external_id.split(':').pop());
  assert.deepEqual(keys, ['online', 'hotplug', 'reboot', 'tx0', 'audout']);
});

test('never read faster than the interval: rounds, connected, unchanged save, button', async (t) => {
  const { gladys, fake, app, clock } = await setup(t);
  await createDevice(gladys);
  const reads = () => fake.reads(BOARD);
  assert.equal(reads(), 1);
  await app.round();
  assert.equal(reads(), 1, 'a round within the interval reads nothing');
  await app.start(gladys.fake.config, { connected: true });
  assert.equal(reads(), 1, 'a reconnection reads nothing');
  await gladys.fake.configUpdated({ ...gladys.fake.config });
  assert.equal(reads(), 1, 'an unchanged configuration reads nothing');
  const check = await gladys.fake.action('check_boxes');
  assert.equal(check.success, true);
  assert.match(check.data.message.en, /HDFury VRROOM-02 \(127\.0\.0\.1:\d+\): answers/);
  assert.match(check.data.message.en, /read \d+ s ago/);
  assert.equal(reads(), 1, 'the button reads nothing within the interval');
  clock.advance(INTERVAL);
  await app.round();
  assert.equal(reads(), 2, 'due after the interval');
});

test('a restart reads nothing sooner than the interval after the last attempt (/data)', async (t) => {
  const store = new MemoryStore();
  const first = await setup(t, { store });
  const device = await createDevice(first.gladys);
  await first.app.stop();
  assert.ok(store.data.lastAttempt > 0, 'the attempt time is in /data');
  const before = first.fake.reads(BOARD);

  const clock = makeClock();
  const second = await setup(t, {
    store,
    box: first.fake,
    clock,
    config: first.gladys.fake.config,
  });
  await second.gladys.fake.deviceCreated(device);
  await second.app.round();
  assert.equal(first.fake.reads(BOARD), before, 'nothing read right after the restart');
  clock.advance(INTERVAL);
  await second.app.round();
  assert.equal(first.fake.reads(BOARD), before + 1);
});

test('an input change re-reads identity and inputs, sends both outputs, then reads back', async (t) => {
  const { gladys, fake } = await setup(t);
  const device = await createDevice(gladys);
  const ack = await press(gladys, device, 'input_tx0', 'input2');
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(fake.commands, ['insel=2%204']);
  await waitFor(() => gladys.fake.lastState(id('input_tx0')) === 'input2', 'the input read back');
  // The read back waited for the debounce after the command.
  const cmd = fake.received.find((r) => r.path === '/cmd');
  const after = fake.received.filter((r) => r.path === BOARD && r.at > cmd.at);
  assert.ok(after[0].at - cmd.at >= FAST.debounce - 5);

  const same = await press(gladys, device, 'input_tx1', 'copy_tx0');
  assert.equal(same.success, true);
  assert.deepEqual(fake.commands, ['insel=2%204'], 'already selected: nothing sent');
});

test('the input already selected sends nothing; operation mode and hotplug', async (t) => {
  const { gladys, fake } = await setup(t);
  const device = await createDevice(gladys);
  assert.equal((await press(gladys, device, 'input_tx0', 'input0')).success, true);
  assert.deepEqual(fake.commands, []);
  assert.equal((await press(gladys, device, 'operation_mode', 'mode3')).success, true);
  assert.equal((await press(gladys, device, 'hotplug')).success, true);
  assert.deepEqual(fake.commands, ['opmode=3', 'hotplug=']);
});

test('invalid commands are refused before any request', async (t) => {
  const { gladys, fake } = await setup(t);
  const device = await createDevice(gladys);
  const before = fake.received.length;
  for (const [key, value] of [
    ['input_tx0', 'input9'],
    ['input_tx0', 4],
    ['operation_mode', '__proto__'],
    ['tx0', 'x'],
    ['online', 1],
  ]) {
    const ack = await press(gladys, device, key, value);
    assert.equal(ack.success, false, key);
    assert.match(ack.error, /nothing sent/, key);
  }
  assert.equal(fake.received.length, before);
});

test('reboot: refused by default, sent when allowed, once every 2 minutes, kept in /data', async (t) => {
  const { gladys, fake, app, store } = await setup(t);
  const device = await createDevice(gladys);
  const before = fake.received.length;
  const refused = await press(gladys, device, 'reboot');
  assert.equal(refused.success, false);
  assert.match(refused.error, /disabled in the configuration.*nothing sent/);
  assert.equal(fake.received.length, before, 'not even a read');

  await gladys.fake.configUpdated({ ...gladys.fake.config, allow_reboot: true });
  const ack = await press(gladys, device, 'reboot');
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(fake.commands, ['reboot=']);
  await waitFor(() => store.data.boxes?.[SERIAL]?.rebootAt > 0, 'the reboot time in /data');

  const again = await press(gladys, device, 'reboot');
  assert.equal(again.success, false);
  assert.match(again.error, /less than 2 minutes ago.*nothing sent/);
  assert.equal(fake.commands.length, 1);
  assert.equal(app.config.allowReboot, true);
});

test('reboot: the option is checked again just before sending', async (t) => {
  const { gladys, fake } = await setup(t, { timings: { commandBudget: 1_500, preRead: 1_000 } });
  const device = await createDevice(gladys);
  await gladys.fake.configUpdated({ ...gladys.fake.config, allow_reboot: true });
  fake.delay[BOARD] = 250;
  const pending = press(gladys, device, 'reboot');
  await settle(60);
  await gladys.fake.configUpdated({ ...gladys.fake.config, allow_reboot: false });
  const ack = await pending;
  assert.equal(ack.success, false);
  assert.match(ack.error, /disabled.*nothing sent/);
  assert.deepEqual(fake.commands, []);
});

test('another box at the address: nothing sent, address forgotten', async (t) => {
  const { gladys, fake } = await setup(t);
  const device = await createDevice(gladys);
  fake.board.serial = 'FFFF00000000';
  const ack = await press(gladys, device, 'hotplug');
  assert.equal(ack.success, false);
  assert.match(ack.error, /another box answers at its address, nothing sent/);
  assert.deepEqual(fake.commands, []);
  await waitFor(() => gladys.fake.lastState(id('online')) === 0, 'offline');
  await waitFor(
    () => /Address unknown/.test(gladys.fake.connectionStatus?.message?.en ?? ''),
    'the status',
  );
  const again = await press(gladys, device, 'hotplug');
  assert.match(again.error, /address unknown.*nothing sent/);
});

test('an unreadable serial is no other box: address kept, only Online, no feature added, commands refused (M5)', async (t) => {
  const { gladys, fake, app, clock } = await setup(t);
  const device = await createDevice(gladys);
  fake.board.serial = '';
  fake.info.TX0 = '1080p60';
  fake.info.RX2 = 'new key';
  const caps = [...app.data.boxes[SERIAL].caps];
  clock.advance(INTERVAL);
  await app.round();
  assert.equal(gladys.fake.lastState(id('tx0')), '4K59.937 593MHz 422 BT2020 12b 2.2');
  assert.equal(gladys.fake.lastState(id('online')), 1);
  assert.deepEqual(app.data.boxes[SERIAL].caps, caps);
  assert.ok(app.data.boxes[SERIAL].host, 'address kept');
  assert.match(gladys.fake.connectionStatus.message.en, /identity not confirmed/);
  fake.board.serial = SERIAL;
  clock.advance(INTERVAL);
  await app.round();
  assert.equal(gladys.fake.lastState(id('tx0')), '1080p60');
  assert.equal(gladys.fake.connectionStatus.message, undefined);
  fake.board.serial = '';
  const ack = await press(gladys, device, 'hotplug');
  assert.match(ack.error, /serial number unreadable, identity not checked, nothing sent/);
  assert.deepEqual(fake.commands, []);
});

test('a box that stops answering: online 0, named in the status, texts kept', async (t) => {
  const { gladys, fake, app, clock } = await setup(t);
  await createDevice(gladys);
  fake.status[BOARD] = 500;
  clock.advance(INTERVAL);
  await app.round();
  assert.equal(gladys.fake.lastState(id('online')), 0);
  assert.equal(gladys.fake.lastState(id('tx0')), '4K59.937 593MHz 422 BT2020 12b 2.2');
  assert.match(gladys.fake.connectionStatus.message.en, /Not reachable.*HDFury VRROOM-02/);
  assert.match(gladys.fake.connectionStatus.message.fr, /Injoignables/);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('an address where nothing answers is in the status, tried again a minute later at most', async (t) => {
  const port = await closedPort();
  const { gladys, app, clock } = await setup(t, { config: { addresses: `127.0.0.1:${port}` } });
  await waitFor(() => gladys.fake.connectionStatus?.message, 'a status message');
  assert.match(
    gladys.fake.connectionStatus.message.en,
    /No HDFury box answers yet at: 127\.0\.0\.1/,
  );
  const probes = app.probes.get(`127.0.0.1:${port}`);
  await app.round();
  assert.equal(app.probes.get(`127.0.0.1:${port}`), probes, 'not asked again before a minute');
  clock.advance(60_000);
  await app.round();
  assert.notEqual(app.probes.get(`127.0.0.1:${port}`), probes);
});

test('a slow command answer is "sent, without confirmation"', async (t) => {
  const { gladys, fake } = await setup(t);
  const device = await createDevice(gladys);
  fake.delay['/cmd'] = 2_000;
  const ack = await press(gladys, device, 'hotplug');
  assert.equal(ack.success, false);
  assert.match(ack.error, /Sent, without confirmation/);
  assert.deepEqual(fake.commands, ['hotplug=']);
});

test('a box too slow before the command: nothing sent, answered within the budget', async (t) => {
  const { gladys, fake } = await setup(t);
  const device = await createDevice(gladys);
  fake.delay[BOARD] = 1_500;
  const started = Date.now();
  const ack = await press(gladys, device, 'hotplug');
  assert.ok(Date.now() - started < 1_500);
  assert.equal(ack.success, false);
  assert.match(ack.error, /nothing sent/);
  assert.deepEqual(fake.commands, []);
});

test('a late answer from a former configuration publishes nothing', async (t) => {
  const { gladys, fake, app, clock } = await setup(t);
  await createDevice(gladys);
  fake.delay[INFO] = 300;
  fake.info.TX0 = 'late value';
  clock.advance(INTERVAL);
  const round = app.round();
  await settle(100);
  await gladys.fake.configUpdated({ addresses: '' });
  await round;
  await settle(350);
  assert.notEqual(gladys.fake.lastState(id('tx0')), 'late value');
});

test('hostile answers: oversized, not JSON, prototype keys', async (t) => {
  const { gladys, fake, app, clock } = await setup(t);
  await createDevice(gladys);
  fake.raw[INFO] = 'x'.repeat(40 * 1024);
  clock.advance(INTERVAL);
  await app.round();
  assert.equal(gladys.fake.lastState(id('online')), 0);
  fake.raw[INFO] =
    '{"__proto__":{"polluted":"yes"},"TX0":"720p\\u0000\\u001b[31m50","constructor":{}}';
  clock.advance(INTERVAL);
  await app.round();
  assert.equal(gladys.fake.lastState(id('online')), 1);
  assert.equal(gladys.fake.lastState(id('tx0')), '720p [31m50');
  assert.equal({}.polluted, undefined);
  fake.raw[INFO] = 'not json';
  clock.advance(INTERVAL);
  await app.round();
  assert.equal(gladys.fake.lastState(id('online')), 0);
});

test('the states share a budget per minute; what does not fit waits', async (t) => {
  const { gladys, fake, app, clock } = await setup(t);
  await createDevice(gladys);
  const count = gladys.fake.states.length;
  fake.info.TX0 = 'new';
  fake.info.TX1 = 'new too';
  clock.advance(INTERVAL);
  app.stateWindow = Array.from({ length: 239 }, () => clock.now());
  await app.round();
  assert.equal(gladys.fake.states.length, count + 1, 'one state fits');
  assert.equal(app.stateWindow.length, 240);
  clock.advance(61_000);
  await app.round();
  assert.equal(gladys.fake.lastState(id('tx0')), 'new');
  assert.equal(gladys.fake.lastState(id('tx1')), 'new too');
});

test('a reconnection publishes devices, states and status again without reading', async (t) => {
  const { gladys, fake, app } = await setup(t);
  await createDevice(gladys);
  const states = gladys.fake.states.length;
  const statuses = gladys.fake.connectionStatuses.length;
  const reads = fake.received.length;
  await app.start(gladys.fake.config, { connected: true });
  assert.ok(gladys.fake.states.length > states, 'states again');
  assert.ok(gladys.fake.connectionStatuses.length > statuses, 'status again');
  assert.equal(fake.received.length, reads);
});

// --- Review 1 ------------------------------------------------------------------

test('I1: /data reset with the device already in Gladys: read and published again', async (t) => {
  const first = await setup(t);
  const device = await createDevice(first.gladys);
  await first.app.stop();
  const clock = makeClock();
  const second = await setup(t, {
    box: first.fake,
    clock,
    store: new MemoryStore(),
    config: first.gladys.fake.config,
    devices: [device],
  });
  await waitFor(() => second.gladys.fake.lastState(id('online')) === 1, 'online from the probe');
  const reads = first.fake.reads(BOARD);
  first.fake.info.TX0 = '1080p50';
  clock.advance(INTERVAL);
  await second.app.round();
  assert.equal(first.fake.reads(BOARD), reads + 1, 'read at the first round due');
  assert.equal(second.gladys.fake.lastState(id('tx0')), '1080p50');
});

test('I2: a dropdown command ignored by the box (HTTP 200) is "sent, without confirmation"', async (t) => {
  const { gladys, fake } = await setup(t);
  const device = await createDevice(gladys);
  fake.ignoreCommands = true;
  const input = await press(gladys, device, 'input_tx0', 'input2');
  assert.equal(input.success, false);
  assert.match(input.error, /Sent, without confirmation/);
  const mode = await press(gladys, device, 'operation_mode', 'mode2');
  assert.match(mode.error, /Sent, without confirmation/);
  assert.deepEqual(fake.commands, ['insel=2%204', 'opmode=2']);
  // Read back within the same command, after the debounce.
  const cmd = fake.received.find((r) => r.path === '/cmd');
  assert.ok(fake.received.some((r) => r.path === INFO && r.at - cmd.at >= FAST.debounce - 5));
  // Hotplug has nothing to read back: the box's HTTP 200 is its ack.
  assert.equal((await press(gladys, device, 'hotplug')).success, true);
});

test('I2: too little time left to read back: "sent, without confirmation", never "nothing sent"', async (t) => {
  const { gladys, fake } = await setup(t);
  const device = await createDevice(gladys);
  fake.delay['/cmd'] = 780;
  const ack = await press(gladys, device, 'input_tx0', 'input1');
  assert.equal(ack.success, false);
  assert.match(ack.error, /Sent, without confirmation/);
  assert.doesNotMatch(ack.error, /nothing sent/);
  assert.deepEqual(fake.commands, ['insel=1%204']);
});

test('M1: the reboot guard is in /data before the box receives the reboot', async (t) => {
  const { gladys, fake, store } = await setup(t, {
    config: { addresses: '', allow_reboot: true },
  });
  await gladys.fake.configUpdated({ addresses: `127.0.0.1:${fake.port}`, allow_reboot: true });
  const device = await createDevice(gladys);
  let seen;
  fake.onCommand = () => {
    seen = store.data.boxes?.[SERIAL]?.rebootAt;
  };
  const ack = await press(gladys, device, 'reboot');
  assert.equal(ack.success, true, ack.error);
  assert.ok(seen > 0, 'rebootAt written before the request');
});

test('M2: a silent box holds its queue for requestTimeout at most', async (t) => {
  const { gladys, fake, app, clock } = await setup(t);
  await createDevice(gladys);
  fake.delay[BOARD] = 1_400;
  clock.advance(INTERVAL);
  const started = Date.now();
  await app.round();
  assert.ok(Date.now() - started < 1_000, `${Date.now() - started} ms`);
  assert.equal(gladys.fake.lastState(id('online')), 0);
});

test('M3: never both outputs copying each other, nor an unknown code sent back', async (t) => {
  const { gladys, fake } = await setup(t);
  const device = await createDevice(gladys);
  const copy = await press(gladys, device, 'input_tx0', 'copy_tx1');
  assert.match(copy.error, /copy the other one, nothing sent/);
  fake.info.portseltx1 = '9';
  const unknown = await press(gladys, device, 'input_tx0', 'input2');
  assert.match(unknown.error, /other output is unknown, nothing sent/);
  assert.deepEqual(fake.commands, []);
});

test('M4: the same box behind two typed addresses stays at the first, said in the status', async (t) => {
  const twin = await startFakeBox();
  t.after(() => twin.close());
  const box = await startFakeBox();
  const { gladys, app, clock } = await setup(t, {
    box,
    config: { addresses: `127.0.0.1:${box.port}, 127.0.0.1:${twin.port}` },
  });
  const device = await discovered(gladys);
  const host = app.keyOf(app.data.boxes[SERIAL]);
  for (let i = 0; i < 3; i += 1) {
    clock.advance(61_000);
    await app.round();
    assert.equal(app.keyOf(app.data.boxes[SERIAL]), host);
  }
  assert.deepEqual(
    gladys.fake.discoveredDevices.find((d) => d.external_id === device.external_id).params,
    device.params,
  );
  assert.match(gladys.fake.connectionStatus.message.en, /same box answers at two typed addresses/);
});

test('M6: writes to /data never overlap', async (t) => {
  let running = 0;
  let most = 0;
  const store = new MemoryStore();
  const save = store.save.bind(store);
  store.save = async (data) => {
    running += 1;
    most = Math.max(most, running);
    await settle(20);
    await save(data);
    running -= 1;
  };
  const { app } = await setup(t, { store });
  await Promise.all([app.saveNow(), app.saveNow(), app.markAttempt(), app.saveNow()]);
  assert.equal(most, 1);
});
