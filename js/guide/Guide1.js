// 引导一：新手推动教学
// 激活条件：0002 关卡 + 玩家 10 秒无操作
// 表现：pig(11) 位置生成幽灵猪，向左旋转 60° 后快照复位循环；自动点击提示按钮
// 结束条件：提示结束，或关卡退出（deactivate → _guide.reset()）

var BaseGuide = require('./BaseGuide.js');

// --- 配置 ---
var ROTATION_SPEED = 60;           // 峰值旋转速度（度/秒）
var ROTATION_ANGLE = 60;           // 向左旋转的度数（逆时针）
var WOBBLE_AMPLITUDE = 2.5;        // 手抖幅度（度）
var WOBBLE_FREQ = 6;               // 手抖频率（Hz）
var HOLD_DURATION = 0.12;          // 末端停顿（秒），模拟人手推到终点后的短暂停留

var Easing = require('../core/Easing.js');

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
  var match = state.levelName === '0002' && state.idleTime > 10;
  if (match) console.log('[Guide1] checkCondition ✓ level=' + state.levelName + ' idle=' + state.idleTime.toFixed(1) + 's');
  return match;
};

// ----------------------------------------------------------------
// 激活
// ----------------------------------------------------------------
Guide1.prototype.onActivate = function (engine) {
  var pig = engine.gp.pigs.find(function (p) { return p.id === 11; });
  console.log('[Guide1] onActivate pig(11) found=' + !!pig + ' pigs.length=' + engine.gp.pigs.length);
  if (!pig) {
    // 关卡中不存在 ID=11 的猪，直接标记完成跳过
    console.log('[Guide1] ⚠ pig 11 不存在，跳过');
    this._completed = true;
    return;
  }

  this._startAngle = pig.angle;
  this._rotationT = 0;
  console.log('[Guide1] 激活 — pig(11) angle=' + this._startAngle.toFixed(1) + '° 向左旋转' + ROTATION_ANGLE + '°');

  // 创建幽灵动画条目（控制 hintAngle 实现旋转）
  this._ghostEntry = {
    pigId: 11,
    hintAngle: this._startAngle,
    dirX: 0, dirY: 0,
    totalDist: 0,
    currentDx: 0, currentDy: 0,
    startTime: Date.now(),
    duration: 1e9,          // 极长 duration，避免自动循环重置 startTime
    progress: 0
  };
  engine.gp.ghostAnimations.push(this._ghostEntry);
  console.log('[Guide1] 幽灵已推入 ghostAnimations.length=' + engine.gp.ghostAnimations.length);

  // 自动点击提示按钮（让提示系统自己选目标）
  var hintResult = engine._hint.show();
  console.log('[Guide1] hint.show() result=' + (hintResult ? 'pig#' + hintResult.id : 'null'));
};

// ----------------------------------------------------------------
// 每帧更新：旋转幽灵猪的 hintAngle
// ----------------------------------------------------------------
Guide1.prototype.onUpdate = function (dt, state, engine) {
  if (!this._ghostEntry) {
    if (!this._loggedMissing) { console.log('[Guide1] onUpdate: _ghostEntry 为 null，跳过'); this._loggedMissing = true; }
    return;
  }

  // 检查幽灵是否还在数组中（可能被 hint.clear() 清空）
  if (engine.gp.ghostAnimations.indexOf(this._ghostEntry) < 0) {
    console.log('[Guide1] ⚠ 幽灵已被移出 ghostAnimations（可能被 hint.clear() 清空），重新推入');
    engine.gp.ghostAnimations.push(this._ghostEntry);
  }

  this._elapsed += dt;

  // 末端停顿阶段：保持终点角度，等待 HOLD_DURATION 后再开始下一段
  if (this._holdT > 0) {
    this._holdT -= dt;
    // 停顿期间角度不动（保持在终点位置）
    return;
  }

  // 计算每段旋转时长
  var segmentDuration = ROTATION_ANGLE / ROTATION_SPEED;

  this._rotationT += dt / segmentDuration;

  if (this._rotationT >= 1) {
    this._rotationT = 0;
    this._holdT = HOLD_DURATION;  // 推到终点后短暂停顿
  }

  var t = this._rotationT;

  // 主运动曲线：ease-in-out — 人手推东西的自然节奏（起停都缓）
  var eased = Easing.easeInOutCubic(t);

  // 手抖叠加：频率 6Hz、振幅 2.5°，中间段最强（手握紧发力时），两端衰减（起停时手最稳）
  var wobbleIntensity = Math.sin(t * Math.PI);          // 0 → 1 → 0
  var wobble = Math.sin(this._elapsed * WOBBLE_FREQ * 2 * Math.PI)
             * WOBBLE_AMPLITUDE
             * wobbleIntensity;

  this._ghostEntry.hintAngle = this._startAngle + ROTATION_ANGLE * eased + wobble;
  // 强制 progress >= 0.05，绕过渲染器的淡入门槛（duration=1e9 导致 progress≈0 → alpha=0 不可见）
  this._ghostEntry.progress = 0.5;
};

// ----------------------------------------------------------------
// 结束条件：14号猪已被推出（关卡退出由 deactivate → _guide.reset() 兜底）
// ----------------------------------------------------------------
Guide1.prototype.checkEndCondition = function (state, engine) {
  if (!state.hintActive) {
    console.log('[Guide1] checkEndCondition ✓ 提示结束');
    return true;
  }
  return false;
};

// ----------------------------------------------------------------
// 清理
// ----------------------------------------------------------------
Guide1.prototype.onDeactivate = function (engine) {
  console.log('[Guide1] onDeactivate — 清理幽灵');
  // 移除旋转幽灵（如果还在的话——hint.clear() 可能已经清空整个数组）
  if (this._ghostEntry) {
    var arr = engine.gp.ghostAnimations;
    var idx = arr.indexOf(this._ghostEntry);
    if (idx >= 0) arr.splice(idx, 1);
    this._ghostEntry = null;
  }
  this._completed = true;
};

module.exports = Guide1;
