// -----------------------------------------------------------------------------
// The pure parts: configuration, protocol parsing, the /data store, and the
// HTTP client against loopback servers.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { normalizeConfig, parseAddress, parsePollInterval } from '../src/config.js';
import { ERROR_KINDS, request, requestJson } from '../src/hdfury/client.js';
import {
  cleanText,
  codeOf,
  commandPath,
  optionOf,
  parseBoard,
  parseInfo,
  parseSerial,
} from '../src/hdfury/protocol.js';
import { MemoryStore, sanitizeData } from '../src/store.js';
import { closedPort } from './fixtures/fakeBox.js';

test('addresses: IPv4 or host name, port 80 by default, invalid ones listed', () => {
  assert.deepEqual(parseAddress('192.168.1.60'), { host: '192.168.1.60', port: 80 });
  assert.deepEqual(parseAddress('http://VRRoom.local:8080/'), { host: 'vrroom.local', port: 8080 });
  assert.equal(parseAddress('999.1.1'), undefined);
  assert.equal(parseAddress('host:0'), undefined);
  assert.equal(parseAddress('a_b'), undefined);
  const config = normalizeConfig({ addresses: '192.168.1.60, bad_host; 192.168.1.60 10.0.0.2:81' });
  assert.deepEqual(config.addresses, [
    { host: '192.168.1.60', port: 80 },
    { host: '10.0.0.2', port: 81 },
  ]);
  assert.deepEqual(config.invalid, ['bad_host']);
});

test('the reboot option is on only when exactly true', () => {
  assert.equal(normalizeConfig({}).allowReboot, false);
  assert.equal(normalizeConfig({ allow_reboot: true }).allowReboot, true);
  assert.equal(normalizeConfig({ allow_reboot: 'true' }).allowReboot, true);
  for (const value of [1, 'yes', 'on', 'false', null, {}]) {
    assert.equal(normalizeConfig({ allow_reboot: value }).allowReboot, false, String(value));
  }
});

test('refresh interval: bounded, default when unreadable', () => {
  assert.equal(parsePollInterval(undefined), 30);
  assert.equal(parsePollInterval(''), 30);
  assert.equal(parsePollInterval(true), 30);
  assert.equal(parsePollInterval(1), 15);
  assert.equal(parsePollInterval('45'), 45);
  assert.equal(parsePollInterval(99_999), 600);
});

test('board: serial, hostname, model and firmware, checked', () => {
  assert.deepEqual(
    parseBoard({ hostname: 'VRROOM-02', serial: '000123456789', version: 'FW: 0.61', pcbv: '3' }),
    { serial: '000123456789', hostname: 'VRROOM-02', model: 'VRROOM', firmware: '0.61' },
  );
  assert.equal(parseSerial('AB12cd34'), 'ab12cd34');
  assert.equal(parseSerial(123456), '123456');
  for (const bad of ['', '12', '../etc', 'a b c d', 'x'.repeat(40), null, {}]) {
    assert.equal(parseSerial(bad), undefined, String(bad));
  }
  assert.deepEqual(parseBoard({ hostname: '<script>', serial: '__proto__' }), {
    serial: undefined,
    hostname: undefined,
    model: undefined,
    firmware: undefined,
  });
  assert.deepEqual(parseBoard('text'), {});
  assert.deepEqual(parseBoard([1]), {});
});

test('info: known keys only, texts cleaned, codes mapped through fixed tables', () => {
  const answer = JSON.parse(
    '{"__proto__":{"x":1},"TX0":" 4K60\\n HDR ","opmode":"3","portseltx0":"9","portseltx1":4,"OTHER":"y"}',
  );
  const info = parseInfo(answer);
  assert.deepEqual({ ...info.texts }, { tx0: '4K60 HDR' });
  assert.deepEqual({ ...info.codes }, { operation_mode: '3', input_tx0: '9', input_tx1: '4' });
  assert.deepEqual(info.keys, ['tx0', 'operation_mode', 'input_tx0', 'input_tx1']);
  assert.equal(optionOf('input_tx0', '9'), undefined);
  assert.equal(optionOf('input_tx1', '4'), 'copy_tx0');
  assert.equal(optionOf('operation_mode', '3'), 'mode3');
  assert.equal(codeOf('input_tx0', 'copy_tx1'), '4');
  assert.equal(codeOf('input_tx0', 'toString'), undefined);
  assert.equal(cleanText('a'.repeat(500)).length, 200);
  assert.equal(cleanText('   '), undefined);
  assert.equal(cleanText({}), undefined);
});

