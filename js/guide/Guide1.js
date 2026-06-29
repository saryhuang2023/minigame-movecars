// 引导一：新手推动教学
// 激活条件：0002 关卡 + 玩家 10 秒无操作 + 14号猪还在棋盘上
// 表现：pig(11) 位置生成幽灵猪，从当前方向旋转至固定 330°，循环复位；自动点击提示按钮
// 若当前方向与 330° 相差 < 10° 则不播放幽灵，直接跳过
// 结束条件：提示结束，或关卡退出（deactivate → _guide.reset()）

var BaseGuide = require('./BaseGuide.js');

// --- 配置 ---
var ROTATION_SPEED = 40;           // 峰值旋转速度（度/秒）
var TARGET_ANGLE = 330;            // 固定目标方向（度）
var WOBBLE_AMPLITUDE = 2.5;        // 手抖幅度（度）
var WOBBLE_FREQ = 4;               // 手抖频率（Hz）
var HOLD_DURATION = 1;             // 末端停顿（秒），推到终点后停留 1 秒再复位

var Easing = require('../core/Easing.js');

// 规范化角度差到 [-180, 180]
function normalizeAngleDiff(diff) {
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;
  return diff;
}

function Guide1() {
  BaseGuide.call(this, 'guide1');

  this._startAngle = 0;
  this._elapsed = 0;               // 累计总时间（用于连续 sin 波形）
  this._rotationT = 0;             // 旋转进度（每段 0→1）
  this._holdT = 0;                 // 末端停顿计时器
  this._ghostEntry = null;         // gp.ghostAnimations 中的引用
}

Guide1.prototype = Object.create(BaseGuide.prototype);
Guide1.prototype.constructor = Guide1;

// ----------------------------------------------------------------
// 激活条件
// ----------------------------------------------------------------
Guide1.prototype.checkCondition = function (state, engine) {
  // --- 关卡名不匹配（首帧或切关时可能出现）---
  if (state.levelName !== '0002') {
    if (!this._loggedWrongLevel && state.levelName) {
      console.log('[LOG] Guide1 checkCondition ✗ levelName=' + state.levelName + '（需要 0002）');
      this._loggedWrongLevel = true;
    }
    return false;
  }
  this._loggedWrongLevel = false;

  // --- 空闲时间不足 ---
  if (state.idleTime <= 10) {
    // 每 3 秒打一次进度（避免刷屏）
    var now = Date.now();
    if (!this._lastIdleLogTs || now - this._lastIdleLogTs > 3000) {
      console.log('[LOG] Guide1 checkCondition ✗ idleTime=' + state.idleTime.toFixed(1) + 's（需 >10s）pigs.length=' + engine.gp.pigs.length);
      this._lastIdleLogTs = now;
    }
    return false;
  }

  // --- 14 号猪检查 ---
  var pig14Exists = engine.gp.pigs.some(function (p) { return p.id === 14; });
  if (pig14Exists) {
    console.log('[LOG] Guide1 checkCondition ✓ level=' + state.levelName + ' idle=' + state.idleTime.toFixed(1) + 's pig14=true → 即将激活');
  } else {
    console.log('[LOG] Guide1 checkCondition ✗ pig14 已被推出（pigs.length=' + engine.gp.pigs.length + '），跳过');
  }
  return pig14Exists;
};

// ----------------------------------------------------------------
// 激活
// ----------------------------------------------------------------
Guide1.prototype.onActivate = function (engine) {
  var pig = engine.gp.pigs.find(function (p) { return p.id === 11; });
  console.log('[LOG] Guide1 onActivate pig(11) found=' + !!pig + ' pigs.length=' + engine.gp.pigs.length +
    ' pigIds=[' + engine.gp.pigs.map(function(p){return p.id;}).join(',') + ']');
  if (!pig) {
    // 关卡中不存在 ID=11 的猪，直接标记完成跳过
    console.log('[LOG] Guide1 ⚠ pig 11 不存在，跳过');
    this._completed = true;
    return;
  }

  this._startAngle = pig.angle;
  this._rotationT = 0;

  // 计算从当前方向旋转到 330° 的最短角度差
  this._rotationAngle = normalizeAngleDiff(TARGET_ANGLE - this._startAngle);
  console.log('[LOG] Guide1 激活 — pig(11) angle=' + this._startAngle.toFixed(1) +
    '° → target=' + TARGET_ANGLE + '° 旋转角=' + this._rotationAngle.toFixed(1) + '°');

  // 创建旋转幽灵（仅当角度差足够大时才播放，差 <10° 播放不出效果）
  if (Math.abs(this._rotationAngle) >= 10) {
    this._ghostEntry = {
      pigId: 11,
      hintAngle: this._startAngle,
      dirX: 0, dirY: 0,
      totalDist: 0,
      currentDx: 0, currentDy: 0,
      startTime: Date.now(),
      duration: 1e9           // 极长 duration，避免自动循环重置 startTime
    };
    engine.gp.ghostAnimations.push(this._ghostEntry);
    console.log('[LOG] Guide1 旋转幽灵已推入 ghostAnimations.length=' + engine.gp.ghostAnimations.length);
  } else {
    console.log('[LOG] Guide1 ⚠ 角度差 ' + this._rotationAngle.toFixed(1) + '° < 10°，跳过旋转幽灵（但提示照常走）');
    this._ghostEntry = null;
  }

  // 自动点击提示按钮（让提示系统自己选目标，14号猪的幽灵猪正常跑）
  var hintResult = engine._hint.show();
  console.log('[LOG] Guide1 hint.show() result=' + (hintResult ? 'pig#' + hintResult.id : 'null'));
};

