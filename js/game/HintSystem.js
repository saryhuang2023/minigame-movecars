// 提示系统 — 管理提示目标选择、幽灵动画调度、定时器
// PlayingEngine 通过此模块控制提示生命周期

const audio = require('../audio/AudioManager.js');

const GHOST_SPEED = 100; // 幽灵提示速度（正常速度的一半）

class HintSystem {
  /**
   * @param {GameplayEngine} gp - 核心玩法引擎引用
   */
  constructor(gp) {
    this._gp = gp;
    this._target = null;  // 当前被提示的猪
    this._timer = null;   // 幽灵动画定时器 ID
  }

  // ------------------------------------------------------------------
  // 公共 API
  // ------------------------------------------------------------------

  /** 选择提示目标并启动幽灵动画。返回被选中的猪，或 null */
  show() {
    if (this._target) return null; // 已有提示进行中

    // 找出未逃脱 + 有 hintId 的猪中，hintId 最小的
    var best = null;
    var pigs = this._gp.pigs;
    for (var i = 0; i < pigs.length; i++) {
      var p = pigs[i];
      if (p.hintId == null) continue;
      if (!best || p.hintId < best.hintId) best = p;
    }
    if (!best) return null;

    this._target = best;
    this._startGhostTimer();
    return best;
  }

  /** 清除当前提示：停止定时器 + 清空幽灵动画 */
  clear() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._gp.ghostAnimations = [];
    this._target = null;
  }

  /** 获取当前提示目标 */
  getTarget() { return this._target; }

  /** 获取当前提示目标 ID（用于 renderBoard 的 hintPigId） */
  getTargetId() { return this._target ? this._target.id : null; }

  /** 是否有激活的提示 */
  isActive() { return !!this._target; }

  /** 当被提示的猪被正常逃脱时调用（PlayingEngine 通知清除） */
  onPigExited(pigId) {
    if (this._target && this._target.id === pigId) {
      this.clear();
    }
  }

  // ------------------------------------------------------------------
  // 内部
  // ------------------------------------------------------------------

  _startGhostTimer() {
    if (this._timer) clearInterval(this._timer);
    this._timer = setInterval(this._playGhostAnimation.bind(this), 2000);
    this._playGhostAnimation(); // 立即播放第一次
  }

  _playGhostAnimation() {
    if (!this._target) return;
    var pig = this._target;
    // 确保猪还在（未被移除）
    if (this._gp.pigs.indexOf(pig) < 0) return;
    var ha = pig.hintAngle != null ? pig.hintAngle : pig.angle;
    var r = this._gp.getPigRect(pig.tailIndex, pig.length, ha);
    if (!r) return;

    var rad = ha * Math.PI / 180;
    var dirX = Math.cos(rad), dirY = -Math.sin(rad);
    // 距离和正常逃脱相同（100 × collisionStep），幽灵速度 = GHOST_SPEED
    var totalDist = 100 * this._gp.collisionStep;
    this._gp.ghostAnimations.push({
      pigId: pig.id,
      hintAngle: ha,
      dirX: dirX, dirY: dirY,
      totalDist: totalDist, currentDx: 0, currentDy: 0,
      startTime: Date.now(), duration: totalDist / GHOST_SPEED * 1000
    });
  }
}

module.exports = HintSystem;
