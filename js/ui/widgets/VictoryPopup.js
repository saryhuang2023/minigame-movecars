// 通关结算弹窗 — PlayingEngine 通关后弹出
// 弹簧入场动画 + 内容错开显示 + 内嵌金币奖励/双倍按钮

var UIComponent = require('../base/UIComponent.js');
var Theme = require('../Theme.js');
var Easing = require('../../core/Easing.js');
var AssetPreloader = require('../AssetPreloader.js');
var { SCREEN_WIDTH, SCREEN_HEIGHT } = require('../../render.js');

// ===== 继续按钮手绘（复用 SettingsPanel 的 3 层 Figma 设计，参数化宽度）=====
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

function _drawContinueBtnBg(ctx, x, y, w, h) {
  ctx.save();

  // === 第1层：深青色外框, #1D6C72, radius 14 ===
  _roundRect(ctx, x, y, w, h, 14);
  ctx.fillStyle = '#1D6C72';
  ctx.fill();

  // === 第2层：青色渐变内框, #00C3D8, radius 12，偏移 (2, 2) ===
  var ix = x + 2;
  var iy = y + 2;
  var iw = w - 4;
  var ih = h - 4;

  _roundRect(ctx, ix, iy, iw, ih, 12);
  ctx.fillStyle = '#00C3D8';
  ctx.fill();

  // 内高光/阴影（clip 到内框）
  _roundRect(ctx, ix, iy, iw, ih, 12);
  ctx.save();
  ctx.clip();

  // inset top: 0px 3px 3px rgba(255,255,255,0.3)
  var tGrad = ctx.createLinearGradient(ix, iy, ix, iy + 4);
  tGrad.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
  tGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = tGrad;
  ctx.fillRect(ix, iy, iw, 5);

  // inset bottom: 0px -4px 0px #0A88B6
  ctx.fillStyle = '#0A88B6';
  ctx.fillRect(ix, iy + ih - 4, iw, 4);

  ctx.restore();  // clip

  // === 第3层：亮青色描边, 1.5px #33D4D7, radius 12 ===
  var sx = x + 2;
  var sy = y + 2;
  var sw = w - 4;
  var sh = h - 7;  // 41 height

  _roundRect(ctx, sx, sy, sw, sh, 12);
  ctx.strokeStyle = '#33D4D7';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.restore();  // outer save
}

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

  // 双倍按钮呼吸动画
  this._goldBtnBreatheStart = 0;
  this._goldBtnBreatheActive = false;
  this._GOLD_BTN_BREATHE_DURATION = 600;   // ms
  this._GOLD_BTN_BREATHE_PULSES = 3;       // 3 次脉冲
  this._GOLD_BTN_BREATHE_AMPLITUDE = 0.06; // 最大缩放 6%

  // 金币数字弹出动画（点击 X2 后两次呼吸脉冲）
  this._goldNumPopStart = 0;
  this._goldNumPopActive = false;
  this._GOLD_NUM_POP_DURATION = 1400;      // ms 总时长（2 次呼吸）
  this._GOLD_NUM_POP_PEAK = 2.2;           // 第一次呼吸峰值
}

VictoryPopup.prototype = Object.create(UIComponent.prototype);
VictoryPopup.prototype.constructor = VictoryPopup;

VictoryPopup.prototype.setAnimator = function (animator) {
  this._animator = animator;
};

VictoryPopup.prototype.setData = function (data) {
  this._steps = data.steps || 0;
  this._returnState = data.returnState || 'menu';
  this._goldAmount = data.goldAmount || 0;
  this._showGold = !!data.showGold;
  this._masterSteps = data.masterSteps != null ? data.masterSteps : null;
  this._masterNickname = data.masterNickname || null;
};

