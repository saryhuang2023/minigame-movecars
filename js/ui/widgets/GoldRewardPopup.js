// 通关金币奖励弹窗 — VictoryPopup 之后弹出
// 弹簧入场动画 + 错开内容显示 + 领取/双倍按钮
// BUILD: v3 — ES6 class extends UIComponent

var UIComponent = require('../base/UIComponent.js');
var Theme = require('../../define/GameDefine.js').THEME;
var Easing = require('../../core/Easing.js');
var { SCREEN_WIDTH, SCREEN_HEIGHT } = require('../../render.js');

class GoldRewardPopup extends UIComponent {
  /**
   * @param {Object} opts
   * @param {Function} opts.onClaim - 领取按钮回调 (amount)
   * @param {Function} opts.onDouble - 双倍按钮回调 (amount * 2)
   * @param {Function} opts.onSkip - 关闭弹窗（遮罩点击）
   */
  constructor(opts) {
    super({
      x: 0, y: 0,
      w: SCREEN_WIDTH, h: SCREEN_HEIGHT,
      zIndex: opts.zIndex || 4,
      visible: false,
    });

    this._closing = false;

    // 数据
    this._amount = 0;
    this._animStart = 0;
    this._animator = null;

    // 回调
    this.onClaim = opts.onClaim || function (amount) {};
    this.onDouble = opts.onDouble || function (amount) {};
    this.onSkip = opts.onSkip || function () {};

    // 按钮区域
    this._claimBtn = null;
    this._doubleBtn = null;

    // 压感
    this._btnPress = {};  // { 'claim': { scale, start }, 'double': { scale, start } }
  }

  // ── 动画器 ──

  setAnimator(animator) {
    this._animator = animator;
  }

  setData(data) {
    this._amount = data.amount || 0;
  }

  isOpen() {
    return this.visible && !this._closing;
  }

  isClosing() {
    return this._closing;
  }

  // ── 动画控制 ──

  open() {
    this.visible = true;
    this._closing = false;
    this._btnPress = {};
    if (this._animator) {
      this._animator.open();
      this._animStart = Date.now();
    }
  }

  close(cb) {
    this._closing = true;
    if (this._animator) {
      this._animator.close(function () {
        this.visible = false;
        if (cb) cb();
      }.bind(this));
    } else {
      this.visible = false;
      if (cb) cb();
    }
  }

  // ── 触控 ──

  handleTouch(type, x, y) {
    if (!this.visible || this._closing) return false;

    if (type === 'touchstart') {
      // 领取按钮
      if (this._claimBtn && x >= this._claimBtn.x && x <= this._claimBtn.x + this._claimBtn.w &&
          y >= this._claimBtn.y && y <= this._claimBtn.y + this._claimBtn.h) {
        this._startPress('claim');
        this.close();
        this.onClaim(this._amount);
        return true;
      }
      // 双倍按钮
      if (this._doubleBtn && x >= this._doubleBtn.x && x <= this._doubleBtn.x + this._doubleBtn.w &&
          y >= this._doubleBtn.y && y <= this._doubleBtn.y + this._doubleBtn.h) {
        this._startPress('double');
        this.close();
        this.onDouble(this._amount * 2);
        return true;
      }
      // 遮罩点击 → 跳过
      this.close();
      this.onSkip();
      return true;
    }

    if (type === 'touchend') {
      this._releaseAllPress();
      return true;
    }

    return false;
  }

  _startPress(key) {
    this._btnPress[key] = { scale: Theme.animation.pressScale, start: Date.now() };
  }

  _releaseAllPress() {
    var self = this;
    Object.keys(this._btnPress).forEach(function (k) {
      self._btnPress[k] = { scale: 1, start: 0 };
    });
  }

  _getPressScale(key, cx, cy) {
    var p = this._btnPress[key];
    if (!p) return 1;
    var elapsed = Date.now() - (p.start || 0);
    var dur = Theme.animation.releaseDuration;
    if (p.scale < 1) {
      var t = Math.min(1, elapsed / Theme.animation.pressDuration);
      return 1 - (1 - Theme.animation.pressScale) * t;
    }
    var t2 = Math.min(1, elapsed / dur);
    var s = Easing.spring(t2 * 3.5, 200, 11);
    return Theme.animation.pressScale + (1 - Theme.animation.pressScale) * s;
  }

  // ── 渲染 ──

