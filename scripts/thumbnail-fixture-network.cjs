// Harness-only interception. Never imported by application code; no live YouTube
// image request is allowed during deterministic Electron verification.
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
function installThumbnailNetwork(reply = () => { throw new Error('Offline thumbnail fixture'); }) {
  const original = https.get, calls = [];
  https.get = function(url, options, callback) {
    if (new URL(url).hostname !== 'i.ytimg.com') return original.call(this, url, options, callback);
    calls.push({ url, headers: options.headers });
    const request = new EventEmitter();
    queueMicrotask(() => {
      try {
        const value = reply(url, options.headers);
        const response = Object.assign(new PassThrough(), { statusCode: value.status, headers: value.headers ?? {}, complete: true });
        callback(response); if (!response.destroyed) response.end(value.bytes);
      } catch (error) { request.emit('error', error); }
    });
    return request;
  };
  return calls;
}
module.exports = { installThumbnailNetwork };
