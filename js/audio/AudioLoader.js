// 推猪消除 — 音频资源加载器
// 三层查找: 主包 assets/audio/ → 本地缓存 USER_DATA_PATH/audio/ → 云存储下载
// 失败不阻塞游戏，静默降级

var config = require('./AudioDefine.js');

var _fs = wx.getFileSystemManager();
var _downloading = false;
var _files = {};       // filename → { localPath, loaded, source }
var _totalCount = 0;
var _loadedCount = 0;
var _onProgress = null;
var _pendingVersion = null;  // 云版本号，下载完成后写入本地

/**
 * 收集所有需要加载的音频文件
 */
function _collectFiles() {
  // 音乐（遍历 MUSIC 配置中所有曲目）
  var seen = {};
  for (var track in config.MUSIC) {
    var file = config.MUSIC[track].file;
    if (!seen[file]) {
      seen[file] = true;
      _addFile(file, 'music');
    }
  }

  // SFX
  var seen = {};
  for (var key in config.SFX_EVENTS) {
    var files = config.SFX_EVENTS[key].files;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (!seen[f]) {
        seen[f] = true;
        _addFile(f, 'sfx');
      }
    }
  }
  _totalCount = Object.keys(_files).length;
  console.log('[AudioLoader] total files to resolve:', _totalCount);
}

function _addFile(filename, subdir) {
  var sub = subdir === 'music' ? 'music' : 'sfx';
  _files[filename] = {
    // 主包路径
    localPkgPath: (sub === 'music' ? config.LOCAL_MUSIC_DIR : config.LOCAL_SFX_DIR) + filename,
    // 云缓存路径
    cachePath: (sub === 'music' ? config.MUSIC_CACHE_DIR : config.SFX_CACHE_DIR) + filename,
    loaded: false,
    resolvedPath: null,  // 最终使用的路径
    source: 'none',      // 'pkg' | 'cache' | 'cloud'
  };
}

/**
 * 确保缓存目录存在
 */
function _ensureDirs() {
  try { _fs.accessSync(config.CACHE_DIR); }
  catch (e) { _fs.mkdirSync(config.CACHE_DIR, true); }
  try { _fs.accessSync(config.SFX_CACHE_DIR); }
  catch (e) { _fs.mkdirSync(config.SFX_CACHE_DIR, true); }
  try { _fs.accessSync(config.MUSIC_CACHE_DIR); }
  catch (e) { _fs.mkdirSync(config.MUSIC_CACHE_DIR, true); }
}

/**
 * 三层查找单个文件
 * 1) 主包 assets/audio/ → 2) 云缓存 USER_DATA_PATH/audio/ → 3) 云存储下载
 */
function _resolveFile(filename) {
  var info = _files[filename];
  if (!info) return false;

  // ── 第一层：主包内置 ──
  try {
    _fs.accessSync(info.localPkgPath);
    info.loaded = true;
    info.resolvedPath = info.localPkgPath;
    info.source = 'pkg';
    console.log('[AudioLoader] ✓ pkg :', filename);
    return true;
  } catch (e) { /* 文件不在主包 */ }

  // ── 第二层：本地缓存 ──
  try {
    _fs.accessSync(info.cachePath);
    info.loaded = true;
    info.resolvedPath = info.cachePath;
    info.source = 'cache';
    console.log('[AudioLoader] ✓ cache :', filename);
    return true;
  } catch (e) { /* 未缓存 */ }

  console.log('[AudioLoader] ✗ miss :', filename);
  return false;
}

/**
 * 检查所有本地文件（主包 + 缓存）
 */
function _checkAllLocal() {
  var names = Object.keys(_files);
  for (var i = 0; i < names.length; i++) {
    if (_resolveFile(names[i])) {
      _loadedCount++;
    }
  }
  _notifyProgress();
}

/**
 * 从云存储下载单个文件
 */
