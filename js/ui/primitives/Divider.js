// 分割线 — 水平或垂直

var UIComponent = require('../base/UIComponent.js');

/**
 * @param {Object} opts
 * @param {string} [opts.direction='horizontal'] - 'horizontal'|'vertical'
 * @param {string} [opts.color='rgba(0,0,0,0.08)']
 * @param {number} [opts.thickness=1]
 * @param {number[]} [opts.dash] - 虚线模式 [dashLen, gapLen]
 */
class Divider extends UIComponent {
  constructor(opts) {
  opts = opts || {};
  super({
    x: opts.x || 0,
    y: opts.y || 0,
    w: opts.w || 0,
    h: opts.h || 1,
    zIndex: opts.zIndex || 0,
    visible: opts.visible !== false,
  });

  this.direction = opts.direction || 'horizontal';
  this.color = opts.color || 'rgba(0,0,0,0.08)';
  this.thickness = opts.thickness || 1;
  this.dash = opts.dash || null;

}
}


Divider.prototype.render = function (ctx) {
  ctx.save();
  ctx.strokeStyle = this.color;
  ctx.lineWidth = this.thickness;

  if (this.dash) {
    ctx.setLineDash(this.dash);
  }

  ctx.beginPath();
  if (this.direction === 'vertical') {
    ctx.moveTo(this.x + this.w / 2, this.y);
    ctx.lineTo(this.x + this.w / 2, this.y + this.h);
  } else {
    ctx.moveTo(this.x, this.y + this.h / 2);
    ctx.lineTo(this.x + this.w, this.y + this.h / 2);
  }
  ctx.stroke();

  if (this.dash) {
    ctx.setLineDash([]);  // 重置
  }

  ctx.restore();
};

module.exports = Divider;
