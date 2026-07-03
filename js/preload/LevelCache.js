// LevelCache.js — 关卡缓存与预下载
// 维护本次会话已下载关卡集合，按需预下载后续5关，合并重复请求
//
// 规则：
//   1. 任何关卡下载都带 version 校验，只拉有变化的
//   2. 同一会话内每个关卡只下载一次
//   3. 同一时间最多一个预下载请求（_pendingPromise）

const cloud = require('../cloud.js');
const PRELOAD_COUNT = 5;

function padLevel(n) { return String(n).padStart(4, '0'); }

function LevelCache() {
  this._downloaded = {};       // name → true（本次会话已下载）
  this._pendingPromise = null; // 进行中的预下载
}

// ==================== 公开 API ====================

/**
 * 下载单个关卡（带 version 校验）
 * @param {string} name   关卡名 "0001"
 * @returns {Promise<object|null>} 关卡数据，未变化则返回 null
 */
LevelCache.prototype.fetchLevel = async function (name) {
  if (this._downloaded[name]) {
    console.log('[LevelCache] ' + name + ' 本次已下载，跳过');
    return null;
  }
  return this._doFetch([name]);
};

/**
 * 预下载 fromIndex 开始的 5 个关卡
 * @param {number} fromIndex 起始关卡索引（0-based）
 * @returns {Promise<void>}
 */
LevelCache.prototype.preloadNext = async function (fromIndex) {
  if (fromIndex < 0) return;
  if (this._pendingPromise) {
    console.log('[LevelCache] 已有预下载进行中，跳过 (fromIndex=' + fromIndex + ')');
    return;
  }

  // 计算目标名，过滤已下载
  var targets = [];
  for (var i = 0; i < PRELOAD_COUNT; i++) {
    var nm = padLevel(fromIndex + i);
    if (!this._downloaded[nm]) targets.push(nm);
  }
  if (targets.length === 0) {
    console.log('[LevelCache] 预下载: 全部已缓存，跳过');
    return;
  }

  var self = this;
  this._pendingPromise = (async function () {
    try {
      console.log('[LevelCache] 预下载 ' + targets.length + ' 关: ' + targets.join(',')
        + ' (fromIndex=' + fromIndex + ')');
      await self._doFetch(targets);
    } catch (err) {
      console.warn('[LevelCache] 预下载异常: ' + (err && err.message));
    } finally {
      self._pendingPromise = null;
    }
  })();
};

// ==================== 内部 ====================

LevelCache.prototype._doFetch = async function (names) {
  // 收集本地版本号
  var versions = {};
  for (var i = 0; i < names.length; i++) {
    versions[names[i]] = this._readLocalVersion(names[i]);
  }

  var result = await cloud.callFunction('batchDownloadLevels',
    { versions: versions, compress: false }, 'Load');

  if (!result || !result.ok) {
    console.warn('[LevelCache] batchDownloadLevels 失败: ' + (result && result.msg));
    return null;
  }

  if (result.base64 && result.changed > 0) {
    var jsonStr = this._decodeBase64(result.base64);
    var payload = JSON.parse(jsonStr);
    var keys = Object.keys(payload);
    for (var j = 0; j < keys.length; j++) {
      var k = keys[j];
      var item = payload[k];
      this._saveLevelFile(k, item.data, item.version);
    }
    console.log('[LevelCache] ' + result.skipped + ' 跳过, ' + result.changed + ' 更新');
  } else {
    console.log('[LevelCache] ' + names.length + ' 关均未变化');
  }

  // 标记已下载
  for (var m = 0; m < names.length; m++) {
    this._downloaded[names[m]] = true;
  }

  return null;
};

LevelCache.prototype._readLocalVersion = function (name) {
  try {
    var fs = wx.getFileSystemManager();
    var raw = fs.readFileSync('assets/levels/' + name + '.json', 'utf8');
    return JSON.parse(raw).version || 0;
  } catch (e) { return 0; }
};

LevelCache.prototype._saveLevelFile = function (name, data, version) {
  try {
    if (version != null) data.version = version;
    var fs = wx.getFileSystemManager();
    var dir = wx.env.USER_DATA_PATH + '/levels';
    try { fs.accessSync(dir); } catch (e) { fs.mkdirSync(dir, true); }
    fs.writeFileSync(dir + '/' + name + '.json', JSON.stringify(data), 'utf8');
    console.log('[LevelCache] ' + name + ' 已缓存 (v=' + version + ')');
  } catch (e) {
    console.warn('[LevelCache] 保存 ' + name + ' 失败: ' + (e && e.message));
  }
};

LevelCache.prototype._decodeBase64 = function (b64) {
  // WeChat 小游戏没有 atob 和 TextDecoder
  if (typeof wx !== 'undefined' && wx.base64ToArrayBuffer) {
    var buf = wx.base64ToArrayBuffer(b64);
    var bytes = new Uint8Array(buf);
    return this._bytesToStr(bytes);
  }
  // 本地 base64 解码
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  var output = '';
  var i = 0;
  b64 = (b64 || '').replace(/[^A-Za-z0-9+/=]/g, '');
  while (i < b64.length) {
    var e1 = chars.indexOf(b64.charAt(i++));
    var e2 = chars.indexOf(b64.charAt(i++));
    var e3 = chars.indexOf(b64.charAt(i++));
    var e4 = chars.indexOf(b64.charAt(i++));
    var c1 = (e1 << 2) | (e2 >> 4);
    var c2 = ((e2 & 15) << 4) | (e3 >> 2);
    var c3 = ((e3 & 3) << 6) | e4;
    output += String.fromCharCode(c1);
    if (e3 !== 64) output += String.fromCharCode(c2);
    if (e4 !== 64) output += String.fromCharCode(c3);
  }
  return decodeURIComponent(escape(output));
};

LevelCache.prototype._bytesToStr = function (bytes) {
  var str = '';
  for (var i = 0; i < bytes.length; i++) {
    str += '%' + ('0' + bytes[i].toString(16)).slice(-2);
  }
  return decodeURIComponent(str);
};

module.exports = new LevelCache();