function _downloadOne(filename) {
  return new Promise(function (resolve) {
    var info = _files[filename];
    console.log('[LOG] _downloadOne(' + filename + ') entry — info.loaded=' + info.loaded + ' info?' + !!info);
    if (info.loaded) { resolve(); return; }

    // 云存储未配置，标记为"已放弃"（loaded=true, resolvedPath=null）
    console.log('[LOG] _downloadOne(' + filename + ') — check: isCloudEnabled=' + config.isCloudEnabled() + ' wx.cloud=' + !!wx.cloud + ' localPkgPath=' + (info.localPkgPath || 'UNDEFINED'));
    if (!config.isCloudEnabled() || !wx.cloud) {
      console.log('[AudioLoader] cloud disabled, skip:', filename);
      info.loaded = true;
      _loadedCount++;
      _notifyProgress();
      resolve();
      return;
    }

    var fileID = config.CLOUD_PREFIX + (info.localPkgPath.indexOf('music') >= 0 ? 'music/' : 'sfx/') + filename;
    console.log('[LOG] _downloadOne(' + filename + ') — fileID=' + fileID + ' 即将调用 wx.cloud.downloadFile');
    console.log('[AudioLoader] downloading:', fileID);

    wx.cloud.downloadFile({
      fileID: fileID,
      success: function (res) {
        console.log('[LOG] _downloadOne(' + filename + ') SUCCESS callback, statusCode=' + res.statusCode + ' tempFilePath=' + (res.tempFilePath ? 'YES' : 'NO'));
        if (res.statusCode === 200 && res.tempFilePath) {
          // 云下载返回的 tempFilePath 是 http://tmp/ 格式，FileSystemManager 读不了
          // 但作为 InnerAudioContext.src 完全可用。直接用它，不经过 readFileSync。
          info.loaded = true;
          info.resolvedPath = res.tempFilePath;
          info.source = 'cloud';
          console.log('[AudioLoader] ✓ cloud :', filename, '(session)');

          // 尝试复制到本地缓存（持久化），失败不阻塞
          try {
            _fs.saveFileSync(res.tempFilePath, info.cachePath);
            info.resolvedPath = info.cachePath;
            console.log('[AudioLoader] ✓ cached :', filename);
          } catch (e) {
            // 模拟器 saveFileSync 也可能失败，无所谓——本次会话 temp 路径可用
            console.log('[LOG] _downloadOne(' + filename + ') — saveFile failed, will re-download next session');
          }
        } else {
          console.warn('[AudioLoader] ✗ cloud HTTP', res.statusCode || 'no tempFilePath', ':', filename);
          info.loaded = true;
        }
        _loadedCount++;
        _notifyProgress();
        resolve();
      },
      fail: function (err) {
        console.log('[LOG] _downloadOne(' + filename + ') FAIL callback fired, errMsg=' + (err.errMsg || err.message || JSON.stringify(err)));
        console.warn('[AudioLoader] ✗ download :', filename, '—', err.errMsg);
        // 不标记 loaded — 保持可重试；下次 _resolveFile 如果缓存里有了就能捡起来
        _loadedCount++;
        _notifyProgress();
        resolve();
      },
    });
  });
}

function _notifyProgress() {
  if (_onProgress) {
    var progress = _totalCount > 0 ? Math.min(_loadedCount / _totalCount, 1) : 1;
    _onProgress(progress, _loadedCount, _totalCount);
  }
}

// ===== 公开 API =====

/**
 * 下载并比对云版本号，不一致则清空本地缓存
 * @returns {Promise<string|null>} 云版本号，或 null（跳过检查）
 */
