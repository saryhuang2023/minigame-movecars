// 右上角剩余步数组件 — 还原旧版 CrownPigWidget 的「步数」显示部分
// 奖杯系统已删除（2026-07-11），故不再绘制奖杯图标，只保留剩余步数 UI
// PlayingEngine 中使用，每帧 setData(threshold, steps) 同步
//
// 布局基准：375 设计宽度的逻辑像素；Figma 以 right 定位，本组件统一换算为 left。
//   Rectangle 3469912（竖条） : 4×72  @ right:43  top:0     → left:328
//   Rectangle 3469910（外黄药丸）: 66×60 @ right:14 top:72    → left:295, r:20
//   Rectangle 3469911（内棕药丸）: 56×50 @ right:19 top:77    → left:300, r:17
//   文字「剩余步数」          : 40×10 @ right:27 top:85    → 中心(328,90)
//   数字（如 33）            : 30×20 @ right:32 top:99    → 中心(328,109)

var UIComponent = require('../base/UIComponent.js');
var Theme = require('../../define/GameDefine.js').THEME;
var { SCREEN_WIDTH } = require('../../render.js');

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

// 各元素 left 坐标（由 Figma right 换算：left = SCREEN_WIDTH - right - w）
var BAR_X = SCREEN_WIDTH - 43 - 4;     // 328
var BAR_Y = 0;
var BAR_W = 4;
var BAR_H = 72;

var OUTER_X = SCREEN_WIDTH - 14 - 66;  // 295
var OUTER_Y = 72;
var OUTER_W = 66;
var OUTER_H = 60;
var OUTER_R = 20;

var INNER_X = SCREEN_WIDTH - 19 - 56;  // 300
var INNER_Y = 77;
var INNER_W = 56;
var INNER_H = 50;
var INNER_R = 17;

var LABEL_CX = SCREEN_WIDTH - 27 - 40 + 20; // 328（40 宽框中心）
var LABEL_CY = 85 + 5;                       // 90

var NUM_CX = SCREEN_WIDTH - 32 - 30 + 15;    // 328（30 宽框中心）
var NUM_CY = 99 + 10;                        // 109

// 呼吸动画围绕主药丸中心
var BREATHE_CX = OUTER_X + OUTER_W / 2;      // 328
var BREATHE_CY = OUTER_Y + OUTER_H / 2;      // 102