test('command paths: only the commands used, single digits', () => {
  assert.equal(commandPath('insel', '0 4'), '/cmd?insel=0%204');
  assert.equal(commandPath('opmode', '3'), '/cmd?opmode=3');
  assert.equal(commandPath('reboot'), '/cmd?reboot=');
  assert.equal(commandPath('hotplug'), '/cmd?hotplug=');
  assert.throws(() => commandPath('relay', 'on'));
  assert.throws(() => commandPath('opmode', '3&reboot='));
  assert.throws(() => commandPath('insel', '0'));
});

test('store: only valid serials, no prototype, times never in the future', async () => {
  const now = 1_000_000;
  const data = sanitizeData(
    JSON.parse(
      JSON.stringify({
        boxes: {
          '000123456789': {
            serial: '000123456789',
            host: '192.168.1.60',
            port: 80,
            hostname: 'VRROOM-02',
            caps: ['tx0', 'evil', 'online'],
            rebootAt: now + 10_000_000,
          },
          'BAD SERIAL': { serial: 'BAD SERIAL' },
          aaaa1111: { serial: 'other' },
        },
        lastAttempt: now + 5,
      }),
    ),
    { now },
  );
  assert.deepEqual(Object.keys(data.boxes), ['000123456789']);
  assert.equal(Object.getPrototypeOf(data.boxes), null);
  assert.deepEqual(data.boxes['000123456789'].caps, ['tx0']);
  assert.equal(data.boxes['000123456789'].rebootAt, now);
  assert.equal(data.lastAttempt, now);
  const store = new MemoryStore({ boxes: '__proto__' });
  assert.deepEqual(Object.keys((await store.load()).boxes), []);
});

async function server(t, handler) {
  const s = http.createServer(handler);
  await new Promise((resolve) => s.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => s.close(resolve)));
  return { host: '127.0.0.1', port: s.address().port };
}

test('client: a 200 JSON object, nothing else', async (t) => {
  const address = await server(t, (req, res) => {
    if (req.url === '/ok') {
      res.end('{"a":"1"}');
    } else if (req.url === '/array') {
      res.end('[1]');
    } else if (req.url === '/redirect') {
      res.writeHead(302, { Location: 'http://example.com/' });
      res.end();
    } else {
      res.end('x'.repeat(100));
    }
  });
  assert.deepEqual(await requestJson(address, '/ok', { timeout: 500 }), { a: '1' });
  await assert.rejects(requestJson(address, '/array', { timeout: 500 }), {
    kind: ERROR_KINDS.INVALID,
  });
  await assert.rejects(request(address, '/redirect', { timeout: 500 }), {
    kind: ERROR_KINDS.HTTP,
    status: 302,
  });
  await assert.rejects(request(address, '/big', { timeout: 500, maxBytes: 50 }), {
    kind: ERROR_KINDS.TOO_LARGE,
  });
});

test('client: a refused connection sent nothing, a silent box may have', async (t) => {
  const port = await closedPort();
  await assert.rejects(request({ host: '127.0.0.1', port }, '/cmd?hotplug=', { timeout: 500 }), {
    kind: ERROR_KINDS.UNREACHABLE,
    sent: false,
  });
  const address = await server(t, () => {});
  await assert.rejects(request(address, '/cmd?hotplug=', { timeout: 150 }), {
    kind: ERROR_KINDS.TIMEOUT,
    sent: true,
  });
});
