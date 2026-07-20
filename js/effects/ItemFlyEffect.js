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

// 弹起段（星星飞入：先在树枝花朵处向上弹起，再飞仙）
var BOB_DURATION = 200;       // 弹起段时长 ms
var BOB_HEIGHT = 42;           // 弹起高度 px
var BOB_SPIN = 0.28;           // 弹起时最大自转弧度
var BOB_SCALE = 0.22;          // 弹起时额外放大比例

function ItemFlyEffect(imgKey, opts) {
  var o = opts || {};
  this._imgKey = imgKey || 'addstep_icon';
  this._iconSize = o.size || ICON_SIZE;
  // 飞行光晕配色：'green'（默认，+3 道具语义）/ 'gold'（星星飞入）
  this._glow = o.glow || 'green';
  this._glowStops = (this._glow === 'gold')
    ? ['rgba(255,235,150,0.9)', 'rgba(255,200,90,0.35)', 'rgba(255,170,50,0)']
    : ['rgba(180, 255, 160, 0.9)', 'rgba(120, 230, 120, 0.35)', 'rgba(80, 200, 80, 0)'];
  // 星星飞入：起点先弹起、弧线更高更飘（天外飞仙）
  this._bob = o.bob || false;
  this._arcScale = o.arc || 1;
  // noRotate：星星飞入时禁止任何旋转（自转/方向旋转会让星形变形）。仅保留弹起缩放+弧线。
  this._noRotate = o.noRotate || false;
  this._animations = [];  // { fromX, fromY, toX, toY, startTime, randX, randY }
}

/** 切换飞行图片 key（星星飞入在普通星/彩星间切换） */
ItemFlyEffect.prototype.setImgKey = function (key) {
  this._imgKey = key;
};

/** 飞行总时长 ms（弹起段 + 飞仙段；供调用方判断单颗飞抵时刻） */
ItemFlyEffect.prototype.getDuration = function () {
  return (this._bob ? BOB_DURATION : 0) + FLY_DURATION;
};