class RightStepWidget extends UIComponent {
  constructor(opts) {
    super({
      x: OUTER_X, y: 0,
      w: OUTER_W, h: OUTER_Y + OUTER_H,
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

    // 数字滚动动画（增减都滚，方向=常规里程表）
    this._displayValue = undefined;  // 当前显示值（首次进入直接显示，不滚动）
    this._animFrom = 0;
    this._animTo = 0;
    this._animStart = 0;
    this._animActive = false;
    this._ANIM_DURATION = 1000;
  }

  /** ease-out-cubic 缓动 */
  _easeOutCubic(t) {
    t = Math.max(0, Math.min(1, t));
    return 1 - Math.pow(1 - t, 3);
  }

  /** 绘制剩余步数数字（描边 #FFD343 + 投影 + 字间距），支持 alpha 与垂直偏移 */
  _drawStepNumber(ctx, numStr, yCenter, alpha) {
    if (alpha <= 0 || !numStr) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = '400 20px ' + Theme.font.family;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    var letterSpacing = 2;
    var chars = numStr.split('');
    var widths = [];
    var totalW = 0;
    for (var i = 0; i < chars.length; i++) {
      var w = ctx.measureText(chars[i]).width;
      widths.push(w);
      totalW += w + (i < chars.length - 1 ? letterSpacing : 0);
    }
    var cursorX = NUM_CX - totalW / 2;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    for (var j = 0; j < chars.length; j++) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#FFD343';
      ctx.strokeText(chars[j], cursorX, yCenter);
      ctx.fillStyle = '#FFD343';
      ctx.fillText(chars[j], cursorX, yCenter);
      cursorX += widths[j] + letterSpacing;
    }
    ctx.restore();
    ctx.restore();
  }

  setData(threshold, steps) {
    this._threshold = threshold || 0;
    this._steps = steps || 0;
    var target = this._threshold - this._steps;
    if (target < 0) target = 0;
    if (this._displayValue === undefined) {
      this._displayValue = target;   // 首次进入直接显示，不滚动
      return;
    }
    if (target === this._displayValue) return;
    if (this._animActive) {
      // 正在滚 → 无缝更新目标，继续滚到新值
      this._animTo = target;
      return;
    }
    // 启动新滚动（增减都滚；方向由 render 里 to vs from 决定）
    this._animFrom = this._displayValue;
    this._animTo = target;
    this._animStart = Date.now();
    this._animActive = true;
  }

  setHidden(hidden) {
    this._hidden = !!hidden;
  }

  /** 剩余步数数字中心屏幕坐标（供积分花朵飞行起点定位） */
  getStepNumberPos() {
    return { x: NUM_CX, y: NUM_CY };
  }

  isHidden() {
    return this._hidden;
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

    // 呼吸动画缩放（围绕主药丸中心）
    var breathScale = this._getBreatheScale();

    ctx.save();
    if (breathScale !== 1) {
      ctx.translate(BREATHE_CX, BREATHE_CY);
      ctx.scale(breathScale, breathScale);
      ctx.translate(-BREATHE_CX, -BREATHE_CY);
    }

    // === 顶部竖条 Rectangle 3469912 ===
    ctx.fillStyle = '#87725F';
    ctx.fillRect(BAR_X, BAR_Y, BAR_W, BAR_H);

    // === 外层黄色药丸 Rectangle 3469910 ===
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = '#FFD036';
    roundRect(ctx, OUTER_X, OUTER_Y, OUTER_W, OUTER_H, OUTER_R);
    ctx.fill();
    ctx.restore();

    // 外层药丸内高光（inset 2px 2px 4px #FFDA61）
    ctx.save();
    roundRect(ctx, OUTER_X, OUTER_Y, OUTER_W, OUTER_H, OUTER_R);
    ctx.clip();
    var outerHi = ctx.createLinearGradient(OUTER_X, OUTER_Y, OUTER_X + 18, OUTER_Y + 18);
    outerHi.addColorStop(0, 'rgba(255, 218, 97, 0.9)');
    outerHi.addColorStop(1, 'rgba(255, 218, 97, 0)');
    ctx.fillStyle = outerHi;
    ctx.fillRect(OUTER_X, OUTER_Y, OUTER_W, OUTER_H);
    ctx.restore();

    // === 内层深棕药丸 Rectangle 3469911 ===
    ctx.fillStyle = '#602C16';
    roundRect(ctx, INNER_X, INNER_Y, INNER_W, INNER_H, INNER_R);
    ctx.fill();

    // 内层药丸内阴影（inset 2px 2px 4px rgba(0,0,0,0.25)）
    ctx.save();
    roundRect(ctx, INNER_X, INNER_Y, INNER_W, INNER_H, INNER_R);
    ctx.clip();
    var innerSh = ctx.createLinearGradient(INNER_X, INNER_Y, INNER_X + 18, INNER_Y + 18);
    innerSh.addColorStop(0, 'rgba(0, 0, 0, 0.25)');
    innerSh.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = innerSh;
    ctx.fillRect(INNER_X, INNER_Y, INNER_W, INNER_H);
    ctx.restore();

    // === 文字「剩余步数」===
    ctx.fillStyle = '#FDC27B';
    ctx.font = '400 10px ' + Theme.font.family;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('剩余步数', LABEL_CX, LABEL_CY);

    // === 剩余步数数字（位移滚动：增减都滚；方向=常规里程表
    //   变大→旧数字向上滑出顶部、新数字从底部滑入；变小→旧数字向下滑出底部、新数字从顶部滑入）===
    var ROLL_DIST = 22; // 滚动距离（px）
    if (this._animActive) {
      var elapsed = Date.now() - this._animStart;
      var t = Math.min(1, elapsed / this._ANIM_DURATION);
      var e2 = this._easeOutCubic(t);
      if (t >= 1) {
        this._animActive = false;
        this._displayValue = this._animTo;
        this._drawStepNumber(ctx, String(this._animTo), NUM_CY, 1);
      } else {
        var goingUp = this._animTo > this._animFrom;  // 变大→视觉向上滚
        if (goingUp) {
          this._drawStepNumber(ctx, String(this._animFrom), NUM_CY - e2 * ROLL_DIST, 1 - e2);
          this._drawStepNumber(ctx, String(this._animTo), NUM_CY + (1 - e2) * ROLL_DIST, e2);
        } else {
          // 变小→视觉向下滚：旧数字向下滑出、新数字从顶部滑入
          this._drawStepNumber(ctx, String(this._animFrom), NUM_CY + e2 * ROLL_DIST, 1 - e2);
          this._drawStepNumber(ctx, String(this._animTo), NUM_CY - (1 - e2) * ROLL_DIST, e2);
        }
      }
    } else {
      var curValue = (this._displayValue === undefined) ? 0 : this._displayValue;
      this._drawStepNumber(ctx, String(Math.round(curValue)), NUM_CY, 1);
    }

    ctx.restore();
  }
}

module.exports = RightStepWidget;
