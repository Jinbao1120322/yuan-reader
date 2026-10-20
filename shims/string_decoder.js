// Node 内置 string_decoder 的 React Native 兼容替代。
// 仅被 iconv-lite 的 InternalCodec（utf-8 / ucs2 / cesu8 / base64 解码）使用。
// iconv.decode() 一次性传入完整 buffer 再 end()，不存在跨 chunk 边界，
// 因此直接对整段 buffer 做 toString 解码即可，语义与 Node StringDecoder 一致。
var Buffer = require('safer-buffer').Buffer;

function StringDecoder(encoding) {
  this.encoding = String(encoding || 'utf8').toLowerCase().replace(/[-_]/g, '') === 'utf8'
    ? 'utf8'
    : String(encoding || 'utf8').toLowerCase();
}

StringDecoder.prototype.write = function (buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf);
  return buf.toString(this.encoding);
};

StringDecoder.prototype.end = function (buf) {
  if (buf && buf.length) return this.write(buf);
  return '';
};

module.exports = { StringDecoder: StringDecoder };
