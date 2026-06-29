// 金币显示组件 — 游戏内左上角金币余额
// PlayingEngine 专用

var UIComponent = require('../base/UIComponent.js');
var AssetPreloader = require('../AssetPreloader.js');
var Theme = require('../Theme.js');

// Figma 设计常量
var BG_X = 24;           // 底框 left
var BG_Y = 93;            // 底框 top
var BG_W = 78;            // 底框 width
var BG_H = 26;            // 底框 height
var BG_RADIUS = 12;       // 底框 border-radius

var COIN_X = 16;          // 金币图标 left
var COIN_Y = 90;          // 金币图标 top
var COIN_SIZE = 32;       // 金币图标宽高

var TEXT_X = 56;          // 金币数字 left
var TEXT_Y = 96;          // 金币数字 top（baseline）
var TEXT_SIZE = 16;       // 字体大小

function GoldWidget(opts) {
  UIComponent.call(this, {
    x: opts.x || 0,
    y: opts.y || 0,
    w: opts.w || COIN_X + COIN_SIZE + 16,
    h: opts.h || COIN_Y + COIN_SIZE,
    zIndex: opts.zIndex || 2,
  });

  this._gold = 0;

  // 呼吸动画（跟 CrownPigWidget 一致）
  this._breatheStart = 0;
  this._breatheActive = false;
  this._BREATHE_DURATION = 400;
  this._BREATHE_AMPLITUDE = 0.13;
}

GoldWidget.prototype = Object.create(UIComponent.prototype);
GoldWidget.prototype.constructor = GoldWidget;

GoldWidget.prototype.setData = function (gold) {
  if (typeof gold === 'number') {
    this._gold = Math.max(0, gold);
  }
};

/** 触发呼吸动画（单次缓慢呼吸，纯 UI 反馈，跟奖杯一致） */
GoldWidget.prototype.triggerBreathe = function () {
  this._breatheStart = Date.now();
  this._breatheActive = true;
};

/** 获取当前呼吸缩放值 */
GoldWidget.prototype._getBreatheScale = function () {
  if (!this._breatheActive) return 1;

  var elapsed = Date.now() - this._breatheStart;
  if (elapsed >= this._BREATHE_DURATION) {
    this._breatheActive = false;
    return 1;
  }

  var t = elapsed / this._BREATHE_DURATION;
  var pulse = Math.abs(Math.sin(t * Math.PI));
  return 1 + pulse * this._BREATHE_AMPLITUDE;
};

GoldWidget.prototype.render = function (ctx) {
  var baseX = this.x;
  var baseY = this.y;

  // === 底框（半透明深色圆角胶囊） ===
  var bgX = baseX + BG_X;
  var bgY = baseY + BG_Y;
  var bgW = BG_W;
  var bgH = BG_H;
  var r = BG_RADIUS;

  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.beginPath();
  ctx.moveTo(bgX + r, bgY);
  ctx.lineTo(bgX + bgW - r, bgY);
  ctx.arcTo(bgX + bgW, bgY, bgX + bgW, bgY + r, r);
  ctx.lineTo(bgX + bgW, bgY + bgH - r);
  ctx.arcTo(bgX + bgW, bgY + bgH, bgX + bgW - r, bgY + bgH, r);
  ctx.lineTo(bgX + r, bgY + bgH);
  ctx.arcTo(bgX, bgY + bgH, bgX, bgY + bgH - r, r);
  ctx.lineTo(bgX, bgY + r);
  ctx.arcTo(bgX, bgY, bgX + r, bgY, r);
  ctx.closePath();
  ctx.fill();

  // === 金币图标（drop-shadow + 呼吸缩放） ===
  if (AssetPreloader.isReady('coin')) {
    var coinX = baseX + COIN_X;
    var coinY = baseY + COIN_Y;
    var coinCX = coinX + COIN_SIZE / 2;
    var coinCY = coinY + COIN_SIZE / 2;

    var breathScale = this._getBreatheScale();

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    if (breathScale !== 1) {
      ctx.translate(coinCX, coinCY);
      ctx.scale(breathScale, breathScale);
      ctx.translate(-coinCX, -coinCY);
    }

    ctx.drawImage(AssetPreloader.get('coin'), coinX, coinY, COIN_SIZE, COIN_SIZE);
    ctx.restore();
  }

  // === 金币数字 ===
  var text = String(this._gold);
  ctx.font = TEXT_SIZE + 'px ' + Theme.font.family;
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(text, baseX + TEXT_X, baseY + TEXT_Y);
};

module.exports = GoldWidget;
