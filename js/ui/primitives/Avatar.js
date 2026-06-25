// 圆形头像 — 从 Image 对象裁剪为圆形

var UIComponent = require('../base/UIComponent.js');

/**
 * @param {Object} opts
 * @param {Object} [opts.image] - wx.createImage() 创建的 Image 对象
 * @param {number} [opts.diameter] - 直径（默认取 w）
 * @param {string} [opts.placeholderColor='#E5E7EB'] - 无图像时的占位色
 */
function Avatar(opts) {
  opts = opts || {};
  var size = opts.diameter || opts.w || 36;
  UIComponent.call(this, {
    x: opts.x || 0,
    y: opts.y || 0,
    w: size,
    h: size,
    zIndex: opts.zIndex || 0,
    visible: opts.visible !== false,
  });

  this.image = opts.image || null;
  this.placeholderColor = opts.placeholderColor || '#E5E7EB';
  this._loaded = false;

  if (this.image && this.image.complete) {
    this._loaded = true;
  }
}

Avatar.prototype = Object.create(UIComponent.prototype);
Avatar.prototype.constructor = Avatar;

Avatar.prototype.setImage = function (img) {
  this.image = img;
  this._loaded = img && img.complete;
};

/**
 * 覆盖默认 hitTest，使用圆形检测
 */
Avatar.prototype.hitTest = function (px, py) {
  if (!this.visible) return false;
  var cx = this.x + this.w / 2;
  var cy = this.y + this.h / 2;
  var r = this.w / 2;
  var dx = px - cx;
  var dy = py - cy;
  return dx * dx + dy * dy <= r * r;
};

Avatar.prototype.render = function (ctx) {
  var x = this.x, y = this.y, d = this.w;
  var cx = x + d / 2, cy = y + d / 2, r = d / 2;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  if (this.image && (this._loaded || this.image.complete)) {
    this._loaded = true;
    ctx.drawImage(this.image, x, y, d, d);
  } else {
    ctx.fillStyle = this.placeholderColor;
    ctx.fillRect(x, y, d, d);
  }

  ctx.restore();
};

module.exports = Avatar;
