// 推猪消除 — 音频管理器（单例门面）
// 统一对外接口，内部组合 SfxPlayer + MusicPlayer + AudioLoader

var config = require('./AudioDefine.js');
var loader = require('./AudioLoader.js');
var sfx = require('./SfxPlayer.js');
var music = require('./MusicPlayer.js');

var _initialized = false;
var _initPromise = null;

// 音乐/音效独立开关（持久化到 storage）
var _musicEnabled = true;
var _sfxEnabled = true;
var _lastMusicScene = null;  // 记录最后播放的场景，用于恢复

(function _loadPrefs() {
  try {
    var me = wx.getStorageSync('audio_music_enabled');
    if (me === false || me === 'false') _musicEnabled = false;
  } catch (e) {}
  try {
    var se = wx.getStorageSync('audio_sfx_enabled');
    if (se === false || se === 'false') _sfxEnabled = false;
  } catch (e) {}
})();

// ===== 内部 =====

function _ensureInit() {
  if (_initialized) return;
  _initialized = true;
  sfx.init();
  music.init();
}

// ===== 公开 API =====

/**
 * 启动音频系统 + 后台下载音频文件
 * @param {Function} onProgress - (progress: 0~1) 下载进度回调
 * @returns {Promise}
 */
function init(onProgress) {
  console.log('[LOG] AudioManager.init() called, _initPromise=' + (!!_initPromise) + ' _initialized=' + _initialized);
  if (_initPromise) { console.log('[LOG] AudioManager.init() — already initialized, skipping'); return _initPromise; }

  _ensureInit();

  console.log('[cloud][AudioManager] AudioManager.init() — calling loader.startDownload(), isCloudEnabled=' + config.isCloudEnabled() + ' wx.cloud=' + !!wx.cloud + ' prefix=' + config.CLOUD_PREFIX);
  _initPromise = loader.startDownload(function (progress, loaded, total) {
    if (onProgress) onProgress(progress);
    console.log('[cloud][Audio] download progress:', Math.round(progress * 100) + '%', loaded + '/' + total);
  }).then(function () {
    console.log('[cloud][Audio] all files ready');
  }).catch(function (err) {
    console.warn('[Audio] download error:', err);
  });

  return _initPromise;
}

/**
 * 播放一次音效
 * @param {string} eventName - 事件名，如 'collide', 'escape', 'victory'
 * @param {Object} opts - { rate: number } 可选变调
 */
function play(eventName, opts) {
  if (!_sfxEnabled) return;
  _ensureInit();
  console.log('[Audio]  play   :', eventName, opts ? JSON.stringify(opts) : '');
  sfx.play(eventName, opts);
}

/**
 * 循环播放（如旋转）
 * @param {string} eventName
 * @returns {number} 句柄
 */
function playLooped(eventName) {
  if (!_sfxEnabled) return -1;
  _ensureInit();
  console.log('[Audio]  loop   :', eventName);
  return sfx.playLooped(eventName);
}

/**
 * 停止循环音效
 * @param {number} handle
 */
function stop(handle) {
  sfx.stop(handle);
}

/**
 * 播放背景音乐
 * @param {string} scene - 'menu' | 'gameplay' | 'editor'
 */
function playMusic(scene) {
  _lastMusicScene = scene;
  if (!_musicEnabled) return;
  _ensureInit();

  // 场景 → 音轨映射
  var trackMap = {
    'menu': 'explore',
    'levelSelect': 'explore',
    'playing': 'level',
    'editor': 'explore',  // 或用静音
  };

  var track = trackMap[scene] || null;
  console.log('[Audio]  music  : scene=' + scene, '→ track=' + (track || 'none'));
  if (track) {
    music.play(track);
  } else {
    music.stop();
  }
}

/**
 * 停止背景音乐
 */
function stopMusic() {
  music.stop();
}

/**
 * 音乐开关
 */
function setMusicEnabled(enabled) {
  _musicEnabled = enabled;
  music.setEnabled(enabled);
  try { wx.setStorageSync('audio_music_enabled', enabled); } catch (e) {}
  if (enabled && _lastMusicScene) {
    // 切回场景对应的 BGM
    var trackMap = {
      'menu': 'explore',
      'levelSelect': 'explore',
      'playing': 'level',
      'editor': 'explore',
    };
    var track = trackMap[_lastMusicScene] || null;
    if (track) music.play(track);
  }
}

function isMusicEnabled() {
  return _musicEnabled;
}

/**
 * 音效开关
 */
function setSfxEnabled(enabled) {
  _sfxEnabled = enabled;
  try { wx.setStorageSync('audio_sfx_enabled', enabled); } catch (e) {}
  if (!enabled) {
    // 关音效不杀已播放的，只阻止新的
  }
}

function isSfxEnabled() {
  return _sfxEnabled;
}

/**
 * 切场景时调用（音效不中断，让它自然播完）
 */
function onSceneChange() {
  console.log('[Audio]  scene change — SFX kept alive');
}

/**
 * 暂停音频（进入后台）
 */
function onHide() {
  console.log('[Audio]  hide   — pause music, release SFX');
  music.pause();
  sfx.releaseAll();
}

/**
 * 恢复音频（回到前台）
 */
function onShow() {
  console.log('[Audio]  show   — resume music');
  music.resume();
}

/**
 * 检查音频文件是否就绪
 */
function isReady() {
  return loader.isReady();
}

/**
 * 获取下载进度
 */
function getProgress() {
  return loader.getProgress();
}

/**
 * 销毁全部音频资源
 */
function destroy() {
  _initialized = false;
  _initPromise = null;
  sfx.destroy();
  music.destroy();
}

// 单例导出
var AudioManager = {
  init: init,
  play: play,
  playLooped: playLooped,
  stop: stop,
  playMusic: playMusic,
  stopMusic: stopMusic,
  setMusicEnabled: setMusicEnabled,
  isMusicEnabled: isMusicEnabled,
  setSfxEnabled: setSfxEnabled,
  isSfxEnabled: isSfxEnabled,
  onSceneChange: onSceneChange,
  onHide: onHide,
  onShow: onShow,
  isReady: isReady,
  getProgress: getProgress,
  destroy: destroy,
};

module.exports = AudioManager;
