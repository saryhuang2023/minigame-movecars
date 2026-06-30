// 推猪消除 — 场景过渡管理器
// 管理场景切换的滑入/滑出动画，输入屏蔽，方向感知

var Easing = require('./Easing.js');
var databus = require('../databus.js');

// 过渡状态
var _active = false;
var _startTime = 0;
var _duration = 0;
var _direction = 'fade';  // 统一使用 'fade' 淡入淡出
var _from = null;
var _to = null;

/**
 * 开始场景过渡
 * @param {string} from - 旧场景名
 * @param {string} to - 新场景名
 * @param {object} opts
 *   opts.duration - 动画时长（默认 300ms）
 *   opts.direction - 手动指定方向 'forward'|'back'|'fade'，不传则自动推断
 */
function start(from, to, opts) {
  // 过渡动画已禁用，直接完成
  _active = false;
}

/**
 * 获取当前过渡进度，用于渲染
 * @returns {null|{t:number, direction:string, from:string, to:string}}
 */
function getProgress() {
  if (!_active) return null;
  var elapsed = Date.now() - _startTime;
  var rawT = Math.min(elapsed / _duration, 1);

  var t;
  if (_direction === 'fade') {
    t = Easing.easeInOutCubic(rawT);
  } else {
    t = Easing.easeOutCubic(rawT);
  }

  // 过渡完成 → 自动清理
  if (rawT >= 1) {
    _active = false;
  }

  return {
    t: t,
    rawT: rawT,
    direction: _direction,
    from: _from,
    to: _to,
    done: rawT >= 1,
  };
}

/**
 * 是否正在过渡（输入应被屏蔽）
 */
function isActive() {
  return _active;
}

/**
 * 强制终止当前过渡
 */
function cancel() {
  _active = false;
  _from = null;
  _to = null;
}

module.exports = {
  start: start,
  getProgress: getProgress,
  isActive: isActive,
  cancel: cancel,
};
