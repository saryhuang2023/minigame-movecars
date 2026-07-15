// 积分粒子飞行动画 — 通关后剩余步数转化为积分，绚丽粒子飞向小虫
// 复用 CoinFlyEffect 的「飞行 + 落地回调」模式，但 render 改为自绘粒子（无金币图）
//
// 设计（用户确认 2026-07-15）：
//  - 之前的「剩余步数→金币」逻辑删除，改为「剩余步数→积分粒子」
//  - 每枚粒子落地 → PlayingEngine 把分支进度积分 +1（小虫继续往前爬 / 溢出旋转）
//  - 飞行体：发光球体（彗星头）；落地：四角星火花爆开

var AssetPreloader = require('../ui/AssetPreloader.js');
var Easing = require('../core/Easing.js');

var FLY_DURATION = 700;     // 单粒子飞行时长 ms
var BURST_DURATION = 450;   // 落地火花持续 ms
var STAR_COLORS = ['#fff7b0', '#ffd24d', '#7fe6ff', '#b6ff8c'];

function rand(a, b) { return a + Math.random() * (b - a); }

function ScoreFlyEffect() {
  this._flights = [];   // { fromX, fromY, toX, toY, startTime }
  this._bursts = [];    // { x, y, startTime, particles:[...] }
}

/** 触发一枚积分粒子从 from→to 飞行（delay 毫秒后发射，用于错峰） */
ScoreFlyEffect.prototype.trigger = function (fromX, fromY, toX, toY, delay) {
  this._flights.push({
    fromX: fromX, fromY: fromY, toX: toX, toY: toY,
    startTime: Date.now() + (delay || 0),
  });
};

/** 是否有飞行中的粒子 */
ScoreFlyEffect.prototype.isActive = function () {
  return this._flights.length > 0;
};

/** 每帧推进，返回本帧落地的粒子数（驱动 PlayingEngine 积分 +1） */
ScoreFlyEffect.prototype.update = function () {
  var now = Date.now();
  var arrived = 0;
  var surviving = [];
  for (var i = 0; i < this._flights.length; i++) {
    var f = this._flights[i];
    if (now < f.startTime) { surviving.push(f); continue; }
    if (now - f.startTime >= FLY_DURATION) {
      arrived++;
      this._spawnBurst(f.toX, f.toY);
    } else {
      surviving.push(f);
    }
  }
  this._flights = surviving;

  // 清理过期火花
  var live = [];
  for (var b = 0; b < this._bursts.length; b++) {
    if (now - this._bursts[b].startTime < BURST_DURATION) live.push(this._bursts[b]);
  }
  this._bursts = live;
  return arrived;
};

ScoreFlyEffect.prototype._spawnBurst = function (x, y) {
  var parts = [];
  var count = 7;
  for (var i = 0; i < count; i++) {
    var ang = (Math.PI * 2 * i) / count + rand(-0.3, 0.3);
    var sp = rand(14, 30);
    parts.push({
      dx: Math.cos(ang) * sp,
      dy: Math.sin(ang) * sp,
      r: rand(2, 4),
      color: STAR_COLORS[i % STAR_COLORS.length],
    });
  }
  this._bursts.push({ x: x, y: y, startTime: Date.now(), particles: parts });
};

ScoreFlyEffect.prototype.render = function (ctx) {
  var now = Date.now();
  // 飞行中的粒子（发光球体 + 轻微抛物）
  for (var i = 0; i < this._flights.length; i++) {
    var f = this._flights[i];
    if (now < f.startTime) continue;
    var t = (now - f.startTime) / FLY_DURATION;
    if (t <= 0) continue;
    if (t > 1) t = 1;
    var e = Easing.easeInOutCubic(t);
    var x = f.fromX + (f.toX - f.fromX) * e;
    var y = f.fromY + (f.toY - f.fromY) * e - Math.sin(t * Math.PI) * 30;
    this._drawOrb(ctx, x, y, 7 + (1 - t) * 3);
  }
  // 落地火花
  for (var b = 0; b < this._bursts.length; b++) {
    var burst = this._bursts[b];
    var bt = (now - burst.startTime) / BURST_DURATION;
    if (bt <= 0 || bt >= 1) continue;
    var alpha = 1 - bt;
    for (var p = 0; p < burst.particles.length; p++) {
      var pt = burst.particles[p];
      var px = burst.x + pt.dx * bt;
      var py = burst.y + pt.dy * bt;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = pt.color;
      this._drawStar(ctx, px, py, pt.r * (1 - bt * 0.5));
      ctx.restore();
    }
  }
};

ScoreFlyEffect.prototype._drawOrb = function (ctx, x, y, r) {
  ctx.save();
  var g = ctx.createRadialGradient(x, y, 0, x, y, r * 2);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.4, 'rgba(255,230,120,0.9)');
  g.addColorStop(1, 'rgba(255,180,40,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r * 2, 0, Math.PI * 2);
  ctx.fill();
  // 亮核
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(x, y, r * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

ScoreFlyEffect.prototype._drawStar = function (ctx, x, y, r) {
  ctx.beginPath();
  for (var i = 0; i < 4; i++) {
    var a = (Math.PI / 2) * i;
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    ctx.lineTo(x + Math.cos(a + Math.PI / 4) * 0.4 * r, y + Math.sin(a + Math.PI / 4) * 0.4 * r);
  }
  ctx.closePath();
  ctx.fill();
};

module.exports = ScoreFlyEffect;
