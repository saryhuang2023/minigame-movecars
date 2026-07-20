// 推猪消除 — 圆形虹膜过场（Circle Iris Transition）
//
// 统一三路场景切换：
//   菜单 → 关卡（expand）
//   关卡 → 菜单（contract，扩张的镜像）
//   关卡 → 关卡（expand，重玩 / 下一关）
//
// 视觉模型（对称）：
//   expand   : 源帧满屏，目标底图在「由慢到快」张开的圆内显现（ease-in-cubic），硬边。
//   contract : 目标底图满屏，源帧在「由快到慢」收缩的圆内隐藏（ease-out-cubic），硬边。
//
// 图层：
//   layerA = 满屏底层（expand 时为 source；contract 时为 target）
//   layerB = 圆内显现层（expand 时为 target；contract 时为 source）
//
// layer 可为：<canvas> / <Image> / function(ctx) 三种之一。
// 使用全局 ctx（离屏画布，坐标与 1x 逻辑一致，drawImage 满屏填 SCREEN_WIDTH×SCREEN_HEIGHT）。

var Easing = require('../core/Easing.js');
var render = require('../render.js');
var SCREEN_WIDTH = render.SCREEN_WIDTH;
var SCREEN_HEIGHT = render.SCREEN_HEIGHT;

// 将一层内容绘制到 ctx（满屏）
function _drawLayer(ctx, layer) {
  if (!layer) return;
  if (typeof layer === 'function') {
    layer(ctx);
    return;
  }
  ctx.drawImage(layer, 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
}

function CircleTransition(opts) {
  this.direction = opts.direction; // 'expand' | 'contract'
  this.source = opts.source;       // 过场起点满屏内容（expand=被覆盖方；contract=缩圈内方）
  this.target = opts.target;       // 过场终点满屏内容（expand=圆内显现方；contract=满屏底图方）
  this.duration = opts.duration || 420;
  this.r0 = (opts.r0 != null) ? opts.r0 : 8; // 起手小圆点半径（逻辑 px）
  this.onComplete = opts.onComplete || null;
  this.active = false;
  this._startTime = 0;
  this._done = false;
}

CircleTransition.prototype.start = function (now) {
  this._startTime = now;
  this.active = true;
  this._done = false;
};

// 归一化进度 0..1
CircleTransition.prototype._rawT = function (now) {
  var t = (now - this._startTime) / this.duration;
  return t < 0 ? 0 : (t > 1 ? 1 : t);
};

// 每帧推进；到达终点触发 onComplete（仅一次）
CircleTransition.prototype.update = function (now) {
  if (!this.active) return;
  if (this._rawT(now) >= 1 && !this._done) {
    this._done = true;
    this.active = false;
    if (this.onComplete) this.onComplete();
  }
};

// 绘制当前帧到 ctx
CircleTransition.prototype.render = function (ctx, now) {
  if (!this.active) return;
  var t = this._rawT(now);
  var cx = SCREEN_WIDTH / 2;
  var cy = SCREEN_HEIGHT / 2;
  // 圆心到最远 corners 的距离 + 余量，确保扩张/收缩全程完整覆盖屏幕（取完整对角线，余量充足）
  var Rmax = Math.sqrt(SCREEN_WIDTH * SCREEN_WIDTH + SCREEN_HEIGHT * SCREEN_HEIGHT) + 10;
  var r;
  if (this.direction === 'expand') {
    var e = Easing.easeInCubic(t);          // 慢 → 快
    r = this.r0 + (Rmax - this.r0) * e;
  } else {
    var e2 = Easing.easeOutCubic(t);        // 快 → 慢（扩张镜像）
    r = Rmax - (Rmax - this.r0) * e2;
  }

  // 满屏底层
  var layerA = (this.direction === 'expand') ? this.source : this.target;
  // 圆内显现层
  var layerB = (this.direction === 'expand') ? this.target : this.source;

  _drawLayer(ctx, layerA);

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  _drawLayer(ctx, layerB);
  ctx.restore();
};

module.exports = CircleTransition;
