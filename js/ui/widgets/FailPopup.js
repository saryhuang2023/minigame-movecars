// 通关失败弹窗 — PlayingEngine 步数用尽（剩余步数=0 且未通关）时弹出
// 复用 VictoryPopup 的弹簧入场 + 遮罩结构，简化为「重玩 / 返回」两个按钮

var UIComponent = require('../base/UIComponent.js');
var Theme = require('../../define/GameDefine.js').THEME;
var AssetPreloader = require('../AssetPreloader.js');
var CommonButton = require('./CommonButton.js');
var { SCREEN_WIDTH, SCREEN_HEIGHT } = require('../../render.js');

/**
 * @param {Object} opts
 * @param {Function} opts.onReplay - 重玩按钮回调
 * @param {Function} opts.onExit - 返回/退出按钮回调
 */
class FailPopup extends UIComponent {
  constructor(opts) {
  super({
    x: 0, y: 0,
    w: SCREEN_WIDTH, h: SCREEN_HEIGHT,
    zIndex: opts.zIndex || 4,
    visible: false,
  });

  // 数据
  this._returnState = 'menu';

  // 返回按钮（通用按钮，蓝）
  this._backBtn = new CommonButton({ w: 160, h: 48, color: 'blue' });

  // 动画（引擎注入 PopupAnimator）
  this._animator = null;
  this._closing = false;
  this._closeCallback = null;
  this._animStart = 0;

  // 按钮点击区域（供引擎 _hitRect 检测）
  this._replayBtn = null;   // 重玩（左下，btn_again 图）
  this._exitBtn = null;     // 返回（右下，通用按钮）

  // 回调
  this.onReplay = opts.onReplay || function () {};
  this.onExit = opts.onExit || function () {};

}
}


FailPopup.prototype.setAnimator = function (animator) {
  this._animator = animator;
};

FailPopup.prototype.setData = function (data) {
  this._returnState = data.returnState || 'menu';
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

  // 遮罩
  ctx.fillStyle = 'rgba(0, 0, 0, ' + maskAlpha.toFixed(3) + ')';
  ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

  var panelScale = state.scale;
  var panelAlpha = state.alpha;
  if (panelAlpha < 0.01) return;

  // 面板几何（与 VictoryPopup 完全一致，复用 victory_bg）
  var pw = 359;
  var ph = 384;
  var px = (SCREEN_WIDTH - pw) / 2 + 1;
  var py = (SCREEN_HEIGHT - ph) / 2 - 39;

  ctx.save();
  ctx.globalAlpha = panelAlpha;

  // 面板缩放（弹簧入场）
  var pCenterX = px + pw / 2;
  var pCenterY = py + ph / 2;
  ctx.translate(pCenterX, pCenterY);
  ctx.scale(panelScale, panelScale);
  ctx.translate(-pCenterX, -pCenterY);

  // 面板背景
  if (AssetPreloader.isReady('victory_bg')) {
    ctx.drawImage(AssetPreloader.get('victory_bg'), px, py, pw, ph);
  }

  // === 标题「通关失败」===
  ctx.save();
  ctx.globalAlpha = panelAlpha;
  ctx.fillStyle = '#E3632D';
  ctx.font = 'bold 28px ' + Theme.font.family;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('通关失败', px + pw / 2, py + 96);
  ctx.restore();

  // === 副标题「步数用尽啦」===
  ctx.save();
  ctx.globalAlpha = panelAlpha;
  ctx.fillStyle = '#7A5230';
  ctx.font = '17px ' + Theme.font.family;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('步数用尽啦，再试一次吧', px + pw / 2, py + 138);
  ctx.restore();

  // === 按钮（位置与 VictoryPopup 对称：重玩左下，返回右下）===
  var CONT_BTN_W = 160;
  var CONT_BTN_H = 48;
  var CONT_BTN_X = px + pw - 78 - CONT_BTN_W;            // right: 78
  var CONT_BTN_Y = py + ph - 29 - CONT_BTN_H;            // bottom: 29

  var REPLAY_BTN_W = 45;
  var REPLAY_BTN_H = 45;
  var REPLAY_BTN_X = px + 66;                              // left: 66
  var REPLAY_BTN_Y = py + ph - 31 - REPLAY_BTN_H;        // bottom: 31

  // 重玩按钮（btn_again 图）
  var replayImg = AssetPreloader.get('btn_again');
  if (replayImg && AssetPreloader.isReady('btn_again')) {
    ctx.drawImage(replayImg, REPLAY_BTN_X, REPLAY_BTN_Y, REPLAY_BTN_W, REPLAY_BTN_H);
  }
  this._replayBtn = { x: REPLAY_BTN_X, y: REPLAY_BTN_Y, w: REPLAY_BTN_W, h: REPLAY_BTN_H };

  // 返回按钮（通用蓝按钮）
  var backLabel = this._returnState === 'editor' ? '返回编辑' : '返回';
  this._backBtn.x = CONT_BTN_X;
  this._backBtn.y = CONT_BTN_Y;
  this._backBtn.label = backLabel;
  this._backBtn.render(ctx);
  this._exitBtn = { x: CONT_BTN_X, y: CONT_BTN_Y, w: CONT_BTN_W, h: CONT_BTN_H };

  ctx.restore();
};

module.exports = FailPopup;
