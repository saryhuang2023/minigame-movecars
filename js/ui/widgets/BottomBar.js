// 底部栏 — 提示按钮 + 条件移除按钮
// PlayingEngine 专用

var UIComponent = require('../base/UIComponent.js');
var Theme = require('../Theme.js');
var { SCREEN_WIDTH, SCREEN_HEIGHT } = require('../../render.js');

var PADDING = Theme.layout.padding || 16;

/**
 * @param {Object} opts
 * @param {number} opts.cardW - 卡片宽度（对齐用）
 * @param {Object} opts.buttonPress - ButtonPress 实例
 * @param {Function} opts.onHintClick - 提示按钮回调
 * @param {Function} opts.onRemoveClick - 移除按钮回调
 */
function BottomBar(opts) {
  UIComponent.call(this, {
    x: 0,
    y: SCREEN_HEIGHT - Theme.layout.bottomBarH,
    w: SCREEN_WIDTH,
    h: Theme.layout.bottomBarH,
    zIndex: opts.zIndex || 2,
  });

  this._cardW = opts.cardW;
  this._buttonPress = opts.buttonPress;
  this._hintActive = false;

  // 按钮尺寸
  this._btnW = Theme.button.defaultW;   // 90
  this._btnH = Theme.button.defaultH;   // 68
  this._gap = 14;

  // 回调
  var self = this;
  this.onHintClick = opts.onHintClick || function () {};
  this.onRemoveClick = opts.onRemoveClick || function () {};

  // 曝光按钮的点击区域（供外部 hitTest 查询）
  this.hintBtnRect = null;
  this.removeBtnRect = null;
}

BottomBar.prototype = Object.create(UIComponent.prototype);
BottomBar.prototype.constructor = BottomBar;

BottomBar.prototype.setHintActive = function (active) {
  this._hintActive = !!active;
};

/**
 * 覆盖 hitTest，精确检测两个按钮
 */
BottomBar.prototype.hitTest = function (px, py) {
  if (!this.visible) return false;

  // 提示按钮
  if (this.hintBtnRect) {
    var h = this.hintBtnRect;
    if (px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h) {
      return true;
    }
  }

  // 移除按钮（仅提示激活时存在）
  if (this._hintActive && this.removeBtnRect) {
    var r = this.removeBtnRect;
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
      return true;
    }
  }

  return false;
};

/**
 * 判断具体点中了哪个按钮
 */
BottomBar.prototype.getHitType = function (px, py) {
  if (this.hintBtnRect) {
    var h = this.hintBtnRect;
    if (px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h) {
      return 'hint';
    }
  }
  if (this._hintActive && this.removeBtnRect) {
    var r = this.removeBtnRect;
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
      return 'remove';
    }
  }
  return null;
};

BottomBar.prototype.render = function (ctx) {
  var barY = this.y;
  var barW = this._cardW;
  var btnW = this._btnW, btnH = this._btnH;
  var gap = this._gap;
  var btnY = SCREEN_HEIGHT - 5 - btnH;  // 底部与关主面板对齐

  // === 提示按钮 ===
  var hintX = PADDING + barW - btnW;
  this.hintBtnRect = { x: hintX, y: btnY, w: btnW, h: btnH };

  var hintScale = this._buttonPress ? this._buttonPress.getScale('hint') : 1;
  var hintCX = hintX + btnW / 2, hintCY = btnY + btnH / 2;

  ctx.save();
  ctx.translate(hintCX, hintCY);
  ctx.scale(hintScale, hintScale);
  ctx.translate(-hintCX, -hintCY);

  var hintDisabled = this._hintActive;
  this._drawStyledBtn(ctx, hintX, btnY, btnW, btnH, Theme.colors.primaryLight, Theme.colors.primary, hintDisabled);
  ctx.fillStyle = hintDisabled ? Theme.colors.primaryMuted : Theme.colors.primary;
  ctx.font = 'bold ' + Theme.font.size.xl + 'px ' + Theme.font.family;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('\u2726 \u63D0\u793A', hintCX, hintCY);
  ctx.restore();

  // === 移除按钮（提示激活时出现）===
  if (this._hintActive) {
    var removeX = hintX - btnW - gap;
    this.removeBtnRect = { x: removeX, y: btnY, w: btnW, h: btnH };

    var rmvScale = this._buttonPress ? this._buttonPress.getScale('remove') : 1;
    var rmvCX = removeX + btnW / 2;

    ctx.save();
    ctx.translate(rmvCX, btnY + btnH / 2);
    ctx.scale(rmvScale, rmvScale);
    ctx.translate(-rmvCX, -(btnY + btnH / 2));

    this._drawStyledBtn(ctx, removeX, btnY, btnW, btnH, Theme.colors.dangerLight, Theme.colors.danger, false);
    ctx.fillStyle = Theme.colors.danger;
    ctx.font = 'bold ' + Theme.font.size.xl + 'px ' + Theme.font.family;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('\u2715 \u79FB\u9664', rmvCX, btnY + btnH / 2);
    ctx.restore();
  } else {
    this.removeBtnRect = null;
  }
};

/** 绘制渐变圆角按钮 */
BottomBar.prototype._drawStyledBtn = function (ctx, x, y, w, h, fillColor, borderColor, disabled) {
  ctx.save();
  ctx.shadowColor = Theme.shadow.button.color;
  ctx.shadowBlur = Theme.shadow.button.blur;
  ctx.shadowOffsetX = Theme.shadow.button.offsetX;
  ctx.shadowOffsetY = Theme.shadow.button.offsetY;

  var r = Theme.button.radius;
  if (disabled) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(139,92,246,0.2)';
  } else {
    var grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, fillColor);
    grad.addColorStop(1, Theme.colors.white);
    ctx.fillStyle = grad;
    ctx.lineWidth = Theme.button.borderWidth;
    ctx.strokeStyle = borderColor;
  }

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
  ctx.restore();
};

module.exports = BottomBar;
