// 关主面板 — 左下角显示关主信息 + 我的记录 + 当前步数
// PlayingEngine 专用
// v123: 背景图替代手绘，只保留文字

var UIComponent = require('../base/UIComponent.js');
var Theme = require('../../define/GameDefine.js').THEME;
var { SCREEN_WIDTH, SCREEN_HEIGHT } = require('../../render.js');

var MUTED = Theme.colors.muted;

// 不跟随场景变化
var MASTER_BG = 'assets/images/levels/master_bg.png';

// 卡片尺寸（由背景图决定）
var CARD_W = 190;
var CARD_H = 92;
var CARD_X = 15;
var CARD_Y = SCREEN_HEIGHT - CARD_H - 22;

/**
 * @param {Object} opts
 */
function MasterPanel(opts) {
  UIComponent.call(this, {
    x: CARD_X,
    y: CARD_Y,
    w: CARD_W,
    h: CARD_H,
    zIndex: opts.zIndex || 1,
  });

  // 数据
  this._master = null;        // { userId, steps, avatarUrl, nickname }
  this._myRecord = null;      // number | null
  this._currentSteps = 0;
  this._loading = true;

  // 背景图
  var self = this;
  this._bgImg = wx.createImage();
  this._bgLoaded = false;
  this._bgImg.onload = function () {
    self._bgLoaded = true;
  };
  this._bgImg.src = MASTER_BG;

  // 头像 Image 对象（保留，供 VictoryAnimation 等外部查询）
  this._avatarImg = null;
  this._avatarLoaded = false;

  // 回调
  this.onAvatarClick = opts.onAvatarClick || null;

  // 可见性由引擎控制
  this._hiddenByTrial = false;

  // 呼吸动画
  this._breatheStart = 0;
  this._breatheActive = false;
  this._BREATHE_DURATION = 400;   // 单次呼吸时长 ms
  this._BREATHE_AMPLITUDE = 0.26; // 比普通按钮(0.06)更大
  this._BREATHE_PULSES = 1;
}

MasterPanel.prototype = Object.create(UIComponent.prototype);
MasterPanel.prototype.constructor = MasterPanel;

MasterPanel.prototype.setData = function (master, myRecord, currentSteps, loading) {
  this._master = master || null;
  this._myRecord = myRecord != null ? myRecord : null;
  this._currentSteps = currentSteps || 0;
  this._loading = !!loading;
};

MasterPanel.prototype.setAvatar = function (img) {
  this._avatarImg = img;
  this._avatarLoaded = img && img.complete;
};

/** 设置当前用户 openid（用于判断"我是关主"） */
MasterPanel.prototype.setMyUserId = function (userId) {
  this._myUserId = userId || null;
};

MasterPanel.prototype.setHiddenByTrial = function (hidden) {
  this._hiddenByTrial = !!hidden;
};

/** 触发呼吸动画（3 次脉冲，纯 UI 反馈） */
MasterPanel.prototype.triggerBreathe = function () {
  this._breatheStart = Date.now();
  this._breatheActive = true;
};

/** 获取当前呼吸缩放值 */
MasterPanel.prototype._getBreatheScale = function () {
  if (!this._breatheActive) return 1;

  var elapsed = Date.now() - this._breatheStart;
  if (elapsed >= this._BREATHE_DURATION) {
    this._breatheActive = false;
    return 1;
  }

  // |sin(t * PULSES * PI)| — 单次缓慢的半正弦脉冲，始终 >= 0
  var t = elapsed / this._BREATHE_DURATION;
  var pulse = Math.abs(Math.sin(t * this._BREATHE_PULSES * Math.PI));
  return 1 + pulse * this._BREATHE_AMPLITUDE;
};

MasterPanel.prototype.render = function (ctx) {
  if (this._hiddenByTrial) return;
  if (this._loading)  return;

  // 呼吸动画缩放（围绕卡片中心）
  var breathScale = this._getBreatheScale();
  var cx = CARD_X + CARD_W / 2;
  var cy = CARD_Y + CARD_H / 2;

  ctx.save();
  if (breathScale !== 1) {
    ctx.translate(cx, cy);
    ctx.scale(breathScale, breathScale);
    ctx.translate(-cx, -cy);
  }

  // ===== 背景图 =====
  if (this._bgLoaded) {
    ctx.drawImage(this._bgImg, CARD_X, CARD_Y, CARD_W, CARD_H);
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#000000';

  // ===== 左栏：关主 =====
  // 头像（圆形裁剪，屏幕绝对定位 left:40 bottom:43 33×33）
  if (this._master && this._avatarLoaded && this._avatarImg) {
    var avatarSize = 33;
    var avatarCenterX = 40 + avatarSize / 2;
    var avatarCenterY = SCREEN_HEIGHT - 43 - avatarSize / 2;
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarCenterX, avatarCenterY, avatarSize / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(this._avatarImg, avatarCenterX - avatarSize / 2, avatarCenterY - avatarSize / 2, avatarSize, avatarSize);
    ctx.restore();
    // 点击区域（供 PlayingEngine 外部使用）
    this._avatarRect = {
      x: avatarCenterX - avatarSize / 2,
      y: avatarCenterY - avatarSize / 2,
      w: avatarSize,
      h: avatarSize,
    };
  } else {
    this._avatarRect = null;
  }

  // 关主标签
  ctx.font = '12px ' + Theme.font.family;
  ctx.fillText('关主记录', CARD_X + 14, CARD_Y + 17);

  // 关主步数（纯文字，无背景药丸）
  var stepsText = "暂无";
  if (this._master && this._master.masterSteps) {
    stepsText = '' + this._master.masterSteps + '步';
  }
  ctx.font = '11px ' + Theme.font.family;
  ctx.fillText(stepsText, CARD_X+29, CARD_Y+69);

  // 我的记录
  ctx.font = '13px ' + Theme.font.family;
  ctx.fillText('我的', CARD_X+90, CARD_Y+31);

  ctx.font = '16px ' + Theme.font.family;
  ctx.fillText('' + (this._myRecord != null ? this._myRecord : '无'), CARD_X+131, CARD_Y+29);

  // 当前步数
  ctx.font = '13px ' + Theme.font.family;
  ctx.fillText('当前步数  ' + this._currentSteps,  CARD_X+90, CARD_Y+56);

  ctx.restore(); // 呼吸动画 restore
};

module.exports = MasterPanel;
