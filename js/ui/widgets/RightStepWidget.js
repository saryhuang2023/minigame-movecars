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

// 吊绳（竖条 Rectangle 3469912）顶端悬挂点 = 单摆支点（整块面板绕此点旋转摆动）
var PIVOT_X = BAR_X + BAR_W / 2;             // 330（4px 宽竖条中心）
var PIVOT_Y = BAR_Y;                         // 0（屏幕顶边，绳的固定端）

// 呼吸动画围绕主药丸中心
var BREATHE_CX = OUTER_X + OUTER_W / 2;      // 328
var BREATHE_CY = OUTER_Y + OUTER_H / 2;      // 102

class RightStepWidget extends UIComponent {
  constructor(opts) {
    // ---- 关卡内右上角避让顶部不可用区（微信胶囊）----
    // 棍子规则：只要面板不越安全线，尽量短，但 ≥ 60px；y=0 起画。
    // pillTop = max(safeY+2, 60)，safeY 已由 PlayingEngine 精确算出（胶囊重叠检测）。
    var safeY = (typeof opts.safeY === 'number') ? opts.safeY : 0;
    var pillTop = Math.max(safeY + 2, 60);   // 药丸顶 = max(安全线下2px, 最短棍60)
    var yOffset = pillTop - OUTER_Y;          // 相对原位置(72)的下移量
    var barH = pillTop;                       // 棍子高度 = 药丸顶（从0起）

    super({
      x: OUTER_X, y: yOffset,
      w: OUTER_W, h: OUTER_Y + OUTER_H + yOffset,
      zIndex: opts.zIndex || 1,
      visible: true,
    });

    // this 在 super() 后才可用，_yOffset/_barH 先用局部变量存、再赋给实例
    this._yOffset = yOffset;
    this._barH = barH;

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

    // 被击中抖动（道具图标飞到面板、或步数变少时触发）：整块面板绕「吊绳顶端」做单摆式旋转摆动
    // 多脉冲叠加模型：每次触发 push 一个新脉冲，角度按时间衰减正弦求和（多次触发会叠加而非重启）
    this._shakes = [];                      // 各脉冲触发时刻(ms)
    this._SHAKE_DURATION = 850;            // 单个脉冲摆动收住时间
    this._SHAKE_AMP = 0.15;                // 初始摆角(弧度) ≈ 8.6°
    this._SHAKE_TAU = 400;                 // 衰减常数(ms)，越大摆得越久、收尾越飘
    this._SHAKE_OMEGA = 2 * Math.PI * 2;   // 摆动角频率(≈2Hz，慢悠悠晃)
    // +3 道具到达用「强档」：振幅更大、摆动更急促，明显区别于普通步数下降（逃猪记步）
    this._SHAKE_AMP_STRONG = 0.34;             // ≈19.5°（普通 0.15≈8.6° 的约 2.3 倍）
    this._SHAKE_OMEGA_STRONG = 2 * Math.PI * 2.6;  // ≈2.6Hz（比普通 2Hz 更急促，撞击感更强）
    this._SHAKE_MAX = 4;                    // 最多叠加脉冲数（防失控）
    this._lastTarget = undefined;           // 上一次 setData 的剩余步数（检测"变少"）

    // 告警态持续抖动（最后5步提醒：高频小幅抖动 + 红色呼吸光晕；纯时间驱动、零状态机）
    // 每帧实时判 remaining∈(0,5]：用 +3 后步数回涨自动停，无需进入/解除标志位
    this._ALERT_AMP_X = 1.6;           // 水平抖动幅度(px)
    this._ALERT_AMP_Y = 1.2;           // 垂直抖动幅度(px)
    this._ALERT_AMP_ANG = 0.012;       // 旋转抖动幅度(rad) ≈ 0.7°
    this._ALERT_FREQ_X = 18;           // 水平抖动角频率系数(≈Hz量级)
    this._ALERT_FREQ_Y = 15;           // 垂直抖动角频率系数
    this._ALERT_FREQ_ANG = 22;         // 旋转抖动角频率系数
    this._ALERT_GLOW_PERIOD = 4;       // 红晕呼吸角频率系数
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
    var target = this._threshold - this._steps;   // 允许为负：+3 飞行途中按真实(不含加成)剩余，会暂时 <0，道具落地后回正；正常游玩负值已被失败态隐藏
    // 步数变少（剩余步数下降）→ 触发面板摆动；与道具飞行到达的抖动可叠加
    if (this._lastTarget !== undefined && target < this._lastTarget) {
      this.triggerHitShake();
    }
    this._lastTarget = target;
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
    return { x: NUM_CX, y: NUM_CY + this._yOffset };
  }

  isHidden() {
    return this._hidden;
  }

  /** 触发呼吸动画（单次缓慢呼吸，纯 UI 反馈） */
  triggerBreathe() {
    this._breatheStart = Date.now();
    this._breatheActive = true;
  }

