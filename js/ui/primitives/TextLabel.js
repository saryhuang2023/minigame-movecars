// 文本标签 — 单行或多行文本显示

var UIComponent = require('../base/UIComponent.js');
var Theme = require('../Theme.js');

/**
 * @param {Object} opts
 * @param {string} opts.text - 文本内容
 * @param {string} [opts.color='#0F172A'] - 文字颜色
 * @param {number} [opts.fontSize=14] - 字号
 * @param {string} [opts.fontWeight='normal'] - 字重
 * @param {string} [opts.align='left'] - 水平对齐 'left'|'center'|'right'
 * @param {string} [opts.baseline='top'] - 垂直基线 'top'|'middle'|'bottom'
 * @param {boolean} [opts.ellipsis=false] - 溢出省略
 */
function TextLabel(opts) {
  opts = opts || {};
  UIComponent.call(this, {
    x: opts.x || 0,
    y: opts.y || 0,
    w: opts.w || 0,
    h: opts.h || 0,
    zIndex: opts.zIndex || 0,
    visible: opts.visible !== false,
  });

  this.text = opts.text || '';
  this.color = opts.color || Theme.colors.dark;
  this.fontSize = opts.fontSize || Theme.font.size.md;
  this.fontWeight = opts.fontWeight || Theme.font.weight.normal;
  this.align = opts.align || 'left';
  this.baseline = opts.baseline || 'top';
  this.ellipsis = !!opts.ellipsis;
}

TextLabel.prototype = Object.create(UIComponent.prototype);
TextLabel.prototype.constructor = TextLabel;

TextLabel.prototype.setText = function (text) {
  this.text = text;
};

TextLabel.prototype.setColor = function (color) {
  this.color = color;
};

TextLabel.prototype.render = function (ctx) {
  var x = this.x, y = this.y, w = this.w;

  ctx.save();
  ctx.fillStyle = this.color;
  ctx.font = this.fontWeight + ' ' + this.fontSize + 'px ' + Theme.font.family;
  ctx.textAlign = this.align;
  ctx.textBaseline = this.baseline;

  var drawX = x;
  if (this.align === 'center') drawX = x + w / 2;
  if (this.align === 'right') drawX = x + w;

  var displayText = this.text;
  // 溢出省略
  if (this.ellipsis && w > 0) {
    while (ctx.measureText(displayText).width > w && displayText.length > 0) {
      displayText = displayText.slice(0, -1);
    }
    if (displayText.length < this.text.length) {
      displayText = displayText.slice(0, -1) + '…';
    }
  }

  ctx.fillText(displayText, drawX, y);
  ctx.restore();
};

module.exports = TextLabel;
