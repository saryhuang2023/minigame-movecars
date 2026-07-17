// 金币磁吸飞行动画 — 每推出一只猪，金币从尾巴弹出飞向金币区
// PlayingEngine 专用，无连击依赖，适合慢节奏策略玩法
// v2：飞行更有冲劲 —— 沿运动方向的速度拉伸（旋转+拉长）+ 提速 + 抬弧 + 增强拖尾与飞行光晕

var AssetPreloader = require('../ui/AssetPreloader.js');
var Easing = require('../core/Easing.js');

// ---- 动画参数 ----
var FLY_DURATION = 780;       // 飞行总时长 ms（提速，更利落有冲劲）
var ARC_HEIGHT = 110;         // 贝塞尔弧线高度 px（抬高弧线，抛感更强）
var BURST_ARC_HEIGHT = 90;   // 炸开模式弧线高度（冲出感）
var BURST_DURATION = 600;      // 炸开总时长 ms
var BURST_PHASE = 300;         // 炸开阶段：0-300ms 向上喷出
var BURST_SNAP = 300;          // 吸入阶段：300-600ms 慢起加速吸到目标
var COIN_SIZE = 24;           // 飞行中金币基准大小
var TRAIL_COUNT = 5;          // 拖尾残影数量（增强）
var TRAIL_SPACING_MS = 26;    // 残影间距 ms（更密更连贯）
var TRAIL_ALPHA = 0.30;       // 拖尾基础透明度（增强）
var POP_PEAK_SCALE = 1.35;    // 弹出峰值缩放
var POP_DURATION_RATIO = 0.15; // 弹出阶段占飞行总时长的比例
var END_SCALE = 0.85;         // 到达时缩放
var JITTER_X = 20;            // 普通模式控制点 X 随机偏移
var JITTER_Y = 15;            // 普通模式控制点 Y 随机偏移

// 速度拉伸参数（核心"有劲"观感）
var STRETCH_SAMPLE_DT = 0.035;  // 采样前瞻比例，用于估算瞬时速度方向
var STRETCH_GAIN = 0.032;       // 位移→拉伸系数
var STRETCH_MAX = 0.62;         // 最长拉伸上限
var STRETCH_SQUASH = 0.45;      // 垂直方向收缩比例（相对拉伸量）

function CoinFlyEffect() {
  this._animations = [];  // { fromX, fromY, toX, toY, startTime, burst, peakX, peakY, randX, randY }
}

/** 触发一枚金币从 from → to 磁吸飞行
 * @param {boolean} [burst] 炸开模式（起点先散开再飞入，用于步数奖励）
 */
CoinFlyEffect.prototype.trigger = function (fromX, fromY, toX, toY, burst) {
  var anim = {
    fromX: fromX,
    fromY: fromY,
    toX: toX,
    toY: toY,
    startTime: Date.now(),
    burst: !!burst,
  };
  if (burst) {
    // 烟花效果：正上方 90° 扇形随机方向喷出
    var peakDist = BURST_ARC_HEIGHT * (0.7 + Math.random() * 0.3); // 150~220
    var fanAngle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI / 2; // -90°±45° (正上方扇形)
    anim.peakX = fromX + Math.cos(fanAngle) * peakDist;
    anim.peakY = fromY + Math.sin(fanAngle) * peakDist;
  } else {
    anim.randX = (Math.random() - 0.5) * JITTER_X * 2;
    anim.randY = (Math.random() - 0.5) * JITTER_Y * 2;
  }
  this._animations.push(anim);
};

/** 是否有飞行中的动画 */
CoinFlyEffect.prototype.isActive = function () {
  return this._animations.length > 0;
};

/** 获取距离目标最近的飞行金币的归一化进度（0~1），无飞行中返回 0 */
CoinFlyEffect.prototype.getNearestProgress = function () {
  var best = 0;
  var now = Date.now();
  for (var i = 0; i < this._animations.length; i++) {
    var dur = this._animations[i].burst ? BURST_DURATION : FLY_DURATION;
    var p = (now - this._animations[i].startTime) / dur;
    if (p > best) best = p;
  }
  return Math.min(best, 1);
};

/** 每帧清理已完成动画，返回本帧到达目标的金币数 */
CoinFlyEffect.prototype.update = function () {
  var now = Date.now();
  var arrivedCount = 0;
  var surviving = [];
  for (var i = 0; i < this._animations.length; i++) {
    var dur = this._animations[i].burst ? BURST_DURATION : FLY_DURATION;
    if (now - this._animations[i].startTime < dur) {
      surviving.push(this._animations[i]);
    } else {
      arrivedCount++;
    }
  }
  this._animations = surviving;
  return arrivedCount;
};

/** 计算某归一化进度（rawT 0~1）下的屏幕坐标，普通/炸开模式通用
 * 供主币位置与拖尾、速度采样复用，避免贝塞尔逻辑散落多处
 */
