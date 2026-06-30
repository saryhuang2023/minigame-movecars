// 关卡选择 — 单个关卡卡片组件
// 三态：locked（灰卡）、completed（白卡）、current（粉色描边白卡）

// 奖章图片路径
var IMG_ACTIVE = 'assets/images/levels/leftStep_1.png';
var IMG_INACTIVE = 'assets/images/levels/leftStep_2.png';
var MEDAL_SIZE = 16;

var Theme = require('../Theme.js');

// 卡片配色（与引擎内 C 常量同步）
var CARD = {
  primary: '#EC4899',
  secondary: '#FFFFFF',
  textDark: '#0F172A',
  textLocked: '#ADB5C4',
  cardDoneShadow: 'rgba(236, 72, 153, 0.10)',
  cardCurrentShadow: 'rgba(236, 72, 153, 0.25)',
  cardLockedBg: '#EFE8EE',
  cardLockedShadow: 'rgba(0, 0, 0, 0.04)',
  innerHighlight: 'rgba(255, 255, 255, 0.35)',
  innerHighlightCurrent: 'rgba(255, 255, 255, 0.4)',
};

function LevelCard(opts) {
  this._x = 0;
  this._y = 0;
  this._w = 50;
  this._h = 40;
  this._radius = 6;
  this._globalIndex = 0;
  this._status = 'locked'; // 'locked' | 'completed' | 'current'
  this._hasCrown = false;
  this._pressScale = 1;

  // 奖章图片
  this._imgActive = wx.createImage();
  this._imgActive.src = IMG_ACTIVE;
  this._activeLoaded = false;
  this._imgActive.onload = (function () { this._activeLoaded = true; }).bind(this);

  this._imgInactive = wx.createImage();
  this._imgInactive.src = IMG_INACTIVE;
  this._inactiveLoaded = false;
  this._imgInactive.onload = (function () { this._inactiveLoaded = true; }).bind(this);
}

/** 同步数据（引擎每帧调） */
LevelCard.prototype.setCardData = function (data) {
  this._x = data.x;
  this._y = data.y;
  this._w = data.w;
  this._h = data.h;
  this._radius = data.radius || 6;
  this._globalIndex = data.globalIndex;
  this._status = data.status;
  this._hasCrown = !!data.hasCrown;
  this._pressScale = data.pressScale || 1;
};

/** 渲染 */
LevelCard.prototype.render = function (ctx) {
  var x = this._x;
  var y = this._y;
  var w = this._w;
  var h = this._h;
  var r = this._radius;
  var cx = x + w / 2;
  var cy = y + h / 2;
  var labelNumber = String(this._globalIndex + 1);

  var cardScale = this._pressScale;
  ctx.save();
  if (cardScale !== 1) {
    ctx.translate(cx, cy);
    ctx.scale(cardScale, cardScale);
    ctx.translate(-cx, -cy);
  }

  if (this._status === 'locked') {
    _drawLocked(ctx, x, y, w, h, r, labelNumber);
    ctx.restore();
    return;
  }

  var isCurrent = this._status === 'current';
  _drawActive(ctx, x, y, w, h, r, labelNumber, isCurrent);

  // 右上角奖章
  var medalImg = this._hasCrown ? this._imgActive : this._imgInactive;
  var medalLoaded = this._hasCrown ? this._activeLoaded : this._inactiveLoaded;
  if (medalLoaded && medalImg) {
    ctx.drawImage(medalImg, x + w - MEDAL_SIZE - 2, y + 2, MEDAL_SIZE, MEDAL_SIZE);
  }

  ctx.restore();
};

// ========== 内部绘制 ==========

function _drawLocked(ctx, x, y, w, h, r, label) {
  // 浅阴影
  ctx.save();
  ctx.shadowColor = CARD.cardLockedShadow;
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 2;
  _roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = CARD.cardLockedBg;
  ctx.fill();
  ctx.restore();

  // 主体（无阴影重绘）
  _roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = CARD.cardLockedBg;
  ctx.fill();

  ctx.fillStyle = CARD.textLocked;
  ctx.font = 'bold 20px ' + Theme.font.family + '';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2);
}

function _drawActive(ctx, x, y, w, h, r, label, isCurrent) {
  // 外阴影
  ctx.save();
  ctx.shadowColor = isCurrent ? CARD.cardCurrentShadow : CARD.cardDoneShadow;
  ctx.shadowBlur = isCurrent ? 14 : 8;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = isCurrent ? 4 : 3;
  _roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = CARD.secondary;
  ctx.fill();
  ctx.restore();

  // 主体白色卡片
  _roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = CARD.secondary;
  ctx.fill();

  // 当前关卡：粉色描边
  if (isCurrent) {
    ctx.strokeStyle = CARD.primary;
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = 0.85;
    _roundRect(ctx, x, y, w, h, r);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // 内高光描边
  ctx.strokeStyle = isCurrent ? CARD.innerHighlightCurrent : CARD.innerHighlight;
  ctx.lineWidth = 1;
  _roundRect(ctx, x + 1, y + 1, w - 2, h - 2, r - 1);
  ctx.stroke();

  // 编号文字
  ctx.fillStyle = isCurrent ? CARD.primary : CARD.textDark;
  ctx.font = 'bold 20px ' + Theme.font.family + '';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2);
}

// 圆角矩形路径
function _roundRect(ctx, x, y, w, h, r) {
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

module.exports = LevelCard;
