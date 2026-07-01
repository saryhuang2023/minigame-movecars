// 通关飞行特效动画 — 中央亮相 → 吸入目的地
// 自管理状态机和 Canvas 渲染，PlayingEngine 通过回调感知阶段完成

const audio = require('../audio/AudioManager.js');
const Easing = require('../core/Easing.js');

const GROW_DURATION = 1600;   // 0→1.2x 缩放 ms
const HOLD_DURATION = 1000;   // 1.2x 停留 ms
const SUCK_DURATION = 530;    // 吸入目的地 ms (原 800，缩短 1/3)
const MAX_SCALE = 1.2;        // 中央亮相最大缩放

// 奖杯目标位置（与 CrownPigWidget 对齐）
const TROPHY_SIZE = 44;
const TROPHY_TOP = 70;
const TROPHY_RIGHT = 20;
const TROPHY_IMG = 'assets/images/levels/leftStep_1.png';

// 关主头像目标位置（左下角 MasterPanel）
const AVATAR_SIZE = 33;
const AVATAR_LEFT = 40;
const AVATAR_BOTTOM = 43;

// 双元素并排间距
const DUAL_GAP = 50;
// 中央亮相时尺寸
const SHOW_TROPHY_SIZE = 88;
const SHOW_AVATAR_SIZE = 66;

function VictoryAnimation(options) {
  this._onCrownDone = options.onCrownDone || function () {};
  this._onMasterDone = options.onMasterDone || function () {};

  this._boardCardX = 0;
  this._boardCardY = 0;
  this._boardCardW = 0;
  this._screenW = 0;
  this._screenH = 0;

  // 奖杯图片
  this._trophyImg = wx.createImage();
  this._trophyLoaded = false;
  var self = this;
  this._trophyImg.onload = function () { self._trophyLoaded = true; };
  this._trophyImg.src = TROPHY_IMG;

  // Crown state
  this._crownPhase = null;   // null | 'grow' | 'hold' | 'suck' | 'done'
  this._crownStart = 0;
  this._crownFromX = 0;
  this._crownFromY = 0;
  this._gotCrown = false;

  // Master state
  this._masterPhase = null;  // null | 'grow' | 'hold' | 'suck' | 'done'
  this._masterStart = 0;
  this._masterAvatarImg = null;
}

// ---- 布局 ----
VictoryAnimation.prototype.setLayout = function (boardCardX, boardCardY, boardCardW, screenW, screenH) {
  this._boardCardX = boardCardX;
  this._boardCardY = boardCardY;
  this._boardCardW = boardCardW;
  this._screenW = screenW;
  this._screenH = screenH;
};

// ---- 生命周期 ----
VictoryAnimation.prototype.reset = function () {
  this._crownPhase = null;
  this._crownStart = 0;
  this._gotCrown = false;
  this._masterPhase = null;
  this._masterStart = 0;
  this._masterAvatarImg = null;
};

/** 启动奖杯动画（用于测试） */
VictoryAnimation.prototype.startCrown = function () {
  this._crownPhase = 'grow';
  this._crownStart = Date.now();
  audio.play('rewards');
};

/** 关主头像动画 */
VictoryAnimation.prototype.startMaster = function (avatarImg) {
  this._masterPhase = 'grow';
  this._masterStart = Date.now();
  this._masterAvatarImg = avatarImg;
  audio.play('rewards');
};

// ---- 每帧 ----
VictoryAnimation.prototype.update = function () {
  this._updateElement('crown');
  this._updateElement('master');
};

VictoryAnimation.prototype._updateElement = function (type) {
  var phaseKey = type === 'crown' ? '_crownPhase' : '_masterPhase';
  var startKey = type === 'crown' ? '_crownStart' : '_masterStart';
  var doneCb = type === 'crown' ? this._onCrownDone : this._onMasterDone;
  var phase = this[phaseKey];
  if (!phase || phase === 'done') return;
  var elapsed = Date.now() - this[startKey];

  if (phase === 'grow') {
    if (elapsed >= GROW_DURATION) {
      this[phaseKey] = 'hold';
      this[startKey] = Date.now();
    }
  } else if (phase === 'hold') {
    if (elapsed >= HOLD_DURATION) {
      this[phaseKey] = 'suck';
      this[startKey] = Date.now();
    }
  } else if (phase === 'suck') {
    if (elapsed >= SUCK_DURATION) {
      this[phaseKey] = 'done';
      this[startKey] = 0;
      if (type === 'crown') this._gotCrown = true;
      console.log('[LOG_victory] ' + (type === 'crown' ? '奖杯' : '关主') + '动画完成');
      doneCb.call(this);
    }
  }
};