CoinFlyEffect.prototype._getPos = function (a, rawT) {
  if (a.burst) {
    if (rawT <= 0.5) {
      var pt = Easing.easeOutCubic(rawT / 0.5);
      return { x: a.fromX + (a.peakX - a.fromX) * pt, y: a.fromY + (a.peakY - a.fromY) * pt };
    }
    var st = Easing.easeInCubic((rawT - 0.5) / 0.5);
    return { x: a.peakX + (a.toX - a.peakX) * st, y: a.peakY + (a.toY - a.peakY) * st };
  }
  var t = Easing.easeInOutCubic(rawT);
  var cpX = a.fromX + (a.toX - a.fromX) * 0.65 + (a.randX || 0);
  var cpY = Math.min(a.fromY, a.toY) - ARC_HEIGHT + (a.randY || 0);
  var t1 = 1 - t;
  return {
    x: t1 * t1 * a.fromX + 2 * t1 * t * cpX + t * t * a.toX,
    y: t1 * t1 * a.fromY + 2 * t1 * t * cpY + t * t * a.toY,
  };
};

/** 渲染（应在 GoldWidget 之前调用，确保币飞到金币区上层） */
CoinFlyEffect.prototype.render = function (ctx) {
  var coinImg = AssetPreloader.get('coin');
  if (!coinImg) return;

  var now = Date.now();

  for (var i = 0; i < this._animations.length; i++) {
    var a = this._animations[i];
    var elapsed = now - a.startTime;

    var totalDur = a.burst ? BURST_DURATION : FLY_DURATION;
    if (elapsed <= 0 || elapsed >= totalDur) continue;
    var rawT = elapsed / totalDur;

    // 主币当前位置
    var p = this._getPos(a, rawT);
    var fx = p.x, fy = p.y;

    // ---- 缩放：弹出→回缩 ----
    var scale;
    var popEnd = POP_DURATION_RATIO;
    if (rawT < popEnd) {
      var popT = rawT / popEnd;
      scale = Easing.easeOutBack(popT, 1.3) * POP_PEAK_SCALE;
    } else {
      var shrinkT = (rawT - popEnd) / (1 - popEnd);
      scale = POP_PEAK_SCALE - (POP_PEAK_SCALE - END_SCALE) * shrinkT;
    }
    scale = Math.max(0.3, scale);

    // ---- 透明度 ----
    var alpha = rawT < 0.05 ? rawT / 0.05 : 1;

    var sized = COIN_SIZE * scale;

    // ---- 速度拉伸：采样前方位置估算瞬时速度方向，沿运动方向拉长 ----
    var ahead = this._getPos(a, Math.min(rawT + STRETCH_SAMPLE_DT, 1));
    var vx = ahead.x - fx;
    var vy = ahead.y - fy;
    var disp = Math.sqrt(vx * vx + vy * vy);
    var angle = Math.atan2(vy, vx);
    var stretch = Math.min(disp * STRETCH_GAIN, STRETCH_MAX);
    // 中段更快 → 拉伸更强（easeInOutCubic 中段速度最大），落点附近自然归零显得"稳稳落定"
    var sx = 1 + stretch;
    var sy = 1 - stretch * STRETCH_SQUASH;

    // ---- 拖尾（沿 path 回溯，复用 _getPos） ----
    ctx.save();
    for (var j = 0; j < TRAIL_COUNT; j++) {
      var trailMs = (j + 1) * TRAIL_SPACING_MS;
      var trailElapsed = elapsed - trailMs;
      if (trailElapsed <= 0) continue;

      var trailRawT = Math.max(0, Math.min(trailElapsed / totalDur, 0.98));
      var tp = this._getPos(a, trailRawT);
      var trailAlpha = TRAIL_ALPHA * (1 - j / TRAIL_COUNT);
      var trailSize = sized * (0.6 - j * 0.05);

      ctx.globalAlpha = trailAlpha;
      ctx.drawImage(coinImg, tp.x - trailSize / 2, tp.y - trailSize / 2, trailSize, trailSize);
    }
    ctx.restore();

    // ---- 飞行中光晕（中段更亮，增强"蓄能冲刺"观感） ----
    var glowPulse = Math.sin(rawT * Math.PI); // 0→1→0
    var glowR = sized * (0.9 + 0.4 * glowPulse);
    ctx.save();
    ctx.globalAlpha = 0.35 * alpha * (0.5 + 0.5 * glowPulse);
    var g = ctx.createRadialGradient(fx, fy, sized * 0.2, fx, fy, glowR);
    g.addColorStop(0, 'rgba(255, 225, 95, 0.9)');
    g.addColorStop(0.5, 'rgba(255, 200, 0, 0.35)');
    g.addColorStop(1, 'rgba(255, 170, 0, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(fx, fy, glowR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // ---- 主金币（沿运动方向拉伸） ----
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(fx, fy);
    ctx.rotate(angle);
    ctx.scale(sx, sy);
    ctx.drawImage(coinImg, -sized / 2, -sized / 2, sized, sized);
    ctx.restore();
  }
};

module.exports = CoinFlyEffect;
