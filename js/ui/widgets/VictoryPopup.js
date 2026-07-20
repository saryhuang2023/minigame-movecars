// 通关结算弹窗 — PlayingEngine 通关后弹出
// 弹簧入场动画 + 内容错开显示 + 内嵌金币奖励/双倍按钮

var UIComponent = require('../base/UIComponent.js');
var Theme = require('../../define/GameDefine.js').THEME;
var Easing = require('../../core/Easing.js');
var AssetPreloader = require('../AssetPreloader.js');
var audio = require('../../audio/AudioManager.js');
var CommonButton = require('./CommonButton.js');
var { SCREEN_WIDTH, SCREEN_HEIGHT } = require('../../render.js');
var { drawAdBadge } = require('../drawAdBadge.js');

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
class VictoryPopup extends UIComponent {
  constructor(opts) {
  super({
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

  // 通用按钮
  this._continueBtn = new CommonButton({ w: 160, h: 48, color: 'blue' });
  this._doubleGoldCommonBtn = new CommonButton({ w: 208, h: 54, color: 'gold', label: '金币X2' });

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

  // 金币数字翻滚动画（结算时从 0 滚到目标值，双倍时从旧值滚到新值）
  this._goldRollStart = 0;
  this._goldRollFrom = 0;
  this._goldRollTo = 0;
  this._goldRolling = false;
  this._goldRollTriggered = false;  // 一次性标记（只自动触第一次）
  this._goldRollSoundLast = 0;
  this._GOLD_ROLL_DURATION = 500;        // ms
  this._GOLD_ROLL_SOUND_INTERVAL = 100;  // ms 循环播放 coin_roll

}
}


VictoryPopup.prototype.setAnimator = function (animator) {
  this._animator = animator;
};

VictoryPopup.prototype.setData = function (data) {
  this._steps = data.steps || 0;
  this._returnState = data.returnState || 'menu';
  // 双倍金币已领取 → 标记 _goldClaimed，阻止 _syncUIData 回写旧值打断翻滚
  if (!this._goldClaimed) {
    this._goldAmount = data.goldAmount || 0;
  }
  this._showGold = !!data.showGold;
};

VictoryPopup.prototype.open = function () {
  this.visible = true;
  this._closing = false;
  this._goldClaimed = false;
  this._goldBtnBreatheActive = false;
  this._goldRolling = false;
  this._goldRollTriggered = false;
  this._animStart = Date.now();
  if (this._animator) {
    this._animator.open();
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

/** 标记双倍金币已领取 — 按钮灰化，金额翻倍，触发翻滚动画 */
VictoryPopup.prototype.markGoldClaimed = function () {
  var oldGold = this._goldAmount;
  this._goldClaimed = true;
  this._goldAmount *= 2;
  this.triggerGoldBtnBreathe();
  this.startGoldRoll(oldGold, this._goldAmount);
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

/** 启动金币数字翻滚：从 from 滚到 to（500ms easeOutBack） */
VictoryPopup.prototype.startGoldRoll = function (from, to) {
  if (from >= to) return;
  this._goldRollStart = Date.now();
  this._goldRollFrom = from;
  this._goldRollTo = to;
  this._goldRolling = true;
  this._goldRollTriggered = true;
  this._goldRollSoundLast = 0;
};

/** 获取当前翻滚中的显示数字（easeOutBack 插值） */
VictoryPopup.prototype._getRollDisplayGold = function () {
  if (!this._goldRolling) return this._goldAmount;
  var elapsed = Date.now() - this._goldRollStart;
  if (elapsed >= this._GOLD_ROLL_DURATION) {
    this._goldRolling = false;
    return this._goldRollTo;
  }
  var t = elapsed / this._GOLD_ROLL_DURATION;
  var eased = Easing.easeOutBack(t, 1.70158);
  var val = this._goldRollFrom + (this._goldRollTo - this._goldRollFrom) * eased;
  return Math.round(val);
};

VictoryPopup.prototype.render = function (ctx) {
  if (!this.visible) return;
  if (!this._animator) return;

  var state = this._animator.update();

  // 首帧 / 新一轮弹窗：从共享 animator 同步打开时间，并重置单次状态
  var openStartTime = this._animator.getOpenStartTime();
  if (openStartTime > 0 && this._animStart !== openStartTime) {
    this._animStart = openStartTime;
    this._goldClaimed = false;
    this._goldRollTriggered = false;
    this._goldRolling = false;
  }

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
  if (AssetPreloader.isReady('level_victory_bg')) {
    ctx.drawImage(AssetPreloader.get('level_victory_bg'), px, py, pw, ph);
  }

  // === 双倍金币按钮（有金币且未领取时才显示）===
  if (showGold && !this._goldClaimed) {
    var goldBtnW = 208, goldBtnH = 54;
    var goldBtnX = px + (pw - goldBtnW) / 2 - 0.5;
    var goldBtnY = py + ph + 12;

    // 呼吸动画缩放
    var breatheScale = this._getGoldBtnBreatheScale();
    if (breatheScale !== 1) {
      var goldCenterX = goldBtnX + goldBtnW / 2;
      var goldCenterY = goldBtnY + goldBtnH / 2;
      ctx.save();
      ctx.translate(goldCenterX, goldCenterY);
      ctx.scale(breatheScale, breatheScale);
      ctx.translate(-goldCenterX, -goldCenterY);
    }

    // 设置点击区域
    this._doubleGoldBtn = { x: goldBtnX, y: goldBtnY, w: goldBtnW, h: goldBtnH };

    // 通用按钮（gold，右上角统一广告角标替代旧 ad_icon.png）
    this._doubleGoldCommonBtn.x = goldBtnX;
    this._doubleGoldCommonBtn.y = goldBtnY;
    this._doubleGoldCommonBtn.w = goldBtnW;
    this._doubleGoldCommonBtn.h = goldBtnH;
    this._doubleGoldCommonBtn.render(ctx);
    drawAdBadge(ctx, goldBtnX + goldBtnW - 14, goldBtnY + 14, 11);

    if (breatheScale !== 1) ctx.restore();
  } else {
    this._doubleGoldBtn = null;
  }

  // === 所有元素一次性显示，无错开动画 ===
  var _elAnim = function () {
    return { alpha: 1, scale: 1 };
  };

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

  // 蓝 — 本关步数
  var blueBadgeAnim = _elAnim();
  _drawBadge(blueBadgeAnim, badgeX, py + 207, '#83DEFF');

  // 黄 — 获得金币
  var goldBadgeAnim = _elAnim();
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

  // 金币
  var coinIconAnim = _elAnim();
  _drawIcon(coinIconAnim, 'coin', iconX, py + 249);

  // 本关步数（标签）
  var stepsAnim = _elAnim();
  _drawInfoText(stepsAnim, '本关步数', infoX, py + 207);

  // 获得金币（标签）
  var goldTextAnim = _elAnim();
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

  // 本关步数数据（top: 214px）
  var myStepsAnim = _elAnim();
  _drawDataText(myStepsAnim, this._steps + '步', py + 214);

  // 获得金币数据（top: 212px）— 双击双倍时翻滚，否则静态 +N
  var myGoldAnim = _elAnim();

  // 双倍翻滚中循环播放 coin_roll 音效
  if (this._goldRolling) {
    var rollElapsed = Date.now() - this._goldRollStart;
    if (rollElapsed - this._goldRollSoundLast >= this._GOLD_ROLL_SOUND_INTERVAL) {
      audio.play('coin_roll');
      this._goldRollSoundLast = rollElapsed;
    }
  }

  var displayGold = this._getRollDisplayGold();
  ctx.save();
  ctx.globalAlpha = myGoldAnim.alpha;
  ctx.fillStyle = '#000000';
  ctx.font = '13px ' + Theme.font.family;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('+' + displayGold + '币', dataX, py + 258 + 6);
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

  var _renderContinueBtn = (anim) => {
    ctx.save();
    ctx.globalAlpha = anim.alpha;
    var cx = CONT_BTN_X + CONT_BTN_W / 2;
    var cy = CONT_BTN_Y + CONT_BTN_H / 2;
    ctx.translate(cx, cy);
    ctx.scale(anim.scale, anim.scale);
    ctx.translate(-cx, -cy);
    this._continueBtn.x = CONT_BTN_X;
    this._continueBtn.y = CONT_BTN_Y;
    this._continueBtn.render(ctx);
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

  // ── 统一绘制：无论试玩/正式、有无金币，结算面板按钮布局完全一致 ──
  // 始终绘制「返回」(右) + 「重玩」(左)；双倍金币按钮仅由 showGold 控制（上方已处理）。
  // 试玩与正式的差异只在点击时分流（onContinue / onReplay 回调按 returnState 判断），
  // 绘制层不区分，保证视觉一致。

  // 重玩按钮（左）
  var restAnim = _elAnim();
  this._restartBtn = { x: REPLAY_BTN_X, y: REPLAY_BTN_Y, w: REPLAY_BTN_W, h: REPLAY_BTN_H };
  _renderReplayBtn(restAnim);

  // 返回按钮（右）：试玩/正式统一文案「返回」，不区分模式
  var contAnim = _elAnim();
  this._nextBtn = { x: CONT_BTN_X, y: CONT_BTN_Y, w: CONT_BTN_W, h: CONT_BTN_H };
  this._continueBtn.label = '返回';
  _renderContinueBtn(contAnim);

  // 旧 _exitBtn 已并入 _nextBtn，不再单独维护
  this._exitBtn = null;

  ctx.restore();
};

module.exports = VictoryPopup;
