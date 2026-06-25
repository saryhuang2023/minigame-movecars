// 小金猪皇冠组件 — PlayingEngine 显示小金猪图标 + 进度环 + 剩余步数

var UIComponent = require('../base/UIComponent.js');
var Theme = require('../Theme.js');
var { drawPigIcon } = require('../../render/PigIconRenderer.js');

/**
 * @param {Object} opts
 */
function CrownPigWidget(opts) {
  UIComponent.call(this, {
    x: 0, y: 0,
    w: 44, h: 44,
    zIndex: opts.zIndex || 1,
    visible: true,
  });

  // 数据
  this._crownSteps = 0;
  this._steps = 0;
  this._gotCrown = false;
  this._hidden = false;

  // 动画阶段（引擎控制）
  this._animPhase = 'idle';  // 'idle' | 'flying' | 'flashing'
  this._animStart = 0;
  this._centerX = 0;
  this._centerY = 0;
}

CrownPigWidget.prototype = Object.create(UIComponent.prototype);
CrownPigWidget.prototype.constructor = CrownPigWidget;

CrownPigWidget.prototype.setData = function (crownSteps, steps, gotCrown) {
  this._crownSteps = crownSteps || 0;
  this._steps = steps || 0;
  this._gotCrown = !!gotCrown;
};

CrownPigWidget.prototype.setAnimPhase = function (phase) {
  this._animPhase = phase;
  this._animStart = Date.now();
};

CrownPigWidget.prototype.setCenter = function (cx, cy) {
  this._centerX = cx;
  this._centerY = cy;
};

CrownPigWidget.prototype.setHidden = function (hidden) {
  this._hidden = !!hidden;
};

CrownPigWidget.prototype.render = function (ctx) {
  if (this._hidden) return;

  var cx = this._centerX || this.x + this.w / 2;
  var cy = this._centerY || this.y + this.h / 2;
  var radius = 20;
  var lineW = 2;
  var hasThreshold = this._crownSteps > 0;

  // 飞行动画中：灰色猪留守原位
  if (this._animPhase === 'flying') {
    drawPigIcon(ctx, cx, cy, 21, false);
    return;
  }

  // 闪烁阶段：交替灰/金
  if (this._animPhase === 'flashing') {
    var flashElapsed = Date.now() - this._animStart;
    var flashAlpha = 0.6 + 0.4 * Math.sin(flashElapsed * 0.015);
    drawPigIcon(ctx, cx, cy, 21, true, flashAlpha);
    return;
  }

  // 已获得
  if (this._gotCrown) {
    drawPigIcon(ctx, cx, cy, 21, true);
    return;
  }

  // 无阈值
  if (!hasThreshold) {
    drawPigIcon(ctx, cx, cy, 21, false);
    return;
  }

  // 有阈值、未获得：进度环 + 灰色猪 + 剩余步数
  var remaining = this._crownSteps - this._steps;
  if (remaining < 0) remaining = 0;
  var progress = remaining / this._crownSteps;

  // 底色圆环
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = lineW;
  ctx.stroke();

  // 进度弧
  if (progress > 0) {
    var arcColor = progress > 0.33 ? '#F59E0B' : '#EF4444';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.strokeStyle = arcColor;
    ctx.lineWidth = lineW;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  // 小金猪图标
  drawPigIcon(ctx, cx, cy, 21, false);

  // 剩余步数（倒数）
  ctx.font = 'bold 12px ' + Theme.font.family;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = remaining <= 0 ? '#EF4444' : remaining <= 3 ? '#F59E0B' : Theme.colors.muted;
  ctx.fillText('剩' + remaining + '步', cx, cy + 28);

  // 阈值标签
  ctx.font = '9px ' + Theme.font.family;
  ctx.fillStyle = Theme.colors.muted;
  ctx.fillText('限' + this._crownSteps + '步', cx, cy - 28);
};

module.exports = CrownPigWidget;