  render(ctx) {
    if (!this.visible || !this._animator) return;

    var state = this._animator.update();
    if (this._closing && this._animator.isClosed()) return;

    var maskAlpha = state.maskAlpha;
    var panelScale = state.scale;
    var panelAlpha = state.alpha;
    if (panelAlpha < 0.01) return;

    // 遮罩
    ctx.fillStyle = 'rgba(0, 0, 0, ' + maskAlpha.toFixed(3) + ')';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    // ── 面板 ──
    var pw = 270;
    var ph = 200;
    var px = (SCREEN_WIDTH - pw) / 2;
    var py = (SCREEN_HEIGHT - ph) / 2 - 20;
    var pCenterX = px + pw / 2;
    var pCenterY = py + ph / 2;

    ctx.save();
    ctx.globalAlpha = panelAlpha;
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

    // ── 元素错开动画 ──
    var elapsed = Date.now() - this._animStart;
    var STAGGER_START = 80;
    var STAGGER_INTERVAL = 55;

    function elAnim(delayMs) {
      var t = Math.max(0, Math.min(1, (elapsed - delayMs) / 280));
      var s = Easing.spring(t * 3.5, 200, 11);
      return { alpha: s, scale: 0.6 + 0.4 * s };
    }

    var staggerIdx = 0;

    // 标题
    var titleAnim = elAnim(0);
    ctx.save();
    ctx.globalAlpha = titleAnim.alpha;
    var titleCX = SCREEN_WIDTH / 2;
    var titleCY = py + 46;
    ctx.translate(titleCX, titleCY);
    ctx.scale(titleAnim.scale, titleAnim.scale);
    ctx.translate(-titleCX, -titleCY);
    ctx.fillStyle = Theme.colors.gold;
    ctx.font = 'bold 22px ' + Theme.font.family;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('获得金币', titleCX, titleCY);
    ctx.restore();

    // 金币数字
    staggerIdx++;
    var amountAnim = elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL);
    ctx.save();
    ctx.globalAlpha = amountAnim.alpha;
    var coinCX = SCREEN_WIDTH / 2;
    var coinCY = py + 100;
    ctx.translate(coinCX, coinCY);
    ctx.scale(amountAnim.scale, amountAnim.scale);
    ctx.translate(-coinCX, -coinCY);

    // 金币图标
    var coinR = 20;
    ctx.beginPath();
    ctx.arc(coinCX - 35, coinCY, coinR, 0, Math.PI * 2);
    ctx.fillStyle = '#FFD700';
    ctx.fill();
    ctx.strokeStyle = '#FFA000';
    ctx.lineWidth = 2;
    ctx.stroke();
    // 金币上的 $ 符号
    ctx.fillStyle = '#B8860B';
    ctx.font = 'bold 14px ' + Theme.font.family;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('$', coinCX - 35, coinCY);

    // 金额
    ctx.fillStyle = '#FFF8E1';
    ctx.font = 'bold 32px ' + Theme.font.family;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('+' + this._amount, coinCX + 5, coinCY);
    ctx.restore();

    // ── 按钮 ──
    var btnY = py + ph - 56;
    var btnW = 100, btnH = 40;

    function renderBtn(x, y, w, h, anim, bgColor, text, textColor) {
      ctx.save();
      ctx.globalAlpha = anim.alpha;
      var cx = x + w / 2, cy = y + h / 2;
      ctx.translate(cx, cy);
      ctx.scale(anim.scale, anim.scale);
      ctx.translate(-cx, -cy);

      var br = 8;
      ctx.fillStyle = bgColor;
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

      ctx.fillStyle = textColor || '#fff';
      ctx.font = 'bold 15px ' + Theme.font.family;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, cx, cy);
      ctx.restore();
    }

    var gap = 20;
    var totalBW = btnW * 2 + gap;
    var btnStartX = (SCREEN_WIDTH - totalBW) / 2;

    // 领取按钮（左边，绿色）
    staggerIdx++;
    var claimAnim = elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL + 20);
    var claimX = btnStartX;
    this._claimBtn = { x: claimX, y: btnY, w: btnW, h: btnH };
    renderBtn(claimX, btnY, btnW, btnH, claimAnim, '#4CAF50', '领取');

    // 双倍按钮（右边，金色）
    staggerIdx++;
    var doubleAnim = elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL + 40);
    var doubleX = btnStartX + btnW + gap;
    this._doubleBtn = { x: doubleX, y: btnY, w: btnW, h: btnH };
    renderBtn(doubleX, btnY, btnW, btnH, doubleAnim, '#FF8F00', '双倍 x2', '#fff');

    ctx.restore();
  }
}

module.exports = GoldRewardPopup;