  /** 触发被击中抖动（单次脉冲；每个脉冲在创建时定一组随机系数，使每次摆动幅度/快慢/起手方向略不同，避免多板一致机械感）
   *  @param {boolean} [strong] 是否强档。true=+3 道具到达（振幅/频率更大）；false/缺省=普通步数下降（逃猪记步） */
  triggerHitShake(strong) {
    var now = Date.now();
    var baseAmp = strong ? this._SHAKE_AMP_STRONG : this._SHAKE_AMP;
    var baseOmega = strong ? this._SHAKE_OMEGA_STRONG : this._SHAKE_OMEGA;
    var p = {
      ts: now,
      amp: baseAmp * (strong ? 0.8 + Math.random() * 0.4 : 0.75 + Math.random() * 0.5), // 强档振幅 ±20%，普通 ±25%
      tau: this._SHAKE_TAU * (0.9 + Math.random() * 0.2),    // 衰减 ±10%（尾韵长短微差）
      omega: baseOmega * (0.9 + Math.random() * 0.2),        // 频率 ±10%（快慢微差）
      dir: Math.random() < 0.5 ? 1 : -1,                     // 起手方向随机（先右/先左，更自然）
    };
    this._shakes.push(p);
    if (this._shakes.length > this._SHAKE_MAX) {
      this._shakes.splice(0, this._shakes.length - this._SHAKE_MAX);
    }
  }

