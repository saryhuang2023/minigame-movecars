// 底部栏 — 提示按钮 + 条件移除按钮
// PlayingEngine 专用
// v125: 提示按钮底框改为 Canvas 2D 绘制（3层叠加：白色外框 → 渐变填充+棕色边框 → 内高光），不再加载背景图

var UIComponent = require('../base/UIComponent.js');
var Theme = require('../Theme.js');
var AssetPreloader = require('../AssetPreloader.js');
var { SCREEN_WIDTH, SCREEN_HEIGHT } = require('../../render.js');
var { roundRect } = require('../../render/PigRenderer.js');

var AD_ICON = 'assets/images/levels/ad_icon.png';

// 提示按钮尺寸（白色外框 146×63）
var HINT_W = 146;
var HINT_H = 63;
var AD_ICON_W = 33;
var AD_ICON_H = 33;

// 按钮底框通用绘制 — 白色外框 + 渐变 + 棕色边框 + 内高光/阴影
function _drawBtnBg(ctx, x, y, gradTop, gradBot, insetTop, insetBot) {
  ctx.save();  // 隔离底框绘制，不污染调用方的 fillStyle/strokeStyle/lineWidth

  // === 第3层：白色外框 146×63, border-radius 15 ===
  roundRect(ctx, x, y, 146, 63, 15);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();

  // === 第1层（棕色边框）+ 第2层（渐变填充）===
  var ix = x + 3, iy = y + 3, iw = 140, ih = 57;

  var grad = ctx.createLinearGradient(ix, iy, ix, iy + ih);
  grad.addColorStop(0, gradTop);
  grad.addColorStop(1, gradBot);

  roundRect(ctx, ix, iy, iw, ih, 14);
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.strokeStyle = '#733C29';
  ctx.lineWidth = 2;
  ctx.stroke();

  // === 内阴影高光 ===
  roundRect(ctx, ix + 1, iy + 1, iw - 2, ih - 2, 13);
  ctx.clip();

  var tGrad = ctx.createLinearGradient(ix, iy, ix, iy + 4);
  tGrad.addColorStop(0, insetTop);
  tGrad.addColorStop(1, 'rgba(255,255,90,0)');
  ctx.fillStyle = tGrad;
  ctx.fillRect(ix + 1, iy + 2, iw - 2, 4);

  var bGrad = ctx.createLinearGradient(ix, iy + ih - 4, ix, iy + ih);
  bGrad.addColorStop(0, 'rgba(217,110,0,0)');
  bGrad.addColorStop(1, insetBot);
  ctx.fillStyle = bGrad;
  ctx.fillRect(ix + 1, iy + ih - 4, iw - 2, 4);

  ctx.restore();
}

// 提示按钮：黄→橙，高光黄，阴影深橙
function _drawHintBg(ctx, x, y) {
  _drawBtnBg(ctx, x, y, '#FFD640', '#FF8925', '#FFFF5A', '#D96E00');
}

// 移除按钮：粉→红，高光肉粉，阴影深红
function _drawEraseBg(ctx, x, y) {
  _drawBtnBg(ctx, x, y, '#FE9368', '#FD3919', '#FFCCB6', '#D90000');
}

/**
 * @param {Object} opts
 * @param {number} opts.cardW - 卡片宽度（对齐用）
 * @param {Object} opts.buttonPress - ButtonPress 实例
 * @param {Function} opts.onHintClick - 提示按钮回调
 * @param {Function} opts.onRemoveClick - 移除按钮回调
 */
function BottomBar(opts) {
  UIComponent.call(this, {
    x: 0,
    y: SCREEN_HEIGHT - Theme.layout.bottomBarH,
    w: SCREEN_WIDTH,
    h: Theme.layout.bottomBarH,
    zIndex: opts.zIndex || 2,
  });

  this._cardW = opts.cardW;
  this._buttonPress = opts.buttonPress;
  this._hintActive = false;
  this._currentSteps = 0;

  // 回调
  this.onHintClick = opts.onHintClick || function () {};
  this.onRemoveClick = opts.onRemoveClick || function () {};

  // 按钮点击区域（供外部 hitTest 查询）
  this.hintBtnRect = null;
  this.removeBtnRect = null;
}

