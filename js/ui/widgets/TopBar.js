// 顶部栏 — 返回/齿轮按钮 + 关卡徽章
// PlayingEngine 专用

var UIComponent = require('../base/UIComponent.js');
var Theme = require('../Theme.js');
var settingsPanel = require('../SettingsPanel.js');
var databus = require('../../databus.js');

// 颜色常量
var DARK = Theme.colors.dark;
var PINK = Theme.colors.pink;
var PADDING = Theme.layout.padding || 16;

/**
 * @param {Object} opts
 * @param {string} opts.levelText - 关卡文字（如 "第 1 关"）
 * @param {string} opts.mode - 'normal' | 'trial'（试玩模式）
 * @param {Object} opts.buttonPress - ButtonPress 实例（用于按压缩放）
 * @param {Function} opts.onBack - 返回按钮点击回调
 */
function TopBar(opts) {
  UIComponent.call(this, {
    x: opts.x || 0,
    y: opts.y || 0,
    w: opts.w || 375,
    h: opts.h || Theme.layout.topBarH,
    zIndex: opts.zIndex || 2,
  });

  this.levelText = opts.levelText || '';
  this.mode = opts.mode || 'normal';
  this._buttonPress = opts.buttonPress;
  this.onBack = opts.onBack || null;
}

TopBar.prototype = Object.create(UIComponent.prototype);
TopBar.prototype.constructor = TopBar;

TopBar.prototype.setLevelText = function (text) {
  this.levelText = text;
};

TopBar.prototype.setMode = function (mode) {
  this.mode = mode;
};

TopBar.prototype.render = function (ctx) {
  var barY = this.y;
  var barW = this.w;

  // === 左上角按钮 ===
  var backW = 49, backH = 47;
  var backX = PADDING;
  var backY = PADDING;

  var setScale = this._buttonPress ? this._buttonPress.getScale('settings') : 1;
  var setCX = backX + backW / 2;
  var setCY = backY + backH / 2;

  ctx.save();
  ctx.translate(setCX, setCY);
  ctx.scale(setScale, setScale);
  ctx.translate(-setCX, -setCY);

  // 白色半透明底 + 圆角
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  var r = 18;
  ctx.beginPath();
  ctx.moveTo(backX + r, backY);
  ctx.lineTo(backX + backW - r, backY);
  ctx.arcTo(backX + backW, backY, backX + backW, backY + r, r);
  ctx.lineTo(backX + backW, backY + backH - r);
  ctx.arcTo(backX + backW, backY + backH, backX + backW - r, backY + backH, r);
  ctx.lineTo(backX + r, backY + backH);
  ctx.arcTo(backX, backY + backH, backX, backY + backH - r, r);
  ctx.lineTo(backX, backY + r);
  ctx.arcTo(backX, backY, backX + r, backY, r);
  ctx.closePath();
  ctx.fill();

  if (this.mode === 'trial') {
    // 试玩模式：返回箭头
    ctx.strokeStyle = DARK;
    ctx.lineWidth = 2.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(setCX + 8, setCY - 10);
    ctx.lineTo(setCX - 5, setCY);
    ctx.lineTo(setCX + 8, setCY + 10);
    ctx.stroke();
  } else {
    // 正常模式：齿轮图标
    settingsPanel.drawGearIcon(ctx, setCX, setCY, 17, DARK);
  }
  ctx.restore();

  // === 关卡徽章（居中），试玩时隐藏 ===
  if (this.mode !== 'trial') {
    ctx.font = 'bold ' + Theme.font.size.xl + 'px ' + Theme.font.family;
    var levelTW = ctx.measureText(this.levelText).width;
    var levelW = levelTW + 16;
    var levelH = 33;
    var levelX = PADDING + (barW - levelW) / 2;
    var levelY = barY + (Theme.layout.topBarH - levelH) / 2;

    ctx.fillStyle = PINK;
    var lr = 12;
    ctx.beginPath();
    ctx.moveTo(levelX + lr, levelY);
    ctx.lineTo(levelX + levelW - lr, levelY);
    ctx.arcTo(levelX + levelW, levelY, levelX + levelW, levelY + lr, lr);
    ctx.lineTo(levelX + levelW, levelY + levelH - lr);
    ctx.arcTo(levelX + levelW, levelY + levelH, levelX + levelW - lr, levelY + levelH, lr);
    ctx.lineTo(levelX + lr, levelY + levelH);
    ctx.arcTo(levelX, levelY + levelH, levelX, levelY + levelH - lr, lr);
    ctx.lineTo(levelX, levelY + lr);
    ctx.arcTo(levelX, levelY, levelX + lr, levelY, lr);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = Theme.colors.white;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.levelText, levelX + levelW / 2, levelY + levelH / 2);
  }
};

module.exports = TopBar;
