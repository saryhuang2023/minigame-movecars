// 通关结算弹窗 — PlayingEngine 通关后弹出
// 弹簧入场动画 + 内容错开显示 + 内嵌金币奖励/双倍按钮

var UIComponent = require('../base/UIComponent.js');
var Theme = require('../Theme.js');
var Easing = require('../../core/Easing.js');
var { SCREEN_WIDTH, SCREEN_HEIGHT } = require('../../render.js');

/**
 * @param {Object} opts
 * @param {Function} opts.onContinue - 继续按钮回调
 * @param {Function} opts.onReplay - 重玩按钮回调
 * @param {Function} opts.onExit - 退出按钮回调
 * @param {Function} opts.onDoubleGold - 双倍金币按钮回调
 */
function VictoryPopup(opts) {
  UIComponent.call(this, {
    x: 0, y: 0,
    w: SCREEN_WIDTH, h: SCREEN_HEIGHT,
    zIndex: opts.zIndex || 4,
    visible: false,
  });

  // 数据
  this._steps = 0;
  this._isNewMaster = false;
  this._hasCrown = false;
  this._returnState = 'menu';
  this._goldAmount = 0;
  this._showGold = false;
  this._goldClaimed = false;  // 双倍金币是否已领取

  // 动画
  this._animStart = 0;
  this._animator = null;  // PopupAnimator 实例（引擎注入）
  this._closing = false;
  this._closeCallback = null;

  // 按钮区域
  this._exitBtn = null;
  this._restartBtn = null;
  this._nextBtn = null;
  this._doubleGoldBtn = null;

  // 回调
  this.onContinue = opts.onContinue || function () {};
  this.onReplay = opts.onReplay || function () {};
  this.onExit = opts.onExit || function () {};
  this.onDoubleGold = opts.onDoubleGold || function () {};
}

VictoryPopup.prototype = Object.create(UIComponent.prototype);
VictoryPopup.prototype.constructor = VictoryPopup;

VictoryPopup.prototype.setAnimator = function (animator) {
  this._animator = animator;
};

VictoryPopup.prototype.setData = function (data) {
  this._steps = data.steps || 0;
  this._isNewMaster = !!data.isNewMaster;
  this._hasCrown = !!data.hasCrown;
  this._returnState = data.returnState || 'menu';
  this._goldAmount = data.goldAmount || 0;
  this._showGold = !!data.showGold;
};

VictoryPopup.prototype.open = function () {
  this.visible = true;
  this._closing = false;
  this._goldClaimed = false;
  if (this._animator) {
    this._animator.open();
    this._animStart = Date.now();
  }
};

