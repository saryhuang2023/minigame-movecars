// 提示系统 — 管理提示目标选择、幽灵动画调度、定时器
// PlayingEngine 通过此模块控制提示生命周期

const audio = require('../audio/AudioManager.js');
var PlayDefine = require('../define/PlayingDefine.js');
const { SCREEN_WIDTH, SCREEN_HEIGHT } = require('../render.js');

class HintSystem {
  /**
   * @param {GameplayEngine} gp - 核心玩法引擎引用
   */
  constructor(gp) {
    this._gp = gp;
    this._target = null;  // 当前被提示的猪
    this._timer = null;   // 幽灵动画定时器 ID
    // 预绑定：避免每次 startGhostTimer 都创建新的 bind 函数对象
    this._tick = this._playGhostAnimation.bind(this);
  }

  // ------------------------------------------------------------------
  // 公共 API
  // ------------------------------------------------------------------

  /**
   * 选择提示目标并启动幽灵动画。
   * @param {number} [targetPigId] 可选：强制指定目标猪 ID（引导系统使用）
   * @returns 被选中的猪，或 null
   */
  show(targetPigId) {
    if (this._target) return null; // 已有提示进行中

    var best = null;
    var pigs = this._gp.pigs;

    if (targetPigId != null) {
      // 强制指定目标（引导系统专用）
      for (var i = 0; i < pigs.length; i++) {
        if (pigs[i].id === targetPigId) { best = pigs[i]; break; }
      }
    } else {
      // 自动选择：未逃脱 + 有 hintId 的猪中，hintId 最小的
      for (var i = 0; i < pigs.length; i++) {
        var p = pigs[i];
        if (p.hintId == null) continue;
        if (!best || p.hintId < best.hintId) best = p;
      }
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
    this._gp.ghostAnimations.length = 0;
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
    this._timer = setInterval(this._tick, PlayDefine.PLAY.HINT.INTERVAL);
    this._tick(); // 立即播放第一次
  }

  _playGhostAnimation() {
    // 防止 clear() 后定时器回调仍执行
    if (!this._timer) return;
    if (!this._target) return;
    var pig = this._target;
    // 确保猪还在（未被移除）
    if (this._gp.pigs.indexOf(pig) < 0) {
      this.clear();
      return;
    }
    var ghosts = this._gp.ghostAnimations;
    // 已存在该猪的幽灵条目 → 直接返回：方向/朝向在首次创建时已锁定，
    // 不再每轮 INTERVAL 删除重建、也不重读原猪角度，避免旋转原猪时幽灵跟着转
    for (var k = 0; k < ghosts.length; k++) {
      if (ghosts[k].pigId === pig.id) return;
    }
    var ha = pig.hintAngle != null ? pig.hintAngle : pig.angle;
    var r = this._gp.getPigRect(pig.tailIndex, pig.length, ha, pig.type, pig.collisionWidth);
    if (!r) return;

    var rad = ha * Math.PI / 180;
    var dirX = Math.cos(rad), dirY = -Math.sin(rad);

    // 简化逃脱方案（与本体猪完全一致）：固定速度每帧直线推进，由 GameplayEngine 实时检测
    // 「整只猪（含屁股）完全离屏」即结束。距离不再预计算（旧 sToExit/AABB 反解已移除），
    // 速度恒为 ESCAPE_SPEED * 2/3（本体猪一半），不随 scale / 格子大小变化。
    var escapeSpeed = PlayDefine.PLAY.ESCAPE_SPEED * 2 / 3; // 幽灵速度（本体猪一半）

    ghosts.push({
      pigId: pig.id,
      hintAngle: ha,
      dirX: dirX, dirY: dirY,
      currentDx: 0, currentDy: 0,
      speed: escapeSpeed,                 // 固定速度（px/s），不预计算距离
      lastT: Date.now(),
      tailIndex: pig.tailIndex, length: pig.length, angle: ha,
      done: false,
      hidden: false,                      // 间隔期隐藏（销毁后空 loopGap 再重建）
      cooldownStart: null,
      loopGap: PlayDefine.PLAY.HINT.GHOST_LOOP_GAP // 两次播放间隔 ms
    });
  }
}

module.exports = HintSystem;
