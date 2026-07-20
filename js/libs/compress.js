// 场外求助：压缩/解压工具
// 云端存储的 snapshot / recording 均为 BASE64(DEFLATE) 串：
//   - 压缩在云函数服务端用 node zlib 完成（客户端无需 pako deflate）
//   - 客户端仅做「解压」，复用已打包的 pako_inflate.min.js
// 因此本模块只暴露 inflateJson（解压还原为 JS 对象），上传方向的序列化由调用方 JSON.stringify。

var pako = require('./pako_inflate.min.js');

function _base64ToUint8Array(b64) {
  // 微信小游戏：base64 → ArrayBuffer → Uint8Array
  var ab = wx.base64ToArrayBuffer(b64);
  return new Uint8Array(ab);
}

function _bytesToUtf8String(bytes) {
  // bytes: Uint8Array（zlib 解压结果），按块转 UTF-8 字符串避免 apply 栈溢出
  var s = '';
  var chunk = 8192;
  for (var i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return s;
}

/**
 * 解压云端返回的 BASE64(DEFLATE) 串为 JS 对象（与云函数 zlib.deflateSync 对应，zlib 封装格式）
 * @param {string} b64
 * @returns {object|null}
 */
function inflateJson(b64) {
  if (!b64) return null;
  var bytes = _base64ToUint8Array(b64);
  var out = pako.inflate(bytes); // 默认 zlib 格式，与 zlib.deflateSync 对齐
  var json = _bytesToUtf8String(out);
  return JSON.parse(json);
}

module.exports = { inflateJson };