  /** 获取当前摆动角度（多个脉冲叠加：每个绕吊绳顶端、被撞后从 0 甩出、衰减回正，再求和；各脉冲用自身随机系数） */
  _getShakeAngle() {
    if (this._shakes.length === 0) return 0;
    var now = Date.now();
    var total = 0;
    for (var i = this._shakes.length - 1; i >= 0; i--) {
      var p = this._shakes[i];
      var elapsed = now - p.ts;
      if (elapsed >= this._SHAKE_DURATION) {
        this._shakes.splice(i, 1);   // 过期脉冲移除
        continue;
      }
      var decay = Math.exp(-elapsed / p.tau);   // 指数衰减（每脉冲各自 tau）
      // 先甩出再来回衰减；dir 决定起手方向，叠加时各脉冲相位/方向/快慢不同 → 自然累加、不再机械一致
      total += p.amp * decay * Math.sin(p.dir * p.omega * elapsed / 1000);
    }
    return total;
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

  /** 是否处于「最后5步」告警态（剩余步数 ∈ (0, 5]，纯实时判断、无状态机） */
  _isAlerting() {
    var remaining = this._threshold - this._steps;  // 原始剩余步数（与显示一致）
    return remaining > 0 && remaining <= 5;
  }

  /** 公开：供 PlayingEngine 查询告警态（决定 +3 道具是否小跳） */
  isAlerting() {
    return this._isAlerting();
  }

  /** 告警态红晕呼吸 alpha（0~0.7 之间正弦呼吸；非告警态返回 0） */
  _getAlertGlowAlpha() {
    if (!this._isAlerting()) return 0;
    var t = Date.now() / 1000;
    return 0.35 + 0.35 * Math.sin(t * this._ALERT_GLOW_PERIOD);
  }

  render(ctx) {
    if (this._hidden) return;

    var hasThreshold = this._threshold > 0;
    if (!hasThreshold) return;  // 没有配置阈值 → 功能未开放，完全不绘制

    var off = this._yOffset;

    // 呼吸动画缩放（围绕主药丸中心）
    var breathScale = this._getBreatheScale();

    ctx.save();

    // 告警态持续抖动（最后5步提醒）：高频小幅 translate + 轻微 rotate，围绕吊绳顶端
    // 与下方 breathScale / 被击单摆为加法叠加关系，互不抢占，其它瞬时动画照常播
    if (this._isAlerting()) {
      var tNow = Date.now() / 1000;
      var jx = Math.sin(tNow * this._ALERT_FREQ_X) * this._ALERT_AMP_X;
      var jy = Math.cos(tNow * this._ALERT_FREQ_Y) * this._ALERT_AMP_Y;
      var ja = Math.sin(tNow * this._ALERT_FREQ_ANG) * this._ALERT_AMP_ANG;
      ctx.translate(PIVOT_X, PIVOT_Y);
      ctx.rotate(ja);
      ctx.translate(-PIVOT_X + jx, -PIVOT_Y + jy);
    }

    if (breathScale !== 1) {
      ctx.translate(BREATHE_CX, BREATHE_CY + off);
      ctx.scale(breathScale, breathScale);
      ctx.translate(-BREATHE_CX, -(BREATHE_CY + off));
    }
    // 被击中：整块面板绕吊绳顶端(PIVOT)做单摆式旋转摆动（绳顶端固定、下方荡动）
    var shakeAngle = this._getShakeAngle();
    if (shakeAngle !== 0) {
      ctx.translate(PIVOT_X, PIVOT_Y);
      ctx.rotate(shakeAngle);
      ctx.translate(-PIVOT_X, -PIVOT_Y);
    }

    // === 顶部竖条 Rectangle 3469912 ===
    ctx.fillStyle = '#87725F';
    ctx.fillRect(BAR_X, BAR_Y, BAR_W, this._barH);

    // === 外层黄色药丸 Rectangle 3469910 ===
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = '#FFD036';
    roundRect(ctx, OUTER_X, OUTER_Y + off, OUTER_W, OUTER_H, OUTER_R);
    ctx.fill();
    ctx.restore();

    // 外层药丸内高光（inset 2px 2px 4px #FFDA61）
    ctx.save();
    roundRect(ctx, OUTER_X, OUTER_Y + off, OUTER_W, OUTER_H, OUTER_R);
    ctx.clip();
    var outerHi = ctx.createLinearGradient(OUTER_X, OUTER_Y + off, OUTER_X + 18, OUTER_Y + off + 18);
    outerHi.addColorStop(0, 'rgba(255, 218, 97, 0.9)');
    outerHi.addColorStop(1, 'rgba(255, 218, 97, 0)');
    ctx.fillStyle = outerHi;
    ctx.fillRect(OUTER_X, OUTER_Y + off, OUTER_W, OUTER_H);
    ctx.restore();

    // === 内层深棕药丸 Rectangle 3469911 ===
    ctx.fillStyle = '#602C16';
    roundRect(ctx, INNER_X, INNER_Y + off, INNER_W, INNER_H, INNER_R);
    ctx.fill();

    // 内层药丸内阴影（inset 2px 2px 4px rgba(0,0,0,0.25)）
    ctx.save();
    roundRect(ctx, INNER_X, INNER_Y + off, INNER_W, INNER_H, INNER_R);
    ctx.clip();
    var innerSh = ctx.createLinearGradient(INNER_X, INNER_Y + off, INNER_X + 18, INNER_Y + off + 18);
    innerSh.addColorStop(0, 'rgba(0, 0, 0, 0.25)');
    innerSh.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = innerSh;
    ctx.fillRect(INNER_X, INNER_Y + off, INNER_W, INNER_H);
    ctx.restore();

    // === 文字「剩余步数」===
    ctx.fillStyle = '#FDC27B';
    ctx.font = '400 10px ' + Theme.font.family;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('剩余步数', LABEL_CX, LABEL_CY + off);

    // === 剩余步数数字（位移滚动：增减都滚；方向=常规里程表
    //   变大→旧数字向上滑出顶部、新数字从底部滑入；变小→旧数字向下滑出底部、新数字从顶部滑入）===
    var numCY = NUM_CY + off;
    var ROLL_DIST = 22; // 滚动距离（px）
    if (this._animActive) {
      var elapsed = Date.now() - this._animStart;
      var t = Math.min(1, elapsed / this._ANIM_DURATION);
      var e2 = this._easeOutCubic(t);
      if (t >= 1) {
        this._animActive = false;
        this._displayValue = this._animTo;
        this._drawStepNumber(ctx, String(this._animTo), numCY, 1);
      } else {
        var goingUp = this._animTo > this._animFrom;  // 变大→视觉向上滚
        if (goingUp) {
          this._drawStepNumber(ctx, String(this._animFrom), numCY - e2 * ROLL_DIST, 1 - e2);
          this._drawStepNumber(ctx, String(this._animTo), numCY + (1 - e2) * ROLL_DIST, e2);
        } else {
          // 变小→视觉向下滚：旧数字向下滑出、新数字从顶部滑入
          this._drawStepNumber(ctx, String(this._animFrom), numCY + e2 * ROLL_DIST, 1 - e2);
          this._drawStepNumber(ctx, String(this._animTo), numCY - (1 - e2) * ROLL_DIST, e2);
        }
      }
    } else {
      var curValue = (this._displayValue === undefined) ? 0 : this._displayValue;
      this._drawStepNumber(ctx, String(Math.round(curValue)), numCY, 1);
    }

    // 告警态红色边缘呼吸光晕（风险提示双通道冗余：红晕作颜色兜底，不抢戏、非整牌变红）
    // 跟随整块面板抖动变换自然同步，alpha 由 _getAlertGlowAlpha 控制
    var alertGlow = this._getAlertGlowAlpha();
    if (alertGlow > 0) {
      ctx.save();
      ctx.globalAlpha = alertGlow;
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#FF3B30';
      ctx.shadowColor = 'rgba(255, 59, 48, 0.85)';
      ctx.shadowBlur = 12;
      roundRect(ctx, OUTER_X - 1, OUTER_Y + off - 1, OUTER_W + 2, OUTER_H + 2, OUTER_R + 1);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }
}

module.exports = RightStepWidget;