// ----------------------------------------------------------------
// 每帧更新：旋转幽灵猪的 hintAngle
// ----------------------------------------------------------------
Guide1.prototype.onUpdate = function (dt, state, engine) {
  if (!this._ghostEntry) {
    if (!this._loggedMissing) { console.log('[LOG] Guide1 onUpdate: _ghostEntry 为 null，跳过'); this._loggedMissing = true; }
    return;
  }

  // 检查幽灵是否还在数组中（可能被 hint.clear() 清空）
  if (engine.gp.ghostAnimations.indexOf(this._ghostEntry) < 0) {
    console.log('[LOG] Guide1 ⚠ 幽灵已被移出 ghostAnimations（可能被 hint.clear() 清空），重新推入');
    engine.gp.ghostAnimations.push(this._ghostEntry);
  }

  this._elapsed += dt;

  // 末端停顿阶段：保持终点角度，等待 HOLD_DURATION 后再开始下一段
  if (this._holdT > 0) {
    this._holdT -= dt;
    // 停顿期间角度不动（保持在终点位置）
    return;
  }

  // 计算每段旋转时长（基于实际旋转角度绝对值）
  var segmentDuration = Math.abs(this._rotationAngle) / ROTATION_SPEED;

  this._rotationT += dt / segmentDuration;

  // 先算角度（用 clamp 确保停在终点），再重置 rotationT
  var t = Math.min(this._rotationT, 1);

  // 主运动曲线：ease-in-out — 人手推东西的自然节奏（起停都缓）
  var eased = Easing.easeInOutCubic(t);

  // 手抖叠加：频率 6Hz、振幅 2.5°，中间段最强（手握紧发力时），两端衰减（起停时手最稳）
  var wobbleIntensity = Math.sin(t * Math.PI);          // 0 → 1 → 0
  var wobble = Math.sin(this._elapsed * WOBBLE_FREQ * 2 * Math.PI)
             * WOBBLE_AMPLITUDE
             * wobbleIntensity;

  this._ghostEntry.hintAngle = this._startAngle + this._rotationAngle * eased + wobble;

  if (this._rotationT >= 1) {
    this._rotationT = 0;
    this._holdT = HOLD_DURATION;  // 推到终点后停留 1 秒
  }
};

// ----------------------------------------------------------------
// 结束条件：14号猪已被推出（关卡退出由 deactivate → _guide.reset() 兜底）
// ----------------------------------------------------------------
Guide1.prototype.checkEndCondition = function (state, engine) {
  if (!state.hintActive) {
    console.log('[LOG] Guide1 checkEndCondition ✓ 提示结束（hintActive=false）');
    return true;
  }
  return false;
};

// ----------------------------------------------------------------
// 清理
// ----------------------------------------------------------------
Guide1.prototype.onDeactivate = function (engine) {
  console.log('[LOG] Guide1 onDeactivate — 清理幽灵（ghostLen=' + engine.gp.ghostAnimations.length + '）');
  // 移除旋转幽灵（如果还在的话——hint.clear() 可能已经清空整个数组）
  if (this._ghostEntry) {
    var arr = engine.gp.ghostAnimations;
    var idx = arr.indexOf(this._ghostEntry);
    if (idx >= 0) arr.splice(idx, 1);
    this._ghostEntry = null;
  }
  this._completed = true;
};

/** 引导高亮猪 ID：pig(11) 真猪染色+换动作 */
Guide1.prototype.getGuidePigId = function () { return 11; };

module.exports = Guide1;
