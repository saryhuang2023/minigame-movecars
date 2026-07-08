// 推猪消除 — 音频资源加载器
// 两层查找: 本地缓存 USER_DATA_PATH/audio/ → 云存储下载（音频为纯云资源，主包不打包 assets/audio/）
// 失败不阻塞游戏，静默降级
//
// 版本管理（v 改）: 使用统一 MD5 内容指纹机制，与图片 CloudCache 同源。
//   - 指纹来自云端 version.json（一个 JSON 文件放云存储 data/ 下，由 tools/gen_version.js 生成后手动上传）。
//     内容形如 { "data/audio/music/bgm_explore.mp3": "md5...", ... }（音频 key 与图片同构，均带 data/ 前缀）。
//   - 启动下载前调用 cloud.getAssetManifest() 拉取一次清单，抽取 audio/ 条目与本地缓存指纹比对；
//     仅当某文件指纹变化（云端内容已更新）时才丢弃本地缓存、重新下载。
//   - 本地指纹持久化在 wx.Storage(AUDIO_FP_KEY)，避免每次重新下载。
//   （原独立 version.txt + AUDIO_VERSION_KEY 方案已废弃删除）

var config = require('./AudioDefine.js');
var cloud = require('../cloud.js');

var _fs = wx.getFileSystemManager();
var _downloading = false;
var _files = {};       // filename → { sub, cachePath, loaded, resolvedPath, source }
var _totalCount = 0;
var _loadedCount = 0;
var _onProgress = null;
var _pendingFingerprints = null;  // { "audio/music/x.mp3": md5, ... } 云端返回的指纹表

/**
 * 收集所有需要加载的音频文件
 * 来源 = 配置引用的音频（MUSIC + SFX_EVENTS）∪ 清单里所有 audio/ 条目
 * 后者保证「云端存在的全部音频」都进入下载/缓存流程（需求：loading 一次性全量下载）。
 * @param {{key:string}} serverMap - 云端音频指纹表（可为 null）
 */
function _collectFiles(serverMap) {
  // 1) 配置引用的音频
  var seen = {};
  for (var track in config.MUSIC) {
    var file = config.MUSIC[track].file;
    if (!seen[file]) {
      seen[file] = true;
      _addFile(file, 'music');
    }
  }

  // SFX
  var seen2 = {};
  for (var key in config.SFX_EVENTS) {
    var files = config.SFX_EVENTS[key].files;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (!seen2[f]) {
        seen2[f] = true;
        _addFile(f, 'sfx');
      }
    }
  }

  // 2) 清单里所有 data/audio/ 条目（云端实际存在的音频，全部纳入缓存）
  if (serverMap) {
    for (var mk in serverMap) {
      if (!serverMap.hasOwnProperty(mk) || mk.indexOf('data/audio/') !== 0) continue;
      var rel = mk.substring('data/audio/'.length);      // 'music/bgm.mp3' | 'sfx/x.mp3'
      var slash = rel.indexOf('/');
      if (slash < 0) continue;
      var sub = rel.substring(0, slash);            // 'music' | 'sfx'
      var fname = rel.substring(slash + 1);
      if (fname && !_files[fname]) {
        _addFile(fname, sub);
      }
    }
  }

  _totalCount = Object.keys(_files).length;
  console.log('[AudioLoader] total files to resolve:', _totalCount);
}

function _addFile(filename, subdir) {
  var sub = subdir === 'music' ? 'music' : 'sfx';
  _files[filename] = {
    sub: sub,
    // 云缓存路径（音频为纯云资源，先查缓存，无则下载落缓存）
    cachePath: (sub === 'music' ? config.MUSIC_CACHE_DIR : config.SFX_CACHE_DIR) + filename,
    loaded: false,
    resolvedPath: null,  // 最终使用的路径
    source: 'none',      // 'cache' | 'cloud'
  };
}

/** 音频文件 → manifest key（与 version.json 中 audio/ 前缀一致） */
function _manifestKey(filename) {
  var sub = _files[filename] ? _files[filename].sub : 'sfx';
  return 'data/audio/' + sub + '/' + filename;
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
 * 两层查找单个文件
 * 1) 本地缓存 USER_DATA_PATH/audio/ → 2) 云存储下载（下载后落缓存）
 * 注：音频为纯云资源，主包不打包 assets/audio/（4MB 包体限制），故无「主包内置」层。
 */
function _resolveFile(filename) {
  var info = _files[filename];
  if (!info) return false;

  // ── 第一层：本地缓存 ──
  try {
    _fs.accessSync(info.cachePath);
    info.loaded = true;
    info.resolvedPath = info.cachePath;
    info.source = 'cache';
    console.log('[AudioLoader] ✓ cache :', filename);
    return true;
  } catch (e) { /* 未缓存，交给云端下载 */ }

  console.log('[AudioLoader] ✗ miss :', filename);
  return false;
}

