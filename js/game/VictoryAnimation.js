// 通关飞行特效动画 — 奖杯飞入 + 关主头像飞入
// 自管理状态机和 Canvas 渲染，PlayingEngine 通过回调感知阶段完成

const audio = require('../audio/AudioManager.js');
const Easing = require('../core/Easing.js');

const FLY_DURATION = 1500;   // 飞行阶段时长 ms
const FLASH_DURATION = 800;  // 闪烁阶段时长 ms

// 奖杯目标位置（与 CrownPigWidget 对齐）
const TROPHY_SIZE = 36;
const TROPHY_TOP = 84;
const TROPHY_RIGHT = 20;
const TROPHY_IMG = 'assets/sceen/0/leftStep_1.png';

class VictoryAnimation {
  /**
   * @param {Object} options
   * @param {Function} options.onCrownDone - 奖杯动画完成回调
   * @param {Function} options.onMasterDone - 关主动画完成回调
   */
  constructor(options) {
    this._onCrownDone = options.onCrownDone || function () {};
    this._onMasterDone = options.onMasterDone || function () {};

    // 布局（由 PlayingEngine 每帧 setLayout 更新）
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
    this._crownPhase = null;   // null | 'flying' | 'flashing' | 'done'
    this._crownStart = 0;
    this._crownFromX = 0;
    this._crownFromY = 0;
    this._gotCrown = false;

    // Master state
    this._masterPhase = null;  // null | 'flying' | 'flashing' | 'done'
    this._masterStart = 0;
    this._masterFromX = 0;
    this._masterFromY = 0;
    this._masterAvatarImg = null;
  }

  // ------------------------------------------------------------------
  // 布局
  // ------------------------------------------------------------------

  setLayout(boardCardX, boardCardY, boardCardW, screenW, screenH) {
    this._boardCardX = boardCardX;
    this._boardCardY = boardCardY;
    this._boardCardW = boardCardW;
    this._screenW = screenW;
    this._screenH = screenH;
  }

  // ------------------------------------------------------------------
  // 生命周期
  // ------------------------------------------------------------------

  reset() {
    this._crownPhase = null;
    this._crownStart = 0;
    this._gotCrown = false;
    this._masterPhase = null;
    this._masterStart = 0;
    this._masterAvatarImg = null;
  }

  /** 奖杯飞行：起点 → 棋盘卡片右上角 */
  startCrown(fromX, fromY) {
    this._crownPhase = 'flying';
    this._crownStart = Date.now();
    this._crownFromX = fromX;
    this._crownFromY = fromY;
    audio.play('rewards');
  }

  /** 关主头像飞行：起点 → 左下角关主徽章 */
  startMaster(fromX, fromY, avatarImg) {
    this._masterPhase = 'flying';
    this._masterStart = Date.now();
    this._masterFromX = fromX;
    this._masterFromY = fromY;
    this._masterAvatarImg = avatarImg;
    audio.play('rewards');
  }

  // ------------------------------------------------------------------
  // 每帧
  // ------------------------------------------------------------------

  update() {
    this._updateCrown();
    this._updateMaster();
  }

  /** 渲染飞行特效（应在棋盘/卡片之上、顶栏/底栏之下调用） */
  render(ctx) {
    this._renderFlyingPig(ctx);
    this._renderFlyingMaster(ctx);
  }

  // ------------------------------------------------------------------
  // 状态查询
  // ------------------------------------------------------------------

  /** 是否获得了奖杯（动画完成后变 true） */
  gotCrown() { return this._gotCrown; }

  /** 奖杯动画是否已完成 */
  isCrownDone() { return this._crownPhase === 'done'; }

  /** 关主动画是否已完成 */
  isMasterDone() { return this._masterPhase === 'done'; }

  /** 全部动画是否已完成 */
  isAllDone() { return this.isCrownDone() && this.isMasterDone(); }

