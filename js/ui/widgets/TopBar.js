// 顶部栏 — 返回/齿轮按钮 + 关卡徽章
// PlayingEngine 专用

var UIComponent = require('../base/UIComponent.js');
var Theme = require('../../define/GameDefine.js').THEME;
var { drawSettingsButton } = require('../drawSettingsButton.js');
var databus = require('../../databus.js');
var { SCREEN_WIDTH } = require('../../render.js');

// 颜色常量
var DARK = Theme.colors.dark;
var PADDING = Theme.layout.padding || 16;

/**
 * @param {Object} opts
 * @param {string} opts.levelText - 关卡文字（如 "2关"）
 * @param {string} opts.mode - 'normal'（试玩与正式一致显示齿轮+关卡徽章）
 * @param {Object} opts.buttonPress - ButtonPress 实例（用于按压缩放）
 * @param {Function} opts.onBack - 返回按钮点击回调
 */
class TopBar extends UIComponent {
  constructor(opts) {
  super({
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
}


TopBar.prototype.setLevelText = function (text) {
  this.levelText = text;
};

TopBar.prototype.setMode = function (mode) {
  this.mode = mode;
};

TopBar.prototype.render = function (ctx) {
  var barW = this.w;

  // === 左上角设置按钮（Figma: left 15 / top 43 / 32×32）===
  var backW = 32, backH = 32;
  var backX = 15;
  var backY = 43;

  var setScale = this._buttonPress ? this._buttonPress.getScale('settings') : 1;
  var setCX = backX + backW / 2;
  var setCY = backY + backH / 2;

  ctx.save();
  ctx.translate(setCX, setCY);
  ctx.scale(setScale, setScale);
  ctx.translate(-setCX, -setCY);

  // 设置按钮（圆形底 + 矢量齿轮，纯代码绘制）— 试玩与正式一致，无 trial 专属返回箭头
  var iconSz = 32;
  drawSettingsButton(ctx, setCX - iconSz / 2, setCY - iconSz / 2, iconSz);
  ctx.restore();

  // === 关卡徽章（左上角，Figma: left 15 / top 23 / 32×16 / 大宝桃桃体 16px / letter-spacing 4px / 白字，无边框）===
  // 试玩与正式一致显示关卡徽章
  {
    var badgeX = 15;
    var badgeY = 23;
    var badgeW = 32;
    var badgeH = 16;

    var chars = this.levelText.split('');
    var fontSize = 16;
    var letterSpacing = 4;
    ctx.font = '400 ' + fontSize + 'px ' + Theme.font.family;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';

    // 计算总文本宽度（逐字测量 + 字间距）
    var totalTextW = 0;
    var charWidths = [];
    for (var i = 0; i < chars.length; i++) {
      var w = ctx.measureText(chars[i]).width;
      charWidths.push(w);
      totalTextW += w + (i < chars.length - 1 ? letterSpacing : 0);
    }

    var baseCursorX = badgeX + (badgeW - totalTextW) / 2;
    var textCY = badgeY + badgeH / 2;

    ctx.save();

    // 文字：白色（按 Figma，无描边无边框）
    ctx.fillStyle = '#FFFFFF';
    var cursorX = baseCursorX;
    for (var i = 0; i < chars.length; i++) {
      ctx.fillText(chars[i], cursorX, textCY);
      cursorX += charWidths[i] + letterSpacing;
    }

    ctx.restore();
  }
};

module.exports = TopBar;
