// UI 动画工具 — 组件级动画辅助（按压缩放、弹簧入场）
// 复用了项目已有的 Easing 函数库
// 注意：ButtonPress 已作为独立动画管理器存在，本模块提供组件内嵌的简化动画

var Easing = require('../../core/Easing.js');

/**
 * 按压缩放动画 — 轻量版，用于单个组件内部
 * 
 * 用法：
 *   var press = new PressAnim();
 *   press.start();           // 按下时调用
 *   press.release();         // 松手时调用
 *   每帧：var scale = press.getScale();
 */
function PressAnim() {
  this._phase = 'idle';      // 'idle' | 'pressing' | 'releasing'
  this._startTime = 0;
  this._currentScale = 1;
}

/** 按压持续时间 ms */
PressAnim.PRESS_DURATION = 80;
/** 回弹持续时间 ms */
PressAnim.RELEASE_DURATION = 200;
/** 最小缩放 */
PressAnim.MIN_SCALE = 0.92;

PressAnim.prototype.start = function () {
  this._phase = 'pressing';
  this._startTime = Date.now();
};

PressAnim.prototype.release = function () {
  // 如果没在按压状态，直接跳到 idle
  if (this._phase !== 'pressing') {
    this._phase = 'idle';
    this._currentScale = 1;
    return;
  }
  this._phase = 'releasing';
  this._startTime = Date.now();
};

PressAnim.prototype.isActive = function () {
  return this._phase !== 'idle';
};

PressAnim.prototype.getScale = function () {
  if (this._phase === 'idle') return 1;

  var elapsed = Date.now() - this._startTime;
  var t;

  if (this._phase === 'pressing') {
    t = Math.min(elapsed / PressAnim.PRESS_DURATION, 1);
    this._currentScale = 1 - (1 - PressAnim.MIN_SCALE) * Easing.easeOutCubic(t);
    return this._currentScale;
  }

  // releasing
  t = Math.min(elapsed / PressAnim.RELEASE_DURATION, 1);
  if (t >= 1) {
    this._phase = 'idle';
    this._currentScale = 1;
    return 1;
  }
  // 从 MIN_SCALE 弹回 1.0，用 easeOutBack
  this._currentScale = PressAnim.MIN_SCALE + (1 - PressAnim.MIN_SCALE) * Easing.easeOutBack(t, 1.5);
  return this._currentScale;
};

/**
 * 透明度渐变动画
 * @param {number} from
 * @param {number} to
 * @param {number} duration — ms
 */
function FadeAnim(from, to, duration) {
  this.from = from;
  this.to = to;
  this.duration = duration;
  this._startTime = 0;
  this._active = false;
  this._value = from;
}

FadeAnim.prototype.start = function () {
  this._startTime = Date.now();
  this._active = true;
  this._value = this.from;
};

FadeAnim.prototype.getValue = function () {
  if (!this._active) return this._value;
  var elapsed = Date.now() - this._startTime;
  var t = Math.min(elapsed / this.duration, 1);
  if (t >= 1) {
    this._active = false;
    this._value = this.to;
    return this._value;
  }
  this._value = this.from + (this.to - this.from) * Easing.easeOutCubic(t);
  return this._value;
};

FadeAnim.prototype.isActive = function () {
  return this._active;
};

module.exports = {
  PressAnim: PressAnim,
  FadeAnim: FadeAnim,
};
