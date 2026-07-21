// 场外求助：压缩/解压工具
// 云端存储的 snapshot / recording 均为 BASE64(DEFLATE) 串：
//   - 压缩在云函数服务端用 node zlib 完成（客户端无需 pako deflate）
//   - 客户端仅做「解压」，复用已打包的 pako_inflate.min.js
// 因此本模块只暴露 inflateJson（解压还原为 JS 对象），上传方向的序列化由调用方 JSON.stringify。

var pako = require('./pako_inflate.min.js');

/**
 * base64 → Uint8Array
 * 小游戏运行时不一定提供 wx.base64ToArrayBuffer（实测部分基础库缺失），
 * 故做多重兜底：wx.base64ToArrayBuffer → atob → 纯 JS 解码，确保任何环境下都能解压。
 */
function _base64ToUint8Array(b64) {
  if (typeof wx !== 'undefined' && typeof wx.base64ToArrayBuffer === 'function') {
    return new Uint8Array(wx.base64ToArrayBuffer(b64));
  }
  if (typeof atob === 'function') {
    var bin = atob(b64);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }
  // 纯 JS 兜底：去掉填充符与空白后用查表解码
  var clean = String(b64).replace(/[^A-Za-z0-9+/]/g, '');
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var lookup = {};
  for (var c = 0; c < chars.length; c++) lookup[chars.charAt(c)] = c;
  var len = clean.length, out = [];
  for (var j = 0; j < len; j += 4) {
    var a = lookup[clean.charAt(j)] || 0;
    var b = lookup[clean.charAt(j + 1)] || 0;
    var cc = lookup[clean.charAt(j + 2)] || 0;
    var d = lookup[clean.charAt(j + 3)] || 0;
    out.push((a << 2) | (b >> 4));
    if (j + 2 < len) out.push(((b & 15) << 4) | (cc >> 2));
    if (j + 3 < len) out.push(((cc & 3) << 6) | d);
  }
  return new Uint8Array(out);
}

/**
 * 解压云端返回的 BASE64(DEFLATE) 串为 JS 对象（与云函数 zlib.deflateSync 对应，zlib 封装格式）
 * @param {string} b64
 * @returns {object|null}
 */
function inflateJson(b64) {
  if (!b64) return null;
  var bytes = _base64ToUint8Array(b64);
  // pako.inflate 的 to:'string' 会按 UTF-8 正确解码（含中文），避免单字节 fromCharCode 乱码
  var out = pako.inflate(bytes, { to: 'string' });
  return JSON.parse(out);
}

module.exports = { inflateJson };
