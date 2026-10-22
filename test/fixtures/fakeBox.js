// -----------------------------------------------------------------------------
// A fake HDFury box on 127.0.0.1 (random port): the board and info pages of
// the Home Assistant tests (a VRRoom), the commands used by the integration
// applied to its state. Every request is recorded; answers can be delayed,
// refused, oversized or garbled per path.
// -----------------------------------------------------------------------------

import http from 'node:http';

export const SERIAL = '000123456789';

export const BOARD = {
  hostname: 'VRROOM-02',
  ipaddress: '127.0.0.1',
  serial: SERIAL,
  pcbv: '3',
  version: 'FW: 0.61',
};

export const INFO = {
  portseltx0: '0',
  portseltx1: '4',
  opmode: '0',
  RX0: '4K59.937 593MHz 422 BT2020 12b 2.2',
  RX1: 'no signal',
  TX0: '4K59.937 593MHz 422 BT2020 12b 2.2',
  TX1: '4K59.937 593MHz 422 BT2020 12b 2.2',
  AUD0: 'bitstream 48kHz',
  AUD1: 'bitstream 48kHz',
  AUDOUT: 'bitstream 48kHz',
  EARCRX: 'eARC/ARC not active',
  SINK0: 'LG TV SSCR2: 4K120 444 FRL6 VRR DSC ALLM DV HDR10 HLG',
  EDIDA0: 'MAT Atmos, DD Atmos, DD, DTS:X+IMAX, DTSHD, DTS, LPCM 2.0 192kHz 24b',
  SINK1: 'Signify FCD: 4K60 444 DV HDR10+ HLG',
  EDIDA1: 'DD, DTS, LPCM 2.0 48kHz 24b',
  SINK2: 'Bose CineMate: 4K60 420 ',
  EDIDA2: 'DD, DTS, LPCM 7.1 96kHz 24b',
};

/**
 * @param {object} [options]
 * @param {object} [options.board] board page (JSON-serialized)
 * @param {object} [options.info] info page
 * @param {Record<string, number>} [options.delay] ms before answering, by path ('/ssi/brdinfo.ssi', '/cmd'...)
 * @param {Record<string, number>} [options.status] HTTP status, by path
 * @param {Record<string, string>} [options.raw] raw body, by path
 */
export async function startFakeBox(options = {}) {
  const box = {
    board: { ...BOARD, ...(options.board ?? {}) },
    info: { ...INFO, ...(options.info ?? {}) },
    delay: { ...(options.delay ?? {}) },
    status: { ...(options.status ?? {}) },
    raw: { ...(options.raw ?? {}) },
    received: [],
    commands: [],
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://box');
    const path = url.pathname;
    box.received.push({ path, query: url.search, at: Date.now() });
    if (path === '/cmd') {
      // Recorded when received, even when the answer comes late.
      box.commands.push(url.search.slice(1));
      box.onCommand?.(url.search.slice(1));
    }
    const answer = () => {
      if (box.status[path] !== undefined) {
        res.writeHead(box.status[path]);
        res.end();
        return;
      }
      if (box.raw[path] !== undefined) {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end(box.raw[path]);
        return;
      }
      if (path === '/ssi/brdinfo.ssi') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(box.board));
        return;
      }
      if (path === '/ssi/infopage.ssi') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(box.info));
        return;
      }
      if (path === '/cmd') {
        // The raw query, as sent: "insel=0%204", "reboot=".
        const query = url.search.slice(1);
        const [name, value = ''] = query.split('=');
        const decoded = decodeURIComponent(value);
        if (box.ignoreCommands) {
          // Answers OK, applies nothing.
        } else if (name === 'insel') {
          const [tx0, tx1] = decoded.split(' ');
          box.info.portseltx0 = tx0;
          box.info.portseltx1 = tx1;
        } else if (name === 'opmode') {
          box.info.opmode = decoded;
        }
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('OK');
        return;
      }
      res.writeHead(404);
      res.end();
    };
    const wait = box.delay[path] ?? 0;
    if (wait > 0) {
      setTimeout(answer, wait);
    } else {
      answer();
    }
  });
  const sockets = new Set();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  box.port = server.address().port;
  box.reads = (path) => box.received.filter((r) => r.path === path).length;
  box.close = () =>
    new Promise((resolve) => {
      for (const socket of sockets) {
        socket.destroy();
      }
      server.close(() => resolve());
    });
  return box;
}

/** A port where nothing listens (a server opened then closed). */
export async function closedPort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}