/**
 * 检查所有本地缓存文件
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
    console.log('[cloud][AudioLoader] _downloadOne(' + filename + ') entry — info.loaded=' + info.loaded + ' info?' + !!info);
    if (info.loaded) { resolve(); return; }

    // 云存储未配置，标记为"已放弃"（loaded=true, resolvedPath=null）
    console.log('[cloud][AudioLoader] _downloadOne(' + filename + ') — check: isCloudEnabled=' + config.isCloudEnabled() + ' wx.cloud=' + !!wx.cloud + ' sub=' + info.sub);
    if (!config.isCloudEnabled() || !wx.cloud) {
      console.log('[cloud][AudioLoader] cloud disabled, skip:', filename);
      info.loaded = true;
      _loadedCount++;
      _notifyProgress();
      resolve();
      return;
    }

    var fileID = config.CLOUD_PREFIX + (info.sub === 'music' ? 'music/' : 'sfx/') + filename;
    console.log('[cloud][AudioLoader] _downloadOne(' + filename + ') — fileID=' + fileID + ' 即将调用 wx.cloud.downloadFile');
    console.log('[cloud][AudioLoader] downloading:', fileID);

    wx.cloud.downloadFile({
      fileID: fileID,
      success: function (res) {
        console.log('[cloud][AudioLoader] _downloadOne(' + filename + ') SUCCESS callback, statusCode=' + res.statusCode + ' tempFilePath=' + (res.tempFilePath ? 'YES' : 'NO'));
        if (res.statusCode === 200 && res.tempFilePath) {
          // 云下载返回的 tempFilePath 是 http://tmp/ 格式，FileSystemManager 读不了
          // 但作为 InnerAudioContext.src 完全可用。直接用它，不经过 readFileSync。
          info.loaded = true;
          info.resolvedPath = res.tempFilePath;
          info.source = 'cloud';
          console.log('[cloud][AudioLoader] ✓ cloud :', filename, '(session)');

          // 尝试复制到本地缓存（持久化），失败不阻塞
          try {
            _fs.saveFileSync(res.tempFilePath, info.cachePath);
            info.resolvedPath = info.cachePath;
            console.log('[cloud][AudioLoader] ✓ cached :', filename);
          } catch (e) {
            // 模拟器 saveFileSync 也可能失败，无所谓——本次会话 temp 路径可用
            console.log('[cloud][AudioLoader] _downloadOne(' + filename + ') — saveFile failed, will re-download next session');
          }
        } else {
          console.warn('[cloud][AudioLoader] ✗ cloud HTTP', res.statusCode || 'no tempFilePath', ':', filename);
          info.loaded = true;
        }
        _loadedCount++;
        _notifyProgress();
        resolve();
      },
      fail: function (err) {
        console.log('[cloud][AudioLoader] _downloadOne(' + filename + ') FAIL callback fired, errMsg=' + (err.errMsg || err.message || JSON.stringify(err)));
        console.warn('[cloud][AudioLoader] ✗ download :', filename, '—', err.errMsg);
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

// ===== 版本管理（MD5 指纹） =====

/**
 * 从清单中抽取音频指纹表（key 以 "audio/" 开头）
 * @param {object} manifest - version.json 内容
 * @returns {{key: md5}|null} 云端指纹表，或 null（跳过）
 */
function _extractAudioServerMap(manifest) {
  if (!config.isCloudEnabled() || !wx.cloud) {
    console.log('[cloud][AudioLoader] cloud disabled, skip fingerprint check');
    return null;
  }
  if (!manifest || typeof manifest !== 'object') return null;
  // 抽取 data/audio/ 开头条目组成服务端指纹表
  var serverMap = {};
  for (var k in manifest) {
    if (manifest.hasOwnProperty(k) && k.indexOf('data/audio/') === 0) {
      serverMap[k] = manifest[k];
    }
  }
  // 清单中没有任何 data/audio/ 条目：说明音频未纳入 version.json
  // （gen_version 未扫描到云端音频，或尚未重新生成清单）。
  // 此时返回 null，避免清空已保存的本地指纹、也避免误判导致缓存失效。
  if (Object.keys(serverMap).length === 0 && Object.keys(_files).length > 0) {
    console.log('[cloud][AudioLoader] 清单无 audio 条目，跳过指纹校验（保留本地缓存指纹）');
    return null;
  }
  console.log('[cloud][AudioLoader] fetched manifest, audio entries=' + Object.keys(serverMap).length);
  return serverMap;
}

/**
 * 比对云端指纹与本地指纹，删除内容已变文件的本地缓存
 */
