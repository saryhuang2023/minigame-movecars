// 道具图标飞行动画 — +3步道具使用后，图标飞向剩余步数面板
// 飞行曲线 / 缩放 / 拖尾 与 CoinFlyEffect（金币飞行）一致，仅将金币图替换为道具图标
// 图片 key 由构造参数传入（默认 addstep_icon），渲染时从 AssetPreloader 取图
// v2：飞行更有冲劲 —— 沿运动方向的速度拉伸（旋转+拉长）+ 提速 + 抬弧 + 增强拖尾与飞行光晕

var AssetPreloader = require('../ui/AssetPreloader.js');
var Easing = require('../core/Easing.js');

// ---- 动画参数（对齐 CoinFlyEffect 普通模式）----
var FLY_DURATION = 780;       // 飞行总时长 ms（提速）
var ARC_HEIGHT = 110;         // 贝塞尔弧线高度 px（抬弧）
var ICON_SIZE = 44;           // 飞行中图标基准大小
var TRAIL_COUNT = 5;          // 拖尾残影数量（增强）
var TRAIL_SPACING_MS = 26;    // 残影间距 ms（更密更连贯）
var TRAIL_ALPHA = 0.30;       // 拖尾基础透明度（增强）
var POP_PEAK_SCALE = 1.35;    // 弹出峰值缩放
var POP_DURATION_RATIO = 0.15; // 弹出阶段占飞行总时长的比例
var END_SCALE = 0.85;         // 到达时缩放
var JITTER_X = 20;            // 控制点 X 随机偏移
var JITTER_Y = 15;            // 控制点 Y 随机偏移

// 速度拉伸参数（核心"有劲"观感）
var STRETCH_SAMPLE_DT = 0.035;
var STRETCH_GAIN = 0.032;
var STRETCH_MAX = 0.62;
var STRETCH_SQUASH = 0.45;

function ItemFlyEffect(imgKey) {
  this._imgKey = imgKey || 'addstep_icon';
  this._animations = [];  // { fromX, fromY, toX, toY, startTime, randX, randY }
}

/** 触发一枚道具图标从 from → to 飞行 */
ItemFlyEffect.prototype.trigger = function (fromX, fromY, toX, toY) {
  var anim = {
    fromX: fromX,
    fromY: fromY,
    toX: toX,
    toY: toY,
    startTime: Date.now(),
  };
  anim.randX = (Math.random() - 0.5) * JITTER_X * 2;
  anim.randY = (Math.random() - 0.5) * JITTER_Y * 2;
  this._animations.push(anim);
};

/** 是否有飞行中的动画 */
ItemFlyEffect.prototype.isActive = function () {
  return this._animations.length > 0;
};

/** 每帧清理已完成动画，返回本帧到达目标的数量 */
ItemFlyEffect.prototype.update = function () {
  var now = Date.now();
  var arrivedCount = 0;
  var surviving = [];
  for (var i = 0; i < this._animations.length; i++) {
    if (now - this._animations[i].startTime < FLY_DURATION) {
      surviving.push(this._animations[i]);
    } else {
      arrivedCount++;
    }
  }
  this._animations = surviving;
  return arrivedCount;
};

/** 计算某归一化进度（rawT 0~1）下的屏幕坐标（普通贝塞尔） */
ItemFlyEffect.prototype._getPos = function (a, rawT) {
  var t = Easing.easeInOutCubic(rawT);
  var cpX = a.fromX + (a.toX - a.fromX) * 0.65 + (a.randX || 0);
  var cpY = Math.min(a.fromY, a.toY) - ARC_HEIGHT + (a.randY || 0);
  var t1 = 1 - t;
  return {
    x: t1 * t1 * a.fromX + 2 * t1 * t * cpX + t * t * a.toX,
    y: t1 * t1 * a.fromY + 2 * t1 * t * cpY + t * t * a.toY,
  };
};

/** 渲染（与金币飞行同层，置于其他 UI 之上） */
ItemFlyEffect.prototype.render = function (ctx) {
  var iconImg = AssetPreloader.get(this._imgKey);
  if (!iconImg) return;

  var now = Date.now();

  for (var i = 0; i < this._animations.length; i++) {
    var a = this._animations[i];
    var elapsed = now - a.startTime;
    if (elapsed <= 0 || elapsed >= FLY_DURATION) continue;
    var rawT = elapsed / FLY_DURATION;

    // 主图标当前位置
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

    var sized = ICON_SIZE * scale;

    // ---- 速度拉伸：采样前方位置估算瞬时速度方向，沿运动方向拉长 ----
    var ahead = this._getPos(a, Math.min(rawT + STRETCH_SAMPLE_DT, 1));
    var vx = ahead.x - fx;
    var vy = ahead.y - fy;
    var disp = Math.sqrt(vx * vx + vy * vy);
    var angle = Math.atan2(vy, vx);
    var stretch = Math.min(disp * STRETCH_GAIN, STRETCH_MAX);
    var sx = 1 + stretch;
    var sy = 1 - stretch * STRETCH_SQUASH;

    // ---- 拖尾 ----
    ctx.save();
    for (var j = 0; j < TRAIL_COUNT; j++) {
      var trailMs = (j + 1) * TRAIL_SPACING_MS;
      var trailElapsed = elapsed - trailMs;
      if (trailElapsed <= 0) continue;

      var trailRawT = Math.max(0, Math.min(trailElapsed / FLY_DURATION, 0.98));
      var tp = this._getPos(a, trailRawT);
      var trailAlpha = TRAIL_ALPHA * (1 - j / TRAIL_COUNT);
      var trailSize = sized * (0.6 - j * 0.05);

      ctx.globalAlpha = trailAlpha;
      ctx.drawImage(iconImg, tp.x - trailSize / 2, tp.y - trailSize / 2, trailSize, trailSize);
    }
    ctx.restore();

    // ---- 飞行中光晕（绿色调，与 +3 道具语义呼应） ----
    var glowPulse = Math.sin(rawT * Math.PI);
    var glowR = sized * (0.9 + 0.4 * glowPulse);
    ctx.save();
    ctx.globalAlpha = 0.35 * alpha * (0.5 + 0.5 * glowPulse);
    var g = ctx.createRadialGradient(fx, fy, sized * 0.2, fx, fy, glowR);
    g.addColorStop(0, 'rgba(180, 255, 160, 0.9)');
    g.addColorStop(0.5, 'rgba(120, 230, 120, 0.35)');
    g.addColorStop(1, 'rgba(80, 200, 80, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(fx, fy, glowR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // ---- 主图标（沿运动方向拉伸） ----
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(fx, fy);
    ctx.rotate(angle);
    ctx.scale(sx, sy);
    ctx.drawImage(iconImg, -sized / 2, -sized / 2, sized, sized);
    ctx.restore();
  }
};

module.exports = ItemFlyEffect;
