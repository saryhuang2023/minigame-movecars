// CommonButton — 通用按钮（3 色复用）
// 构造：new CommonButton({ x, y, w, h, label, color, onClick, fontSize, iconKey, iconSize })
// color: 'gold' | 'red' | 'blue'

var Easing = require('../../core/Easing.js');
var audio = require('../../audio/AudioManager.js');
var AssetPreloader = require('../AssetPreloader.js');

// ===== 三种颜色预设 =====
var PRESETS = {
  gold: {
    gradTop: '#FFD640', gradBottom: '#FF8925',
    border: '#733C29',
    shadowTop: '#FFFF5A', shadowBottom: '#D96E00',
    textColor: '#FFFFFF',
  },
  red: {
    gradTop: '#FE9368', gradBottom: '#FD3919',
    border: '#733C29',
    shadowTop: '#FFCCB6', shadowBottom: '#D90000',
    textColor: '#FFFFFF',
  },
  blue: {
    gradTop: '#48EEFF', gradBottom: '#34AAD6',
    border: '#008590',
    shadowTop: '#76FDFF', shadowBottom: '#1A98BE',
    textColor: '#FFFFFF',
  },
};

var DEFAULT_W = 144;
var DEFAULT_H = 61;
var DEFAULT_FONT_SIZE = 22;
var BORDER_RADIUS = 14;
var BORDER_WIDTH = 2;
var PRESS_DURATION = 100;
var RELEASE_DURATION = 140;
var SHADOW_OFFSET = 4;

// ===== 圆角矩形 =====
function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ===== 构造函数 =====
function CommonButton(opts) {
  opts = opts || {};
  this.x = opts.x || 0;
  this.y = opts.y || 0;
  this.w = opts.w || DEFAULT_W;
  this.h = opts.h || DEFAULT_H;
  this.label = opts.label || '';
  this.color = PRESETS[opts.color] ? opts.color : 'gold';
  this.onClick = opts.onClick || null;
  this.fontSize = opts.fontSize || DEFAULT_FONT_SIZE;
  this.iconKey = opts.iconKey || null;
  this.iconSize = opts.iconSize || 33;
  this._pressState = null;  // { startTime, phase: 'pressing'|'releasing'|'breathe' }
}

// ===== 点击压感 =====
CommonButton.prototype._getPressScale = function () {
  var p = this._pressState;
  if (!p) return 1;
  var elapsed = Date.now() - p.startTime;
  if (p.phase === 'pressing') {
    var t = Math.min(elapsed / PRESS_DURATION, 1);
    return 1 - 0.06 * Easing.easeOutCubic(t);
  } else {
    var t2 = Math.min(elapsed / RELEASE_DURATION, 1);
    return 0.94 + 0.06 * Easing.easeOutBack(t2, 1.5);
  }
};

// ===== 碰撞检测 =====
CommonButton.prototype.hitTest = function (x, y) {
  return x >= this.x && x <= this.x + this.w && y >= this.y && y <= this.y + this.h;
};

// ===== 触控处理 =====
CommonButton.prototype.handleTouch = function (x, y, type) {
  if (!this.hitTest(x, y)) return false;
  if (type === 'touchstart') {
    this._pressState = { startTime: Date.now(), phase: 'pressing' };
    audio.play('button_click');
    if (this.onClick) this.onClick();
    return true;
  }
  if (type === 'touchend') {
    if (this._pressState) {
      this._pressState = { startTime: Date.now(), phase: 'releasing' };
    }
    return true;
  }
  return type === 'touchmove';
};

// ===== 渲染 =====
CommonButton.prototype.render = function (ctx) {
  var x = this.x, y = this.y, w = this.w, h = this.h;
  var cfg = PRESETS[this.color];
  var cx = x + w / 2, cy = y + h / 2;
  var pressScale = this._getPressScale();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(pressScale, pressScale);
  ctx.translate(-cx, -cy);

  // 1. 底色 + 渐变
  var grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, cfg.gradTop);
  grad.addColorStop(1, cfg.gradBottom);
  ctx.fillStyle = grad;
  _roundRect(ctx, x, y, w, h, BORDER_RADIUS);
  ctx.fill();

  // 2. 上内阴影（亮色）
  ctx.save();
  _roundRect(ctx, x, y, w, h, BORDER_RADIUS);
  ctx.clip();
  ctx.fillStyle = cfg.shadowTop;
  ctx.fillRect(x, y, w, SHADOW_OFFSET);
  ctx.restore();

  // 3. 下内阴影（暗色）
  ctx.save();
  _roundRect(ctx, x, y, w, h, BORDER_RADIUS);
  ctx.clip();
  ctx.fillStyle = cfg.shadowBottom;
  ctx.fillRect(x, y + h - SHADOW_OFFSET, w, SHADOW_OFFSET);
  ctx.restore();

  // 4. 边框描边
  ctx.strokeStyle = cfg.border;
  ctx.lineWidth = BORDER_WIDTH;
  _roundRect(ctx, x, y, w, h, BORDER_RADIUS);
  ctx.stroke();

  // 5. 图标（如果有）
  var iconShift = 0;
  if (this.iconKey && AssetPreloader.isReady(this.iconKey)) {
    var is = this.iconSize;
    var ix = x + 24, iy = y + (h - is) / 2;
    ctx.drawImage(AssetPreloader.get(this.iconKey), ix, iy, is, is);
    iconShift = 16;  // 文字右移
  }

  // 6. 文字
  ctx.fillStyle = cfg.textColor;
  ctx.font = this.fontSize + 'px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(this.label, cx + iconShift, cy);

  ctx.restore();
};

// ===== 工厂方法 =====
CommonButton.create = function (opts) {
  return new CommonButton(opts);
};

module.exports = CommonButton;
