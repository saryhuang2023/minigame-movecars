// CloudCache.js — 云端资源缓存（图片等）
// 采用 MD5 内容指纹（manifest，来自云端 version.json）做版本控制，替代原先的数字 version 号。
// 设计目标（用户需求）：
//   1. 云端内容与本地缓存不一致才重新下载；
//   2. 尽可能少的网络交互（仅启动时拉一次 version.json，按需才下载文件）；
//   3. 所有云端图片都纳入本机制（不只 loading 阶段）。
//
// 指纹来源：version.json（一个 JSON 文件放云存储 data/ 下），由 tools/gen_version.js 本地生成后手动上传。
//           内容形如 { "data/skins/rock/idle/1.png": "md5...", ... }。
//           客户端启动时调用 cloud.getAssetManifest() 拉取一次，与本地缓存指纹比对。
//
// manifest key 约定：
//   图片  → "data/" + relativePath （relativePath 即 downloadImage 入参，如 "skins/rock/idle/1.png"）
//   音频  → 见 AudioLoader（"data/audio/music/..." / "data/audio/sfx/..."）
// 客户端内部仍以 relativePath 索引，仅在查 manifest 时拼成完整 key。
//
// 两类资源：
//   preload  — Loading 阶段立即下载
//   lazy     — Loading 阶段仅校验指纹，首次访问时按需下载
//
// 缓存目录: USER_DATA_PATH/cache/img/
// 本地指纹:  wx.Storage('cache_versions') = { "skins/rock/idle/1.png": "md5..." }

var cloud = require('../cloud.js');

var STORAGE_KEY = 'cache_versions';
var CACHE_DIR = wx.env.USER_DATA_PATH + '/cache/img/';

function CloudCache() {
  this._ready = false;
  this._pendingInit = null;
  this._localVersions = {};     // relativePath → md5（string）或 null（本地内置文件）
  this._remoteVersions = {};    // relativePath → md5（string）或 null（云端未登记）
  this._needsDownload = {};     // relativePath → true（指纹变化/无缓存 → 需要下载）
  this._sessionCache = {};      // relativePath → localPath（本次会话）
  this._localVersionsLoaded = false; // 是否已从 Storage 恢复本地指纹
}

// relativePath → manifest key
CloudCache.prototype._toKey = function (relativePath) {
  return 'data/' + relativePath;
};

// ==================== 公开 API ====================

/**
 * 注册文件并校验指纹（每个 session 调用一次）
 * @param {string[]} preloadFiles 预加载文件列表（立即下载）
 * @param {string[]} lazyFiles 按需下载文件列表（仅校验指纹）
 * @returns {Promise<void>}
 */
