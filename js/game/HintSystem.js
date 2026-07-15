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
    var r = this._gp.getPigRect(pig.tailIndex, pig.length, ha);
    if (!r) return;

    var rad = ha * Math.PI / 180;
    var dirX = Math.cos(rad), dirY = -Math.sin(rad);

    // 与本体猪完全一致：尾孔沿推离方向到「屏幕真实边缘」的直线距离（四方向用真实边界，不再用固定 100×collisionStep）
    var tailHole = this._gp.holes[pig.tailIndex];
    if (!tailHole) return;
    var tailSX = this._gp.boardOffsetX + tailHole.x;
    var tailSY = this._gp.topBarH + this._gp.boardOffsetY + tailHole.y;
    var edgeDist;
    if (dirX > 0.001) edgeDist = (SCREEN_WIDTH - tailSX) / dirX;
    else if (dirX < -0.001) edgeDist = tailSX / -dirX;
    else if (dirY > 0.001) edgeDist = (SCREEN_HEIGHT - tailSY) / dirY;
    else if (dirY < -0.001) edgeDist = tailSY / -dirY;
    else edgeDist = 100 * this._gp.collisionStep; // 方向退化兜底
    // 精确计算「整只猪完全离开屏幕」所需平移距离：用猪的轴对齐包围盒（AABB）反解，
    // 不再靠补偿上界猜测，轴向/对角都严格正确（与本体猪算法一致）。
    var d = this._gp.scaledDiameter;
    // 复用上方已求的胶囊矩形 r；绘制半宽约 d*0.7（pigBodyWidth = d*1.4），取 max 覆盖碰撞半径
    var aabbR = Math.max(r.capRadius, d * 0.7);
    var minX0 = Math.min(r.capTailX, r.capHeadX) - aabbR;
    var maxX0 = Math.max(r.capTailX, r.capHeadX) + aabbR;
    var minY0 = Math.min(r.capTailY, r.capHeadY) - aabbR;
    var maxY0 = Math.max(r.capTailY, r.capHeadY) + aabbR;
    var aMinX = this._gp.boardOffsetX + minX0;
    var aMaxX = this._gp.boardOffsetX + maxX0;
    var aMinY = this._gp.topBarH + this._gp.boardOffsetY + minY0;
    var aMaxY = this._gp.topBarH + this._gp.boardOffsetY + maxY0;
    // 沿推离方向平移 s，使 AABB 完全在屏外（minX>W 或 maxX<0 或 minY>H 或 maxY<0）
    var sToExit = Infinity;
    if (dirX > 0.001) sToExit = Math.min(sToExit, (SCREEN_WIDTH - aMinX) / dirX);
    else if (dirX < -0.001) sToExit = Math.min(sToExit, (0 - aMaxX) / dirX);
    if (dirY > 0.001) sToExit = Math.min(sToExit, (SCREEN_HEIGHT - aMinY) / dirY);
    else if (dirY < -0.001) sToExit = Math.min(sToExit, (0 - aMaxY) / dirY);
    if (!isFinite(sToExit) || sToExit < 1) sToExit = (edgeDist > 1 ? edgeDist : 1); // 兜底
    var totalDist = sToExit;   // 整只猪完全离屏的距离（精确）
    var escapeSpeed = PlayDefine.PLAY.ESCAPE_SPEED * 2 / 3; // 幽灵速度（本体猪一半）

    ghosts.push({
      pigId: pig.id,
      hintAngle: ha,
      dirX: dirX, dirY: dirY,
      totalDist: totalDist, currentDx: 0, currentDy: 0,
      startTime: Date.now(), duration: totalDist / escapeSpeed * 1000,
      loopGap: PlayDefine.PLAY.HINT.GHOST_LOOP_GAP // 两次播放间隔（停起点）
    });
  }
}

module.exports = HintSystem;
