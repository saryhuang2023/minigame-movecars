// 道具图标飞行动画 — +3步道具使用后，图标飞向剩余步数面板
// 飞行曲线 / 缩放 / 拖尾 与 CoinFlyEffect（金币飞行）一致，仅将金币图替换为道具图标
// 图片 key 由构造参数传入（默认 addstep_icon），渲染时从 AssetPreloader 取图

var AssetPreloader = require('../ui/AssetPreloader.js');
var Easing = require('../core/Easing.js');

// ---- 动画参数（对齐 CoinFlyEffect 普通模式）----
var FLY_DURATION = 1000;      // 飞行总时长 ms
var ARC_HEIGHT = 80;          // 贝塞尔弧线高度 px
var ICON_SIZE = 44;           // 飞行中图标基准大小
var TRAIL_COUNT = 3;          // 拖尾残影数量
var TRAIL_SPACING_MS = 35;    // 残影间距 ms
var POP_PEAK_SCALE = 1.35;    // 弹出峰值缩放
var POP_DURATION_RATIO = 0.15; // 弹出阶段占飞行总时长的比例
var END_SCALE = 0.85;         // 到达时缩放
var JITTER_X = 20;            // 控制点 X 随机偏移
var JITTER_Y = 15;            // 控制点 Y 随机偏移

function ItemFlyEffect(imgKey) {
  this._imgKey = imgKey || 'addstep_icon';
  this._animations = [];  // { fromX, fromY, toX, toY, startTime }
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
    var t = Easing.easeInOutCubic(rawT);

    var cpX = a.fromX + (a.toX - a.fromX) * 0.65 + (a.randX || 0);
    var cpY = Math.min(a.fromY, a.toY) - ARC_HEIGHT + (a.randY || 0);

    var t1 = 1 - t;
    var fx = t1 * t1 * a.fromX + 2 * t1 * t * cpX + t * t * a.toX;
    var fy = t1 * t1 * a.fromY + 2 * t1 * t * cpY + t * t * a.toY;

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

    // ---- 拖尾 ----
    ctx.save();
    for (var j = 0; j < TRAIL_COUNT; j++) {
      var trailMs = (j + 1) * TRAIL_SPACING_MS;
      var trailElapsed = elapsed - trailMs;
      if (trailElapsed <= 0) continue;

      var trailRawT = Math.min(trailElapsed / FLY_DURATION, 0.95);
      var trailT = Easing.easeInOutCubic(trailRawT);
      var trt1 = 1 - trailT;
      var cpX2 = a.fromX + (a.toX - a.fromX) * 0.65 + (a.randX || 0);
      var cpY2 = Math.min(a.fromY, a.toY) - ARC_HEIGHT + (a.randY || 0);
      var trailFx = trt1 * trt1 * a.fromX + 2 * trt1 * trailT * cpX2 + trailT * trailT * a.toX;
      var trailFy = trt1 * trt1 * a.fromY + 2 * trt1 * trailT * cpY2 + trailT * trailT * a.toY;

      var trailAlpha = 0.25 * (1 - j / TRAIL_COUNT);
      var trailSize = sized * 0.6;

      ctx.globalAlpha = trailAlpha;
      ctx.drawImage(iconImg, trailFx - trailSize / 2, trailFy - trailSize / 2, trailSize, trailSize);
    }
    ctx.restore();

    // ---- 主图标 ----
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(iconImg, fx - sized / 2, fy - sized / 2, sized, sized);
    ctx.restore();
  }
};

module.exports = ItemFlyEffect;