function _checkVersionAndSync() {
  console.log('[LOG] _checkVersionAndSync() — isCloudEnabled=' + config.isCloudEnabled() + ' wx.cloud=' + !!wx.cloud + ' prefix=' + (config.CLOUD_PREFIX || '(empty)'));
  if (!config.isCloudEnabled() || !wx.cloud) {
    console.log('[LOG] _checkVersionAndSync() — SKIPPED: isCloudEnabled=' + config.isCloudEnabled() + ' wx.cloud=' + !!wx.cloud);
    return Promise.resolve(null);
  }

  var versionFileID = config.CLOUD_PREFIX + config.VERSION_FILE;
  console.log('[AudioLoader] checking version:', versionFileID);

  return new Promise(function (resolve) {
    wx.cloud.downloadFile({
      fileID: versionFileID,
      success: function (res) {
        if (res.statusCode !== 200 || !res.tempFilePath) {
          console.warn('[AudioLoader] version check: HTTP', res.statusCode || 'no tempFilePath', '— proceeding without version sync');
          resolve(null);
          return;
        }
        try {
          var cloudVersion = _fs.readFileSync(res.tempFilePath, 'utf-8').trim();
          var localVersion = wx.getStorageSync(config.AUDIO_VERSION_KEY) || '';
          console.log('[AudioLoader] version compare: cloud=' + cloudVersion + ' local=' + (localVersion || '(none)'));

          if (cloudVersion && cloudVersion !== localVersion) {
            console.log('[AudioLoader] version mismatch — clearing cache...');
            _clearCache();
            resolve(cloudVersion);
          } else if (!cloudVersion) {
            console.warn('[AudioLoader] version.txt is empty — skipping');
            resolve(null);
          } else {
            console.log('[AudioLoader] version match — cache is up to date');
            resolve(null);
          }
        } catch (e) {
          console.warn('[AudioLoader] version read error:', e.message);
          resolve(null);
        }
      },
      fail: function (err) {
        console.warn('[AudioLoader] version check failed:', err.errMsg, '— proceeding without version sync');
        resolve(null);
      },
    });
  });
}

/**
 * 清空音频缓存目录，重置所有文件状态
 */
function _clearCache() {
  try {
    // 递归删除整个 audio 目录
    _rmdirRecursive(config.CACHE_DIR);
  } catch (e) {
    console.warn('[AudioLoader] clear cache error:', e.message);
  }
  // 重新创建目录
  _ensureDirs();
  // 重置所有文件状态（让 _checkAllLocal 重新判断）
  var names = Object.keys(_files);
  for (var i = 0; i < names.length; i++) {
    var info = _files[names[i]];
    info.loaded = false;
    info.resolvedPath = null;
    info.source = 'none';
  }
  _loadedCount = 0;
  // 清除本地版本号（等下载完成后再写新的）
  try { wx.removeStorageSync(config.AUDIO_VERSION_KEY); } catch (e) {}
}

/**
 * 递归删除目录
 */
function _rmdirRecursive(dirPath) {
  // 去掉末尾斜杠，统一路径拼接
  var base = dirPath.replace(/\/+$/, '');
  try {
    var files = _fs.readdirSync(base);
    for (var i = 0; i < files.length; i++) {
      var fullPath = base + '/' + files[i];
      try {
        var stat = _fs.statSync(fullPath);
        if (stat.isDirectory()) {
          _rmdirRecursive(fullPath);
        } else {
          _fs.unlinkSync(fullPath);
        }
      } catch (e) {
        // 文件/目录可能不存在，跳过
      }
    }
    _fs.rmdirSync(base);
  } catch (e) {
    // 目录不存在则无需删除
  }
}

/**
 * 启动后台解析 + 下载（fire-and-forget）
 * @param {Function} onProgress - (progress: 0~1, loaded: number, total: number)
 * @returns {Promise} 完成
 */
function startDownload(onProgress) {
  console.log('[LOG] AudioLoader.startDownload() — _downloading=' + _downloading + ' isCloudEnabled=' + config.isCloudEnabled());
  if (_downloading) { console.log('[LOG] AudioLoader.startDownload() — already downloading, skipping'); return Promise.resolve(); }
  _downloading = true;
  _onProgress = onProgress || null;

  _ensureDirs();
  _collectFiles();

  // ── 版本检测：云端更新 → 清缓存重拉 ──
  return _checkVersionAndSync().then(function (newVersion) {
    console.log('[LOG] AudioLoader — _checkVersionAndSync resolved, newVersion=' + newVersion + ' isCloudEnabled=' + config.isCloudEnabled());
    _pendingVersion = newVersion;

    // 第一轮：检查所有本地来源
    _checkAllLocal();

    // 第二轮：云存储下载剩余文件
    var names = Object.keys(_files);
    var pending = names.filter(function (f) { return !_files[f].loaded; });
    console.log('[LOG] AudioLoader — after _checkAllLocal: total=' + names.length + ' loaded=' + _loadedCount + ' pending=' + pending.length);

    if (pending.length > 0 && !config.isCloudEnabled()) {
      console.log('[AudioLoader]', pending.length, 'files not found. Upload audio to cloud storage, then call AudioConfig.setCloudPrefix(fileID).');
    }

    if (pending.length === 0 || !config.isCloudEnabled()) {
      console.log('[LOG] AudioLoader — skipping cloud download: pending=' + pending.length + ' isCloudEnabled=' + config.isCloudEnabled());
      _downloading = false;
      _saveVersion();
      return Promise.resolve();
    }

    console.log('[LOG] AudioLoader — PROCEEDING to cloud download, pending=' + pending.length + ' CONCURRENCY=4');
    console.log('[AudioLoader] ▸ downloading', pending.length, 'from cloud...');
    var CONCURRENCY = 4;
    function downloadBatch() {
      console.log('[LOG] downloadBatch() — pending.length=' + pending.length);
      if (pending.length === 0) return Promise.resolve();
      var batch = pending.splice(0, CONCURRENCY);
      console.log('[LOG] downloadBatch() — batch=[' + batch.join(',') + ']');
      return Promise.all(batch.map(_downloadOne)).then(downloadBatch);
    }

    return downloadBatch().then(function () {
      _downloading = false;
      _saveVersion();
      var summary = _getSummary();
      console.log('[AudioLoader] done:', summary);
    });
  }).catch(function(err) {
    console.error('[LOG] AudioLoader — FATAL error in download chain:', err && err.message || err);
    _downloading = false;
  });
}

