// 推猪消除 — 背景音乐播放器
// 使用独享 InnerAudioContext，支持淡入淡出和场景切换

var config = require('./AudioDefine.js');
var loader = require('./AudioLoader.js');

var _ctx = null;
var _currentTrack = '';
var _enabled = true;
var _fadeTimer = null;
var _pendingTrack = null;       // 文件未就绪时暂存曲目名，就绪后自动播放
var _pendingTimer = null;       // 轮询定时器

/**
 * 初始化（创建 InnerAudioContext）
 */
function init() {
  if (_ctx) return;
  _ctx = wx.createInnerAudioContext();
  _ctx.obeyMuteSwitch = false;
  _ctx.loop = true;
  _ctx.volume = config.MUSIC.explore.volume;
  _ctx.onError(function (err) {
    var errMsg = (err && err.errMsg) || '';
    console.warn('[MusicPlayer] error:', errMsg);
    // 解码失败 → 清理 BGM 缓存，下次尝试重新下载
    if ((errMsg.indexOf('decode') >= 0 || errMsg.indexOf('Decode') >= 0) && _currentTrack) {
      var cfg = config.MUSIC[_currentTrack];
      if (cfg) {
        loader.invalidateFile(cfg.file);
        console.log('[MusicPlayer] invalidated cache for', cfg.file, '— will re-download');
      }
    }
  });
}

/**
 * 淡入播放
 */
function _fadeIn(targetVol, durationMs) {
  if (!_ctx) return;
  clearInterval(_fadeTimer);

  var steps = 20;
  var stepMs = durationMs / steps;
  var stepVol = targetVol / steps;
  _ctx.volume = 0;
  _ctx.seek(0);

  try { _ctx.play(); } catch (e) {}

  var currentStep = 0;
  _fadeTimer = setInterval(function () {
    currentStep++;
    if (currentStep >= steps) {
      _ctx.volume = targetVol;
      clearInterval(_fadeTimer);
      _fadeTimer = null;
      return;
    }
    _ctx.volume = Math.min(stepVol * currentStep, targetVol);
  }, stepMs);
}

/**
 * 淡出停止
 */
function _fadeOut(durationMs, callback) {
  if (!_ctx) { if (callback) callback(); return; }
  clearInterval(_fadeTimer);

  var startVol = _ctx.volume;
  var steps = 15;
  var stepMs = durationMs / steps;
  var stepVol = startVol / steps;

  var currentStep = 0;
  _fadeTimer = setInterval(function () {
    currentStep++;
    if (currentStep >= steps) {
      _ctx.volume = 0;
      try { _ctx.stop(); } catch (e) {}
      clearInterval(_fadeTimer);
      _fadeTimer = null;
      if (callback) callback();
      return;
    }
    _ctx.volume = Math.max(startVol - stepVol * currentStep, 0);
  }, stepMs);
}

/**
 * 播放/切换背景音乐
 * @param {string} trackName - 'explore'（可扩展更多）
 */
function play(trackName) {
  if (!_enabled) return;
  if (!_ctx) init();
  if (_currentTrack === trackName) {
    console.log('[MusicPlayer] skip: already playing', trackName);
    return; // 同一首不重播
  }

  var musicCfg = config.MUSIC[trackName];
  if (!musicCfg) {
    console.warn('[MusicPlayer] unknown track:', trackName);
    return;
  }

  var path = loader.getLocalPath(musicCfg.file);
  if (!path) {
    // 文件尚未下载就绪（云存储异步），暂存曲目，轮询等待
    console.warn('[MusicPlayer] path not ready:', musicCfg.file, '— pending retry (track:', trackName + ')');
    _pendingTrack = trackName;
    _startRetryPoll();
    return;
  }

  // 文件就绪，清除待播放状态
  _pendingTrack = null;
  _clearRetryPoll();

  console.log('[MusicPlayer] ▶ play  :', trackName, '→', musicCfg.file, _currentTrack ? '(crossfade)' : '(start)');

  // 如果正播放，淡出后切
  if (_currentTrack) {
    _fadeOut(800, function () {
      _ctx.src = path;
      _currentTrack = trackName;
      _fadeIn(musicCfg.volume, musicCfg.fadeMs);
    });
  } else {
    _ctx.src = path;
    _currentTrack = trackName;
    _fadeIn(musicCfg.volume, musicCfg.fadeMs);
  }
}

/**
 * 轮询：等待云下载完成后自动播放
 */
function _startRetryPoll() {
  if (_pendingTimer) return;
  console.log('[MusicPlayer] ⟳ retry poll started');
  _pendingTimer = setInterval(function () {
    if (!_pendingTrack) { _clearRetryPoll(); return; }
    var cfg = config.MUSIC[_pendingTrack];
    if (!cfg) { _pendingTrack = null; _clearRetryPoll(); return; }
    var path = loader.getLocalPath(cfg.file);
    if (path) {
      console.log('[MusicPlayer] ✓ retry success:', cfg.file);
      var track = _pendingTrack;
      _pendingTrack = null;
      _clearRetryPoll();
      play(track);  // 文件就绪，正常播放
    }
  }, 1000); // 每秒检查一次
}

function _clearRetryPoll() {
  if (_pendingTimer) {
    clearInterval(_pendingTimer);
    _pendingTimer = null;
  }
}

/**
 * 停止音乐
 */
function stop() {
  if (!_ctx || !_currentTrack) return;
  console.log('[MusicPlayer] ■ stop  :', _currentTrack);
  _fadeOut(1000, function () {
    _currentTrack = '';
  });
}

/**
 * 暂停（切到后台时）
 */
function pause() {
  if (_ctx && _currentTrack) {
    try { _ctx.pause(); } catch (e) {}
  }
}

/**
 * 恢复（回到前台时）
 */
function resume() {
  if (_ctx && _currentTrack && _enabled) {
    try { _ctx.play(); } catch (e) {}
  }
}

/**
 * 静音切换
 */
function setEnabled(enabled) {
  _enabled = enabled;
  if (!enabled) {
    stop();
  }
}

/**
 * 释放
 */
function destroy() {
  clearInterval(_fadeTimer);
  _fadeTimer = null;
  if (_ctx) {
    try { _ctx.destroy(); } catch (e) {}
    _ctx = null;
  }
  _currentTrack = '';
}

module.exports = {
  init: init,
  play: play,
  stop: stop,
  pause: pause,
  resume: resume,
  setEnabled: setEnabled,
  destroy: destroy,
};
