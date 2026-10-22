# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for HDFury HDMI boxes (VRRoom,
Vertex2, Diva, Arcana...) over their local HTTP interface: a Node.js service
(Node 22+, ESM, no build step) that runs in its own sandboxed Docker container
and talks to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.
See `TODO.md` for the status and the decisions.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
node --test --test-name-pattern "reboot"  # tests whose name matches
npm run cover                             # regenerate cover.png (800×534)
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: src/handlers.js registered before connect()
src/handlers.js                   the SDK handlers -> HdfuryApp (shared with the tests)
src/app.js                        HdfuryApp: known boxes, polling, commands, reboot guard, status
src/hdfury/client.js              one HTTP GET: deadline, bounded answer, whether it may have been sent
src/hdfury/protocol.js            pages, commands, modes and inputs (pure, ported)
src/model.js                      known boxes -> Gladys devices and states (pure)
src/store.js                      /data/hdfury.json (boxes, last reboot, last read attempt)
src/config.js                     DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/constants.js, src/i18n.js     frozen keys, limits, timings; texts in English and French
scripts/cover.mjs                 cover.png generator (plain Node)
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, against the SDK's fake Gladys and a fake box (loopback)
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the serial number
  of the box (letters and digits, lowercased), never its address or a label.
  The same goes for every key users store: manifest `config_schema`,
  `actions`, feature keys. A device published again never loses a feature
  (the offered set only grows).
- **No switch.** Hotplug and reboot are `button/push`; the online state is
  read only. An "everything off" must never reach a box.
- **Reboot is off by default**, behind `allow_reboot`, checked when asked and
  again just before the request; at most one per box every 2 minutes, kept
  in `/data`.
- **Never read faster than the interval**: not on `connected`, not on an
  unchanged configuration save, not from the button, not after a restart
  (`lastAttempt` in `/data`). A late answer of a former configuration
  publishes nothing.
- **Commands**: validated before queueing; the identity of the box read just
  before acting; the answer to Gladys within the 3.5 s budget; "sent, without
  confirmation" when the request may have left, "nothing sent" otherwise.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the README's hand-pushed tag path, which bumps all three
  together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`.
  The catalog `description` holds 10 to 100 characters per language.
  `test/manifest.test.js` ties the manifest to the code: change both sides
  together.
- **User-facing text** is bilingual (English and French): action messages,
  manifest texts, and `docs/en.md` / `docs/fr.md`, kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network (loopback only).
- **Encoding.** Every file is UTF-8 without BOM; `test/encoding.test.js`
  refuses mojibake in the manifest, the docs and these files.
- **Untrusted input.** Everything the box sends is bounded, only listed keys
  are read, values are mapped through fixed tables.
