# HDFury boxes for Gladys

Follow your **HDFury** HDMI boxes (VRRoom, Vertex2, Diva, Arcana...) from
Gladys, locally, without any cloud: input and output signals (resolution,
HDR, colour), audio formats, connected displays and soundbar, operation mode
and input of each output, hotplug and reboot.

> **Important.** This integration has never been tested with a real box: it
> was written after the `hdfury` library (the one of Home Assistant) and
> tested against a fake box only. Your feedback is welcome. Unofficial
> integration, not affiliated with HDFury.

## Installation

1. Plug the box into your network (LAN port) and give it a **fixed IP
   address** in your router (reserved DHCP lease).
2. Check that its web page opens in a browser at that address
   (`http://192.168.1.60` for example): the integration reads the same
   interface.
3. In Gladys, install the **HDFury** integration, open its configuration and
   type the IP addresses, separated by commas (port 80 by default, another
   one as `192.168.1.60:8080`).
4. The boxes appear in the **Discovery** tab: create them.

Each box is identified by its **serial number** (read from its `brdinfo`
page, as Home Assistant does): its address may change, type the new one
then. A box whose serial number is unreadable is not added (the integration
status says so, tried again every minute at most). The device name uses the
host name of the box (`HDFury VRROOM-02`).

## What you get

| Feature                              | Gladys type        | Note                                              |
| ------------------------------------ | ------------------ | ------------------------------------------------- |
| Online                               | binary (read only) | 1 when the box answered the last read             |
| Operation mode                       | dropdown           | Mode 0 to 5 (splitter, matrix...), VRRoom         |
| Input of TX0, input of TX1           | dropdown           | Input 0 to 3, or a copy of the other output       |
| Hotplug                              | button             | the sources and displays handshake again          |
| Reboot                               | button             | refused while the "Allow rebooting" option is off |
| Input RX0, RX1 signal                | text (read only)   | for example `4K59.937 593MHz 422 BT2020 12b 2.2`  |
| Output TX0, TX1 signal               | text (read only)   | resolution, rate, colour, depth, HDR              |
| Audio TX0, TX1, audio output, eARC   | text (read only)   | for example `bitstream 48kHz`                     |
| Display TX0, TX1, audio device       | text (read only)   | what the display or soundbar announces (EDID)     |
| Audio formats TX0, TX1, audio output | text (read only)   | the audio formats announced                       |

The texts are the box's own, in English. A box offers only the features its
info page holds (a Diva or an Arcana fewer than a VRRoom); a feature that
appeared is never removed afterwards. No **switch**: an "everything off" of a
voice assistant or a scene never reboots a box.

## Commands

Before each command, the `brdinfo` page of the box is read again: its serial
number must be the device's. Another box at that address: nothing is sent,
and the address is forgotten. An unreadable serial number: nothing is sent
(identity not checked), but the address is kept.

- **Input of TX0 / TX1**: the inputs are read again just before; the box
  receives both outputs together (`insel`), the other output sent back as it
  is. Already selected: nothing is sent.
- **Operation mode** and **Hotplug**: sent after the identity is read again.
- **Reboot**: **off by default**. Tick "Allow rebooting the boxes from
  Gladys"; the option is checked again just before sending (unticking it
  while a command waits cancels it). At most one reboot per box every 2
  minutes (kept in the data folder, even across a restart of the
  integration). A reboot cuts the picture and the sound for a while.

Every command is answered within 4 seconds (Gladys waits 5 seconds). A
command that left without an answer from the box in time is reported "sent,
without confirmation"; a command that could not leave is reported "nothing
sent". The box is read again 2.5 seconds after each command (the reference
library waits 2 seconds after a command before reading), 45 seconds after a
reboot.

## Configuration button

- **Check the boxes**: the state of each box. A box read less than an
  interval ago is not read again: the answer gives the last read and its age.

## Refresh, status and limits

- Each box is read every 30 seconds by default (15 to 600), in two requests
  (`brdinfo`, then the info page), never faster: neither a reconnection to
  Gladys, nor saving an unchanged configuration, nor the button, nor a
  restart of the integration (the time of the last attempt is kept in the
  data folder) reads sooner.
- A box that does not answer shows "Online" 0, keeps its last texts, and is
  named in the integration status.
- An answer larger than 32 KB, or that is not a JSON object, counts as "does
  not answer". Texts are cleaned (control characters removed, 200 characters
  at most).
- The states sent to Gladys stay under 240 a minute for the whole
  integration (Gladys accepts 300); what does not fit goes at the next read.

## Data and privacy

The interface of the box has no password: the integration asks for none. It
keeps in `/data/hdfury.json` the known boxes (serial number, address, port,
host name, model, firmware, features offered, time of the last reboot sent)
and the time of the last read. Nothing leaves your local network.

## Known limits

- Not yet the settings of the configuration page of the box (automatic input
  switching, HTPC mode, CEC, OLED, relay, audio mute...).
- The relay of the box is deliberately not offered (it may drive a device
  plugged into it).
- Never tested with a real box: real answers may differ.