CloudCache.prototype.init = async function (preloadFiles, lazyFiles) {
  if (this._ready) return;
  if (this._pendingInit) return this._pendingInit;

  var allFiles = (preloadFiles || []).concat(lazyFiles || []);
  if (allFiles.length === 0) { this._ready = true; return; }

  console.log('[cloud][CloudCache] init: 预加载 ' + (preloadFiles || []).length
    + ' + 按需 ' + (lazyFiles || []).length + ' = ' + allFiles.length + ' 个文件');

  // 分离：本地已有 vs 仅云端
  var localOnly = [];    // assets/ 目录已存在 → 跳过云端
  var cloudOnly = [];    // 需要走云端校验
  for (var k = 0; k < allFiles.length; k++) {
    if (_assetExists(allFiles[k])) {
      localOnly.push(allFiles[k]);
    } else {
      cloudOnly.push(allFiles[k]);
    }
  }
  if (localOnly.length > 0) console.log('[cloud][CloudCache] 本地已有 ' + localOnly.length + ' 个，跳过云端');

  var self = this;
  this._pendingInit = (async function () {
    try {
      // 本地已存在的文件 → 直接注册（无指纹跟踪）
      for (var li = 0; li < localOnly.length; li++) {
        var lf = localOnly[li];
        self._sessionCache[lf] = 'assets/' + lf;
        self._localVersions[lf] = null;  // 标记为本地文件
      }

      if (cloudOnly.length === 0) { return; }  // 全部本地，无需云端

      // 读取本地指纹记录
      try {
        var raw = wx.getStorageSync(STORAGE_KEY);
        if (raw) self._localVersions = Object.assign(self._localVersions, JSON.parse(raw));
      } catch (e) { /* 首次 */ }

      // 拉取云端资源清单 version.json（模块级缓存，整个 session 只拉一次）
      // 独立 try：清单拉取失败不影响资源下载，降级为「全部重新下载」
      try {
        var t0 = Date.now();
        var manifest = await cloud.getAssetManifest();
        console.log('[cloud][CloudCache] 清单返回 ' + (Date.now() - t0) + 'ms, 共 ' + Object.keys(manifest || {}).length + ' 条');
        for (var i = 0; i < cloudOnly.length; i++) {
          var f = cloudOnly[i];
          var key = self._toKey(f);
          self._remoteVersions[f] = (manifest[key] != null) ? manifest[key] : null;
        }
      } catch (e) {
        console.error('[cloud][CloudCache] 清单拉取失败（降级：全部重新下载） errCode=' + (e && e.errCode) + ' ' + (e && e.message));
        for (var k2 = 0; k2 < cloudOnly.length; k2++) {
          // 置 null 避免 downloadImage 懒路径再次触发清单拉取；
          // 置 needsDownload 直接重新下载
          self._remoteVersions[cloudOnly[k2]] = null;
          self._needsDownload[cloudOnly[k2]] = true;
        }
      }

      // 比对指纹 → 标记需要下载的文件（仅在指纹校验成功时执行）
      var needDownloadList = [];
      var skipList = [];
      for (var j = 0; j < cloudOnly.length; j++) {
        var ff = cloudOnly[j];
        if (self._needsDownload[ff]) { continue; } // 已因校验失败标记为下载
        var remoteMd5 = self._remoteVersions[ff];
        var localMd5 = self._localVersions[ff] || null;
        var cachePath = self._cachePath(ff);

        // 检查缓存文件是否存在
        var cacheExists = false;
        try {
          wx.getFileSystemManager().accessSync(cachePath);
          cacheExists = true;
        } catch (e) {}

        // 远端指纹与本地指纹一致，且缓存文件存在 → 跳过
        if (remoteMd5 && localMd5 === remoteMd5 && cacheExists) {
          skipList.push(ff);
        } else {
          self._needsDownload[ff] = true;
          var reason = !remoteMd5 ? '无指纹(直下)'
            : (!cacheExists ? '无本地缓存' : '内容变更');
          needDownloadList.push(ff + '(' + reason + ')');
        }
      }
      self._saveLocalVersions();

      console.log('[cloud][CloudCache] 跳过(命中): ' + skipList.length +
        ' | 需下载: ' + needDownloadList.length + ' 个 → ' + needDownloadList.join(', '));

      // 预加载文件：立即下载
      for (var p = 0; p < (preloadFiles || []).length; p++) {
        var pf = preloadFiles[p];
        if (self._needsDownload[pf]) {
          try {
            await self._doDownload(pf);
          } catch (e) {
            console.warn('[cloud][CloudCache] 预加载失败: ' + pf + ' ' + (e && e.message));
          }
        } else if (self._localVersions[pf] != null) {
          // 已缓存且一致，注册 session cache
          var cp = self._cachePath(pf);
          try {
            wx.getFileSystemManager().accessSync(cp);
            self._sessionCache[pf] = cp;
          } catch (e) { /* 缓存丢失，下载逻辑会在访问时补 */ }
        }
      }
      console.log('[cloud][CloudCache] 指纹校验完成');
    } catch (e) {
      console.warn('[cloud][CloudCache] 校验失败: ' + (e && e.message));
    } finally {
      self._ready = true;
      self._pendingInit = null;
    }
  })();

  return this._pendingInit;
};

/**
 * 下载云端图片（优先缓存，指纹变化自动更新）
 * 所有云端图片都走本方法 → 全部纳入指纹机制（含未预注册的动态下载）
 * @param {string} relativePath
 * @returns {Promise<string>} 本地文件路径
 */
