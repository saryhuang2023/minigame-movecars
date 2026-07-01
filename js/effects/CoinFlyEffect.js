// 金币磁吸飞行动画 — 每推出一只猪，金币从尾巴弹出飞向金币区
// PlayingEngine 专用，无连击依赖，适合慢节奏策略玩法

var AssetPreloader = require('../ui/AssetPreloader.js');
var Easing = require('../core/Easing.js');

// ---- 动画参数 ----
var FLY_DURATION = 1000;      // 飞行总时长 ms（放慢让轨迹可见）
var ARC_HEIGHT = 80;          // 贝塞尔弧线高度 px（配合慢速，弧度降低以保持自然）
var BURST_ARC_HEIGHT = 90;   // 炸开模式弧线高度（冲出感）
var BURST_DURATION = 600;      // 炸开总时长 ms
var BURST_PHASE = 300;         // 炸开阶段：0-300ms 向上喷出
var BURST_SNAP = 300;          // 吸入阶段：300-600ms 慢起加速吸到目标
var COIN_SIZE = 24;           // 飞行中金币基准大小
var TRAIL_COUNT = 3;          // 拖尾残影数量
var TRAIL_SPACING_MS = 35;    // 残影间距 ms
var POP_PEAK_SCALE = 1.35;    // 弹出峰值缩放
var POP_DURATION_RATIO = 0.15; // 弹出阶段占飞行总时长的比例
var END_SCALE = 0.85;         // 到达时缩放
var JITTER_X = 20;            // 普通模式控制点 X 随机偏移
var JITTER_Y = 15;            // 普通模式控制点 Y 随机偏移

function CoinFlyEffect() {
  this._animations = [];  // { fromX, fromY, toX, toY, startTime }
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

/** 渲染（应在 GoldWidget 之前调用，确保币飞到金币区上层） */
CoinFlyEffect.prototype.render = function (ctx) {
  var coinImg = AssetPreloader.get('coin');
  if (!coinImg) return;

  var now = Date.now();

  for (var i = 0; i < this._animations.length; i++) {
    var a = this._animations[i];
    var elapsed = now - a.startTime;

    var fx, fy, t, totalDur, rawT;
    if (a.burst) {
      // === 烟花效果：先喷出(0-300ms easeOut) → 吸入(300-400ms easeIn) ===
      totalDur = BURST_DURATION;
      if (elapsed >= totalDur) continue;
      rawT = elapsed / totalDur;
      var phaseT = elapsed / BURST_PHASE;
      if (elapsed < BURST_PHASE) {
        // 喷出阶段：起点 → peak，前快后慢
        t = Easing.easeOutCubic(Math.min(phaseT, 1));
        fx = a.fromX + (a.peakX - a.fromX) * t;
        fy = a.fromY + (a.peakY - a.fromY) * t;
      } else {
        // 吸入阶段：peak → 目标，慢起速加（被吸进去的感觉）
        var snapT = (elapsed - BURST_PHASE) / BURST_SNAP;
        t = Easing.easeInCubic(Math.min(snapT, 1));
        fx = a.peakX + (a.toX - a.peakX) * t;
        fy = a.peakY + (a.toY - a.peakY) * t;
      }
    } else {
      // === 普通模式：单贝塞尔曲线 ===
      totalDur = FLY_DURATION;
      if (elapsed <= 0 || elapsed >= totalDur) continue;
      rawT = elapsed / totalDur;
      t = Easing.easeInOutCubic(rawT);

      var cpX = a.fromX + (a.toX - a.fromX) * 0.65 + (a.randX || 0);
      var cpY = Math.min(a.fromY, a.toY) - ARC_HEIGHT + (a.randY || 0);

      var t1 = 1 - t;
      fx = t1 * t1 * a.fromX + 2 * t1 * t * cpX + t * t * a.toX;
      fy = t1 * t1 * a.fromY + 2 * t1 * t * cpY + t * t * a.toY;
    }

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

    // ---- 拖尾（普通模式用贝塞尔曲线；炸开模式简化：沿 path 均匀回溯） ----
    ctx.save();
    for (var j = 0; j < TRAIL_COUNT; j++) {
      var trailMs = (j + 1) * TRAIL_SPACING_MS;
      var trailElapsed = elapsed - trailMs;
      if (trailElapsed <= 0) continue;

      var trailFx, trailFy;
      if (a.burst) {
        if (trailElapsed < BURST_PHASE) {
          var et = Easing.easeOutCubic(trailElapsed / BURST_PHASE);
          trailFx = a.fromX + (a.peakX - a.fromX) * et;
          trailFy = a.fromY + (a.peakY - a.fromY) * et;
        } else {
          var st = (trailElapsed - BURST_PHASE) / BURST_SNAP;
          var si = Easing.easeInCubic(Math.min(st, 1));
          trailFx = a.peakX + (a.toX - a.peakX) * si;
          trailFy = a.peakY + (a.toY - a.peakY) * si;
        }
      } else {
        var trailRawT = Math.min(trailElapsed / FLY_DURATION, 0.95);
        var trailT = Easing.easeInOutCubic(trailRawT);
        var trt1 = 1 - trailT;
        var cpX2 = a.fromX + (a.toX - a.fromX) * 0.65 + (a.randX || 0);
        var cpY2 = Math.min(a.fromY, a.toY) - ARC_HEIGHT + (a.randY || 0);
        trailFx = trt1 * trt1 * a.fromX + 2 * trt1 * trailT * cpX2 + trailT * trailT * a.toX;
        trailFy = trt1 * trt1 * a.fromY + 2 * trt1 * trailT * cpY2 + trailT * trailT * a.toY;
      }

      var trailAlpha = 0.25 * (1 - j / TRAIL_COUNT);
      var trailSize = sized * 0.6;

      ctx.globalAlpha = trailAlpha;
      ctx.drawImage(coinImg, trailFx - trailSize / 2, trailFy - trailSize / 2, trailSize, trailSize);
    }
    ctx.restore();

    // ---- 主金币 ----
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(coinImg, fx - sized / 2, fy - sized / 2, sized, sized);
    ctx.restore();
  }
};

module.exports = CoinFlyEffect;
