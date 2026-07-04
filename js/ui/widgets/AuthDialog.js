// 关主授权对话框 — PlayingEngine 夺关主后弹出

var UIComponent = require('../base/UIComponent.js');
var Theme = require('../../define/GameDefine.js').THEME;
var { SCREEN_WIDTH, SCREEN_HEIGHT } = require('../../render.js');

/**
 * @param {Object} opts
 */
function AuthDialog(opts) {
  UIComponent.call(this, {
    x: 0, y: 0,
    w: SCREEN_WIDTH, h: SCREEN_HEIGHT,
    zIndex: opts.zIndex || 4,
    visible: false,
  });

  this._animator = null;

  // 跳过按钮区域（供引擎检测）
  this.skipBtnRect = null;
}

AuthDialog.prototype = Object.create(UIComponent.prototype);
AuthDialog.prototype.constructor = AuthDialog;

AuthDialog.prototype.setAnimator = function (animator) {
  this._animator = animator;
};

AuthDialog.prototype.render = function (ctx) {
  if (!this.visible || !this._animator) return;

  var state = this._animator.update();
  if (this._animator.isClosed()) return;

  var maskAlpha = state.maskAlpha;
  var scale = state.scale;
  var alpha = state.alpha;
  if (alpha < 0.01) return;

  // 遮罩
  ctx.fillStyle = 'rgba(0, 0, 0, ' + maskAlpha.toFixed(3) + ')';
  ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

  var pw = 260, ph = 200;
  var px = (SCREEN_WIDTH - pw) / 2;
  var py = (SCREEN_HEIGHT - ph) / 2 - 20;

  ctx.save();
  ctx.globalAlpha = alpha;

  var pCenterX = px + pw / 2;
  var pCenterY = py + ph / 2;
  ctx.translate(pCenterX, pCenterY);
  ctx.scale(scale, scale);
  ctx.translate(-pCenterX, -pCenterY);

  // 面板背景 + 金色边框
  var r = 16;
  ctx.fillStyle = 'rgba(26, 26, 46, 0.95)';
  ctx.beginPath();
  ctx.moveTo(px + r, py);
  ctx.lineTo(px + pw - r, py);
  ctx.arcTo(px + pw, py, px + pw, py + r, r);
  ctx.lineTo(px + pw, py + ph - r);
  ctx.arcTo(px + pw, py + ph, px + pw - r, py + ph, r);
  ctx.lineTo(px + r, py + ph);
  ctx.arcTo(px, py + ph, px, py + ph - r, r);
  ctx.lineTo(px, py + r);
  ctx.arcTo(px, py, px + r, py, r);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 215, 0, 0.5)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // 标题
  ctx.fillStyle = Theme.colors.gold;
  ctx.font = 'bold 22px ' + Theme.font.family;
  ctx.fillText('\uD83D\uDC51 恭喜你成为关主！', SCREEN_WIDTH / 2, py + 44);

  // 说明
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.font = '14px ' + Theme.font.family;
  ctx.fillText('授权后可显示你的头像和昵称', SCREEN_WIDTH / 2, py + 85);

  // 两个按钮
  var btnW = 100, btnH = 44, gap = 20;
  var totalBtnW = btnW * 2 + gap;
  var btnStartX = (SCREEN_WIDTH - totalBtnW) / 2;
  var btnY = py + 130;

  // 授权按钮（金色）
  ctx.fillStyle = Theme.colors.gold;
  var br = 10;
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
  ctx.fillStyle = '#1a1a2e';
  ctx.font = 'bold 15px ' + Theme.font.family;
  ctx.fillText('授权', btnStartX + btnW / 2, btnY + btnH / 2);

  // 跳过按钮
  var skipX = btnStartX + btnW + gap;
  this.skipBtnRect = { x: skipX, y: btnY, w: btnW, h: btnH };
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
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
  ctx.fillStyle = '#fff';
  ctx.font = '14px ' + Theme.font.family;
  ctx.fillText('跳过', skipX + btnW / 2, btnY + btnH / 2);

  ctx.restore();
};

module.exports = AuthDialog;
