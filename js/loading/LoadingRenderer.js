// LoadingRenderer.js — 加载画面渲染器
// 每帧绘制：bg.jpg背景 → idle猪动画 → 金币进度条 → "加载中..."文字
// 猪位置与主界面 renderMenu() 完全一致，实现无缝过渡

var PigRenderer = require('../render/PigRenderer.js');
var { ctx, SCREEN_WIDTH, SCREEN_HEIGHT, beginFrame, present } = require('../render.js');
var Theme = require('../ui/Theme.js');

// 进度条尺寸常量
var BAR_LEFT = 20;
var BAR_RIGHT = 20;
var BAR_WIDTH = SCREEN_WIDTH - BAR_LEFT - BAR_RIGHT;
var BAR_HEIGHT = 28;
var BAR_RADIUS = 14;
var BAR_Y = SCREEN_HEIGHT * 0.75;

// 文字位置
var TEXT_Y = BAR_Y + 44;
var BAR_X = BAR_LEFT;
var BAR_MID_X = SCREEN_WIDTH / 2;

// 主界面猪位置（与 GameEngine.renderMenu() 一致）
var PIG_CX = SCREEN_WIDTH / 2;
var PIG_CY = SCREEN_HEIGHT / 2;
var PIG_TARGET_W = SCREEN_WIDTH * 2 / 3;

// 金币图标在进度条中的尺寸
var COIN_SIZE = 42;

function LoadingRenderer(loadingManager) {
  this._lm = loadingManager;
  this._bgImg = null;
  this._coinImg = null;
  this._bgLoaded = false;
  this._coinLoaded = false;
  // 滑出动画状态
  this._slideOutElapsed = 0;
  this._slideOutDuration = 500;
  this._slideOutActive = false;
}

/** 设置背景图（由 LoadingManager 提供） */
LoadingRenderer.prototype.setBgImage = function (img) {
  this._bgImg = img;
  this._bgLoaded = true;
};

/** 设置金币图（由 LoadingManager 提供） */
LoadingRenderer.prototype.setCoinImage = function (img) {
  this._coinImg = img;
  this._coinLoaded = true;
};

/** 启动滑出动画 */
LoadingRenderer.prototype.startSlideOut = function () {
  this._slideOutActive = true;
  this._slideOutElapsed = 0;
};

/** 更新滑出动画（每帧调用） */
LoadingRenderer.prototype.updateSlideOut = function (dt) {
  if (!this._slideOutActive) return;
  this._slideOutElapsed = Math.min(dt, this._slideOutDuration);
};

/** 滑出动画是否结束 */
LoadingRenderer.prototype.isSlideOutDone = function () {
  return this._slideOutActive && this._slideOutElapsed >= this._slideOutDuration;
};

/** 获取滑出进度 0→1 (ease-out) */
LoadingRenderer.prototype._slideOutT = function () {
  var t = this._slideOutElapsed / this._slideOutDuration;
  t = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - t, 3); // ease-out cubic
};

/** 每帧渲染 */
LoadingRenderer.prototype.render = function () {
  beginFrame();

  // 1. 背景
  this._drawBackground();

  // 2. 主界面 idle 小猪动画（始终保持，不做滑出淡化）
  PigRenderer.drawMenuIdlePig(ctx, PIG_CX, PIG_CY, PIG_TARGET_W);

  // 3. 进度条 + 文字（滑出时向下平移 + 淡出）
  this._drawProgressBar();
  this._drawText();

  // 滑出阶段：在底部画一条覆盖线掩饰进度条残留
  if (this._slideOutActive) {
    var st = this._slideOutT();
    var fadeY = BAR_Y + st * 180; // 向下 180px
    // 透明遮罩擦除残留
    ctx.fillStyle = 'rgba(255,255,255,' + (st * 0.4) + ')';
    ctx.fillRect(0, fadeY - 10, SCREEN_WIDTH, 180);
  }

  present();
};

// ===== 内部绘制 =====

