# gladys-hdfury

[Gladys Assistant](https://gladysassistant.com) external integration for
**HDFury HDMI boxes** (VRRoom, Vertex2, Diva, Arcana...), on the local
network: input and output signals, audio formats, connected displays,
operation mode and input of each output (dropdowns), hotplug and reboot
(buttons, reboot off by default), through the HTTP interface of the box,
without any cloud. Unofficial, not affiliated with HDFury.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> **Work in progress.** First milestone, tested against a fake box only,
> never with a real HDFury box.

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (HdfuryApp)
                                   ├─ src/hdfury/client.js    one HTTP GET: deadline, bounded answer, "may have been sent"
                                   ├─ src/hdfury/protocol.js  pages, commands, modes and inputs (ported, pure)
                                   ├─ src/model.js            known boxes -> Gladys devices and states (pure)
                                   └─ src/store.js            /data/hdfury.json: boxes, last reboot, last read attempt
```

- **Boxes** are added by IP address (configuration; no network discovery).
  Each one is identified by its serial number (`/ssi/brdinfo.ssi`, as Home
  Assistant): external id `hdfury:<serial>`, letters and digits, lowercased;
  a box without a readable serial is not added. Its features follow the keys
  of its info page (`/ssi/infopage.ssi`), a set that only grows.
- **Reads**: the board page (the serial must still be this box's: another
  valid serial clears the address, an unreadable one proves nothing), then
  the info page, one box at a time per address, never faster than the
  interval (the time of the attempt is written to `/data` before reading, at
  most once a minute; a reconnection, an unchanged configuration save or the
  button never read sooner). A late answer of a former configuration
  publishes nothing.
- **Commands**: validated first, serialized per box, each within a 3.5 s
  budget (Gladys acks in 5 s): the identity read again, the inputs read
  again for `insel`, the deadline checked just before the request. The
  reboot option is checked when asked and again just before sending; one
  reboot per box every 2 minutes, its time set before the request and kept
  in `/data`. A request that may have reached the box is reported "sent,
  without confirmation".
- **Features**: read-only `unknown/binary` online state, `text/select`
  operation mode and inputs, `button/push` hotplug and reboot, read-only
  `text/text` for the signals, audio, displays and audio formats. No switch,
  no unit.
- **Bounded input**: 32 KB per answer, a plain JSON object, only the listed
  keys read (`Object.hasOwn`), texts cleaned and cut at 200 characters, codes
  mapped through fixed tables; serial keys only in `/data`, tables without
  prototype. At most 240 states a minute for the whole integration.

## Development

```bash
npm install
npm test                                        # node --test, loopback only (fake box)
npm run lint && npm run format:check
npm run audit
npm run cover                                   # regenerates cover.png (800×534, no dependency)
npx github:GladysAssistant/integration-store .  # store admission checks
```

`test/fixtures/fakeBox.js` is a fake HDFury box on 127.0.0.1 (the pages of
the Home Assistant tests, the commands applied to its state, delays, errors,
oversized or garbled answers). The end-to-end tests run the real handlers
against the SDK's fake Gladys.

## Credits

- [`hdfury`](https://github.com/glenndehaan/python-hdfury) 1.6.1 by Glenn de
  Haan (MIT), the library behind the Home Assistant HDFury integration: the
  pages, commands, wait after a command, modes and inputs are ported from it
  to JavaScript.
- The Home Assistant HDFury integration (Apache-2.0) was consulted for the
  identity (serial number), the names and the features offered.
- The app structure follows
  [LM1LC3N7/gladys-jvc-projector](https://github.com/LM1LC3N7/gladys-jvc-projector)
  (same author, Apache-2.0).

HDFury is a trademark of its owner, used here only to name the compatible
products.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic is added at the first real release.

## License

Apache-2.0, see [LICENSE](LICENSE). Third-party notices (hdfury, MIT):
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