VictoryPopup.prototype.close = function (cb) {
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

VictoryPopup.prototype.isClosing = function () {
  return this._closing;
};

/** 标记双倍金币已领取 — 按钮灰化，金额翻倍显示 */
VictoryPopup.prototype.markGoldClaimed = function () {
  this._goldClaimed = true;
  this._goldAmount *= 2;
};

VictoryPopup.prototype.render = function (ctx) {
  if (!this.visible) return;
  if (!this._animator) return;

  var state = this._animator.update();

  // 若正在关闭且动画结束
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

  var isNewMaster = this._isNewMaster;
  var hasCrown = this._hasCrown;
  var showGold = this._showGold;

  var ph = 200;
  if (isNewMaster) ph += 22;
  if (hasCrown) ph += 22;
  if (showGold) ph += 36;
  var pw = 310;
  var px = (SCREEN_WIDTH - pw) / 2;
  var py = (SCREEN_HEIGHT - ph) / 2 - 20;

  ctx.save();
  ctx.globalAlpha = panelAlpha;

  // 面板缩放
  var pCenterX = px + pw / 2;
  var pCenterY = py + ph / 2;
  ctx.translate(pCenterX, pCenterY);
  ctx.scale(panelScale, panelScale);
  ctx.translate(-pCenterX, -pCenterY);

  // 面板背景
  var r = 16;
  ctx.fillStyle = 'rgba(26, 26, 46, 0.95)';
  ctx.beginPath();
  ctx.moveTo(px + r, py);
  ctx.lineTo(px + pw - r, py);
  ctx.arcTo(px + pw, py, px + pw, py + r, r);
  ctx.lineTo(px + pw, py + ph - r);
  ctx.arcTo(px + pw, py + ph, px + pw - r, py + ph, r);
  ctx.lineTo(px + r, py + ph);
  ctx.arcTo(px, py + ph, px, py + ph - r, r);
  ctx.lineTo(px, py + r);
  ctx.arcTo(px, py, px + r, py, r);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 215, 0, 0.5)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // === 元素错开动画 ===
  var elapsed = Date.now() - this._animStart;
  var STAGGER_START = 80;
  var STAGGER_INTERVAL = 55;
  var self = this;

  var _elAnim = function (delayMs) {
    var t = Math.max(0, Math.min(1, (elapsed - delayMs) / 280));
    var s = Easing.spring(t * 3.5, 200, 11);
    return { alpha: s, scale: 0.6 + 0.4 * s };
  };

  var staggerIdx = 0;

  // 标题
  var titleAnim = _elAnim(0);
  ctx.save();
  ctx.globalAlpha = titleAnim.alpha;
  var titleCX = SCREEN_WIDTH / 2;
  var titleCY = py + 44;
  ctx.translate(titleCX, titleCY);
  ctx.scale(titleAnim.scale, titleAnim.scale);
  ctx.translate(-titleCX, -titleCY);
  ctx.fillStyle = Theme.colors.gold;
  ctx.font = 'bold 26px ' + Theme.font.family;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('通关成功！', titleCX, titleCY);
  ctx.restore();

  // 步数
  staggerIdx++;
  var stepsAnim = _elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL);
  ctx.save();
  ctx.globalAlpha = stepsAnim.alpha;
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '14px ' + Theme.font.family;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('共 ' + this._steps + ' 步', SCREEN_WIDTH / 2, py + 78);
  ctx.restore();

  var nextY = py + 78;

  // 新关主
  if (isNewMaster) {
    staggerIdx++;
    var masterAnim = _elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL);
    ctx.save();
    ctx.globalAlpha = masterAnim.alpha;
    ctx.fillStyle = Theme.colors.gold;
    ctx.font = 'bold 16px ' + Theme.font.family;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('\uD83D\uDC51 恭喜你成为新的关主！', SCREEN_WIDTH / 2, nextY + 22);
    ctx.restore();
    nextY = nextY + 22;
  }

  // 奖杯
  if (hasCrown) {
    staggerIdx++;
    var crownAnim = _elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL);
    ctx.save();
    ctx.globalAlpha = crownAnim.alpha;
    ctx.fillStyle = '#FBBF24';
    ctx.font = 'bold 16px ' + Theme.font.family;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('\uD83C\uDFC6 获得奖杯！', SCREEN_WIDTH / 2, nextY + 22);
    ctx.restore();
    nextY = nextY + 22;
  }

  // 金币奖励（嵌在面板内，不单独弹窗）
  if (showGold) {
    staggerIdx++;
    var goldAnim = _elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL);
    ctx.save();
    ctx.globalAlpha = goldAnim.alpha;

    var goldTextY = nextY + 26;
    // 金币文字
    var goldFontSize = this._goldClaimed ? 24 : 20;
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold ' + goldFontSize + 'px ' + Theme.font.family;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var goldLabel = this._goldClaimed
      ? '💰 +' + this._goldAmount + ' ✓'
      : '💰 +' + this._goldAmount;
    ctx.fillText(goldLabel, SCREEN_WIDTH / 2, goldTextY);

    ctx.restore();
    nextY = goldTextY + 8;
  }

  // === 按钮 ===
  var btnY = nextY + 30;

  var _renderBtn = function (x, y, w, h, anim, bgColor, label) {
    ctx.save();
    ctx.globalAlpha = anim.alpha;
    var cx = x + w / 2, cy = y + h / 2;
    ctx.translate(cx, cy);
    ctx.scale(anim.scale, anim.scale);
    ctx.translate(-cx, -cy);
    ctx.fillStyle = bgColor;
    var br = 8;
    ctx.beginPath();
    ctx.moveTo(x + br, y);
    ctx.lineTo(x + w - br, y);
    ctx.arcTo(x + w, y, x + w, y + br, br);
    ctx.lineTo(x + w, y + h - br);
    ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
    ctx.lineTo(x + br, y + h);
    ctx.arcTo(x, y + h, x, y + h - br, br);
    ctx.lineTo(x, y + br);
    ctx.arcTo(x, y, x + br, y, br);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px ' + Theme.font.family;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, cy);
    ctx.restore();
  };

  var rState = this._returnState;
  var btnH = 42;

  if (showGold) {
    // ── 有金币：继续(左) + 重玩(中) + 金币x2(右) ──
    var contBtnW = 82, restBtnW = 74, goldBtnW = 82, gap = 8;
    var goldBtnColor = self._goldClaimed ? 'rgba(255,255,255,0.1)' : '#F59E0B';
    var goldBtnLabel = self._goldClaimed ? '已领取' : '金币x2';

    var totalW3 = contBtnW + gap + restBtnW + gap + goldBtnW;
    var startX3 = (SCREEN_WIDTH - totalW3) / 2;
    staggerIdx++;
    var contAnim = _elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL + 20);
    this._nextBtn = { x: startX3, y: btnY, w: contBtnW, h: btnH };
    _renderBtn(startX3, btnY, contBtnW, btnH, contAnim, '#4CAF50', '继续');
    staggerIdx++;
    var restAnim = _elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL + 20);
    this._restartBtn = { x: startX3 + contBtnW + gap, y: btnY, w: restBtnW, h: btnH };
    _renderBtn(startX3 + contBtnW + gap, btnY, restBtnW, btnH, restAnim, 'rgba(255,255,255,0.12)', '重玩');
    staggerIdx++;
    var goldBtnAnim = _elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL + 20);
    this._doubleGoldBtn = { x: startX3 + contBtnW + gap + restBtnW + gap, y: btnY, w: goldBtnW, h: btnH };
    _renderBtn(startX3 + contBtnW + gap + restBtnW + gap, btnY, goldBtnW, btnH, goldBtnAnim, goldBtnColor, goldBtnLabel);
    this._exitBtn = null;

  } else if (rState === 'menu') {
    // ── 无金币 menu：单个继续按钮 ──
    var btnW = 100;
    this._exitBtn = null;
    this._restartBtn = null;
    this._doubleGoldBtn = null;
    staggerIdx++;
    var contAnim = _elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL + 20);
    var contX = (SCREEN_WIDTH - btnW) / 2;
    this._nextBtn = { x: contX, y: btnY, w: btnW, h: btnH };
    _renderBtn(contX, btnY, btnW, btnH, contAnim, '#4CAF50', '继续');
  } else if (rState === 'levelSelect') {
    // ── 无金币 levelSelect：重玩 + 继续 ──
    var btnW = 100;
    var gap = 20;
    var totalW = btnW * 2 + gap;
    var startX = (SCREEN_WIDTH - totalW) / 2;
    this._exitBtn = null;
    this._doubleGoldBtn = null;
    staggerIdx++;
    var restAnim = _elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL + 20);
    var restX = startX;
    this._restartBtn = { x: restX, y: btnY, w: btnW, h: btnH };
    _renderBtn(restX, btnY, btnW, btnH, restAnim, 'rgba(255,255,255,0.12)', '重玩');
    staggerIdx++;
    var contAnim2 = _elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL + 40);
    var contX2 = startX + btnW + gap;
    this._nextBtn = { x: contX2, y: btnY, w: btnW, h: btnH };
    _renderBtn(contX2, btnY, btnW, btnH, contAnim2, '#4CAF50', '继续');
  } else {
    // ── 编辑器返回 ──
    var btnW = 100;
    this._nextBtn = null;
    this._restartBtn = null;
    this._doubleGoldBtn = null;
    staggerIdx++;
    var exitAnim = _elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL + 20);
    var exitX = (SCREEN_WIDTH - btnW) / 2;
    this._exitBtn = { x: exitX, y: btnY, w: btnW, h: btnH };
    var exitLabel = rState === 'editor' ? '返回编辑' : '退出';
    _renderBtn(exitX, btnY, btnW, btnH, exitAnim, 'rgba(255,255,255,0.12)', exitLabel);
  }

  ctx.restore();
};

module.exports = VictoryPopup;
