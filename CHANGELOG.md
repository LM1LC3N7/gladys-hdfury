# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- HDFury HDMI boxes (VRRoom, Vertex2, Diva, Arcana...) over their local HTTP
  interface, without any cloud: added by IP address, identified by their
  serial number, named after their host name.
- Online state, input and output signals, audio formats, connected displays
  and audio device (read-only texts of the box), operation mode and input of
  each output (dropdowns), and a "Hotplug" button. The features follow what
  the info page of each box holds.
- "Reboot" button, refused unless the "Allow rebooting the boxes from
  Gladys" option is on (checked again just before sending), at most once per
  box every 2 minutes.
- The identity of the box is read again before every command: another box
  at the address gets nothing. Every command is answered to Gladys within 4
  seconds: "sent, without confirmation" when it may have reached the box,
  "nothing sent" otherwise.
- "Check the boxes" button; refresh interval option (30 s by default),
  never read faster, restarts included.

### Fixed

- An input or mode change is reported a success only when the box, read
  again within the command, holds the value asked; otherwise "sent, without
  confirmation".
- A device already in Gladys is read again after the saved box list was
  lost or reset.
- The reboot guard is written to `/data` before the reboot is sent.
- A silent box no longer holds its queue for 10 seconds (4 at most per
  request).
- Two outputs copying each other, or an unknown input sent back, are
  refused ("nothing sent").
- The same box typed under two addresses no longer moves between them every
  minute; the status says so.
- With an unreadable serial number, only "Online" is published and the
  status says the identity is not confirmed.
- Writes to `/data` no longer overlap.

### Security

- Answers bounded (32 KB, a plain JSON object, listed keys only, texts
  cleaned and cut), commands built from fixed tables only; only serial
  numbers are keys in `/data`, and its tables have no prototype.
- Zero-width and bidirectional marks are removed from the texts of the box;
  an address read back from `/data` is checked like a typed one.

[Unreleased]: https://github.com/LM1LC3N7/gladys-hdfury/commits/main
