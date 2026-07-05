// 顶部栏 — 返回/齿轮按钮 + 关卡徽章
// PlayingEngine 专用

var UIComponent = require('../base/UIComponent.js');
var Theme = require('../../define/GameDefine.js').THEME;
var commonIcons = require('../commonIcons.js');
var databus = require('../../databus.js');
var { SCREEN_WIDTH } = require('../../render.js');

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

  // 徽章呼吸动画
  this._breatheStart = 0;
  this._breatheActive = false;
  this._BREATHE_DURATION = 400;
  this._BREATHE_AMPLITUDE = 0.13;
}

TopBar.prototype = Object.create(UIComponent.prototype);
TopBar.prototype.constructor = TopBar;

TopBar.prototype.setLevelText = function (text) {
  this.levelText = text;
};

TopBar.prototype.setMode = function (mode) {
  this.mode = mode;
};

/** 触发徽章呼吸动画 */
TopBar.prototype.triggerBreathe = function () {
  this._breatheStart = Date.now();
  this._breatheActive = true;
};

/** 获取当前呼吸缩放值 */
TopBar.prototype._getBreatheScale = function () {
  if (!this._breatheActive) return 1;
  var elapsed = Date.now() - this._breatheStart;
  if (elapsed >= this._BREATHE_DURATION) {
    this._breatheActive = false;
    return 1;
  }
  var t = elapsed / this._BREATHE_DURATION;
  return 1 + Math.abs(Math.sin(t * Math.PI)) * this._BREATHE_AMPLITUDE;
};

TopBar.prototype.render = function (ctx) {
  var barY = this.y;
  var barW = this.w;

  // === 左上角设置按钮 ===
  var backW = 49, backH = 47;
  var backX = PADDING;
  var backY = PADDING;  // 离屏幕顶部 26px

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

  // === 关卡徽章（Figma：每字描边 + letter-spacing 4px，居中 + 呼吸缩放） ===
  if (this.mode !== 'trial') {
    var badgeW = 80;
    var badgeX = (SCREEN_WIDTH - badgeW) / 2;
    var badgeY = backY;
    var badgeH = 24;
    var badgeCX = badgeX + badgeW / 2;
    var badgeCY = badgeY + badgeH / 2;

    var breathScale = this._getBreatheScale();

    var chars = this.levelText.split('');
    var fontSize = 24;
    var letterSpacing = 4;
    ctx.font = '400 ' + fontSize + 'px ' + Theme.font.family;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 1;
    ctx.lineJoin = 'round';

    // 计算总文本宽度（逐字测量）
    var totalTextW = 0;
    var charWidths = [];
    for (var i = 0; i < chars.length; i++) {
      var w = ctx.measureText(chars[i]).width;
      charWidths.push(w);
      totalTextW += w + (i < chars.length - 1 ? letterSpacing : 0);
    }

    // 水平居中
    var baseCursorX = badgeX + (badgeW - totalTextW) / 2;

    ctx.save();
    if (breathScale !== 1) {
      ctx.translate(badgeCX, badgeCY);
      ctx.scale(breathScale, breathScale);
      ctx.translate(-badgeCX, -badgeCY);
    }

    var cursorX = baseCursorX;
    for (var i = 0; i < chars.length; i++) {
      // 先画描边（黑色 1px），再画填充（白色），实现每字描边
      ctx.strokeStyle = '#000000';
      ctx.strokeText(chars[i], cursorX, badgeY);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(chars[i], cursorX, badgeY);
      cursorX += charWidths[i] + letterSpacing;
    }

    ctx.restore();
  }
};

module.exports = TopBar;
