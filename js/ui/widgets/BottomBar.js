// 底部栏 — 提示按钮
// PlayingEngine 专用（实际按钮已由 CommonButton 接管，此处仅作隐藏兜底）
// v125: 提示按钮底框改为 Canvas 2D 绘制（3层叠加：白色外框 → 渐变填充+棕色边框 → 内高光），不再加载背景图

var UIComponent = require('../base/UIComponent.js');
var Theme = require('../../define/GameDefine.js').THEME;
var AssetPreloader = require('../AssetPreloader.js');
var { SCREEN_WIDTH, SCREEN_HEIGHT } = require('../../render.js');
var { roundRect } = require('../../render/PigRenderer.js');

var AD_ICON = 'assets/images/ad_icon.png';

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

/**
 * @param {Object} opts
 * @param {number} opts.cardW - 卡片宽度（对齐用）
 * @param {Object} opts.buttonPress - ButtonPress 实例
 * @param {Function} opts.onHintClick - 提示按钮回调
 */
class BottomBar extends UIComponent {
  constructor(opts) {
  super({
    x: 0,
    y: SCREEN_HEIGHT - Theme.layout.bottomBarH,
    w: SCREEN_WIDTH,
    h: Theme.layout.bottomBarH,
    zIndex: opts.zIndex || 2,
  });

  this._cardW = opts.cardW;
  this._buttonPress = opts.buttonPress;
  this._hintShowing = false;  // 提示正在展示中（灰化按钮）
  this._hintHidden = false;   // 通关后隐藏提示/移除按钮
  this._currentSteps = 0;

  // 回调
  this.onHintClick = opts.onHintClick || function () {};

  // 按钮点击区域（供外部 hitTest 查询）
  this.hintBtnRect = null;

}
}


BottomBar.prototype.setHintShowing = function (showing) {
  this._hintShowing = !!showing;
};

BottomBar.prototype.setHintHidden = function (hidden) {
  this._hintHidden = !!hidden;
};

BottomBar.prototype.setCurrentSteps = function (steps) {
  this._currentSteps = steps;
};

/**
 * 覆盖 hitTest，精确检测提示按钮
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

  return false;
};

/**
 * 判断具体点中了哪个按钮
 */
BottomBar.prototype.getHitType = function (px, py) {
  // 提示展示中：提示按钮灰化，不可点击
  if (this._hintShowing) return null;
  if (this.hintBtnRect) {
    var h = this.hintBtnRect;
    if (px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h) {
      return 'hint';
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
  // ===== 提示按钮（移除功能已删除，仅保留提示）=====
  if (this._hintHidden) return;  // 通关后隐藏
  var hintX = SCREEN_WIDTH - 15 - HINT_W;
  var hintY = SCREEN_HEIGHT - 30 - HINT_H;

  var btnScale = this._buttonPress ? this._buttonPress.getScale('hint') : 1;
  this.hintBtnRect = { x: hintX, y: hintY, w: HINT_W, h: HINT_H };

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

  // 绘制按钮底框（提示配色）
  _drawHintBg(ctx, hintX, hintY);

  // 广告图标
  if (AssetPreloader.isReady('ad_icon')) {
    ctx.drawImage(AssetPreloader.get('ad_icon'), hintX + 22, hintY + 15, AD_ICON_W, AD_ICON_H);
  }

  // 文字
  _drawLabel(ctx, '提示!', hintX + 66, hintY + 19.5, 2);

  // 提示展示中：灰化遮罩
  if (this._hintShowing) {
    ctx.fillStyle = 'rgba(180,180,180,0.55)';
    ctx.fillRect(hintX, hintY, HINT_W, HINT_H);
  }

  ctx.restore();
};

module.exports = BottomBar;
