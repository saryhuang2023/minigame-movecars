// 推猪消除 — 通用弹窗动画器
// Scale-based spring pop-in / pop-out，供所有弹窗复用
//
// 打开：0.15 → overshoot → 1.0（弹簧弹出）
// 关闭：1.0 → 微放大(弹一下) → 0.12（反弹缩回）
//
// 用法：
//   var anim = createPopupAnimator();
//   anim.open();           // 触发弹出
//   anim.close(function() { /* 动画完成 */ });
//   每帧：var s = anim.update();  // 拿到 { scale, alpha, maskAlpha }

var Easing = require('../core/Easing.js');

/**
 * 创建一个弹窗动画器（所有弹窗动画参数统一，不接受外部配置）
 * @returns {object} animator
 */
function createPopupAnimator() {
  var _phase = 'closed';          // 'opening' | 'open' | 'closing' | 'closed'
  var _startTime = 0;
  var _openDuration = 650;        // 弹出总时长 ms（统一值）
  var _closeExpandDur = 80;      // 关闭时"弹一下"阶段时长 ms
  var _closeShrinkDur = 280;      // 关闭时缩回阶段时长 ms
  var _onClose = null;
  var _openStartTime = 0;          // 记录打开开始时间，供 stagger 计算

  // 弹簧参数：物理模型在 t≈1.0 自然衰减完毕
  // 用 SPRING_T_MULT=1.0 让动画填满整个 _openDuration，不再提前结束
  // stiffness 180 + damping 10 → 明显过冲回弹，手感更"弹"
  var SPRING_T_MULT = 1.0;
  var SPRING_STIFF = 180;
  var SPRING_DAMP = 10;

  function _closedState() { return { scale: 0, alpha: 0, maskAlpha: 0, rawT: 0, elapsed: 0 }; }
  function _openState()   { return { scale: 1, alpha: 1, maskAlpha: 0.5, rawT: 1, elapsed: _openDuration }; }

  /**
   * 触发打开动画（幂等）
   */
  function open() {
    if (_phase === 'opening' || _phase === 'open') return;
    _phase = 'opening';
    _startTime = Date.now();
    _openStartTime = _startTime;
  }

  /**
   * 触发关闭动画
   * @param {Function} [cb] 动画完成后回调
   */
  function close(cb) {
    if (_phase === 'closed') {
      if (cb) cb();
      return;
    }
    if (_phase === 'closing') return;
    _phase = 'closing';
    _startTime = Date.now();
    _onClose = cb || null;
  }

  /**
   * 每帧驱动状态机
   * @returns {{ scale: number, alpha: number, maskAlpha: number, rawT: number, elapsed: number }}
   */
  function update() {
    if (_phase === 'closed') return _closedState();
    if (_phase === 'open')   return _openState();

    var elapsed = Date.now() - _startTime;

    // ---- 打开动画 ----
    if (_phase === 'opening') {
      var rawT = Math.min(elapsed / _openDuration, 1);
      var springVal = Easing.spring(rawT * SPRING_T_MULT, SPRING_STIFF, SPRING_DAMP);
      var scl = 0.15 + 0.85 * springVal;
      var alp = springVal;
      var msk = 0.5 * springVal;

      if (rawT >= 1) {
        _phase = 'open';
        return _openState();
      }
      return { scale: Math.max(0, scl), alpha: Math.max(0, Math.min(1, alp)), maskAlpha: Math.max(0, msk), rawT: rawT, elapsed: elapsed };
    }

    // ---- 关闭动画（两阶段：弹一下 → 缩回）----
    if (_phase === 'closing') {
      var totalDur = _closeExpandDur + _closeShrinkDur;
      var ct = Math.min(elapsed / totalDur, 1);
      var splitT = _closeExpandDur / totalDur;
      var scl, alp;

      if (ct <= splitT) {
        // 阶段1: 微微放大 "弹一下" (1.0 → 1.06)
        var et = ct / splitT;
        scl = 1 + 0.06 * Easing.easeOutCubic(et);
        alp = 1;
      } else {
        // 阶段2: 加速缩回消失 (1.06 → 0.12)
        var st = (ct - splitT) / (1 - splitT);
        var shrink = 1 - Easing.easeInCubic(st);
        scl = 1.06 * shrink;
        alp = 1 - Easing.easeInCubic(Math.min(st * 1.4, 1));
      }

      var msk = 0.5 * alp;

      if (ct >= 1) {
        _phase = 'closed';
        var cb = _onClose;
        _onClose = null;
        if (cb) cb();
        return _closedState();
      }
      return { scale: Math.max(0, scl), alpha: Math.max(0, Math.min(1, alp)), maskAlpha: Math.max(0, msk), rawT: ct, elapsed: elapsed };
    }

    return _closedState();
  }

  // 查询
  function isOpen()       { return _phase === 'open'; }
  function isClosed()     { return _phase === 'closed'; }
  function isAnimating()  { return _phase === 'opening' || _phase === 'closing'; }
  function getPhase()     { return _phase; }
  function getOpenDur()   { return _openDuration; }

  return {
    open: open, close: close, update: update,
    isOpen: isOpen, isClosed: isClosed, isAnimating: isAnimating, getPhase: getPhase,
    getOpenDur: getOpenDur,
  };
}

module.exports = { createPopupAnimator };
