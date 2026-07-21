// LoadingRenderer.js — 加载画面渲染器
// 每帧绘制：bg.jpg背景 → 金币进度条 → "加载中..."文字

var { ctx, SCREEN_WIDTH, SCREEN_HEIGHT, beginFrame, present } = require('../render.js');
var Theme = require('../define/GameDefine.js').THEME;

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

// 端点圆钮由代码绘制（见 _drawProgressBar），不再使用金币图

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

  // 2. 进度条 + 文字（滑出时向下平移 + 淡出）
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

  // 1. 轨道（半透明白底 + 细描边，更有质感）
  ctx.fillStyle = 'rgba(255, 255, 255, 0.50)';
  _roundRect(ctx, BAR_X, BAR_Y, BAR_WIDTH, BAR_HEIGHT, BAR_RADIUS);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // 2. 填充（粉 → 琥珀渐变）
  var fillW = this._slideOutActive ? BAR_WIDTH : Math.max(BAR_RADIUS * 2, BAR_WIDTH * progress);
  if (fillW > BAR_RADIUS * 2) {
    var fillGrad = ctx.createLinearGradient(BAR_X, 0, BAR_X + BAR_WIDTH, 0);
    fillGrad.addColorStop(0, '#EC4899');
    fillGrad.addColorStop(1, '#FBBF24');
    ctx.fillStyle = fillGrad;
    _roundRect(ctx, BAR_X, BAR_Y, fillW, BAR_HEIGHT, BAR_RADIUS);
    ctx.fill();

    // 3. 顶部高光（裁剪到填充区，营造果冻/玻璃质感）
    ctx.save();
    _roundRect(ctx, BAR_X, BAR_Y, fillW, BAR_HEIGHT, BAR_RADIUS);
    ctx.clip();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.fillRect(BAR_X, BAR_Y, fillW, BAR_HEIGHT * 0.42);
    ctx.restore();
  }

  // 4. 端点圆钮（白色描边 + 粉芯 + 高光点），跟随填充右缘
  var knobCx = BAR_X + fillW;
  var knobCy = BAR_Y + BAR_HEIGHT / 2;
  var knobR = BAR_HEIGHT / 2 + 4; // 略大于半高，微微凸出轨道
  ctx.save();
  ctx.shadowColor = 'rgba(236, 72, 153, 0.45)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(knobCx, knobCy, knobR, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#EC4899';
  ctx.beginPath();
  ctx.arc(knobCx, knobCy, knobR - 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.beginPath();
  ctx.arc(knobCx - knobR * 0.3, knobCy - knobR * 0.3, knobR * 0.22, 0, Math.PI * 2);
  ctx.fill();

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
  ctx.font = 'bold 14px ' + (Theme.font.family || 'sans-serif');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  // 白色加描边（与游戏内「白字描边」风格一致）
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.fillStyle = '#FFFFFF';
  ctx.strokeText('加载中... ' + pct + '%', BAR_MID_X, TEXT_Y);
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
