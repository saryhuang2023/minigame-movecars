// 面板容器 — 带背景、阴影、内高光的通用卡片面板

var UIComponent = require('../base/UIComponent.js');
var Theme = require('../../define/GameDefine.js').THEME;

/**
 * @param {Object} opts
 * @param {number} [opts.radius=32] - 圆角
 * @param {Object} [opts.shadow] - 阴影配置 { color, blur, offsetX, offsetY }
 * @param {string|Object} [opts.fill] - 填充色或渐变配置
 *   - 字符串：纯色填充
 *   - 数组 [{ stop:0, color:'#FFF' }, ...]：线性渐变（从上到下）
 * @param {Object} [opts.border] - 边框 { color, width }
 * @param {Object} [opts.innerGlow] - 内高光 { color, width, inset }
 */
function Panel(opts) {
  opts = opts || {};
  UIComponent.call(this, {
    x: opts.x || 0,
    y: opts.y || 0,
    w: opts.w || 0,
    h: opts.h || 0,
    zIndex: opts.zIndex || 0,
    visible: opts.visible !== false,
  });

  this.radius = opts.radius != null ? opts.radius : Theme.radius.card;
  this.shadow = opts.shadow || Theme.shadow.card;
  this.fill = opts.fill || Theme.colors.white;
  this.border = opts.border || null;
  this.innerGlow = opts.innerGlow || null;
}

Panel.prototype = Object.create(UIComponent.prototype);
Panel.prototype.constructor = Panel;

Panel.prototype.render = function (ctx) {
  var x = this.x, y = this.y, w = this.w, h = this.h;
  var r = Math.min(this.radius, w / 2, h / 2);

  ctx.save();

  // 外阴影
  if (this.shadow) {
    ctx.shadowColor = this.shadow.color || Theme.shadow.card.color;
    ctx.shadowBlur = this.shadow.blur || Theme.shadow.card.blur;
    ctx.shadowOffsetX = this.shadow.offsetX || 0;
    ctx.shadowOffsetY = this.shadow.offsetY || 0;
  }

  // 填充
  if (Array.isArray(this.fill)) {
    var grad = ctx.createLinearGradient(x, y, x, y + h);
    for (var i = 0; i < this.fill.length; i++) {
      grad.addColorStop(this.fill[i].stop, this.fill[i].color);
    }
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = this.fill;
  }

  // 圆角路径
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

  // 清除阴影再描边框
  ctx.shadowColor = 'transparent';

  // 边框
  if (this.border) {
    ctx.strokeStyle = this.border.color;
    ctx.lineWidth = this.border.width || 1;
    ctx.stroke();
  }

  // 内高光
  if (this.innerGlow) {
    var ig = this.innerGlow;
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
    ctx.clip();

    ctx.strokeStyle = ig.color || 'rgba(255,255,255,0.8)';
    ctx.lineWidth = ig.width || 3;
    var inset = ig.inset || 2;
    // 在 clip 区域内画一个内缩的圆角矩形描边
    ctx.beginPath();
    var ir = Math.max(r - inset, 0);
    ctx.moveTo(x + inset + ir, y + inset);
    ctx.lineTo(x + w - inset - ir, y + inset);
    ctx.arcTo(x + w - inset, y + inset, x + w - inset, y + inset + ir, ir);
    ctx.lineTo(x + w - inset, y + h - inset - ir);
    ctx.arcTo(x + w - inset, y + h - inset, x + w - inset - ir, y + h - inset, ir);
    ctx.lineTo(x + inset + ir, y + h - inset);
    ctx.arcTo(x + inset, y + h - inset, x + inset, y + h - inset - ir, ir);
    ctx.lineTo(x + inset, y + inset + ir);
    ctx.arcTo(x + inset, y + inset, x + inset + ir, y + inset, ir);
    ctx.closePath();
    ctx.stroke();
  }

  ctx.restore();

  // 子组件渲染（renderTree 中会自动调，但 render 本身被 renderTree 包裹在 save/restore 里）
};

module.exports = Panel;
