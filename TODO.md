# TODO — HDFury v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`
  (Node 22 and 24), `npm audit --omit=dev`,
  `npx github:GladysAssistant/integration-store .`, then update README,
  `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only.

## Status

- [x] **Milestone 1 — local reads and commands** (2026-10-22): boxes added
      by IP address, identified by serial number; board and info pages read
      at the interval; online state, signal / audio / display texts,
      operation mode and inputs (dropdowns), Hotplug and Reboot buttons
      (reboot off by default); "Check the boxes" button; docs en/fr. Tested
      against a fake box on the loopback interface only, never with a real
      box. The store validator could not be run from the development
      session (no access to it there): to run before the first release.
- [ ] **Milestone 2 — real boxes** (testers with a VRRoom, Vertex2, Diva or
      Arcana). To check first:
  - the exact keys of the info page of each model (which features each one
    gets), and whether the serial number is in the board page of every
    model and firmware;
  - what the box answers to a command it refuses (an `insel` on a model
    without matrix, an `opmode` out of range): HTTP status or 200;
  - how long an `insel` or an `opmode` takes, and whether 2 s after a
    command is enough before reading again (the reference library's wait);
  - the rendering on the Gladys dashboard (not checked here): long
    `text/text` values, the dropdowns, the two `button/push`.
- [ ] **Milestone 3 — more**: the settings of the configuration page
      (`/ssi/confpage.ssi`, `/ssi/cecpage.ssi`): automatic input switching,
      HTPC mode per input, CEC, OLED, TX audio mute, +5 V, unmute delays,
      reboot timer — as dropdowns or buttons, never switches; the MAC
      address (`macaddr`) shown; a "forget a box" action. The relay stays
      out unless asked for (it may drive a device: then behind an option).
- [ ] **Milestone 4 — first release**: Docker image build check, Release
      workflow, topic, then the store validator once the image is published.

## Decisions

- Forum: no dedicated topic, no post from this module's work; one recap per
  wave in /t/10385, posted by the main session.
- Reuse: glenndehaan/python-hdfury 1.6.1 (package `hdfury`, MIT, commit of
  2026-09-01, the library of the Home Assistant HDFury integration; licence
  file `LICENCE` read: MIT, copyright 2017 Glenn de Haan) is Python
  (aiohttp), so its pages, commands, value forms, the 2 s wait after a
  command and the tables of modes and inputs are ported to JavaScript
  (`src/hdfury/`); MIT notice in `THIRD_PARTY_NOTICES.md`, copied into the
  image. The Home Assistant integration (Apache-2.0) was read for the
  identity, the names, the features offered by key and the sample answers
  used by the fake box. No runtime dependency besides the SDK (`node:http`).
- Version 0.1.0 in `package.json`, `package-lock.json`, the manifest and the
  `docker_image` tag, set by hand at milestone 1: the one exception to
  "versions belong to the Release workflow", because the template's 1.0.0 and
  its image were someone else's. The first patch release gives 0.1.1. The
  manifest test checks that they agree, never a fixed version.
- External ids: `gladys.externalIds('hdfury', <serial>)`, the `serial` of
  `/ssi/brdinfo.ssi` (Home Assistant's unique id) trimmed, 4 to 32 letters
  or digits, lowercased; never the address. A box whose serial is missing or
  invalid is not added: the status names the address ("serial number
  unreadable"), probed again every minute at most (never once per start
  only). Feature keys are frozen: `online`, `operation_mode`, `input_tx0`,
  `input_tx1`, `hotplug`, `reboot`, `rx0`, `rx1`, `tx0`, `tx1`, `aud0`,
  `aud1`, `audout`, `earcrx`, `sink0`, `sink1`, `sink2`, `edida0`,
  `edida1`, `edida2`.
- Features offered: `online`, `hotplug`, `reboot` always; the others when
  their key is in the info page (as Home Assistant). The set (`caps`) only
  grows: persisted in `/data`, merged with the features of the created
  device (`gladys.devices`), so a device published again never loses one.
- **No switch** (lesson of lot 6): `online` is `unknown/binary` read only;
  hotplug and reboot are `button/push`; mode and inputs `text/select`; the
  texts `text/text` read only. No unit anywhere (none needed).
- **Reboot, the sensitive command**: refused unless `allow_reboot` (boolean,
  false by default; only `true` / `"true"` enable it) — checked when asked
  (no request at all when off) and again just before the request (an
  option unticked while the command waits refuses it). At most one per box
  every 2 minutes: `rebootAt` set before the first byte, kept in `/data`
  (capped at "now" when read back), cleared only when the request provably
  never left (connection refused). Read again 45 s later. No protective
  command exists on this device (nothing to "turn off"), so none needs the
  never-blocked path.
- Commands (`insel`, `opmode`, `hotplug`, `reboot`): validated before
  queueing (an unknown option, a feature the box does not offer: no
  request); serialized with the reads of the box (commands first); budget
  3.5 s from the Gladys request (wait in the queue included); the board page
  read again first (1.8 s at most): another valid serial clears the address
  and refuses ("nothing sent"), an unreadable one refuses without clearing;
  for an input, the info page read again and both outputs sent (`insel=<tx0>
<tx1>`, the other one as read), nothing sent when already selected; the
  epoch (configuration) and the deadline checked again just before the
  request (300 ms at least left). A command still queued at its deadline is
  dropped, never sent late.
- Ack: an HTTP 200 to the command is the box's acknowledgement and answers
  success; the box is read again 2.5 s later (after the reference library's
  2 s wait), and that read publishes the real value. The value is not read
  back before answering Gladys: the 2 s wait after a command does not fit in
  the 5 s ack. A request whose connection opened and that got no answer in
  time is "sent, without confirmation"; a refused connection is "nothing
  sent"; another HTTP status is "the box answered HTTP <status>".
- Polling: `poll_interval` 15..600 s (30 by default; Home Assistant reads
  every 60 s). A box is read when an interval has passed since its last
  attempt; after a restart, since the last attempt of the previous run
  (`lastAttempt` in `/data`, written before the read, at most once a
  minute). The "Check the boxes" button reads only the boxes due, and gives
  the last read with its age for the others. `connected` publishes the
  devices, the states from memory and the status again, reads nothing; a
  configuration save reads only what is due (a new address at once), an
  unchanged one nothing. The probe of a new address gives the first reading
  (no second read when the device is created).
- Late answers: the epoch is bumped by `stop()` and by a change of the typed
  addresses; every read checks it, and that the box is still at the same
  address, after each request: a stale read publishes nothing and sets no
  status.
- A box that does not answer (or answers garbage): `online` 0, its texts
  kept, named in the status; asked again at the next interval. The status is
  always `connected: true` (local, no account): problems are in its message.
- States: own memory of what Gladys accepted (cleared on `connected`, on
  device creation, update and deletion, as the SDK does) plus
  `publishChangedStates`; at most 240 states a minute for the whole
  integration, counted before the request so simultaneous publications
  share the budget; what does not fit waits for the next read.
- Hostile input: `node:http`, a new connection per request, no redirect
  followed, 32 KB at most per answer (else cut), `JSON.parse` (linear) of a
  plain object, only the listed keys read with `Object.hasOwn`, texts
  stripped of control characters and cut at 200 characters, codes single
  digits mapped through fixed tables, command paths built from a fixed list
  and single-digit values only. No password exists on the box API.
- No network discovery: the boxes announce themselves over mDNS
  (`_http._tcp`, used by Home Assistant's zeroconf), but the manifest asks
  for no network capture; the addresses are typed.
- Store category `multimedia`.
