// 奖杯组件 — 显示奖杯图标（激活/未激活）+ 步数底框
// PlayingEngine 中使用，取代旧版小金猪图标 + 进度环

var UIComponent = require('../base/UIComponent.js');
var Theme = require('../Theme.js');
var { SCREEN_WIDTH } = require('../../render.js');

// 布局常量（相对屏幕右上角）
var TROPHY_SIZE = 44;
var TROPHY_TOP = 79;
var TROPHY_RIGHT = 20;
var STEP_BG_W = 60;
var STEP_BG_H = 24;
var STEP_BG_TOP = 120;
var STEP_BG_RIGHT = 11;
var STEP_BG_RADIUS = 12;

// 圆角矩形路径（兼容微信小游戏 canvas，不用 ctx.roundRect）
function roundRect(ctx, x, y, w, h, r) {
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
  this._hasUsedRemove = false;
  this._hidden = false;

  // 呼吸动画
  this._breatheStart = 0;
  this._breatheActive = false;
  this._BREATHE_DURATION = 800;
  this._BREATHE_AMPLITUDE = 0.10;

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

CrownPigWidget.prototype.setData = function (crownSteps, steps, gotCrown, hasUsedRemove) {
  this._crownSteps = crownSteps || 0;
  this._steps = steps || 0;
  this._gotCrown = !!gotCrown;
  this._hasUsedRemove = !!hasUsedRemove;
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

  // === 奖杯图标 ===
  // 激活条件：总步数尚未超过规定步数（steps <= crownSteps）
  // 超过后在下一帧变灰（steps > crownSteps）
  // 奖杯 drop-shadow: 0px 4px 4px rgba(0,0,0,0.25)
  ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 4;

  if (this._hasUsedRemove || this._steps > this._crownSteps) {
    // 未激活状态（使用过移除 或 步数已超）
    if (this._inactiveLoaded) {
      ctx.drawImage(this._imgInactive, trophyX, trophyY, TROPHY_SIZE, TROPHY_SIZE);
    }
  } else {
    // 激活状态
    if (this._activeLoaded) {
      ctx.drawImage(this._imgActive, trophyX, trophyY, TROPHY_SIZE, TROPHY_SIZE);
    }
  }

  // 清除阴影，避免影响后续渲染
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  // === 步数进度条 ===
  var remaining = this._hasUsedRemove ? 0 : (this._crownSteps - this._steps);
  if (remaining < 0) remaining = 0;
  var progressRatio = this._crownSteps > 0 ? remaining / this._crownSteps : 0;
  var fillW = Math.floor(STEP_BG_W * progressRatio);

  ctx.save();

  // === 底框（圆角 12px，仅边框无填充）===
  roundRect(ctx, bgX, bgY, STEP_BG_W, STEP_BG_H, STEP_BG_RADIUS);
  ctx.strokeStyle = '#733C29';
  ctx.lineWidth = 1;
  ctx.stroke();

  // === 前置填充条（右对齐，从左往右缩短，移动端圆角）===
  if (fillW > 0) {
    var fillX = bgX + STEP_BG_W - fillW;  // 右对齐，左端 ← 移动
    var fillRadius = Math.min(STEP_BG_RADIUS, Math.floor(fillW / 2));

    // clip 到整个底框的圆角区域（右端从 clip 获得圆角）
    roundRect(ctx, bgX, bgY, STEP_BG_W, STEP_BG_H, STEP_BG_RADIUS);
    ctx.clip();

    // 前置填充条底色（左端自带圆角）
    if (fillRadius > 0) {
      roundRect(ctx, fillX, bgY, fillW, STEP_BG_H, fillRadius);
      ctx.fillStyle = '#FF9D9D';
      ctx.fill();
    } else {
      ctx.fillStyle = '#FF9D9D';
      ctx.fillRect(fillX, bgY, fillW, STEP_BG_H);
    }

    // 顶部 inner shadow（暗部渐变）
    var topGrad = ctx.createLinearGradient(fillX, bgY, fillX, bgY + 6);
    topGrad.addColorStop(0, 'rgba(103, 0, 0, 0.30)');
    topGrad.addColorStop(1, 'rgba(103, 0, 0, 0)');
    ctx.fillStyle = topGrad;
    ctx.fillRect(fillX, bgY, fillW, 6);

    // 底部 inner highlight（亮部渐变）
    var btmGrad = ctx.createLinearGradient(fillX, bgY + STEP_BG_H - 4, fillX, bgY + STEP_BG_H);
    btmGrad.addColorStop(0, 'rgba(255, 255, 255, 0)');
    btmGrad.addColorStop(1, 'rgba(255, 255, 255, 0.25)');
    ctx.fillStyle = btmGrad;
    ctx.fillRect(fillX, bgY + STEP_BG_H - 4, fillW, 4);
  }

  ctx.restore();

  ctx.font = '12px ' + Theme.font.family;
  ctx.fillStyle = '#733C29';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // === 步数文字 ===
  var text = '';
  if (this._hasUsedRemove) {
    text = '移除无效';
  } else if (!this._gotCrown) {
    if (this._steps > this._crownSteps) {
      text = '步数已超';
    } else {
      var remaining = this._crownSteps - this._steps;
      text = '剩' + remaining + '步';
    }
  } else {
    text = '已获得';
  }
  ctx.fillText(text, bgX + STEP_BG_W / 2, bgY + STEP_BG_H / 2);

  ctx.restore(); // 呼吸动画 restore
};

module.exports = CrownPigWidget;