VictoryAnimation.prototype.render = function (ctx) {
  var hasCrown = this._crownPhase && this._crownPhase !== 'done';
  var hasMaster = this._masterPhase && this._masterPhase !== 'done';
  if (!hasCrown && !hasMaster) return;

  // 背景压暗
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(0, 0, this._screenW, this._screenH);
  ctx.restore();

  if (hasCrown) this._renderElement(ctx, 'crown');
  if (hasMaster) this._renderElement(ctx, 'master');
};

VictoryAnimation.prototype._renderElement = function (ctx, type) {
  var phase = type === 'crown' ? this._crownPhase : this._masterPhase;
  var start = type === 'crown' ? this._crownStart : this._masterStart;
  var elapsed = Date.now() - start;
  var isTrophy = type === 'crown';
  var img = isTrophy ? this._trophyImg : this._masterAvatarImg;
  if (!img || (isTrophy && !this._trophyLoaded)) return;

  // 目标位置
  var targetX, targetY, targetSize;
  if (isTrophy) {
    targetSize = TROPHY_SIZE;
    targetX = this._screenW - targetSize / 2 - TROPHY_RIGHT;
    targetY = TROPHY_TOP + targetSize / 2;
  } else {
    targetSize = AVATAR_SIZE;
    targetX = AVATAR_LEFT + targetSize / 2;
    targetY = this._screenH - AVATAR_BOTTOM - targetSize / 2;
  }

  // 中央位置（自动检测有几个元素在播）
  var hasCrown = this._crownPhase && this._crownPhase !== 'done';
  var hasMaster = this._masterPhase && this._masterPhase !== 'done';
  var dualMode = hasCrown && hasMaster;
  var showSize = isTrophy ? SHOW_TROPHY_SIZE : SHOW_AVATAR_SIZE;
  var centerX, centerY = this._screenH / 2;
  if (dualMode) {
    // 边缘间距 DUAL_GAP：头像左，奖杯右
    var totalW = SHOW_AVATAR_SIZE + DUAL_GAP + SHOW_TROPHY_SIZE;
    if (isTrophy) {
      centerX = this._screenW / 2 + totalW / 2 - SHOW_TROPHY_SIZE / 2;
    } else {
      centerX = this._screenW / 2 - totalW / 2 + SHOW_AVATAR_SIZE / 2;
    }
  } else {
    centerX = this._screenW / 2;
  }

  var fx, fy, scale;

  if (phase === 'grow') {
    // 0 → MAX_SCALE, easeOutBack
    var t = Math.min(elapsed / GROW_DURATION, 1);
    scale = Easing.easeOutBack(t, 1.5) * MAX_SCALE;
    fx = centerX;
    fy = centerY;
  } else if (phase === 'hold') {
    // 保持 MAX_SCALE
    scale = MAX_SCALE;
    fx = centerX;
    fy = centerY;
  } else if (phase === 'suck') {
    // 吸入目标：center → target, easeInCubic
    var st = Math.min(elapsed / SUCK_DURATION, 1);
    var t2 = Easing.easeInCubic(st);
    fx = centerX + (targetX - centerX) * t2;
    fy = centerY + (targetY - centerY) * t2;
    scale = MAX_SCALE + (targetSize / showSize - MAX_SCALE) * t2;
  }

  var size = showSize * scale;

  ctx.save();
  if (!isTrophy) {
    // 头像圆形裁剪
    ctx.beginPath();
    ctx.arc(fx, fy, size / 2, 0, Math.PI * 2);
    ctx.clip();
  }
  ctx.drawImage(img, fx - size / 2, fy - size / 2, size, size);
  ctx.restore();
};

// ---- 状态查询 ----
VictoryAnimation.prototype.gotCrown = function () { return this._gotCrown; };
VictoryAnimation.prototype.isCrownDone = function () { return this._crownPhase === 'done'; };
VictoryAnimation.prototype.isMasterDone = function () { return this._masterPhase === 'done'; };
VictoryAnimation.prototype.isAllDone = function () { return this.isCrownDone() && this.isMasterDone(); };
VictoryAnimation.prototype.isActive = function () {
  return (this._crownPhase && this._crownPhase !== 'done') ||
         (this._masterPhase && this._masterPhase !== 'done');
};

module.exports = VictoryAnimation;