BottomBar.prototype = Object.create(UIComponent.prototype);
BottomBar.prototype.constructor = BottomBar;

BottomBar.prototype.setHintActive = function (active) {
  this._hintActive = !!active;
};

BottomBar.prototype.setCurrentSteps = function (steps) {
  this._currentSteps = steps;
};

/**
 * 覆盖 hitTest，精确检测两个按钮
 */
BottomBar.prototype.hitTest = function (px, py) {
  if (!this.visible) return false;

  // 提示按钮
  if (this.hintBtnRect) {
    var h = this.hintBtnRect;
    if (px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h) {
      return true;
    }
  }

  // 移除按钮（仅提示激活时存在）
  if (this._hintActive && this.removeBtnRect) {
    var r = this.removeBtnRect;
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
      return true;
    }
  }

  return false;
};

/**
 * 判断具体点中了哪个按钮
 */
BottomBar.prototype.getHitType = function (px, py) {
  if (this.hintBtnRect) {
    var h = this.hintBtnRect;
    if (px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h) {
      return 'hint';
    }
  }
  if (this._hintActive && this.removeBtnRect) {
    var r = this.removeBtnRect;
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
      return 'remove';
    }
  }
  return null;
};

/**
 * 绘制带字间距和描边的文本
 */
function _drawLabel(ctx, text, x, y, spacing) {
  for (var i = 0; i < text.length; i++) {
    ctx.fillText(text[i], x, y);
    ctx.strokeText(text[i], x, y);
    x += ctx.measureText(text[i]).width + spacing;
  }
}

BottomBar.prototype.render = function (ctx) {
  // ===== 提示/移除按钮（同位置互斥）=====
  var hintX = SCREEN_WIDTH - 15 - HINT_W;
  var hintY = SCREEN_HEIGHT - 30 - HINT_H;

  var witchBtn = this._hintActive ? 'remove' : 'hint';
  var btnScale = this._buttonPress ? this._buttonPress.getScale(witchBtn) : 1;
  this.hintBtnRect = this.removeBtnRect = { x: hintX, y: hintY, w: HINT_W, h: HINT_H };

  ctx.save();
  ctx.fillStyle = Theme.colors.white;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = '24px ' + Theme.font.family;
  ctx.strokeStyle = '#733C29';
  ctx.lineWidth = 1;

  // 缩放动画（以按钮中心为锚点）
  if (btnScale !== 1) {
    var hintCX = hintX + HINT_W / 2;
    var hintCY = hintY + HINT_H / 2;
    ctx.translate(hintCX, hintCY);
    ctx.scale(btnScale, btnScale);
    ctx.translate(-hintCX, -hintCY);
  }

  // 绘制按钮底框（提示/移除使用不同配色）
  var offsetY = 0;
  if (this._hintActive) {
    _drawEraseBg(ctx, hintX, hintY);
    offsetY = -8;
  } else {
    _drawHintBg(ctx, hintX, hintY);
  }

  // 广告图标
  if (AssetPreloader.isReady('ad_icon')) {
    ctx.drawImage(AssetPreloader.get('ad_icon'), hintX + 22, hintY + 15 + offsetY, AD_ICON_W, AD_ICON_H);
  }

  // 文字
  var label = this._hintActive ? '移除!' : '提示!';
  _drawLabel(ctx, label, hintX + 66, hintY + 19.5 + offsetY, 2);

  // 移除按钮：步数说明文字（底部居中）
  if (this._hintActive) {
    ctx.font = '13px ' + Theme.font.family;
    ctx.fillStyle = '#000000';
    ctx.strokeStyle = 'transparent';
    var stepText = '移除增加5步';
    var textW = ctx.measureText(stepText).width;
    var stepTextX = hintX + 66 - textW / 2 + 10;  // 水平居中后右移10px
    var stepTextY = hintY + 63 - 7 - 13;     // bottom: 4px, textH: 13px
    ctx.fillText(stepText, stepTextX, stepTextY);
  }

  ctx.restore();

  // 互斥：设置正确的点击区域
  if (this._hintActive) {
    this.hintBtnRect = null;
  } else {
    this.removeBtnRect = null;
  }
};

module.exports = BottomBar;
