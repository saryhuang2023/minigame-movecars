// 引导二：旋转教学
// 激活条件：0003 关卡 + 玩家 10 秒无操作 + 20号猪还在棋盘上
// 表现：pig(20) 位置生成幽灵猪，向左旋转 180° 后快照复位循环（不自动呼出提示）
// 结束条件：20号猪被推出，或关卡退出（deactivate → _guide.reset()）

var BaseGuide = require('./BaseGuide.js');

// --- 配置 ---
var ROTATION_SPEED = 60;           // 峰值旋转速度（度/秒，与 Guide1 一致）
var ROTATION_ANGLE = 180;          // 向左旋转的度数（逆时针，比 Guide1 的 60° 更大幅度）
var WOBBLE_AMPLITUDE = 2.5;        // 手抖幅度（度）
var WOBBLE_FREQ = 6;               // 手抖频率（Hz）
var HOLD_DURATION = 1;             // 末端停顿（秒），推到终点后停留 1 秒再复位

var Easing = require('../core/Easing.js');

function Guide2() {
  BaseGuide.call(this, 'guide2');

  this._startAngle = 0;
  this._elapsed = 0;               // 累计总时间（用于连续 sin 波形）
  this._rotationT = 0;             // 旋转进度（每段 0→1）
  this._holdT = 0;                 // 末端停顿计时器
  this._ghostEntry = null;         // gp.ghostAnimations 中的引用
}

Guide2.prototype = Object.create(BaseGuide.prototype);
Guide2.prototype.constructor = Guide2;

// ----------------------------------------------------------------
// 激活条件
// ----------------------------------------------------------------
Guide2.prototype.checkCondition = function (state, engine) {
  if (state.levelName !== '0003' || state.idleTime <= 10) return false;

  var pig20Exists = engine.gp.pigs.some(function (p) { return p.id === 20; });
  if (pig20Exists) {
    console.log('[Guide2] checkCondition ✓ level=' + state.levelName + ' idle=' + state.idleTime.toFixed(1) + 's pig20=true');
  } else {
    console.log('[Guide2] checkCondition ✗ pig20 已被推出，跳过');
  }
  return pig20Exists;
};

// ----------------------------------------------------------------
// 激活
// ----------------------------------------------------------------
Guide2.prototype.onActivate = function (engine) {
  var pig = engine.gp.pigs.find(function (p) { return p.id === 20; });
  console.log('[Guide2] onActivate pig(20) found=' + !!pig + ' pigs.length=' + engine.gp.pigs.length);
  if (!pig) {
    // 关卡中不存在 ID=20 的猪，直接标记完成跳过
    console.log('[Guide2] ⚠ pig 20 不存在，跳过');
    this._completed = true;
    return;
  }

  this._startAngle = pig.angle;
  this._rotationT = 0;
  console.log('[Guide2] 激活 — pig(20) angle=' + this._startAngle.toFixed(1) + '° 向左旋转' + ROTATION_ANGLE + '°');

  // 创建幽灵动画条目（控制 hintAngle 实现旋转）
  this._ghostEntry = {
    pigId: 20,
    hintAngle: this._startAngle,
    dirX: 0, dirY: 0,
    totalDist: 0,
    currentDx: 0, currentDy: 0,
    startTime: Date.now(),
    duration: 1e9           // 极长 duration，避免自动循环重置 startTime
  };
  engine.gp.ghostAnimations.push(this._ghostEntry);
  console.log('[Guide2] 幽灵已推入 ghostAnimations.length=' + engine.gp.ghostAnimations.length);

  console.log('[Guide2] (无提示，仅旋转)');
};

// ----------------------------------------------------------------
// 每帧更新：旋转幽灵猪的 hintAngle（与 Guide1 完全相同的动画节奏）
// ----------------------------------------------------------------
Guide2.prototype.onUpdate = function (dt, state, engine) {
  if (!this._ghostEntry) {
    if (!this._loggedMissing) { console.log('[Guide2] onUpdate: _ghostEntry 为 null，跳过'); this._loggedMissing = true; }
    return;
  }

  // 检查幽灵是否还在数组中（可能被 hint.clear() 清空）
  if (engine.gp.ghostAnimations.indexOf(this._ghostEntry) < 0) {
    console.log('[Guide2] ⚠ 幽灵已被移出 ghostAnimations（可能被 hint.clear() 清空），重新推入');
    engine.gp.ghostAnimations.push(this._ghostEntry);
  }

  this._elapsed += dt;

  // 末端停顿阶段：保持终点角度，等待 HOLD_DURATION 后再开始下一段
  if (this._holdT > 0) {
    this._holdT -= dt;
    // 停顿期间角度不动（保持在终点位置）
    return;
  }

  // 计算每段旋转时长（180°/60°/s = 3秒）
  var segmentDuration = ROTATION_ANGLE / ROTATION_SPEED;

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

  this._ghostEntry.hintAngle = this._startAngle + ROTATION_ANGLE * eased + wobble;

  if (this._rotationT >= 1) {
    this._rotationT = 0;
    this._holdT = HOLD_DURATION;  // 推到终点后停留 1 秒
  }
};

// ----------------------------------------------------------------
// 结束条件：20号猪已被推出（关卡退出由 deactivate → _guide.reset() 兜底）
// ----------------------------------------------------------------
Guide2.prototype.checkEndCondition = function (state, engine) {
  var pig20Exists = engine.gp.pigs.some(function (p) { return p.id === 20; });
  if (!pig20Exists) {
    console.log('[Guide2] checkEndCondition ✓ pig20 已被推出');
    return true;
  }
  return false;
};

// ----------------------------------------------------------------
// 清理
// ----------------------------------------------------------------
Guide2.prototype.onDeactivate = function (engine) {
  console.log('[Guide2] onDeactivate — 清理幽灵');
  // 移除旋转幽灵（如果还在的话——hint.clear() 可能已经清空整个数组）
  if (this._ghostEntry) {
    var arr = engine.gp.ghostAnimations;
    var idx = arr.indexOf(this._ghostEntry);
    if (idx >= 0) arr.splice(idx, 1);
    this._ghostEntry = null;
  }
  this._completed = true;
};

module.exports = Guide2;
