// 全局 Toast 替代组件 — 轻量、时间驱动、不拦截触摸
// 风格（按用户 CSS）：黑底半透明胶囊 + 15px 白字居中
// 动画：快速淡入(180ms) → 短暂停留 → 缓慢上移并淡出(450ms, 上移 ~22px)
// 既可由 GameEngine 直接 render，也可经全局 showToast(text) 从任意模块调用

const UIComponent = require('../base/UIComponent.js');
const Theme = require('../../define/GameDefine.js').THEME;
const { SCREEN_WIDTH, SCREEN_HEIGHT } = require('../../render.js');

// 阶段时长（毫秒）
const FADE_IN = 180;
const FADE_OUT = 450;
const DEFAULT_DURATION = 1500; // 与微信原生 toast 默认时长接近

// 布局常量（直接来自用户提供的 CSS）
const W = 186;
const H = 38;
const TOP = Math.round(SCREEN_HEIGHT * 0.382); // 距顶 = 屏幕总高度 × 38.2%
const BG_ALPHA = 0.45; // background #000000; opacity 0.45
const RADIUS = 34;     // border-radius 34px（胶囊）
const RISE = 22;       // 退出时向上位移像素

// 内联缓动，避免额外依赖
function easeOutCubic(p) { return 1 - Math.pow(1 - p, 3); }
function easeInCubic(p) { return p * p * p; }

class ToastWidget extends UIComponent {
  constructor(opts = {}) {
    super(Object.assign({ x: 0, y: TOP, w: W, h: H, visible: false }, opts));
    this._text = '';
    this._start = 0;
    this._active = false;
    this._hold = DEFAULT_DURATION - FADE_IN - FADE_OUT;
  }

  /**
   * 触发一次 toast。
   * @param {string} text    展示文案
   * @param {number} [duration] 总时长(ms)，默认 1500；小于 FADE_IN+FADE_OUT 时按默认处理
   */
  show(text, duration) {
    this._text = text == null ? '' : String(text);
    var d = (duration && duration > FADE_IN + FADE_OUT) ? duration : DEFAULT_DURATION;
    this._hold = d - FADE_IN - FADE_OUT;
    this._start = Date.now();
    this._active = true;
    this.visible = true;
  }

  /** 永远不拦截触摸事件 */
  hitTest() { return false; }

  render(ctx) {
    if (!this._active) return;

    var t = Date.now() - this._start;
    var total = FADE_IN + this._hold + FADE_OUT;
    if (t >= total) {
      this._active = false;
      this.visible = false;
      return;
    }

    var alpha, yOff;
    if (t < FADE_IN) {
      // 快速淡入
      alpha = easeOutCubic(t / FADE_IN);
      yOff = 0;
    } else if (t < FADE_IN + this._hold) {
      // 停留
      alpha = 1;
      yOff = 0;
    } else {
      // 缓慢上移并淡出
      var p = (t - FADE_IN - this._hold) / FADE_OUT;
      var e = easeInCubic(p);
      alpha = 1 - e;
      yOff = -RISE * e;
    }

    var x = SCREEN_WIDTH / 2 - W / 2 + 0.5; // 居中（含 0.5px 亚像素对齐，对应 CSS calc）
    var y = TOP + yOff;

    ctx.save();
    ctx.globalAlpha = alpha;

    // 背景胶囊
    this._roundRect(ctx, x, y, W, H, Math.min(RADIUS, H / 2));
    ctx.fillStyle = 'rgba(0,0,0,' + BG_ALPHA + ')';
    ctx.fill();

    // 文字（15px 白字居中，line-height 100% → 垂直居中）
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '400 15px ' + (Theme.font && Theme.font.family ? Theme.font.family : 'sans-serif');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this._text, x + W / 2, y + H / 2 + 0.5);

    ctx.restore();
  }

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}

// ============ 全局便捷入口 ============
// 由 GameEngine 在构造时注册其实例；未注册时回退到微信原生 wx.showToast
let _globalToast = null;
ToastWidget.registerToast = function (instance) { _globalToast = instance; };

/**
 * 随时随地调用的 toast 替代。
 * 引擎未就绪（极少情况）时回退到微信原生 wx.showToast(icon:'none')。
 * @param {string} text
 * @param {number} [duration]
 */
function showToast(text, duration) {
  if (_globalToast && _globalToast.show) {
    _globalToast.show(text, duration);
    return;
  }
  if (typeof wx !== 'undefined' && wx.showToast) {
    wx.showToast({ title: String(text == null ? '' : text), icon: 'none' });
  }
}

module.exports = { ToastWidget, showToast };
