// -----------------------------------------------------------------------------
// One HTTP request to a box (plain HTTP on the home network, no account, no
// cloud), with `node:http`: a new connection per request (no keep-alive), a
// deadline for the whole request, the answer read up to LIMITS.responseBytes,
// redirects never followed, no User-Agent of anyone else.
//
// The error says whether the request may have reached the box (`sent`): a
// connection that never opened (refused, no route, unknown name, no answer
// to the connection) sent nothing; anything after the connection opened may
// have. Errors carry our own words, never a text of the box.
// -----------------------------------------------------------------------------

import http from 'node:http';
import { LIMITS } from '../constants.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable',
  TIMEOUT: 'timeout',
  HTTP: 'http',
  TOO_LARGE: 'too_large',
  INVALID: 'invalid',
  BUDGET: 'budget',
});

export class HdfuryError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message
   * @param {{ sent?: boolean, status?: number }} [details]
   */
  constructor(kind, message, { sent = false, status } = {}) {
    super(message);
    this.name = 'HdfuryError';
    this.kind = kind;
    this.sent = sent;
    this.status = status;
  }
}

/** A system error code (ECONNREFUSED...) is ours to show; anything else is not. */
const systemCode = (err) => {
  const code = err?.code;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,30}$/.test(code) ? code : undefined;
};

/**
 * One GET of `path` at `address` ({ host, port }), within `timeout` ms.
 * @returns {Promise<string>} the body of a 200 answer
 */
export function request(address, path, { timeout, maxBytes = LIMITS.responseBytes } = {}) {
  return new Promise((resolve, reject) => {
    let connected = false;
    let settled = false;
    const finish = (err, body) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (err) {
        req.destroy();
        reject(err);
      } else {
        resolve(body);
      }
    };
    const req = http.request({
      host: address.host,
      port: address.port,
      path,
      method: 'GET',
      agent: false,
      headers: { Accept: 'application/json, text/plain, */*', Connection: 'close' },
    });
    const timer = setTimeout(
      () =>
        finish(
          new HdfuryError(ERROR_KINDS.TIMEOUT, connected ? 'no answer' : 'no connection', {
            sent: connected,
          }),
        ),
      Math.max(1, timeout),
    );
    req.on('socket', (socket) => {
      if (!socket.connecting) {
        connected = true;
      }
      socket.once('connect', () => {
        connected = true;
      });
    });
    req.on('error', (err) => {
      const code = systemCode(err);
      finish(
        new HdfuryError(
          connected ? ERROR_KINDS.TIMEOUT : ERROR_KINDS.UNREACHABLE,
          connected
            ? `connection cut${code ? ` (${code})` : ''}`
            : `unreachable${code ? ` (${code})` : ''}`,
          { sent: connected },
        ),
      );
    });
    req.on('response', (res) => {
      const status = res.statusCode;
      if (status !== 200) {
        res.resume();
        finish(new HdfuryError(ERROR_KINDS.HTTP, `HTTP ${status}`, { sent: true, status }));
        return;
      }
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          finish(
            new HdfuryError(ERROR_KINDS.TOO_LARGE, 'the box answered more than an HDFury sends', {
              sent: true,
            }),
          );
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => finish(undefined, Buffer.concat(chunks).toString('utf8')));
      res.on('error', () =>
        finish(new HdfuryError(ERROR_KINDS.TIMEOUT, 'answer cut', { sent: true })),
      );
    });
    req.end();
  });
}

/** One GET whose answer must be a JSON object. */
export async function requestJson(address, path, options) {
  const text = await request(address, path, options);
  let answer;
  try {
    answer = JSON.parse(text);
  } catch {
    throw new HdfuryError(ERROR_KINDS.INVALID, 'the box answered something that is not data', {
      sent: true,
    });
  }
  if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) {
    throw new HdfuryError(ERROR_KINDS.INVALID, 'unexpected answer', { sent: true });
  }
  return answer;
}
