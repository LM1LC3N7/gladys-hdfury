// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here. No version is
// pinned: they must agree, whatever the release.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_CONFIG } from '../src/config.js';
import { ACTIONS, POLL_INTERVAL } from '../src/constants.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const handlers = read('src/handlers.js');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, entry] of node.entries()) {
      yield* texts(entry, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

const allFields = [
  ...manifest.config_schema,
  ...manifest.actions.flatMap((item) => item.fields ?? []),
];

test('the store basics', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.match(manifest.gladys_version, /^>=5\.1\.0$/);
  const pkg = JSON.parse(read('package.json'));
  const lock = JSON.parse(read('package-lock.json'));
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(pkg.name, 'gladys-hdfury');
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-hdfury:${manifest.version}`);
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['multimedia']);
  assert.deepEqual(Object.keys(pkg.dependencies), ['@gladysassistant/integration-sdk']);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    const docs = read(`docs/${lang}.md`);
    assert.ok(docs.length >= 300, `docs/${lang}.md is too short for the store`);
    assert.match(
      docs,
      /not[\s>]+affiliated[\s>]+with[\s>]+HDFury|sans[\s>]+lien[\s>]+avec[\s>]+HDFury/i,
    );
    assert.match(
      docs,
      /never[\s>]+been[\s>]+tested[\s>]+with[\s>]+a[\s>]+real[\s>]+(?:box|device)|jamais[\s>]+été[\s>]+testée[\s>]+avec[\s>]+un[\s>]+vrai[\s>]+(?:boîtier|appareil)/i,
      'say it was never tested',
    );
  }
});

test('every text is in English and French', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr']) {
      assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
    }
  }
  for (const field of allFields.filter((f) => f.placeholder !== undefined)) {
    assert.equal(typeof field.placeholder, 'object', `${field.key}: placeholder`);
  }
});

test('no network capture, no wake-up, no sub-container', () => {
  assert.equal(manifest.network_discovery, undefined);
  assert.equal(manifest.network_wake, undefined);
  assert.equal(manifest.containers, undefined);
});

test('the configuration matches the code; reboot off by default; no secret', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
    assert.ok(fields[key], `${key} is not in the config_schema`);
    assert.deepEqual(fields[key].default, value, key);
  }
  for (const field of manifest.config_schema.filter((f) => f.default !== undefined)) {
    assert.ok(field.key in DEFAULT_CONFIG, `${field.key} has no default in the code`);
  }
  assert.deepEqual(
    [fields.poll_interval.min, fields.poll_interval.max, fields.poll_interval.default],
    [POLL_INTERVAL.min, POLL_INTERVAL.max, POLL_INTERVAL.default],
  );
  assert.equal(fields.allow_reboot.type, 'boolean');
  assert.equal(fields.allow_reboot.default, false);
  assert.equal(
    manifest.config_schema.filter((f) => f.type === 'secret').length,
    0,
    'the box has no password',
  );
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(
      section.required ?? section.default ?? section.placeholder,
      undefined,
      section.key,
    );
    assert.ok(!(section.key in DEFAULT_CONFIG), section.key);
    for (const lang of ['en', 'fr']) {
      assert.ok(section.description[lang].length <= 1000, `${section.key}.${lang}`);
    }
    assert.ok((section.links ?? []).every((l) => l.url.startsWith('https://')));
  }
});

test('the actions are the ones the code handles', () => {
  assert.deepEqual(manifest.actions.map((a) => a.key).sort(), Object.values(ACTIONS).sort());
  for (const name of Object.keys(ACTIONS)) {
    assert.ok(handlers.includes(`onAction(ACTIONS.${name}`), `ACTIONS.${name} has no handler`);
  }
  for (const action of manifest.actions) {
    assert.ok(action.timeout_seconds <= 60, action.key);
  }
  assert.equal(manifest.scene_actions, undefined);
  assert.equal(manifest.scene_triggers, undefined);
  assert.equal(manifest.widgets, undefined);
});

test('the image ships the license and the third-party notices', () => {
  const dockerfile = read('Dockerfile');
  assert.match(dockerfile, /COPY [^\n]*LICENSE[^\n]*THIRD_PARTY_NOTICES\.md/);
  const notices = read('THIRD_PARTY_NOTICES.md');
  assert.match(notices, /hdfury 1\.6\.1/);
  assert.match(notices, /Copyright \(c\) 2017 Glenn de Haan/);
  assert.match(notices, /Permission is hereby granted, free of charge/);
});

test('no source file holds a raw line separator, zero-width or bidirectional mark', () => {
  const codes = [0x2028, 0x2029, 0xfeff, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f];
  for (let c = 0x202a; c <= 0x202e; c += 1) codes.push(c);
  for (let c = 0x2060; c <= 0x2069; c += 1) codes.push(c);
  for (const file of ['src/app.js', 'src/hdfury/protocol.js', 'src/i18n.js', 'src/store.js']) {
    const text = read(file);
    for (const code of codes) {
      assert.ok(!text.includes(String.fromCharCode(code)), `${file}: U+${code.toString(16)}`);
    }
  }
});

test('no file holds a control character (tabs and newlines aside)', () => {
  for (const file of [
    'gladys-assistant-integration.json',
    'index.js',
    'src/app.js',
    'src/config.js',
    'src/constants.js',
    'src/handlers.js',
    'src/i18n.js',
    'src/model.js',
    'src/store.js',
    'src/hdfury/client.js',
    'src/hdfury/protocol.js',
    'docs/en.md',
    'docs/fr.md',
    'README.md',
    'CHANGELOG.md',
    'TODO.md',
    'CLAUDE.md',
  ]) {
    // eslint-disable-next-line no-control-regex
    assert.doesNotMatch(read(file), /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/, file);
  }
});
