// 顶部栏 — 返回/齿轮按钮 + 关卡徽章
// PlayingEngine 专用

var UIComponent = require('../base/UIComponent.js');
var Theme = require('../Theme.js');
var commonIcons = require('../commonIcons.js');
var databus = require('../../databus.js');

// 颜色常量
var DARK = Theme.colors.dark;
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

  // === 左上角设置按钮 ===
  var backW = 49, backH = 47;
  var backX = PADDING;
  var backY = 26;  // 离屏幕顶部 26px

  var setScale = this._buttonPress ? this._buttonPress.getScale('settings') : 1;
  var setCX = backX + backW / 2;
  var setCY = backY + backH / 2;

  ctx.save();
  ctx.translate(setCX, setCY);
  ctx.scale(setScale, setScale);
  ctx.translate(-setCX, -setCY);

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
    // 正常模式：设置图标
    var iconSz = 44;
    ctx.drawImage(commonIcons.setting, setCX - iconSz / 2, setCY - iconSz / 2, iconSz, iconSz);
  }
  ctx.restore();

  // === 关卡标题（居中），试玩时隐藏 ===
  if (this.mode !== 'trial') {
    ctx.font = '32px ' + Theme.font.family;
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(this.levelText, barW / 2, 87);
  }
};

module.exports = TopBar;