function _invalidateChangedCache(serverMap) {
  if (!serverMap) return;
  var localMap = {};
  try { localMap = JSON.parse(wx.getStorageSync(config.AUDIO_FP_KEY) || '{}'); } catch (e) {}
  for (var fn in _files) {
    var key = _manifestKey(fn);
    var serverMd5 = serverMap[key];
    if (serverMd5 && localMap[key] && localMap[key] !== serverMd5) {
      // 云端内容已更新 → 丢弃旧缓存，强制重新下载
      try { _fs.unlinkSync(_files[fn].cachePath); } catch (e) {}
      console.log('[cloud][AudioLoader] fingerprint changed, drop cache:', fn);
    }
  }
}

/**
 * 下载完成后保存云端指纹表
 */
function _saveFingerprints() {
  if (_pendingFingerprints) {
    try {
      wx.setStorageSync(config.AUDIO_FP_KEY, JSON.stringify(_pendingFingerprints));
      console.log('[cloud][AudioLoader] fingerprints saved (' + Object.keys(_pendingFingerprints).length + ' entries)');
    } catch (e) {}
    _pendingFingerprints = null;
  }
}

/**
 * 启动后台解析 + 下载（fire-and-forget）
 * @param {Function} onProgress - (progress: 0~1, loaded: number, total: number)
 * @returns {Promise} 完成
 */
function startDownload(onProgress) {
  console.log('[cloud][AudioLoader] AudioLoader.startDownload() — _downloading=' + _downloading + ' isCloudEnabled=' + config.isCloudEnabled());
  if (_downloading) { console.log('[cloud][AudioLoader] AudioLoader.startDownload() — already downloading, skipping'); return Promise.resolve(); }
  _downloading = true;
  _onProgress = onProgress || null;

  _ensureDirs();

  // ── 拉取清单 + 收集文件 + 指纹检测：云端内容更新 → 清对应缓存重拉 ──
  return cloud.getAssetManifest().then(function (manifest) {
    var serverMap = _extractAudioServerMap(manifest);
    _pendingFingerprints = serverMap;

    // 收集文件：配置引用 ∪ 清单全部 audio/ 条目（全量下载进缓存）
    _collectFiles(serverMap);
    _invalidateChangedCache(serverMap);

    // 第一轮：检查所有本地来源
    _checkAllLocal();

    // 第二轮：云存储下载剩余文件
    var names = Object.keys(_files);
    var pending = names.filter(function (f) { return !_files[f].loaded; });
    console.log('[cloud][AudioLoader] AudioLoader — after _checkAllLocal: total=' + names.length + ' loaded=' + _loadedCount + ' pending=' + pending.length);

    if (pending.length > 0 && !config.isCloudEnabled()) {
      console.log('[cloud][AudioLoader]', pending.length, 'files not found. Upload audio to cloud storage, then call AudioConfig.setCloudPrefix(fileID).');
    }

    if (pending.length === 0 || !config.isCloudEnabled()) {
      console.log('[cloud][AudioLoader] AudioLoader — skipping cloud download: pending=' + pending.length + ' isCloudEnabled=' + config.isCloudEnabled());
      _downloading = false;
      _saveFingerprints();
      return Promise.resolve();
    }

    console.log('[cloud][AudioLoader] AudioLoader — PROCEEDING to cloud download, pending=' + pending.length + ' CONCURRENCY=4');
    console.log('[cloud][AudioLoader] ▸ downloading', pending.length, 'from cloud...');
    var CONCURRENCY = 4;
    function downloadBatch() {
      console.log('[cloud][AudioLoader] downloadBatch() — pending.length=' + pending.length);
      if (pending.length === 0) return Promise.resolve();
      var batch = pending.splice(0, CONCURRENCY);
      console.log('[cloud][AudioLoader] downloadBatch() — batch=[' + batch.join(',') + ']');
      return Promise.all(batch.map(_downloadOne)).then(downloadBatch);
    }

    return downloadBatch().then(function () {
      _downloading = false;
      _saveFingerprints();
      var summary = _getSummary();
      console.log('[cloud][AudioLoader] done:', summary);
    });
  }).catch(function(err) {
    console.error('[cloud][AudioLoader] AudioLoader — FATAL error in download chain:', err && err.message || err);
    _downloading = false;
  });
}

function _getSummary() {
  var cache = 0, cloud = 0, miss = 0;
  var names = Object.keys(_files);
  for (var i = 0; i < names.length; i++) {
    var s = _files[names[i]].source;
    if (s === 'cache') cache++;
    else if (s === 'cloud') cloud++;
    else miss++;
  }
  return 'cache=' + cache + ' cloud=' + cloud + ' miss=' + miss;
}

/**
 * 获取文件实际路径（缓存 > null）
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
