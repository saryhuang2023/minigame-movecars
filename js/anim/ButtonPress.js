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
}

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
 * 获取指定按钮的当前缩放值
 * @param {string} btnId
 * @returns {number} 1.0 为正常大小，0.95 为按压状态
 */
ButtonPress.prototype.getScale = function (btnId) {
  if (!this._active) return 1;
  // 如果当前活跃的不是这个按钮，返回 1
  if (this._activeId !== btnId) return 1;

  var elapsed = Date.now() - this._pressTime;

  // 按压阶段：1 → 0.95
  if (elapsed < this.PRESS_DURATION) {
    var t = Math.min(elapsed / this.PRESS_DURATION, 1);
    return 1 - 0.05 * Easing.easeOutCubic(t);
  }

  // 回弹阶段：0.95 → 1.0
  var releaseT = Math.min((elapsed - this.PRESS_DURATION) / this.RELEASE_DURATION, 1);
  if (releaseT >= 1) {
    this._activeId = null;
    this._active = false;
    return 1;
  }
  return 0.95 + 0.05 * Easing.easeOutBack(releaseT, 1.5);
};

/**
 * 是否有任何按钮正在动画中
 * @returns {boolean}
 */
ButtonPress.prototype.isAnimating = function () {
  return this._active;
};

module.exports = ButtonPress;