  /** 是否有飞行动画在播 */
  isActive() {
    return this._crownPhase === 'flying' || this._masterPhase === 'flying';
  }

  // ------------------------------------------------------------------
  // 内部 — Crown
  // ------------------------------------------------------------------

  _updateCrown() {
    if (!this._crownPhase || this._crownPhase === 'done') return;

    var elapsed = Date.now() - this._crownStart;

    if (this._crownPhase === 'flying') {
      if (elapsed >= FLY_DURATION) {
        this._crownPhase = 'flashing';
        this._crownStart = Date.now();
      }
      return;
    }

    if (this._crownPhase === 'flashing') {
      if (elapsed >= FLASH_DURATION) {
        this._crownPhase = 'done';
        this._gotCrown = true;
        this._crownStart = 0;
        this._onCrownDone();
      }
    }
  }

  _renderFlyingPig(ctx) {
    if (this._crownPhase !== 'flying') return;
    if (!this._trophyLoaded) return;

    var t = Math.min((Date.now() - this._crownStart) / FLY_DURATION, 1);
    t = Easing.easeOutCubic(t);

    var startX = this._crownFromX;
    var startY = this._crownFromY;
    // 目标：右上角奖杯中心位置（与 CrownPigWidget 对齐）
    var targetX = this._screenW - TROPHY_SIZE / 2 - TROPHY_RIGHT;
    var targetY = TROPHY_TOP + TROPHY_SIZE / 2;

    // 二次贝塞尔弧线
    var cpX = (startX + targetX) / 2;
    var cpY = Math.min(startY, targetY) - 80;
    var t1 = 1 - t;
    var fx = t1 * t1 * startX + 2 * t1 * t * cpX + t * t * targetX;
    var fy = t1 * t1 * startY + 2 * t1 * t * cpY + t * t * targetY;

    // 从 60 → 36 渐缩到目标尺寸
    var scale = 60 + (TROPHY_SIZE - 60) * t;
    ctx.drawImage(this._trophyImg, fx - scale / 2, fy - scale / 2, scale, scale);
  }

  // ------------------------------------------------------------------
  // 内部 — Master
  // ------------------------------------------------------------------

  _updateMaster() {
    if (!this._masterPhase || this._masterPhase === 'done') return;

    var elapsed = Date.now() - this._masterStart;

    if (this._masterPhase === 'flying') {
      if (elapsed >= FLY_DURATION) {
        this._masterPhase = 'flashing';
        this._masterStart = Date.now();
      }
      return;
    }

    if (this._masterPhase === 'flashing') {
      if (elapsed >= FLASH_DURATION) {
        this._masterPhase = 'done';
        this._masterStart = 0;
        this._onMasterDone();
      }
    }
  }

  _renderFlyingMaster(ctx) {
    if (this._masterPhase !== 'flying') return;
    if (!this._masterAvatarImg) return;

    var t = Math.min((Date.now() - this._masterStart) / FLY_DURATION, 1);
    t = Easing.easeOutCubic(t);

    var startX = this._masterFromX;
    var startY = this._masterFromY;
    // 目标：左下角关主头像中心（left:40 bottom:43, 33×33）
    var targetX = 40 + 33 / 2;
    var targetY = this._screenH - 43 - 33 / 2;

    var cpX = (startX + targetX) / 2;
    var cpY = Math.min(startY, targetY) - 80;
    var t1 = 1 - t;
    var fx = t1 * t1 * startX + 2 * t1 * t * cpX + t * t * targetX;
    var fy = t1 * t1 * startY + 2 * t1 * t * cpY + t * t * targetY;

    // 从 60 → 33 渐缩到目标尺寸
    var scale = 60 + (33 - 60) * t;

    ctx.save();
    ctx.beginPath();
    ctx.arc(fx, fy, scale / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(this._masterAvatarImg, fx - scale / 2, fy - scale / 2, scale, scale);
    ctx.restore();
  }
}

module.exports = VictoryAnimation;
