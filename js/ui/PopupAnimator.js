// 推猪消除 — 通用弹窗动画器
// Scale-based easeOutCubic pop-in / pop-out，供所有弹窗复用
//
// 打开：0.6 → 1.0（easeOutCubic 渐显+放大，无弹跳）
// 关闭：1.0 → 0.3（easeInCubic 加速缩小+淡出）
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
  var _openDuration = 350;        // 弹出总时长 ms（无弹簧振荡，350 足够）
  var _closeDuration = 130;       // 关闭总时长 ms
  var _onClose = null;
  var _openStartTime = 0;          // 记录打开开始时间

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

    // ---- 打开动画：0.6→1.0 渐显 + easeOutCubic 放大到正常大小 ----
    if (_phase === 'opening') {
      var rawT = Math.min(elapsed / _openDuration, 1);
      var eased = Easing.easeOutCubic(rawT);
      var scl = 0.6 + 0.4 * eased;
      var alp = eased;
      var msk = 0.5 * eased;

      if (rawT >= 1) {
        _phase = 'open';
        return _openState();
      }
      return { scale: scl, alpha: alp, maskAlpha: msk, rawT: rawT, elapsed: elapsed };
    }

    // ---- 关闭动画：1.0→0.3 加速缩小 + 淡出 ----
    if (_phase === 'closing') {
      var ct = Math.min(elapsed / _closeDuration, 1);
      var eased = Easing.easeInCubic(ct);
      var scl = 1 - 0.7 * eased;
      var alp = 1 - eased;
      var msk = 0.5 * alp;

      if (ct >= 1) {
        _phase = 'closed';
        var cb = _onClose;
        _onClose = null;
        if (cb) cb();
        return _closedState();
      }
      return { scale: scl, alpha: alp, maskAlpha: msk, rawT: ct, elapsed: elapsed };
    }

    return _closedState();
  }

  // 查询
  function isOpen()       { return _phase === 'open'; }
  function isClosed()     { return _phase === 'closed'; }
  function isAnimating()  { return _phase === 'opening' || _phase === 'closing'; }
  function getPhase()     { return _phase; }
  function getOpenDur()   { return _openDuration; }
  function getOpenStartTime() { return _openStartTime; }

  return {
    open: open, close: close, update: update,
    isOpen: isOpen, isClosed: isClosed, isAnimating: isAnimating, getPhase: getPhase,
    getOpenDur: getOpenDur, getOpenStartTime: getOpenStartTime,
  };
}

module.exports = { createPopupAnimator };
