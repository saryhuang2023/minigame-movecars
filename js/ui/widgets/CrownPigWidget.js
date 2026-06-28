// 奖杯组件 — 显示奖杯图标（激活/未激活）+ 步数底框
// PlayingEngine 中使用，取代旧版小金猪图标 + 进度环

var UIComponent = require('../base/UIComponent.js');
var Theme = require('../Theme.js');
var { SCREEN_WIDTH } = require('../../render.js');

// 布局常量（相对屏幕右上角）
var TROPHY_SIZE = 36;
var TROPHY_TOP = 84;
var TROPHY_RIGHT = 20;
var STEP_BG_W = 54;
var STEP_BG_H = 24;
var STEP_BG_TOP = 120;
var STEP_BG_RIGHT = 11;

// 奖杯图片路径
var IMG_ACTIVE = 'assets/sceen/0/leftStep_1.png';
var IMG_INACTIVE = 'assets/sceen/0/leftStep_2.png';
var IMG_STEP_BG = 'assets/sceen/0/leftStep_num.png';

function CrownPigWidget(opts) {
  UIComponent.call(this, {
    x: 0, y: 0,
    w: TROPHY_SIZE, h: TROPHY_SIZE,
    zIndex: opts.zIndex || 1,
    visible: true,
  });

  // 数据
  this._crownSteps = 0;
  this._steps = 0;
  this._gotCrown = false;
  this._hidden = false;

  // 奖杯图片
  this._imgActive = wx.createImage();
  this._imgActive.src = IMG_ACTIVE;
  this._activeLoaded = false;
  this._imgActive.onload = (function () { this._activeLoaded = true; }).bind(this);

  this._imgInactive = wx.createImage();
  this._imgInactive.src = IMG_INACTIVE;
  this._inactiveLoaded = false;
  this._imgInactive.onload = (function () { this._inactiveLoaded = true; }).bind(this);

  this._imgStepBg = wx.createImage();
  this._imgStepBg.src = IMG_STEP_BG;
  this._bgLoaded = false;
  this._imgStepBg.onload = (function () { this._bgLoaded = true; }).bind(this);
}

CrownPigWidget.prototype = Object.create(UIComponent.prototype);
CrownPigWidget.prototype.constructor = CrownPigWidget;

CrownPigWidget.prototype.setData = function (crownSteps, steps, gotCrown) {
  this._crownSteps = crownSteps || 0;
  this._steps = steps || 0;
  this._gotCrown = !!gotCrown;
};

CrownPigWidget.prototype.setAnimPhase = function () { /* 位置固定后不再需要动画阶段 */ };
CrownPigWidget.prototype.setCenter = function () { /* 位置固定后不再需要 setCenter */ };

CrownPigWidget.prototype.setHidden = function (hidden) {
  this._hidden = !!hidden;
};

CrownPigWidget.prototype.render = function (ctx) {
  if (this._hidden) return;

  var hasThreshold = this._crownSteps > 0;
  if (!hasThreshold) return;  // 没有配置阈值的话，则说明功能未开放，完全不绘制

  // 计算固定位置
  var trophyX = SCREEN_WIDTH - TROPHY_SIZE - TROPHY_RIGHT;
  var trophyY = TROPHY_TOP;
  var bgX = SCREEN_WIDTH - STEP_BG_W - STEP_BG_RIGHT;
  var bgY = STEP_BG_TOP;

  // === 奖杯图标 ===
  if (this._gotCrown) {
    // 激活状态（已获得奖杯）
    if (this._activeLoaded) {
      ctx.drawImage(this._imgActive, trophyX, trophyY, TROPHY_SIZE, TROPHY_SIZE);
    }
  } else {
    // 未激活状态
    if (this._inactiveLoaded) {
      ctx.drawImage(this._imgInactive, trophyX, trophyY, TROPHY_SIZE, TROPHY_SIZE);
    }
  }

  // 底框背景图
  if (this._bgLoaded) {
    ctx.drawImage(this._imgStepBg, bgX, bgY, STEP_BG_W, STEP_BG_H);
  }

  ctx.font = '12px ' + Theme.font.family;
  ctx.fillStyle = '#733C29';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // === 未获得，展示剩余步数===
  var text = '';
  if (!this._gotCrown) {
    var remaining = this._crownSteps - this._steps;
    if (remaining < 0) remaining = 0;

    // 文字："剩N步"
    text = '剩' + remaining + '步';
  }else{ // 已获得，展示已获得
    text = '已获得';
  }
  ctx.fillText(text, bgX + STEP_BG_W / 2, bgY + STEP_BG_H / 2);
};

module.exports = CrownPigWidget;
