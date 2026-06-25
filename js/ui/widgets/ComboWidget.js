// 连击计数器 — 自管理 PopupAnimator，对外暴露 trigger/close/reset

var UIComponent = require('../base/UIComponent.js');
var Theme = require('../Theme.js');
var PopupAnimator = require('../PopupAnimator.js');

var COMBO_WINDOW_MS = 3000;
var COMBO_WIDGET_W = 120;
var COMBO_WIDGET_H = 30;
var COMBO_WIDGET_R = 20;

/**
 * @param {Object} opts
 * @param {number} [opts.boardCardY] - 棋盘卡片顶部 y（定位用）
 */
function ComboWidget(opts) {
  UIComponent.call(this, {
    x: 0, y: 0,
    w: COMBO_WIDGET_W, h: COMBO_WIDGET_H,
    zIndex: opts.zIndex || 1,
    visible: false,
  });

  this._boardCardY = opts.boardCardY || 0;
  this._count = 0;
  this._comboStartTime = 0;
  this._bumpStart = 0;
  this._closing = false;          // 关闭动画中标记（防止竞态）
  this._animator = PopupAnimator.createPopupAnimator();
}

ComboWidget.prototype = Object.create(UIComponent.prototype);
ComboWidget.prototype.constructor = ComboWidget;

// ========== 公开 API ==========

/** 连击触发：弹出/更新计数+弹跳 */
ComboWidget.prototype.trigger = function (count) {
  this._count = count;
  this._comboStartTime = Date.now();
  this._closing = false;  // 取消任何进行中的关闭（防止竞态）

  if (!this.visible) {
    this.visible = true;
    this._animator.open();
  } else {
    if (this._animator.getPhase() === 'closing') {
      this._animator.open();
    }
    this._bumpStart = Date.now();
  }
  this.markDirty();
};

/** 关闭动画（完成后隐藏并回调），返回前检查 _closing 防竞态 */
ComboWidget.prototype.close = function (callback) {
  var self = this;
  this._closing = true;
  this._animator.close(function () {
    if (self._closing) {
      self.visible = false;
    }
    if (callback) callback();
  });
};

/** 强制复位（不带动画回调） */
ComboWidget.prototype.reset = function () {
  this._count = 0;
  this._bumpStart = 0;
  this._closing = false;
  this.visible = false;
  if (this._animator.getPhase() !== 'closed') {
    this._animator.close(function () {});
  }
  this.markDirty();
};

/** 是否正在展示/动画中 */
ComboWidget.prototype.isActive = function () {
  return this.visible || this._animator.getPhase() !== 'closed';
};

ComboWidget.prototype.updatePosition = function (boardCardY) {
  this._boardCardY = boardCardY;
  this.y = boardCardY - COMBO_WIDGET_H;
};

// ========== 渲染 ==========

ComboWidget.prototype.render = function (ctx) {
  if (!this.visible || this._animator.getPhase() === 'closed') return;

  var now = Date.now();
  var anim = this._animator.update();
  var remaining = COMBO_WINDOW_MS - (now - this._comboStartTime);
  var progress = Math.max(0, Math.min(1, remaining / COMBO_WINDOW_MS));

  // 递增弹跳
  var bumpMult = 1;
  if (this._bumpStart > 0) {
    var bumpAge = now - this._bumpStart;
    if (bumpAge < 150) {
      var bt = bumpAge / 150;
      bumpMult = 1 + 0.08 * Math.pow(1 - Math.abs(bt * 2 - 1), 3);
    } else {
      this._bumpStart = 0;
    }
  }

  var useScale = anim.scale * bumpMult;
  var useAlpha = anim.alpha;

  // 进度条颜色
  var barColor;
  if (progress > 0.75) barColor = Theme.colors.combo_safe;
  else if (progress > 0.5) barColor = Theme.colors.combo_warn;
  else barColor = Theme.colors.combo_danger;

  var wx = 0;
  var wy = this._boardCardY - COMBO_WIDGET_H;
  var barWidth = COMBO_WIDGET_W * progress;

  ctx.save();
  ctx.globalAlpha = useAlpha;

  var centerX = wx + COMBO_WIDGET_W / 2;
  var centerY = wy + COMBO_WIDGET_H / 2;
  ctx.translate(centerX, centerY);
  ctx.scale(useScale, useScale);
  ctx.translate(-centerX, -centerY);

  // 1. 容器背景
  ctx.fillStyle = 'rgba(236, 72, 153, 0.05)';
  _roundRect(ctx, wx + 0.5, wy + 0.5, COMBO_WIDGET_W, COMBO_WIDGET_H, COMBO_WIDGET_R);
  ctx.fill();

  // 2. 暗色占位槽
  ctx.fillStyle = 'rgba(61, 61, 92, 0.12)';
  _roundRect(ctx, wx + 0.5, wy + 0.5, COMBO_WIDGET_W, COMBO_WIDGET_H, COMBO_WIDGET_R);
  ctx.fill();

  // 3. 进度条填充
  ctx.save();
  _roundRect(ctx, wx + 0.5, wy + 0.5, COMBO_WIDGET_W, COMBO_WIDGET_H, COMBO_WIDGET_R);
  ctx.clip();
  ctx.fillStyle = barColor;
  ctx.fillRect(wx, wy, barWidth, COMBO_WIDGET_H);
  ctx.restore();

  // 4. 文字
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 20px ' + Theme.font.family;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('连击 X', wx + 10, wy + COMBO_WIDGET_H / 2 + 2);

  var labelW = ctx.measureText('连击 X').width;
  ctx.fillStyle = Theme.colors.gold;
  ctx.font = 'bold 30px ' + Theme.font.family;
  ctx.fillText(String(this._count || 0), wx + 10 + labelW + 2, wy + COMBO_WIDGET_H / 2 + 2);

  ctx.restore();
};

function _roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
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

module.exports = ComboWidget;
