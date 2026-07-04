// 棋盘卡片 — PlayingEngine 白色背景卡片

var UIComponent = require('../base/UIComponent.js');
var Panel = require('../primitives/Panel.js');
var Theme = require('../../define/GameDefine.js').THEME;

/**
 * @param {Object} opts
 * @param {number} opts.x - 棋盘卡片左上角 x
 * @param {number} opts.y - 棋盘卡片左上角 y
 * @param {number} opts.w - 宽度
 * @param {number} opts.h - 高度
 */
function BoardCard(opts) {
  UIComponent.call(this, {
    x: opts.x, y: opts.y, w: opts.w, h: opts.h, zIndex: opts.zIndex || 0,
  });

  // 使用 Panel 作为内部渲染
  this._panel = new Panel({
    x: opts.x, y: opts.y, w: opts.w, h: opts.h,
    radius: Theme.radius.card,
    shadow: {
      color: 'rgba(161, 150, 181, 0.2)',
      blur: 24,
      offsetX: 12,
      offsetY: 12,
    },
    fill: Theme.colors.white,
    innerGlow: {
      color: 'rgba(255, 255, 255, 0.8)',
      width: 3,
      inset: 4,
    },
  });
}

BoardCard.prototype = Object.create(UIComponent.prototype);
BoardCard.prototype.constructor = BoardCard;

BoardCard.prototype.updatePosition = function (x, y, w, h) {
  this.setBounds(x, y, w, h);
  this._panel.setBounds(x, y, w, h);
};

BoardCard.prototype.render = function (ctx) {
  this._panel.render(ctx);
};

module.exports = BoardCard;
