// 推猪消除 — SFX 播放池
// 管理 InnerAudioContext 池，支持 8 并发、优先级抢占、playbackRate 变调

var config = require('./AudioDefine.js');
var loader = require('./AudioLoader.js');

// 池中每个槽位
// { ctx: InnerAudioContext, busy: bool, key: string, priority: number, handle: number }
var _pool = [];
var _handleCounter = 0;

// 已创建的循环播放句柄集合（用于外部 stop）
var _loopedHandles = {};

/**
 * 初始化池
 */
function init() {
  for (var i = 0; i < config.MAX_VOICES; i++) {
    var ctx = wx.createInnerAudioContext();
    ctx.obeyMuteSwitch = false;
    ctx.onEnded(function () {
      _onCtxEnded(ctx);
    });
    ctx.onError(function (err) {
      console.warn('[SfxPlayer] error:', err.errMsg);
      _onCtxEnded(ctx);
    });
    _pool.push({
      ctx: ctx,
      busy: false,
      key: '',
      priority: 99,
      handle: 0,
      looped: false,
    });
  }
}

/**
 * 音效结束回调：释放槽位
 */
function _onCtxEnded(ctx) {
  for (var i = 0; i < _pool.length; i++) {
    if (_pool[i].ctx === ctx) {
      if (_pool[i].looped) {
        // 循环音效：重新 seek(0) 再 play
        ctx.seek(0);
        ctx.play();
      } else {
        console.log('[SfxPlayer] ■ end   :', _pool[i].key, '[h#' + _pool[i].handle + ']');
        _pool[i].busy = false;
        _pool[i].key = '';
        _pool[i].handle = 0;
      }
      break;
    }
  }
}

/**
 * 检查是否有槽位正在播放同一事件（非循环），用于快速重触发时复用
 * @returns {Object|null} 匹配的槽位，或 null
 */
function _findSameEvent(eventName) {
  for (var i = 0; i < _pool.length; i++) {
    if (_pool[i].busy && _pool[i].key === eventName && !_pool[i].looped) {
      // onEnded 回调不可靠（WeChat 平台常见），检查 ctx 是否真的还在播
      // paused=true 说明已播完但回调未触发，应主动释放
      if (_pool[i].ctx.paused) {
        console.log('[SfxPlayer] ■ cleanup:', eventName, '[h#' + _pool[i].handle + '] (onEnded missed)');
        _pool[i].busy = false;
        _pool[i].key = '';
        _pool[i].handle = 0;
        return null;
      }
      return _pool[i];
    }
  }
  return null;
}

/**
 * 找到一个空闲槽位，如果没有则抢占最低优先级的
 */
function _acquireSlot(priority) {
  // 先找空闲的
  var freeSlot = null;
  var lowestSlot = null;
  var lowestPrio = -1;

  for (var i = 0; i < _pool.length; i++) {
    if (!_pool[i].busy) {
      freeSlot = _pool[i];
      break;
    }
    if (_pool[i].priority > lowestPrio) {
      lowestPrio = _pool[i].priority;
      lowestSlot = _pool[i];
    }
  }

  if (freeSlot) return freeSlot;

  // 全部忙：检查能否抢占
  if (lowestSlot && priority < lowestSlot.priority) {
    // 抢占：停止当前播放，让出槽位
    console.log('[SfxPlayer] steal slot: prio', lowestSlot.priority, '(' + lowestSlot.key + ') ← prio', priority);
    try { lowestSlot.ctx.stop(); } catch (e) {}
    lowestSlot.busy = false;
    lowestSlot.key = '';
    if (lowestSlot.handle && _loopedHandles[lowestSlot.handle]) {
      delete _loopedHandles[lowestSlot.handle];
    }
    return lowestSlot;
  }

  // 无法抢占，丢弃当前音效
  console.log('[SfxPlayer] drop: all slots busy, prio', priority, 'cannot steal');
  return null;
}

/**
 * 播放一次 SFX
 * @param {string} eventName - 事件名，如 'collide'
 * @param {Object} opts - { rate: number } 可选变调
 */
