// 通关失败弹窗 — PlayingEngine 步数用尽（剩余步数=0 且未通关）时弹出
// 统一弹窗出场动画（PopupAnimator 注入的 scale/alpha 弹簧入场 + 遮罩）
// 设计稿（designWidth=393，按 s = SCREEN_WIDTH/393 缩放）：
//   背景 level_loss_bg.png  383.77×262  top:141 水平居中
//   按钮 button_green.png   189×62     top:calc(50% - 62/2 + 85) 水平居中；点击=重新开始
//   文字「重新挑战」96×29 相对按钮居中，白字 + #14671F 描边/投影

var UIComponent = require('../base/UIComponent.js');
var Theme = require('../../define/GameDefine.js').THEME;
var AssetPreloader = require('../AssetPreloader.js');
var { drawGreenButton } = require('./greenButton.js');
var { SCREEN_WIDTH, SCREEN_HEIGHT } = require('../../render.js');

var DESIGN_W = 393;

/**
 * @param {Object} opts
 * @param {Function} opts.onReplay - 重玩按钮回调（引擎实际直接调用 restartLevel，此处保留兼容）
 */
class FailPopup extends UIComponent {
  constructor(opts) {
    super({
      x: 0, y: 0,
      w: SCREEN_WIDTH, h: SCREEN_HEIGHT,
      zIndex: opts.zIndex || 4,
      visible: false,
    });

    // 动画（引擎注入 PopupAnimator）
    this._animator = null;
    this._closing = false;
    this._closeCallback = null;
    this._animStart = 0;

    // 按钮点击区域（供引擎 _hitRect 检测）
    this._replayBtn = null;   // 绿色「重新挑战」按钮（= 重新开始）
    this._exitBtn = null;     // 新设计无返回钮；置空以禁用引擎的返回分支

    // 回调
    this.onReplay = opts.onReplay || function () {};
  }
}


FailPopup.prototype.setAnimator = function (animator) {
  this._animator = animator;
};

FailPopup.prototype.setData = function (data) {
  // 失败弹窗不再区分 returnState（无返回钮）
};

FailPopup.prototype.open = function () {
  this.visible = true;
  this._closing = false;
  this._animStart = Date.now();
  if (this._animator) {
    this._animator.open();
  }
};

FailPopup.prototype.close = function (cb) {
  this._closing = true;
  this._closeCallback = cb || null;
  if (this._animator) {
    this._animator.close(function () {
      this.visible = false;
      if (this._closeCallback) this._closeCallback();
    }.bind(this));
  } else {
    this.visible = false;
    if (cb) cb();
  }
};

FailPopup.prototype.render = function (ctx) {
  if (!this.visible) return;
  if (!this._animator) return;

  var state = this._animator.update();

  // 与 VictoryPopup 对称：追踪 animator 打开时间，重置单次状态
  var openStartTime = this._animator.getOpenStartTime();
  if (openStartTime > 0 && this._animStart !== openStartTime) {
    this._animStart = openStartTime;
  }

  if (this._closing && this._animator.isClosed()) {
    return;
  }

  var maskAlpha = state.maskAlpha;

  // 遮罩（点击不处理，仅视觉压暗）
  ctx.fillStyle = 'rgba(0, 0, 0, ' + maskAlpha.toFixed(3) + ')';
  ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

  var panelScale = state.scale;
  var panelAlpha = state.alpha;
  if (panelAlpha < 0.01) return;

  var s = SCREEN_WIDTH / DESIGN_W;

  // === 面板几何（设计稿 393 空间，乘 s 适配设备）===
  var bgW = 383.77 * s;
  var bgH = 262 * s;
  var bgX = (SCREEN_WIDTH - bgW) / 2 - 0.5 * s;   // left: calc(50% - 383.77/2 - 0.5)
  var bgY = 141 * s;                               // top: 141

  var BTN_W = 189 * s;
  var BTN_H = 62 * s;
  var btnX = (SCREEN_WIDTH - BTN_W) / 2;           // 水平居中
  var btnY = SCREEN_HEIGHT / 2 - BTN_H / 2 + 85 * s; // top: calc(50% - 62/2 + 85)

  ctx.save();
  ctx.globalAlpha = panelAlpha;

  // 面板缩放（弹簧入场，以背景卡中心为锚）
  var pCenterX = bgX + bgW / 2;
  var pCenterY = bgY + bgH / 2;
  ctx.translate(pCenterX, pCenterY);
  ctx.scale(panelScale, panelScale);
  ctx.translate(-pCenterX, -pCenterY);

  // 背景（level_loss_bg.png；若资源未就绪则跳过，不崩）
  if (AssetPreloader.isReady('level_loss_bg')) {
    ctx.drawImage(AssetPreloader.get('level_loss_bg'), bgX, bgY, bgW, bgH);
  }

  // 绿钮（button_green.png 底图 + 白字/绿描边/投影，统一由 drawGreenButton 绘制）
  drawGreenButton(ctx, {
    x: btnX, y: btnY, w: BTN_W, h: BTN_H,
    label: '重新挑战', s: s,
  });

  ctx.restore();

  // 命中区：仅绿色「重新挑战」按钮（= 重新开始）
  this._replayBtn = { x: btnX, y: btnY, w: BTN_W, h: BTN_H };
  this._exitBtn = null;
};

module.exports = FailPopup;