/**
 * 下载完成后保存版本号
 */
function _saveVersion() {
  if (_pendingVersion) {
    wx.setStorageSync(config.AUDIO_VERSION_KEY, _pendingVersion);
    console.log('[AudioLoader] version saved:', _pendingVersion);
    _pendingVersion = null;
  }
}

function _getSummary() {
  var pkg = 0, cache = 0, cloud = 0, miss = 0;
  var names = Object.keys(_files);
  for (var i = 0; i < names.length; i++) {
    var s = _files[names[i]].source;
    if (s === 'pkg') pkg++;
    else if (s === 'cache') cache++;
    else if (s === 'cloud') cloud++;
    else miss++;
  }
  return 'pkg=' + pkg + ' cache=' + cache + ' cloud=' + cloud + ' miss=' + miss;
}

/**
 * 获取文件实际路径（主包 > 缓存 > null）
 * @param {string} filename
 * @returns {string|null}
 */
function getLocalPath(filename) {
  var info = _files[filename];
  if (info && info.loaded && info.resolvedPath) {
    return info.resolvedPath;
  }
  if (!info) {
    console.warn('[AudioLoader] getLocalPath: unknown file', filename);
  } else if (!info.loaded) {
    console.warn('[AudioLoader] getLocalPath: not loaded', filename, 'source=' + info.source);
  }
  return null;
}

/**
 * 获取下载进度
 */
function getProgress() {
  if (_totalCount === 0) return 1;
  return Math.min(_loadedCount / _totalCount, 1);
}

/**
 * 是否全部就绪
 */
function isReady() {
  return _totalCount > 0 && _loadedCount >= _totalCount;
}

/**
 * 诊断：打印所有文件的状态
 */
function diagnostics() {
  var names = Object.keys(_files);
  console.log('[AudioLoader] diagnostics ─── ' + names.length + ' files ───');
  console.log('  cloud enabled:', config.isCloudEnabled());
  console.log('  cloud prefix:', config.CLOUD_PREFIX || '(not set)');
  for (var i = 0; i < names.length; i++) {
    var info = _files[names[i]];
    console.log('  ' + names[i] + ' → ' + info.source + ' [' + (info.resolvedPath || 'unresolved') + ']');
  }
}

/**
 * 即时解析单个文件（供 SfxPlayer 兜底）
 * 当 getLocalPath 返回 null 时调用，检查文件是否刚下载完
 */
function _syncResolve(filename) {
  var wasLoaded = _files[filename] && _files[filename].loaded;
  _resolveFile(filename);
  var nowLoaded = _files[filename] && _files[filename].loaded;
  if (!wasLoaded && nowLoaded) {
    console.log('[AudioLoader] syncResolve recovered:', filename);
  }
}

module.exports = {
  startDownload: startDownload,
  getLocalPath: getLocalPath,
  getProgress: getProgress,
  isReady: isReady,
  diagnostics: diagnostics,
  _syncResolve: _syncResolve,
};
