// 右上角剩余步数组件 — 还原旧版 CrownPigWidget 的「步数」显示部分
// 奖杯系统已删除（2026-07-11），故不再绘制奖杯图标，只保留剩余步数底框 + 文字
// PlayingEngine 中使用，每帧 setData(threshold, steps) 同步

var UIComponent = require('../base/UIComponent.js');
var Theme = require('../../define/GameDefine.js').THEME;
var { SCREEN_WIDTH } = require('../../render.js');

// 布局常量（相对屏幕右上角，沿用旧版 CrownPigWidget 的 Figma 规格）
var STEP_BG_W = 90;
var STEP_BG_H = 32;
var STEP_BG_TOP = 90;
var STEP_BG_RIGHT = 16;
var STEP_BG_RADIUS = 30;
var STEP_TEXT_RIGHT = 25;

// 圆角矩形路径（兼容微信小游戏 canvas，不用 ctx.roundRect）
function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, Math.floor(w / 2), Math.floor(h / 2));
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

class RightStepWidget extends UIComponent {
  constructor(opts) {
    super({
      x: 0, y: 0,
      w: STEP_BG_W, h: STEP_BG_H,
      zIndex: opts.zIndex || 1,
      visible: true,
    });

    // 数据
    this._threshold = 0;   // 步数预算（原 crownSteps / 现 stepBonusThreshold）
    this._steps = 0;
    this._hidden = false;

    // 呼吸动画（还原旧版触感）
    this._breatheStart = 0;
    this._breatheActive = false;
    this._BREATHE_DURATION = 400;
    this._BREATHE_AMPLITUDE = 0.26;
  }

  setData(threshold, steps) {
    this._threshold = threshold || 0;
    this._steps = steps || 0;
  }

  setHidden(hidden) {
    this._hidden = !!hidden;
  }

  /** 触发呼吸动画（单次缓慢呼吸，纯 UI 反馈） */
  triggerBreathe() {
    this._breatheStart = Date.now();
    this._breatheActive = true;
  }

  /** 获取当前呼吸缩放值 */
  _getBreatheScale() {
    if (!this._breatheActive) return 1;
    var elapsed = Date.now() - this._breatheStart;
    if (elapsed >= this._BREATHE_DURATION) {
      this._breatheActive = false;
      return 1;
    }
    var t = elapsed / this._BREATHE_DURATION;
    var pulse = Math.abs(Math.sin(t * Math.PI));
    return 1 + pulse * this._BREATHE_AMPLITUDE;
  }

  render(ctx) {
    if (this._hidden) return;

    var hasThreshold = this._threshold > 0;
    if (!hasThreshold) return;  // 没有配置阈值 → 功能未开放，完全不绘制

    // 固定位置（右上角）
    var bgX = SCREEN_WIDTH - STEP_BG_W - STEP_BG_RIGHT;
    var bgY = STEP_BG_TOP;

    // 呼吸动画缩放（围绕底框中心）
    var breathScale = this._getBreatheScale();
    var cx = bgX + STEP_BG_W / 2;
    var cy = bgY + STEP_BG_H / 2;

    ctx.save();
    if (breathScale !== 1) {
      ctx.translate(cx, cy);
      ctx.scale(breathScale, breathScale);
      ctx.translate(-cx, -cy);
    }

    // === 步数底框（圆角 30px，半透黑底）===
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    roundRect(ctx, bgX, bgY, STEP_BG_W, STEP_BG_H, STEP_BG_RADIUS);
    ctx.fill();

    // === 步数文字「剩N步」===
    var remaining = this._threshold - this._steps;
    if (remaining < 0) remaining = 0;
    var text = '剩' + remaining + '步';
    ctx.font = '16px ' + Theme.font.family;
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    var textX = SCREEN_WIDTH - STEP_TEXT_RIGHT;
    var textY = STEP_BG_TOP + STEP_BG_H / 2;
    ctx.fillText(text, textX, textY);

    ctx.restore();
  }
}

module.exports = RightStepWidget;
