// CloudCache.js — 云端资源缓存（图片等）
// 数据库 config.doc('asset_versions') 按文件名独立管理版本号。
// 文件名不存在 → 自动注册 version=1。
//
// 两类资源：
//   preload  — Loading 阶段立即下载
//   lazy     — Loading 阶段仅校验版本，首次访问时按需下载
//
// 缓存目录: USER_DATA_PATH/cache/img/
// 本地版本:  wx.Storage('cache_versions') = { "skins_rock_idle_1.png": 1 }

var cloud = require('../cloud.js');

var STORAGE_KEY = 'cache_versions';
var CACHE_DIR = wx.env.USER_DATA_PATH + '/cache/img/';

function CloudCache() {
  this._ready = false;
  this._pendingInit = null;
  this._localVersions = {};
  this._remoteVersions = {};
  this._needsDownload = {};    // path → true（版本变化/无缓存 → 需要下载）
  this._sessionCache = {};     // path → localPath（本次会话）
}

// ==================== 公开 API ====================

/**
 * 注册文件并校验版本（每个 session 调用一次）
 * @param {string[]} preloadFiles 预加载文件列表（立即下载）
 * @param {string[]} lazyFiles 按需下载文件列表（仅校验版本）
 * @returns {Promise<void>}
 */
CloudCache.prototype.init = async function (preloadFiles, lazyFiles) {
  if (this._ready) return;
  if (this._pendingInit) return this._pendingInit;

  var allFiles = (preloadFiles || []).concat(lazyFiles || []);
  if (allFiles.length === 0) { this._ready = true; return; }

  console.log('[CloudCache] init: 预加载 ' + (preloadFiles || []).length
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
  if (localOnly.length > 0) console.log('[CloudCache] 本地已有 ' + localOnly.length + ' 个，跳过云端');

  var self = this;
  this._pendingInit = (async function () {
    try {
      // 本地已存在的文件 → 直接注册（无版本跟踪）
      for (var li = 0; li < localOnly.length; li++) {
        var lf = localOnly[i];
        self._sessionCache[lf] = 'assets/' + lf;
        self._localVersions[lf] = -1;  // 标记为本地文件
      }

      if (cloudOnly.length === 0) { return; }  // 全部本地，无需云端

      // 读取本地版本记录
      try {
        var raw = wx.getStorageSync(STORAGE_KEY);
        if (raw) self._localVersions = Object.assign(self._localVersions, JSON.parse(raw));
      } catch (e) { /* 首次 */ }

      // 查询云端版本（仅 cloudOnly）
      var result = await cloud.getAssetConfig(cloudOnly);
      self._remoteVersions = result.versions || {};

      // 比对版本 → 标记需要下载的文件
      var needDownloadList = [];
      for (var i = 0; i < cloudOnly.length; i++) {
        var f = cloudOnly[i];
        var remoteVer = self._remoteVersions[f] || 0;
        var localVer = self._localVersions[f] || 0;
        var cachePath = self._cachePath(f);

        // 检查缓存文件是否存在
        var cacheExists = false;
        try {
          var fs = wx.getFileSystemManager();
          fs.accessSync(cachePath);
          cacheExists = true;
        } catch (e) {}

        if (remoteVer > 0 && localVer >= remoteVer && cacheExists) {
          // 版本一致 + 缓存存在 → 跳过
        } else {
          self._needsDownload[f] = true;
          if (remoteVer > 0) needDownloadList.push(f);
        }

        // 同步本地版本记录
        if (remoteVer > 0) self._localVersions[f] = remoteVer;
      }
      self._saveLocalVersions();

      console.log('[CloudCache] 需下载: ' + needDownloadList.length + ' 个 (' + needDownloadList.join(',') + ')');

      // 预加载文件：立即下载
      for (var j = 0; j < (preloadFiles || []).length; j++) {
        var pf = preloadFiles[j];
        if (self._needsDownload[pf]) {
          try {
            await self._doDownload(pf);
          } catch (e) {
            console.warn('[CloudCache] 预加载失败: ' + pf + ' ' + (e && e.message));
          }
        } else if (self._localVersions[pf] >= (self._remoteVersions[pf] || 0)) {
          // 已缓存，注册 session cache
          var cp = self._cachePath(pf);
          self._sessionCache[pf] = cp;
        }
      }
      console.log('[CloudCache] 版本校验完成');
    } catch (e) {
      console.warn('[CloudCache] 校验失败: ' + (e && e.message));
    } finally {
      self._ready = true;
      self._pendingInit = null;
    }
  })();

  return this._pendingInit;
};

/**
 * 下载云端图片（优先缓存，版本变化自动更新）
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

  // init 未注册此文件 → 直接下载不缓存
  if (!this._ready || this._remoteVersions[relativePath] === undefined) {
    var tp = await cloud.downloadCloudImage(relativePath);
    this._sessionCache[relativePath] = tp;
    return tp;
  }

  // 已缓存（版本一致）
  if (!this._needsDownload[relativePath]) {
    var cp = this._cachePath(relativePath);
    try {
      wx.getFileSystemManager().accessSync(cp);
      this._sessionCache[relativePath] = cp;
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
    console.warn('[CloudCache] 写入缓存失败: ' + relativePath + ' ' + (e && e.message));
  }

  // 更新本地版本
  if (this._remoteVersions[relativePath]) {
    this._localVersions[relativePath] = this._remoteVersions[relativePath];
    this._saveLocalVersions();
  }

  delete this._needsDownload[relativePath];
};

CloudCache.prototype._saveLocalVersions = function () {
  try { wx.setStorageSync(STORAGE_KEY, JSON.stringify(this._localVersions)); } catch (e) {}
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
