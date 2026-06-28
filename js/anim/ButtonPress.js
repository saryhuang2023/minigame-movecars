// 推猪消除 — 按钮按压微交互共享模块
// 统一的按压回弹动画，所有引擎复用

var Easing = require('../core/Easing.js');

/**
 * 创建一个按钮按压动画管理器
 *
 * 用法：
 *   var press = new ButtonPress();
 *   // touchstart 命中按钮时
 *   press.press('myBtn');
 *   // 渲染时获取缩放值
 *   var s = press.getScale('myBtn');
 *   // 围绕按钮中心做 translate/scale
 */
function ButtonPress() {
  this._activeId = null;     // 当前被按下的按钮 id
  this._pressTime = 0;       // 按下时间戳 (Date.now)
  this._active = false;      // 是否有活跃的按压动画

  // 呼吸动画（多按钮同时支持）
  this._breathes = {};       // { btnId: startTime }
}

/** 呼吸动画总时长 (ms) — 单次脉冲 */
ButtonPress.prototype.BREATHE_DURATION = 500;
/** 呼吸振幅（缩放值偏离 1.0 的最大幅度） */
ButtonPress.prototype.BREATHE_AMPLITUDE = 0.06;

/** 按压持续时间 (ms) */
ButtonPress.prototype.PRESS_DURATION = 80;
/** 回弹持续时间 (ms) */
ButtonPress.prototype.RELEASE_DURATION = 140;

/**
 * 开始按压动画。在同一帧重复调用会重置计时器
 * @param {string} btnId - 按钮标识
 */
ButtonPress.prototype.press = function (btnId) {
  this._activeId = btnId;
  this._pressTime = Date.now();
  this._active = true;
};

/**
 * 获取指定按钮的当前缩放值（按压 + 呼吸叠加）
 * @param {string} btnId
 * @returns {number} 1.0 为正常大小
 */
ButtonPress.prototype.getScale = function (btnId) {
  // 按压动画优先
  if (this._active && this._activeId === btnId) {
    var elapsed = Date.now() - this._pressTime;

    if (elapsed < this.PRESS_DURATION) {
      var t = Math.min(elapsed / this.PRESS_DURATION, 1);
      return 1 - 0.05 * Easing.easeOutCubic(t);
    }

    var releaseT = Math.min((elapsed - this.PRESS_DURATION) / this.RELEASE_DURATION, 1);
    if (releaseT >= 1) {
      this._activeId = null;
      this._active = false;
      // 按压结束，检查是否有呼吸
      return this._getBreatheScale(btnId);
    }
    return 0.95 + 0.05 * Easing.easeOutBack(releaseT, 1.5);
  }

  // 无按压时检查呼吸
  return this._getBreatheScale(btnId);
};

/**
 * 是否有任何按钮正在动画中
 * @returns {boolean}
 */
ButtonPress.prototype.isAnimating = function () {
  if (this._active) return true;
  for (var k in this._breathes) { return true; }
  return false;
};

/**
 * 触发呼吸动画（点击后单次脉冲，支持多按钮同时呼吸）
 * @param {string} btnId
 */
ButtonPress.prototype.breathe = function (btnId) {
  this._breathes[btnId] = Date.now();
};

/**
 * 获取呼吸动画的缩放值（内部）
 * 单次正弦脉冲：0→峰值→0，500ms 结束
 * @param {string} btnId
 * @returns {number}
 */
ButtonPress.prototype._getBreatheScale = function (btnId) {
  var startTime = this._breathes[btnId];
  if (!startTime) return 1;

  var elapsed = Date.now() - startTime;
  if (elapsed >= this.BREATHE_DURATION) {
    delete this._breathes[btnId];
    return 1;
  }

  // 单次半正弦脉冲：t: 0→1, sin(t*PI): 0→1→0
  var t = elapsed / this.BREATHE_DURATION;
  var pulse = Math.sin(t * Math.PI);
  return 1 + pulse * this.BREATHE_AMPLITUDE;
};

module.exports = ButtonPress;
