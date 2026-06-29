// 金币磁吸飞行动画 — 每推出一只猪，金币从尾巴弹出飞向金币区
// PlayingEngine 专用，无连击依赖，适合慢节奏策略玩法

var AssetPreloader = require('../ui/AssetPreloader.js');
var Easing = require('../core/Easing.js');

// ---- 动画参数 ----
var FLY_DURATION = 1000;      // 飞行总时长 ms（放慢让轨迹可见）
var ARC_HEIGHT = 80;          // 贝塞尔弧线高度 px（配合慢速，弧度降低以保持自然）
var COIN_SIZE = 24;           // 飞行中金币基准大小
var TRAIL_COUNT = 3;          // 拖尾残影数量
var TRAIL_SPACING_MS = 35;    // 残影间距 ms
var POP_PEAK_SCALE = 1.35;    // 弹出峰值缩放
var POP_DURATION_RATIO = 0.15; // 弹出阶段占飞行总时长的比例
var END_SCALE = 0.85;         // 到达时缩放

function CoinFlyEffect() {
  this._animations = [];  // { fromX, fromY, toX, toY, startTime }
}

/** 触发一枚金币从 from → to 磁吸飞行 */
CoinFlyEffect.prototype.trigger = function (fromX, fromY, toX, toY) {
  this._animations.push({
    fromX: fromX,
    fromY: fromY,
    toX: toX,
    toY: toY,
    startTime: Date.now(),
  });
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
    var p = (now - this._animations[i].startTime) / FLY_DURATION;
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
    if (now - this._animations[i].startTime < FLY_DURATION) {
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
    var rawT = (now - a.startTime) / FLY_DURATION;
    if (rawT <= 0 || rawT >= 1) continue;

    // ---- 磁吸缓动 ----
    // easeInOutCubic：犹豫 → 加速（磁吸生效）→ 减速着陆
    var t = Easing.easeInOutCubic(rawT);

    // 控制点偏向目标（磁吸感：硬币像被"拽"过去）
    var pull = 0.65;  // 0.5=标准弧, 1.0=完全偏目标
    var cpX = a.fromX + (a.toX - a.fromX) * pull;
    var cpY = Math.min(a.fromY, a.toY) - ARC_HEIGHT;

    var t1 = 1 - t;
    var fx = t1 * t1 * a.fromX + 2 * t1 * t * cpX + t * t * a.toX;
    var fy = t1 * t1 * a.fromY + 2 * t1 * t * cpY + t * t * a.toY;

    // ---- 缩放：弹出→回缩 ----
    var scale;
    var popEnd = POP_DURATION_RATIO;
    if (rawT < popEnd) {
      // 弹出阶段：0 → POP_PEAK_SCALE（带 easeOutBack）
      var popT = rawT / popEnd;
      scale = Easing.easeOutBack(popT, 1.3) * POP_PEAK_SCALE;
    } else {
      // 回缩阶段：POP_PEAK_SCALE → END_SCALE
      var shrinkT = (rawT - popEnd) / (1 - popEnd);
      scale = POP_PEAK_SCALE - (POP_PEAK_SCALE - END_SCALE) * shrinkT;
    }
    scale = Math.max(0.3, scale);

    // ---- 透明度 ----
    var alpha = rawT < 0.05 ? rawT / 0.05 : 1;  // 最初5%淡入

    var sized = COIN_SIZE * scale;

    // ---- 拖尾残影 ----
    for (var j = 0; j < TRAIL_COUNT; j++) {
      var trailMs = (j + 1) * TRAIL_SPACING_MS;
      var trailRawT = rawT - trailMs / FLY_DURATION;
      if (trailRawT <= 0) continue;

      var trailT = Easing.easeInOutCubic(Math.min(trailRawT, 0.95));
      var trt1 = 1 - trailT;
      var trailFx = trt1 * trt1 * a.fromX + 2 * trt1 * trailT * cpX + trailT * trailT * a.toX;
      var trailFy = trt1 * trt1 * a.fromY + 2 * trt1 * trailT * cpY + trailT * trailT * a.toY;

      var trailAlpha = 0.25 * (1 - j / TRAIL_COUNT);
      var trailSize = sized * 0.6;

      ctx.save();
      ctx.globalAlpha = trailAlpha;
      ctx.drawImage(coinImg, trailFx - trailSize / 2, trailFy - trailSize / 2, trailSize, trailSize);
      ctx.restore();
    }

    // ---- 主金币 ----
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(coinImg, fx - sized / 2, fy - sized / 2, sized, sized);
    ctx.restore();
  }
};

module.exports = CoinFlyEffect;
