// 奖杯组件 — 显示奖杯图标（激活/未激活）+ 步数底框
// PlayingEngine 中使用，取代旧版小金猪图标 + 进度环

var UIComponent = require('../base/UIComponent.js');
var Theme = require('../../define/GameDefine.js').THEME;
var { SCREEN_WIDTH } = require('../../render.js');

// 布局常量（相对屏幕右上角，Figma 规格）
var TROPHY_SIZE = 32;
var TROPHY_TOP = 90;
var TROPHY_RIGHT = 82;
var STEP_BG_W = 90;
var STEP_BG_H = 32;
var STEP_BG_TOP = 90;
var STEP_BG_RIGHT = 16;
var STEP_BG_RADIUS = 30;
var STEP_TEXT_RIGHT = 25;
var STEP_TEXT_TOP = 98;

// 圆角矩形路径（兼容微信小游戏 canvas，不用 ctx.roundRect）
function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, Math.floor(w / 2), Math.floor(h / 2));
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

// 奖杯图片路径
var IMG_ACTIVE = 'assets/images/levels/leftStep_1.png';
var IMG_INACTIVE = 'assets/images/levels/leftStep_2.png';
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

  // 步数奖励动画（纯视觉效果，不修改 _steps）
  this._bonusAnimActive = false;
  this._bonusAnimRemaining = 0;

  // 呼吸动画
  this._breatheStart = 0;
  this._breatheActive = false;
  this._BREATHE_DURATION = 400;
  this._BREATHE_AMPLITUDE = 0.26;

  // 奖杯图片
  this._imgActive = wx.createImage();
  this._imgActive.src = IMG_ACTIVE;
  this._activeLoaded = false;
  this._imgActive.onload = (function () { this._activeLoaded = true; }).bind(this);

  this._imgInactive = wx.createImage();
  this._imgInactive.src = IMG_INACTIVE;
  this._inactiveLoaded = false;
  this._imgInactive.onload = (function () { this._inactiveLoaded = true; }).bind(this);
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

/** 触发呼吸动画（单次缓慢呼吸，纯 UI 反馈） */
CrownPigWidget.prototype.triggerBreathe = function () {
  this._breatheStart = Date.now();
  this._breatheActive = true;
};

/** 获取当前呼吸缩放值 */
CrownPigWidget.prototype._getBreatheScale = function () {
  if (!this._breatheActive) return 1;

  var elapsed = Date.now() - this._breatheStart;
  if (elapsed >= this._BREATHE_DURATION) {
    this._breatheActive = false;
    return 1;
  }

  var t = elapsed / this._BREATHE_DURATION;
  var pulse = Math.abs(Math.sin(t * Math.PI));
  return 1 + pulse * this._BREATHE_AMPLITUDE;
};

/** 启动步数奖励动画（纯表现层，不修改 _steps 数据） */
CrownPigWidget.prototype.startStepBonusAnim = function (remaining) {
  this._bonusAnimActive = true;
  this._bonusAnimRemaining = remaining;
};

/** tick 递减步数奖励剩余值 */
CrownPigWidget.prototype.setStepBonusRemaining = function (remaining) {
  this._bonusAnimRemaining = remaining;
};

/** 结束步数奖励动画 */
CrownPigWidget.prototype.endStepBonusAnim = function () {
  this._bonusAnimActive = false;
  this._bonusAnimRemaining = 0;
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

  // 呼吸动画缩放（围绕整体区域中心）
  var breathScale = this._getBreatheScale();
  var minX = Math.min(trophyX, bgX);
  var maxX = Math.max(trophyX + TROPHY_SIZE, bgX + STEP_BG_W);
  var minY = trophyY;
  var maxY = bgY + STEP_BG_H;
  var cx = (minX + maxX) / 2;
  var cy = (minY + maxY) / 2;

  ctx.save();
  if (breathScale !== 1) {
    ctx.translate(cx, cy);
    ctx.scale(breathScale, breathScale);
    ctx.translate(-cx, -cy);
  }

  // === 步数底框 ===
  var remaining;
  if (this._bonusAnimActive) {
    remaining = this._bonusAnimRemaining;
  } else if (this._gotCrown) {
    remaining = 0;
  } else {
    remaining = this._crownSteps - this._steps;
    if (remaining < 0) remaining = 0;
  }

  // 底框（圆角 30px，半透黑底）— 先画底框再画奖杯，保证奖杯在上层
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  roundRect(ctx, bgX, bgY, STEP_BG_W, STEP_BG_H, STEP_BG_RADIUS);
  ctx.fill();

  // === 奖杯图标 ===
  ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 4;

  if (!this._gotCrown && this._steps > this._crownSteps) {
    if (this._inactiveLoaded) {
      ctx.drawImage(this._imgInactive, trophyX, trophyY, TROPHY_SIZE, TROPHY_SIZE);
    }
  } else {
    if (this._activeLoaded) {
      ctx.drawImage(this._imgActive, trophyX, trophyY, TROPHY_SIZE, TROPHY_SIZE);
    }
  }

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  // === 步数文字 ===
  var text;
  if (this._bonusAnimActive) {
    text = '剩' + this._bonusAnimRemaining + '步';
  } else if (!this._gotCrown) {
    text = '剩' + remaining + '步';
  } else {
    text = '已获得';
  }
  ctx.font = '16px ' + Theme.font.family;
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  var textX = SCREEN_WIDTH - STEP_TEXT_RIGHT;
  var textY = STEP_BG_TOP + STEP_BG_H / 2;
  ctx.fillText(text, textX, textY);

  ctx.restore(); // 呼吸动画 restore
};

module.exports = CrownPigWidget;