LoadingRenderer.prototype._drawBackground = function () {
  if (this._bgLoaded && this._bgImg) {
    // cover 模式：等比缩放填满屏幕
    var imgW = this._bgImg.width;
    var imgH = this._bgImg.height;
    if (imgW > 0 && imgH > 0) {
      var scale = Math.max(SCREEN_WIDTH / imgW, SCREEN_HEIGHT / imgH);
      var dw = imgW * scale;
      var dh = imgH * scale;
      var dx = (SCREEN_WIDTH - dw) / 2;
      var dy = (SCREEN_HEIGHT - dh) / 2;
      ctx.drawImage(this._bgImg, dx, dy, dw, dh);
      return;
    }
  }

  // 兜底：品牌渐变背景
  var grad = ctx.createLinearGradient(0, 0, 0, SCREEN_HEIGHT);
  grad.addColorStop(0, '#F0EAFA');
  grad.addColorStop(0.4, '#FDE8EF');
  grad.addColorStop(1, '#FDF2F8');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
};

LoadingRenderer.prototype._drawProgressBar = function () {
  var progress = this._lm.getProgress();

  // 滑出动画：向下平移 + 淡出
  var offsetY = 0;
  var alpha = 1;
  if (this._slideOutActive) {
    var t = this._slideOutT();
    offsetY = t * 180;
    alpha = 1 - t;
  }

  ctx.save();
  ctx.translate(0, offsetY);
  ctx.globalAlpha *= alpha;

  // 背景轨道
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  _roundRect(ctx, BAR_X, BAR_Y, BAR_WIDTH, BAR_HEIGHT, BAR_RADIUS);
  ctx.fill();

  // 填充条（进度锁定 100%）
  var fillW = this._slideOutActive ? BAR_WIDTH : Math.max(BAR_RADIUS * 2, BAR_WIDTH * progress);
  if (fillW > BAR_RADIUS * 2) {
    var fillGrad = ctx.createLinearGradient(BAR_X, 0, BAR_X + BAR_WIDTH, 0);
    fillGrad.addColorStop(0, '#EC4899');
    fillGrad.addColorStop(1, '#F59E0B');
    ctx.fillStyle = fillGrad;
    _roundRect(ctx, BAR_X, BAR_Y, fillW, BAR_HEIGHT, BAR_RADIUS);
    ctx.fill();
  }

  // 金币图标（跟随填充右边缘）
  if (this._coinLoaded && this._coinImg) {
    var coinX = BAR_X + fillW - COIN_SIZE / 2;
    var coinY = BAR_Y + BAR_HEIGHT / 2 - COIN_SIZE / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(245, 158, 11, 0.6)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.drawImage(this._coinImg, coinX, coinY, COIN_SIZE, COIN_SIZE);
    ctx.restore();
  }

  ctx.restore();
};

LoadingRenderer.prototype._drawText = function () {
  var progress = this._lm.getProgress();
  var pct = Math.round(progress * 100);

  // 滑出动画：与进度条同步向下平移 + 淡出
  var offsetY = 0;
  var alpha = 1;
  if (this._slideOutActive) {
    var t = this._slideOutT();
    offsetY = t * 180;
    alpha = 1 - t;
    pct = 100; // 锁定 100%
  }

  ctx.save();
  ctx.translate(0, offsetY);
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = '#94A3B8';
  ctx.font = '14px ' + (Theme.font.family || 'sans-serif');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('加载中... ' + pct + '%', BAR_MID_X, TEXT_Y);
  ctx.restore();
};

// ===== 圆角矩形工具 =====

function _roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.arcTo(x + w, y, x + w, y + r, r);
  c.lineTo(x + w, y + h - r);
  c.arcTo(x + w, y + h, x + w - r, y + h, r);
  c.lineTo(x + r, y + h);
  c.arcTo(x, y + h, x, y + h - r, r);
  c.lineTo(x, y + r);
  c.arcTo(x, y, x + r, y, r);
  c.closePath();
}

module.exports = LoadingRenderer;