VictoryPopup.prototype.open = function () {
  this.visible = true;
  this._closing = false;
  this._goldClaimed = false;
  this._goldBtnBreatheActive = false;
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

/** 标记双倍金币已领取 — 按钮灰化，金额翻倍显示，触发呼吸动画 */
VictoryPopup.prototype.markGoldClaimed = function () {
  this._goldClaimed = true;
  this._goldAmount *= 2;
  this.triggerGoldBtnBreathe();
  this.triggerGoldNumPop();
};

/** 触发双倍按钮呼吸动画 */
VictoryPopup.prototype.triggerGoldBtnBreathe = function () {
  this._goldBtnBreatheStart = Date.now();
  this._goldBtnBreatheActive = true;
};

/** 获取双倍按钮呼吸缩放值 */
VictoryPopup.prototype._getGoldBtnBreatheScale = function () {
  if (!this._goldBtnBreatheActive) return 1;
  var elapsed = Date.now() - this._goldBtnBreatheStart;
  if (elapsed >= this._GOLD_BTN_BREATHE_DURATION) {
    this._goldBtnBreatheActive = false;
    return 1;
  }
  var t = elapsed / this._GOLD_BTN_BREATHE_DURATION;
  var pulse = Math.abs(Math.sin(t * this._GOLD_BTN_BREATHE_PULSES * Math.PI));
  return 1 + pulse * this._GOLD_BTN_BREATHE_AMPLITUDE;
};

/** 触发金币数字弹出动画 */
VictoryPopup.prototype.triggerGoldNumPop = function () {
  this._goldNumPopStart = Date.now();
  this._goldNumPopActive = true;
};

/** 获取金币数字呼吸缩放值 — 2 次正弦脉冲 + 指数衰减 */
VictoryPopup.prototype._getGoldNumPopScale = function () {
  if (!this._goldNumPopActive) return 1;
  var elapsed = Date.now() - this._goldNumPopStart;
  if (elapsed >= this._GOLD_NUM_POP_DURATION) {
    this._goldNumPopActive = false;
    return 1;
  }
  var t = elapsed / this._GOLD_NUM_POP_DURATION;
  var PEAK = this._GOLD_NUM_POP_PEAK;
  // sin²(2π·t)——1 个完整正弦周期，平方后得到 2 个正向峰
  //   t=0→0→t=0.25→1→t=0.5→0→t=0.75→1→t=1→0
  var breath = Math.sin(t * 2 * Math.PI);
  // 指数衰减包络：第一次呼吸 ~74%，第二次 ~41%
  var decay = Math.exp(-t * 1.2);
  return 1 + (PEAK - 1) * breath * breath * decay;
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

  var showGold = this._showGold;

  var pw = 359;
  var ph = 384;
  var px = (SCREEN_WIDTH - pw) / 2 + 1;
  var py = (SCREEN_HEIGHT - ph) / 2 - 39;

  ctx.save();
  ctx.globalAlpha = panelAlpha;

  // 面板缩放
  var pCenterX = px + pw / 2;
  var pCenterY = py + ph / 2;
  ctx.translate(pCenterX, pCenterY);
  ctx.scale(panelScale, panelScale);
  ctx.translate(-pCenterX, -pCenterY);

  // 面板背景
  if (AssetPreloader.isReady('victory_bg')) {
    ctx.drawImage(AssetPreloader.get('victory_bg'), px, py, pw, ph);
  }

  // === 双倍金币按钮（有金币且未领取时才显示）===
  if (showGold && !this._goldClaimed) {
    var goldBtnW = 208, goldBtnH = 54;
    var goldBtnX = px + (pw - goldBtnW) / 2 - 0.5;
    var goldBtnY = py + ph + 12;  // 面板底部下方 12px

    // 呼吸动画缩放
    var breatheScale = this._getGoldBtnBreatheScale();
    var goldCenterX = goldBtnX + goldBtnW / 2;
    var goldCenterY = goldBtnY + goldBtnH / 2;
    if (breatheScale !== 1) {
      ctx.save();
      ctx.translate(goldCenterX, goldCenterY);
      ctx.scale(breatheScale, breatheScale);
      ctx.translate(-goldCenterX, -goldCenterY);
    }

    // 设置点击区域（large button）
    this._doubleGoldBtn = { x: goldBtnX, y: goldBtnY, w: goldBtnW, h: goldBtnH };

    // 外层暗底 #7C2C04
    ctx.fillStyle = '#7C2C04';
    _roundRect(ctx, goldBtnX, goldBtnY, goldBtnW, goldBtnH, 14);
    ctx.fill();

    // 中层橙色 #FFA600 + inner shadows
    var innerW = 204.02, innerH = 50.46;
    var innerX = px + (pw - innerW) / 2 - 0.5;
    var innerY = goldBtnY + 1.77;
    ctx.save();
    _roundRect(ctx, innerX, innerY, innerW, innerH, 12);
    ctx.clip();
    ctx.fillStyle = '#FFA600';
    ctx.fillRect(innerX, innerY, innerW, innerH);
    // inset top shadow
    var topGrad = ctx.createLinearGradient(innerX, innerY, innerX, innerY + 3);
    topGrad.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
    topGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = topGrad;
    ctx.fillRect(innerX, innerY, innerW, 3);
    // inset bottom shadow
    var btmGrad = ctx.createLinearGradient(innerX, innerY + innerH - 4, innerX, innerY + innerH);
    btmGrad.addColorStop(0, 'rgba(144, 78, 0, 0)');
    btmGrad.addColorStop(1, 'rgba(144, 78, 0, 0.5)');
    ctx.fillStyle = btmGrad;
    ctx.fillRect(innerX, innerY + innerH - 4, innerW, 4);
    ctx.restore();

    // 内层金色描边
    var strokeW = 204.02, strokeH = 47.8;
    var strokeX = px + (pw - strokeW) / 2 - 0.5;
    var strokeY = innerY;
    ctx.strokeStyle = '#FFC74F';
    ctx.lineWidth = 1.5;
    _roundRect(ctx, strokeX, strokeY, strokeW, strokeH, 12);
    ctx.stroke();

    // 按钮文字 "金币X2"（居中）
    var btnCenterX = px + pw / 2 - 0.5;
    var btnCenterY = goldBtnY + goldBtnH / 2;
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '24px ' + Theme.font.family;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('金币X2', btnCenterX, btnCenterY);
    // 文字描边
    ctx.strokeStyle = '#733C29';
    ctx.lineWidth = 1.2;
    ctx.strokeText('金币X2', btnCenterX, btnCenterY);

    // 广告位图标（双倍按钮内，left 27，上下居中）
    var adIconSize = 32.42;
    var adIconX = goldBtnX + 27;
    var adIconY = goldBtnY + (goldBtnH - adIconSize) / 2;
    if (AssetPreloader.isReady('ad_icon')) {
      ctx.drawImage(AssetPreloader.get('ad_icon'), adIconX, adIconY, adIconSize, adIconSize);
    }

    if (breatheScale !== 1) {
      ctx.restore();
    }
  } else {
    this._doubleGoldBtn = null;
  }

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

  // === 文本框（相对背景面板定位）===
  var _drawInfoText = function (anim, text, x, y) {
    ctx.save();
    ctx.globalAlpha = anim.alpha;
    ctx.fillStyle = '#E3632D';
    ctx.font = '20px ' + Theme.font.family;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y + 10);  // baseline → middle 偏移半行高
    ctx.restore();
  };

  var infoX = px + 91;

  // === 标签背景色块 ===
  var badgeW = 70, badgeH = 28;
  var badgeX = px + pw - 91 - badgeW;  // right: 91px

  var _drawBadge = function (anim, x, y, color) {
    ctx.save();
    ctx.globalAlpha = anim.alpha;
    ctx.fillStyle = color;
    // CSS border-radius: 6px 24px 24px 6px
    // Canvas 不自动钳位 → 手动 clamp：28px 高元素，24→14
    var rl = Math.min(6, badgeH / 2);
    var rr = Math.min(24, badgeH / 2);
    ctx.beginPath();
    // 从上边左上角开始，顺时针绘制
    ctx.moveTo(x + rl, y);
    // 上边 → 右上角
    ctx.lineTo(x + badgeW - rr, y);
    ctx.arc(x + badgeW - rr, y + rr, rr, -Math.PI / 2, 0);
    // 右边 → 右下角
    ctx.lineTo(x + badgeW, y + badgeH - rr);
    ctx.arc(x + badgeW - rr, y + badgeH - rr, rr, 0, Math.PI / 2);
    // 下边 → 左下角
    ctx.lineTo(x + rl, y + badgeH);
    ctx.arc(x + rl, y + badgeH - rl, rl, Math.PI / 2, Math.PI);
    // 左边 → 左上角
    ctx.lineTo(x, y + rl);
    ctx.arc(x + rl, y + rl, rl, Math.PI, -Math.PI / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  // 红 — 关主步数
  staggerIdx++;
  var redBadgeAnim = _elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL);
  _drawBadge(redBadgeAnim, badgeX, py + 161, '#FF7B7B');

  // 蓝 — 本关步数
  staggerIdx++;
  var blueBadgeAnim = _elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL);
  _drawBadge(blueBadgeAnim, badgeX, py + 207, '#83DEFF');

  // 黄 — 获得金币
  staggerIdx++;
  var goldBadgeAnim = _elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL);
  _drawBadge(goldBadgeAnim, badgeX, py + 251, '#FFC500');

  // === 图标（盖在色块上面）===
  var iconW = 32, iconH = 32;
  var iconX = px + pw - 143 - iconW;  // right: 143px

  var _drawIcon = function (anim, key, x, y) {
    if (!AssetPreloader.isReady(key)) return;
    ctx.save();
    ctx.globalAlpha = anim.alpha;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.drawImage(AssetPreloader.get(key), x, y, iconW, iconH);
    ctx.restore();
  };

  // 奖杯（关主）
  staggerIdx++;
  var crownIconAnim = _elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL);
  _drawIcon(crownIconAnim, 'master_hat', iconX, py + 157);

  // 步数
  staggerIdx++;
  var stepIconAnim = _elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL);
  _drawIcon(stepIconAnim, 'leftStep', iconX, py + 205);

  // 金币
  staggerIdx++;
  var coinIconAnim = _elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL);
  _drawIcon(coinIconAnim, 'coin', iconX, py + 249);

  // 关主步数（标签）
  staggerIdx++;
  var masterAnim = _elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL);
  _drawInfoText(masterAnim, '关主步数', infoX, py + 165);

  // 本关步数（标签）
  staggerIdx++;
  var stepsAnim = _elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL);
  _drawInfoText(stepsAnim, '本关步数', infoX, py + 207);

  // 获得金币（标签）
  staggerIdx++;
  var goldTextAnim = _elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL);
  _drawInfoText(goldTextAnim, '获得金币', infoX, py + 253);

  // === 数据值（left:2px 相对 icon 右边缘，top 相对背景）===
  var dataX = iconX + iconW + 2;  // icon 右边缘 + 2px

  var _drawDataText = function (anim, text, y) {
    ctx.save();
    ctx.globalAlpha = anim.alpha;
    ctx.fillStyle = '#000000';
    ctx.font = '13px ' + Theme.font.family;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, dataX, y + 6);
    ctx.restore();
  };

  // 关主步数数据（top: 168px）
  if (this._masterSteps != null) {
    staggerIdx++;
    var masterDataAnim = _elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL);
    _drawDataText(masterDataAnim, this._masterSteps + '步', py + 168);
  }

  // 本关步数数据（top: 214px）
  staggerIdx++;
  var myStepsAnim = _elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL);
  _drawDataText(myStepsAnim, this._steps + '步', py + 214);

  // 获得金币数据（top: 258px）— 带弹出动画
  staggerIdx++;
  var myGoldAnim = _elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL);
  var goldPopScale = this._getGoldNumPopScale();
  ctx.save();
  ctx.globalAlpha = myGoldAnim.alpha;
  if (goldPopScale !== 1) {
    // 以文本左边缘为锚点放大，保持对齐
    var goldTextX = dataX;
    var goldTextY = py + 258 + 6;
    ctx.translate(goldTextX, goldTextY);
    ctx.scale(goldPopScale, goldPopScale);
    ctx.translate(-goldTextX, -goldTextY);
  }
  // 金币呼吸中 → 金橙色 bold（颜色随呼吸强度渐变）；结束后 → 普通黑色
  var isBreathing = this._goldClaimed && this._goldNumPopActive;
  if (isBreathing) {
    var intensity = Math.min(1, Math.max(0, (goldPopScale - 1) / 0.5));
    ctx.fillStyle = 'rgb(255,' + Math.round(80 + 100 * intensity) + ',0)';
    ctx.font = 'bold 16px ' + Theme.font.family;
  } else {
    ctx.fillStyle = '#000000';
    ctx.font = '13px ' + Theme.font.family;
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('+' + (this._goldAmount || 0) + '币', dataX, py + 258 + 6);
  ctx.restore();

  // === 按钮（位置固定，样式同设置面板）===
  var CONT_BTN_W = 160;
  var CONT_BTN_H = 48;
  var CONT_BTN_X = px + pw - 78 - CONT_BTN_W;            // right: 78
  var CONT_BTN_Y = py + ph - 29 - CONT_BTN_H;            // bottom: 29

  var REPLAY_BTN_W = 45;
  var REPLAY_BTN_H = 45;
  var REPLAY_BTN_X = px + 66;                              // left: 66
  var REPLAY_BTN_Y = py + ph - 31 - REPLAY_BTN_H;        // bottom: 31

  var _renderContinueBtn = function (anim) {
    ctx.save();
    ctx.globalAlpha = anim.alpha;
    var cx = CONT_BTN_X + CONT_BTN_W / 2;
    var cy = CONT_BTN_Y + CONT_BTN_H / 2;
    ctx.translate(cx, cy);
    ctx.scale(anim.scale, anim.scale);
    ctx.translate(-cx, -cy);
    _drawContinueBtnBg(ctx, CONT_BTN_X, CONT_BTN_Y, CONT_BTN_W, CONT_BTN_H);

    // 文字 "继续游戏"（带阴影，同 SettingsPanel）
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '22px ' + Theme.font.family;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(3, 48, 75, 0.6)';
    ctx.shadowBlur = 2;
    ctx.fillText('继续游戏', cx, cy);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.restore();
  };

  var _renderReplayBtn = function (anim) {
    ctx.save();
    ctx.globalAlpha = anim.alpha;
    var cx = REPLAY_BTN_X + REPLAY_BTN_W / 2;
    var cy = REPLAY_BTN_Y + REPLAY_BTN_H / 2;
    ctx.translate(cx, cy);
    ctx.scale(anim.scale, anim.scale);
    ctx.translate(-cx, -cy);
    var img = AssetPreloader.get('btn_again');
    if (img && AssetPreloader.isReady('btn_again')) {
      ctx.drawImage(img, REPLAY_BTN_X, REPLAY_BTN_Y, REPLAY_BTN_W, REPLAY_BTN_H);
    }
    ctx.restore();
  };

  var rState = this._returnState;

  if (showGold) {
    // ── 有金币：继续(左) + 重玩(右)（双倍按钮已在上方 large button 区域绘制）──
    staggerIdx++;
    var contAnim = _elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL + 20);
    this._nextBtn = { x: CONT_BTN_X, y: CONT_BTN_Y, w: CONT_BTN_W, h: CONT_BTN_H };
    _renderContinueBtn(contAnim);

    staggerIdx++;
    var restAnim = _elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL + 20);
    this._restartBtn = { x: REPLAY_BTN_X, y: REPLAY_BTN_Y, w: REPLAY_BTN_W, h: REPLAY_BTN_H };
    _renderReplayBtn(restAnim);

    this._exitBtn = null;

  } else if (rState === 'menu') {
    // ── 无金币 menu：继续 + 重玩 ──
    this._exitBtn = null;
    this._doubleGoldBtn = null;
    staggerIdx++;
    var restAnim3 = _elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL + 20);
    this._restartBtn = { x: REPLAY_BTN_X, y: REPLAY_BTN_Y, w: REPLAY_BTN_W, h: REPLAY_BTN_H };
    _renderReplayBtn(restAnim3);
    staggerIdx++;
    var contAnim2 = _elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL + 40);
    this._nextBtn = { x: CONT_BTN_X, y: CONT_BTN_Y, w: CONT_BTN_W, h: CONT_BTN_H };
    _renderContinueBtn(contAnim2);
  } else if (rState === 'levelSelect') {
    // ── 无金币 levelSelect：重玩 + 继续 ──
    this._exitBtn = null;
    this._doubleGoldBtn = null;
    staggerIdx++;
    var restAnim2 = _elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL + 20);
    this._restartBtn = { x: REPLAY_BTN_X, y: REPLAY_BTN_Y, w: REPLAY_BTN_W, h: REPLAY_BTN_H };
    _renderReplayBtn(restAnim2);
    staggerIdx++;
    var contAnim3 = _elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL + 40);
    this._nextBtn = { x: CONT_BTN_X, y: CONT_BTN_Y, w: CONT_BTN_W, h: CONT_BTN_H };
    _renderContinueBtn(contAnim3);
  } else {
    // ── 编辑器返回 ──
    this._nextBtn = null;
    this._restartBtn = null;
    this._doubleGoldBtn = null;
    var exitBtnW = 100, exitBtnH = 42;
    var exitBtnX = (SCREEN_WIDTH - exitBtnW) / 2;
    var exitBtnY = CONT_BTN_Y + 3;
    staggerIdx++;
    var exitAnim = _elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL + 20);
    this._exitBtn = { x: exitBtnX, y: exitBtnY, w: exitBtnW, h: exitBtnH };
    var exitLabel = rState === 'editor' ? '返回编辑' : '退出';
    ctx.save();
    ctx.globalAlpha = exitAnim.alpha;
    var ecx = exitBtnX + exitBtnW / 2, ecy = exitBtnY + exitBtnH / 2;
    ctx.translate(ecx, ecy);
    ctx.scale(exitAnim.scale, exitAnim.scale);
    ctx.translate(-ecx, -ecy);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    var ebr = 8;
    ctx.beginPath();
    ctx.moveTo(exitBtnX + ebr, exitBtnY);
    ctx.lineTo(exitBtnX + exitBtnW - ebr, exitBtnY);
    ctx.arcTo(exitBtnX + exitBtnW, exitBtnY, exitBtnX + exitBtnW, exitBtnY + ebr, ebr);
    ctx.lineTo(exitBtnX + exitBtnW, exitBtnY + exitBtnH - ebr);
    ctx.arcTo(exitBtnX + exitBtnW, exitBtnY + exitBtnH, exitBtnX + exitBtnW - ebr, exitBtnY + exitBtnH, ebr);
    ctx.lineTo(exitBtnX + ebr, exitBtnY + exitBtnH);
    ctx.arcTo(exitBtnX, exitBtnY + exitBtnH, exitBtnX, exitBtnY + exitBtnH - ebr, ebr);
    ctx.lineTo(exitBtnX, exitBtnY + ebr);
    ctx.arcTo(exitBtnX, exitBtnY, exitBtnX + ebr, exitBtnY, ebr);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px ' + Theme.font.family;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(exitLabel, ecx, ecy);
    ctx.restore();
  }

  ctx.restore();
};

module.exports = VictoryPopup;