/** 触发一枚道具图标从 from → to 飞行（delay 可选：延迟起飞 ms） */
ItemFlyEffect.prototype.trigger = function (fromX, fromY, toX, toY, delay) {
  var anim = {
    fromX: fromX,
    fromY: fromY,
    toX: toX,
    toY: toY,
    startTime: Date.now() + (delay || 0),
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
  var dur = this.getDuration();
  for (var i = 0; i < this._animations.length; i++) {
    if (now - this._animations[i].startTime < dur) {
      surviving.push(this._animations[i]);
    } else {
      arrivedCount++;
    }
  }
  this._animations = surviving;
  return arrivedCount;
};

/** 计算某归一化进度（rawT 0~1）下的屏幕坐标（高弧贝塞尔；arcScale 抬升弧线） */
ItemFlyEffect.prototype._getPos = function (a, rawT) {
  // 天外飞仙：起飞快、落定飘 → easeOutCubic（快出慢收）
  var t = 1 - Math.pow(1 - rawT, 3);
  var cpX = a.fromX + (a.toX - a.fromX) * 0.5 + (a.randX || 0);
  var cpY = Math.min(a.fromY, a.toY) - ARC_HEIGHT * this._arcScale + (a.randY || 0);
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
    var total = this.getDuration();
    if (elapsed <= 0 || elapsed >= total) continue;

    var fx, fy, scale, alpha = 1, spin = 0, stretchAngle = 0, useStretch = false;
    var rawT;  // 飞仙段归一化进度（弹起段为 undefined）

    if (this._bob && elapsed < BOB_DURATION) {
      // ===== 弹起段：树枝花朵处原地向上弹跳 =====
      var pa = elapsed / BOB_DURATION;              // 0→1
      var bobWave = Math.sin(Math.PI * pa);          // 中段最高、两端归零
      fx = a.fromX + Math.sin(Math.PI * pa * 2) * 4; // 轻微左右晃
      fy = a.fromY - bobWave * BOB_HEIGHT;
      scale = 1 + BOB_SCALE * bobWave;               // 弹起时略放大
      alpha = 1;
      useStretch = false;
    } else {
      // ===== 飞仙段：高弧飞向目标 =====
      var flyElapsed = elapsed - (this._bob ? BOB_DURATION : 0);
      rawT = flyElapsed / FLY_DURATION;
      var p = this._getPos(a, rawT);
      fx = p.x; fy = p.y;

      // 缩放：起飞弹出 → 落定回 1.0（轻盈无缝接静态星）
      var popEnd = POP_DURATION_RATIO;
      if (rawT < popEnd) {
        scale = Easing.easeOutBack(rawT / popEnd, 1.3) * POP_PEAK_SCALE;
      } else {
        var e2 = (rawT - popEnd) / (1 - popEnd);
        scale = POP_PEAK_SCALE - (POP_PEAK_SCALE - 1.0) * (1 - Math.pow(1 - e2, 3)); // easeOutCubic 降到 1.0
      }
      alpha = rawT < 0.05 ? rawT / 0.05 : 1;
      // 速度拉伸方向（沿运动方向对齐，非自转；星/道具均不自转以免变形）
      var ahead = this._getPos(a, Math.min(rawT + STRETCH_SAMPLE_DT, 1));
      stretchAngle = Math.atan2(ahead.y - fy, ahead.x - fx);
      useStretch = true;
    }
    scale = Math.max(0.3, scale);
    var sized = this._iconSize * scale;

    // ---- 拖尾（仅飞仙段） ----
    if (useStretch) {
      ctx.save();
      for (var j = 0; j < TRAIL_COUNT; j++) {
        var trailMs = (j + 1) * TRAIL_SPACING_MS;
        var tElapsed = flyElapsed - trailMs;
        if (tElapsed <= 0) continue;
        var trRaw = Math.max(0, Math.min(tElapsed / FLY_DURATION, 0.98));
        var tp = this._getPos(a, trRaw);
        var trailAlpha = TRAIL_ALPHA * (1 - j / TRAIL_COUNT);
        var trailSize = sized * (0.6 - j * 0.05);
        ctx.globalAlpha = trailAlpha;
        ctx.drawImage(iconImg, tp.x - trailSize / 2, tp.y - trailSize / 2, trailSize, trailSize);
      }
      ctx.restore();
    }

    // ---- 光晕（两段都画） ----
    var glowPhase = (this._bob && elapsed < BOB_DURATION) ? (elapsed / BOB_DURATION) : rawT;
    var glowPulse = Math.sin((glowPhase || 0) * Math.PI);
    var glowR = sized * (0.9 + 0.4 * glowPulse);
    ctx.save();
    ctx.globalAlpha = 0.35 * alpha * (0.5 + 0.5 * glowPulse);
    var g = ctx.createRadialGradient(fx, fy, sized * 0.2, fx, fy, glowR);
    g.addColorStop(0, this._glowStops[0]);
    g.addColorStop(0.5, this._glowStops[1]);
    g.addColorStop(1, this._glowStops[2]);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(fx, fy, glowR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.globalAlpha = 1;

    // ---- 主图标 ----
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(fx, fy);
    if (this._noRotate) {
      // 星星飞入：绝不旋转/拉伸，保持星形不变形，仅用 sized 内的弹出缩放
      // (sized 已含 scale，无需额外 ctx.scale)
    } else {
      ctx.rotate((useStretch ? stretchAngle : 0) + spin);
      if (useStretch) {
        var vx = Math.cos(stretchAngle), vy = Math.sin(stretchAngle);
        // 速度拉伸幅度（飞仙略弱，偏飘逸）
        var stretch = Math.min(Math.sqrt(vx * vx + vy * vy) * 0 + 18 * (rawT < 0.15 ? rawT / 0.15 : 1) * STRETCH_GAIN * 30, STRETCH_MAX);
        ctx.scale(1 + stretch, 1 - stretch * STRETCH_SQUASH);
      }
    }
    ctx.drawImage(iconImg, -sized / 2, -sized / 2, sized, sized);
    ctx.restore();
    ctx.globalAlpha = 1;
  }
};

module.exports = ItemFlyEffect;
