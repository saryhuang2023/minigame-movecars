// 确认对话框 — EditorEngine 保存确认等
// 简易模态弹窗，不依赖 PopupAnimator

var UIComponent = require('../base/UIComponent.js');
var Theme = require('../Theme.js');
var { SCREEN_WIDTH, SCREEN_HEIGHT } = require('../../render.js');

/**
 * @param {Object} opts
 */
function ConfirmDialog(opts) {
  UIComponent.call(this, {
    x: 0, y: 0,
    w: SCREEN_WIDTH, h: SCREEN_HEIGHT,
    zIndex: opts.zIndex || 4,
    visible: false,
  });

  this._title = '';
  this._saveLabel = '保存';
  this._skipLabel = '跳过';

  this.saveBtnRect = null;
  this.skipBtnRect = null;

  this.onSave = opts.onSave || function () {};
  this.onSkip = opts.onSkip || function () {};
}

ConfirmDialog.prototype = Object.create(UIComponent.prototype);
ConfirmDialog.prototype.constructor = ConfirmDialog;

ConfirmDialog.prototype.show = function (title, saveLabel, skipLabel) {
  this._title = title || '';
  this._saveLabel = saveLabel || '保存';
  this._skipLabel = skipLabel || '跳过';
  this.visible = true;
};

ConfirmDialog.prototype.render = function (ctx) {
  if (!this.visible) return;

  // 半透明遮罩
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

  var dw = 280, dh = 160;
  var dx = (SCREEN_WIDTH - dw) / 2;
  var dy = (SCREEN_HEIGHT - dh) / 2;
  var r = 12;

  // 白色面板
  ctx.fillStyle = Theme.colors.white;
  ctx.beginPath();
  ctx.moveTo(dx + r, dy);
  ctx.lineTo(dx + dw - r, dy);
  ctx.arcTo(dx + dw, dy, dx + dw, dy + r, r);
  ctx.lineTo(dx + dw, dy + dh - r);
  ctx.arcTo(dx + dw, dy + dh, dx + dw - r, dy + dh, r);
  ctx.lineTo(dx + r, dy + dh);
  ctx.arcTo(dx, dy + dh, dx, dy + dh - r, r);
  ctx.lineTo(dx, dy + r);
  ctx.arcTo(dx, dy, dx + r, dy, r);
  ctx.closePath();
  ctx.fill();

  // 标题
  ctx.fillStyle = '#333';
  ctx.font = 'bold 16px ' + Theme.font.family;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(this._title, dx + dw / 2, dy + 40);

  // 按钮
  var btnW = 90, btnH = 38;
  var gap = 20;
  var totalW = btnW * 2 + gap;
  var btnStartX = dx + (dw - totalW) / 2;
  var btnY = dy + dh - 58;
  var br = 8;

  // 保存按钮
  ctx.fillStyle = '#8B5CF6';
  ctx.beginPath();
  ctx.moveTo(btnStartX + br, btnY);
  ctx.lineTo(btnStartX + btnW - br, btnY);
  ctx.arcTo(btnStartX + btnW, btnY, btnStartX + btnW, btnY + br, br);
  ctx.lineTo(btnStartX + btnW, btnY + btnH - br);
  ctx.arcTo(btnStartX + btnW, btnY + btnH, btnStartX + btnW - br, btnY + btnH, br);
  ctx.lineTo(btnStartX + br, btnY + btnH);
  ctx.arcTo(btnStartX, btnY + btnH, btnStartX, btnY + btnH - br, br);
  ctx.lineTo(btnStartX, btnY + br);
  ctx.arcTo(btnStartX, btnY, btnStartX + br, btnY, br);
  ctx.closePath();
  ctx.fill();
  this.saveBtnRect = { x: btnStartX, y: btnY, w: btnW, h: btnH };
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 14px ' + Theme.font.family;
  ctx.fillText(this._saveLabel, btnStartX + btnW / 2, btnY + btnH / 2);

  // 跳过按钮
  var skipX = btnStartX + btnW + gap;
  ctx.fillStyle = '#E5E7EB';
  ctx.beginPath();
  ctx.moveTo(skipX + br, btnY);
  ctx.lineTo(skipX + btnW - br, btnY);
  ctx.arcTo(skipX + btnW, btnY, skipX + btnW, btnY + br, br);
  ctx.lineTo(skipX + btnW, btnY + btnH - br);
  ctx.arcTo(skipX + btnW, btnY + btnH, skipX + btnW - br, btnY + btnH, br);
  ctx.lineTo(skipX + br, btnY + btnH);
  ctx.arcTo(skipX, btnY + btnH, skipX, btnY + btnH - br, br);
  ctx.lineTo(skipX, btnY + br);
  ctx.arcTo(skipX, btnY, skipX + br, btnY, br);
  ctx.closePath();
  ctx.fill();
  this.skipBtnRect = { x: skipX, y: btnY, w: btnW, h: btnH };
  ctx.fillStyle = '#333';
  ctx.fillText(this._skipLabel, skipX + btnW / 2, btnY + btnH / 2);
};

module.exports = ConfirmDialog;