function play(eventName, opts) {
  opts = opts || {};
  var rate = opts.rate || 1;

  var evt = config.SFX_EVENTS[eventName];
  if (!evt) {
    console.warn('[SfxPlayer] play: unknown event', eventName);
    return;
  }

  // 随机选变体
  var files = evt.files;
  var file = files[Math.floor(Math.random() * files.length)];

  // 获取本地路径（一次即时重查兜底）
  var path = loader.getLocalPath(file);
  if (!path) {
    // 可能刚下载完但还没被 _resolveFile 捡到，手动同步再查一次
    loader._syncResolve(file);
    path = loader.getLocalPath(file);
  }
  if (!path) {
    console.warn('[SfxPlayer] play: no path for', file, '(event:', eventName + ')');
    return; // 确实没就绪，静默跳过
  }

  // 检查同事件是否已在播放 — 同一 src 不能在多个 ctx 同时播放（WeChat 平台限制）
  // 快速连点时间中，复用已有槽位 stop → seek(0) → play，避免静默丢失
  // 重触发时也重新随机选变体，确保多文件配置生效
  var sameSlot = _findSameEvent(eventName);
  if (sameSlot) {
    console.log('[SfxPlayer] ↻ retrig:', eventName, '→', file, '[h#' + sameSlot.handle + ']');
    try {
      sameSlot.ctx.stop();
      sameSlot.ctx.src = path;
      sameSlot.ctx.seek(0);
      sameSlot.ctx.playbackRate = rate;
      sameSlot.ctx.play();
    } catch (e) {
      sameSlot.busy = false;
      console.warn('[SfxPlayer] ✗ retrig err:', eventName, e.message);
    }
    return;
  }

  var slot = _acquireSlot(evt.priority);
  if (!slot) {
    console.warn('[SfxPlayer] play: no slot for', eventName);
    return;
  }

  slot.busy = true;
  slot.key = eventName;
  slot.priority = evt.priority;
  slot.looped = false;
  _handleCounter++;
  slot.handle = _handleCounter;

  try {
    slot.ctx.src = path;
    slot.ctx.playbackRate = rate;
    slot.ctx.loop = false;
    slot.ctx.play();
    var rateStr = rate !== 1 ? ' rate=' + rate.toFixed(2) : '';
    console.log('[SfxPlayer] ▶ play :', eventName, '→', file, rateStr, '[h#' + slot.handle + ']');
  } catch (e) {
    slot.busy = false;
    console.warn('[SfxPlayer] ✗ play err :', eventName, e.message);
  }
}

/**
 * 循环播放 SFX（如旋转声）
 * @param {string} eventName
 * @returns {number} 句柄，传给 stop()
 */
function playLooped(eventName) {
  var evt = config.SFX_EVENTS[eventName];
  if (!evt) {
    console.warn('[SfxPlayer] playLooped: unknown event', eventName);
    return -1;
  }

  var file = evt.files[0];
  var path = loader.getLocalPath(file);
  if (!path) {
    loader._syncResolve(file);
    path = loader.getLocalPath(file);
  }
  if (!path) {
    console.warn('[SfxPlayer] playLooped: no path for', file, '(event:', eventName + ')');
    return -1;
  }

  var slot = _acquireSlot(evt.priority);
  if (!slot) {
    console.warn('[SfxPlayer] playLooped: no slot for', eventName);
    return -1;
  }

  slot.busy = true;
  slot.key = eventName;
  slot.priority = evt.priority;
  slot.looped = true;
  _handleCounter++;
  slot.handle = _handleCounter;

  try {
    slot.ctx.src = path;
    slot.ctx.playbackRate = 1;
    slot.ctx.loop = true;
    slot.ctx.play();
    console.log('[SfxPlayer] ⟳ loop  :', eventName, '→', file, '[h#' + slot.handle + ']');
  } catch (e) {
    slot.busy = false;
    console.warn('[SfxPlayer] ✗ loop err:', eventName, e.message);
    return -1;
  }

  _loopedHandles[_handleCounter] = slot;
  return _handleCounter;
}

/**
 * 停止循环播放
 * @param {number} handle - playLooped 返回的句柄
 */
function stop(handle) {
  var slot = _loopedHandles[handle];
  if (!slot) return;

  console.log('[SfxPlayer] ■ stop  :', slot.key, '[h#' + handle + ']');
  try { slot.ctx.stop(); } catch (e) {}
  slot.busy = false;
  slot.key = '';
  slot.handle = 0;
  slot.looped = false;
  delete _loopedHandles[handle];
}

/**
 * 停止某个事件名的所有音效
 */
function stopAll(eventName) {
  for (var i = 0; i < _pool.length; i++) {
    if (_pool[i].busy && _pool[i].key === eventName) {
      try { _pool[i].ctx.stop(); } catch (e) {}
      _pool[i].busy = false;
      _pool[i].key = '';
      if (_pool[i].handle && _loopedHandles[_pool[i].handle]) {
        delete _loopedHandles[_pool[i].handle];
      }
    }
  }
}

/**
 * 释放所有音频资源（切场景时调用）
 */
function releaseAll() {
  for (var i = 0; i < _pool.length; i++) {
    if (_pool[i].busy) {
      try { _pool[i].ctx.stop(); } catch (e) {}
      _pool[i].busy = false;
      _pool[i].key = '';
      _pool[i].handle = 0;
      _pool[i].looped = false;
    }
  }
  _loopedHandles = {};
}

/**
 * 销毁池（游戏退出时调用）
 */
function destroy() {
  for (var i = 0; i < _pool.length; i++) {
    try { _pool[i].ctx.destroy(); } catch (e) {}
  }
  _pool = [];
  _loopedHandles = {};
}

module.exports = {
  init: init,
  play: play,
  playLooped: playLooped,
  stop: stop,
  stopAll: stopAll,
  releaseAll: releaseAll,
  destroy: destroy,
};