CloudCache.prototype.downloadImage = async function (relativePath) {
  if (this._sessionCache[relativePath]) return this._sessionCache[relativePath];

  // 本地 assets 存在 → 直接用
  if (_assetExists(relativePath)) {
    this._sessionCache[relativePath] = 'assets/' + relativePath;
    return 'assets/' + relativePath;
  }

  // 等待 init 完成
  if (this._pendingInit) {
    try { await this._pendingInit; } catch (e) {}
  }

  // 未注册（init 没覆盖到）→ 按需查清单并判定是否需要下载
  // 不再走"不缓存直下"旁路：任何云端图片都必须先校验指纹再决定是否缓存
  // 关键：冷启动时 _localVersions 尚未从 Storage 恢复，必须先加载，否则 localMd5 恒为 null
  //       导致指纹比对永远失败、每次都重新下载（#2026-07-08 修复）
  if (!this._localVersionsLoaded) {
    this._loadLocalVersions();
    this._localVersionsLoaded = true;
  }
  if (!this._ready || this._remoteVersions[relativePath] === undefined) {
    try {
      var key = this._toKey(relativePath);
      var manifest = await cloud.getAssetManifest();
      var remoteMd5 = (manifest[key] != null) ? manifest[key] : null;
      this._remoteVersions[relativePath] = remoteMd5;

      // 与本地指纹比对，决定是否需下载
      var localMd5 = this._localVersions[relativePath] || null;
      var cachePath = this._cachePath(relativePath);
      var cacheExists = false;
      try { wx.getFileSystemManager().accessSync(cachePath); cacheExists = true; } catch (e) {}
      if (!(remoteMd5 && localMd5 === remoteMd5 && cacheExists)) {
        this._needsDownload[relativePath] = true;
      }
    } catch (e) {
      console.warn('[cloud][CloudCache] 按需清单查询失败: ' + relativePath + ' ' + (e && e.message));
      this._remoteVersions[relativePath] = null;
    }
  }

  // 已缓存（指纹一致）
  if (!this._needsDownload[relativePath]) {
    var cp = this._cachePath(relativePath);
    try {
      wx.getFileSystemManager().accessSync(cp);
      this._sessionCache[relativePath] = cp;
      console.log('[cloud][CloudCache] 命中缓存: ' + relativePath);
      return cp;
    } catch (e) { /* 缓存丢失，继续下载 */ }
  }

  // 需要下载
  await this._doDownload(relativePath);
  var cp2 = this._cachePath(relativePath);
  this._sessionCache[relativePath] = cp2;
  return cp2;
};

// ==================== 内部 ====================

CloudCache.prototype._doDownload = async function (relativePath) {
  var cachePath = this._cachePath(relativePath);
  var tempPath = await cloud.downloadCloudImage(relativePath);

  try {
    var fs = wx.getFileSystemManager();
    this._ensureDir();
    try { fs.unlinkSync(cachePath); } catch (e) {}
    fs.copyFileSync(tempPath, cachePath);
  } catch (e) {
    console.warn('[cloud][CloudCache] 写入缓存失败: ' + relativePath + ' ' + (e && e.message));
  }

  // 用云端指纹作为本地指纹（信任云端计算结果）
  if (this._remoteVersions[relativePath] != null) {
    this._localVersions[relativePath] = this._remoteVersions[relativePath];
    this._saveLocalVersions();
  }

  delete this._needsDownload[relativePath];
};

CloudCache.prototype._saveLocalVersions = function () {
  try { wx.setStorageSync(STORAGE_KEY, JSON.stringify(this._localVersions)); } catch (e) {}
};

// 从 Storage 恢复本地指纹表（冷启动必须：否则 _localVersions 恒空 → 指纹比对失效 → 每次重下）
CloudCache.prototype._loadLocalVersions = function () {
  try {
    var raw = wx.getStorageSync(STORAGE_KEY);
    if (raw) {
      var parsed = JSON.parse(raw);
      this._localVersions = Object.assign(this._localVersions, parsed);
      console.log('[cloud][CloudCache] 已从本地存储恢复 ' + Object.keys(parsed).length + ' 条指纹');
    }
  } catch (e) {}
};

CloudCache.prototype._ensureDir = function () {
  try {
    var fs = wx.getFileSystemManager();
    fs.accessSync(CACHE_DIR);
  } catch (e) { fs.mkdirSync(CACHE_DIR, true); }
};

CloudCache.prototype._cachePath = function (relativePath) {
  return CACHE_DIR + relativePath.replace(/\//g, '_');
};

/** 检查本地 assets/ 目录是否存在该文件 */
function _assetExists(relativePath) {
  try {
    var fs = wx.getFileSystemManager();
    fs.accessSync('assets/' + relativePath);
    return true;
  } catch (e) { return false; }
}

module.exports = new CloudCache();
