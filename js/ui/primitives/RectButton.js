// 圆角矩形按钮 — 统一按钮控件
// 支持：渐变填充、彩色边框、按压缩放动画、禁用态

var UIComponent = require('../base/UIComponent.js');
var { PressAnim } = require('../base/Animation.js');
var Theme = require('../Theme.js');

/**
 * @param {Object} opts
 * @param {string} opts.label - 按钮文字
 * @param {string} [opts.fillColor='#F3EEFF'] - 渐变顶部颜色
 * @param {string} [opts.borderColor='#8B5CF6'] - 边框颜色
 * @param {number} [opts.radius=22] - 圆角
 * @param {number} [opts.fontSize=20] - 字号
 * @param {string} [opts.fontWeight='bold'] - 字重
 * @param {string} [opts.textColor] - 文字颜色（默认用 borderColor）
 * @param {Function} [opts.onClick] - 点击回调
 */
function RectButton(opts) {
  opts = opts || {};
  UIComponent.call(this, {
    x: opts.x || 0,
    y: opts.y || 0,
    w: opts.w || Theme.button.defaultW,
    h: opts.h || Theme.button.defaultH,
    zIndex: opts.zIndex || 0,
    visible: opts.visible !== false,
  });

  this.label = opts.label || '';
  this.fillColor = opts.fillColor || Theme.colors.primaryLight;
  this.borderColor = opts.borderColor || Theme.colors.primary;
  this.radius = opts.radius != null ? opts.radius : Theme.button.radius;
  this.fontSize = opts.fontSize || Theme.font.size.xl;
  this.fontWeight = opts.fontWeight || Theme.font.weight.bold;
  this.textColor = opts.textColor || this.borderColor;
  this.disabled = !!opts.disabled;

  /** @type {PressAnim} */
  this._pressAnim = new PressAnim();

  // 事件
  var self = this;
  this.onPressStart = function () {
    self._pressAnim.start();
  };
  this.onPressEnd = function () {
    self._pressAnim.release();
  };
  if (opts.onClick) this.onClick = opts.onClick;
}

RectButton.prototype = Object.create(UIComponent.prototype);
RectButton.prototype.constructor = RectButton;

RectButton.prototype.setDisabled = function (disabled) {
  this.disabled = !!disabled;
};

RectButton.prototype.setLabel = function (label) {
  this.label = label;
};

RectButton.prototype.update = function (dt) {
  // 按压动画由 PressAnim 自驱动（基于 Date.now），无需 dt
};

RectButton.prototype.render = function (ctx) {
  var scale = this._pressAnim.getScale();
  var x = this.x, y = this.y, w = this.w, h = this.h;
  var cx = x + w / 2, cy = y + h / 2;

  ctx.save();
  // 围绕中心缩放
  if (scale !== 1) {
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-cx, -cy);
  }

  // 阴影
  ctx.shadowColor = Theme.shadow.button.color;
  ctx.shadowBlur = Theme.shadow.button.blur;
  ctx.shadowOffsetX = Theme.shadow.button.offsetX;
  ctx.shadowOffsetY = Theme.shadow.button.offsetY;

  var r = Math.min(this.radius, w / 2, h / 2);

  if (this.disabled) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = Theme.button.borderWidth;
    ctx.strokeStyle = 'rgba(139,92,246,0.2)';
  } else {
    // 渐变填充
    var grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, this.fillColor);
    grad.addColorStop(1, Theme.colors.white);
    ctx.fillStyle = grad;
    ctx.lineWidth = Theme.button.borderWidth;
    ctx.strokeStyle = this.borderColor;
  }

  // 圆角矩形
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
  ctx.fill();
  ctx.stroke();

  // 文字
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = this.disabled ? Theme.colors.primaryMuted : this.textColor;
  ctx.font = this.fontWeight + ' ' + this.fontSize + 'px ' + Theme.font.family;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(this.label, cx, cy);

  ctx.restore();
};

module.exports = RectButton;
