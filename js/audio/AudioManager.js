// 推猪消除 — 音频管理器（单例门面）
// 统一对外接口，内部组合 SfxPlayer + MusicPlayer + AudioLoader

var config = require('./AudioConfig.js');
var loader = require('./AudioLoader.js');
var sfx = require('./SfxPlayer.js');
var music = require('./MusicPlayer.js');

var _initialized = false;
var _enabled = true;
var _initPromise = null;

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
  if (_initPromise) return _initPromise;

  _ensureInit();

  _initPromise = loader.startDownload(function (progress, loaded, total) {
    if (onProgress) onProgress(progress);
    console.log('[Audio] download progress:', Math.round(progress * 100) + '%', loaded + '/' + total);
  }).then(function () {
    console.log('[Audio] all files ready');
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
  if (!_enabled) return;
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
  if (!_enabled) return -1;
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
  if (!_enabled) return;
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
 * 全局静音开关
 */
function setEnabled(enabled) {
  _enabled = enabled;
  music.setEnabled(enabled);
  // 静音只阻止新播放，不杀正在播的音效
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
  setEnabled: setEnabled,
  onSceneChange: onSceneChange,
  onHide: onHide,
  onShow: onShow,
  isReady: isReady,
  getProgress: getProgress,
  destroy: destroy,
};

module.exports = AudioManager;
