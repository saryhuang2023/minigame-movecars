// 金币显示组件 — 游戏内左上角金币余额
// PlayingEngine 专用

var UIComponent = require('../base/UIComponent.js');
var AssetPreloader = require('../AssetPreloader.js');
var Theme = require('../../define/GameDefine.js').THEME;
var Easing = require('../../core/Easing.js');
var audio = require('../../audio/AudioManager.js');

// Figma 设计常量（v2：去除数字底框，图标 21×21 + 数字 13px 左对齐堆叠在左上角）
var COIN_X = 57;          // 金币图标 left（Figma left:57）
var COIN_Y = 51;          // 金币图标 top（Figma top:51）
var COIN_SIZE = 21;       // 金币图标宽高（Figma 21×21）

var TEXT_X = 80;          // 金币数字 左缘-x（金币右缘 78 + 2px 间距 = 80）
var TEXT_Y = 57;          // 金币数字 top
var TEXT_SIZE = 13;       // 字体大小（Figma 13px 大宝桃桃体）

class GoldWidget extends UIComponent {
  constructor(opts) {
  super({
    x: opts.x || 0,
    y: opts.y || 0,
    w: opts.w || 64,   // 图标(7..28) + 数字(左缘33起，最长约4位→~62) 包围盒
    h: opts.h || 36,   // top79..101
    zIndex: opts.zIndex || 2,
  });

  this._gold = 0;

  // 数字翻滚动画（任何数字变化都滚动，200ms easeOutBack）
  this._rollActive = false;
  this._rollFrom = 0;
  this._rollTarget = 0;
  this._rollStartTime = 0;
  this._ROLL_DURATION = 800;

  // "+N" 浮动文字动画
  this._floatTexts = [];  // { text, x, y, startTime, duration }

  // 磁吸光晕强度 0-1（飞行中呼吸光环）
  this._magnetGlow = 0;

  // 满额庆祝动画（全部金币到齐后触发，方案D）
  this._celebrateStart = 0;
  this._celebrateActive = false;
  this._CELEBRATE_DURATION = 800;   // ms，加长让玩家看清
  this._CELEBRATE_AMPLITUDE = 0.30; // 图标 +30% 缩放
  this._CELEBRATE_GLOW_PEAK = 0.85; // 光晕更亮

}
}


/** 设置显示数字（带翻滚动画） */
GoldWidget.prototype.setData = function (gold) {
  if (typeof gold !== 'number') return;
  gold = Math.max(0, gold);

  // 当前真实的显示值（正在滚就用目标值，否则用 _gold）
  var currentDisplay = this._rollActive ? this._rollTarget : this._gold;
  if (gold === currentDisplay) return;

  console.log('[LOG_gold] GoldWidget.setData: ' + currentDisplay + ' -> ' + gold + ' (rollActive=' + this._rollActive + ' _gold=' + this._gold + ' _rollFrom=' + this._rollFrom + ')');

  if (this._rollActive) {
    // 正在滚 → 无缝更新目标，继续滚到新值
    this._rollTarget = gold;
    return;
  }

  // 启动新翻滚
  this._rollFrom = this._gold;
  this._rollTarget = gold;
  this._rollStartTime = Date.now();
  this._rollActive = true;
  audio.play('coin_roll');
};

/** 获取当前翻滚显示数字 */
GoldWidget.prototype._getRollDisplay = function () {
  if (!this._rollActive) return this._gold;

  var elapsed = Date.now() - this._rollStartTime;
  if (elapsed >= this._ROLL_DURATION) {
    this._rollActive = false;
    this._gold = this._rollTarget;
    return this._gold;
  }

  var t = elapsed / this._ROLL_DURATION;
  var eased = Easing.easeOutCubic(t);  // easeOutCubic 无回弹，不会冲过目标
  var val = this._rollFrom + (this._rollTarget - this._rollFrom) * eased;
  return Math.round(val);
};

/** 强制设值（跳过翻滚动画，直接同步） */
GoldWidget.prototype.forceSet = function (gold) {
  if (typeof gold !== 'number') return;
  this._gold = Math.max(0, gold);
  this._rollFrom = this._gold;  // 同步翻滚起点，防止后续 setData 从旧值起跳
  this._rollActive = false;
};

/** 金币到达时弹出 "+N" 浮动文字 */
GoldWidget.prototype.addFloatText = function () {
  var coinCX = this.x + COIN_X + COIN_SIZE / 2;
  var coinCY = this.y + COIN_Y;
  this._floatTexts.push({
    text: '+1',
    x: coinCX + 20,
    y: coinCY - 4,
    startTime: Date.now(),
    duration: 800,
  });
};

/** 设置磁吸光晕强度 0-1（飞行中 CoinFlyEffect 调用） */
GoldWidget.prototype.setMagnetGlow = function (intensity) {
  this._magnetGlow = Math.max(0, Math.min(1, intensity));
};

/** 满额庆祝（全部金币到齐，方案D）— 强呼吸 + 金辉光晕 */
GoldWidget.prototype.celebrate = function () {
  this._celebrateStart = Date.now();
  this._celebrateActive = true;
};

/** 获取庆祝呼吸缩放值（含数字缩放） */
GoldWidget.prototype._getCelebrateScale = function () {
  if (!this._celebrateActive) return { icon: 1, num: 1, glow: 0 };
  var elapsed = Date.now() - this._celebrateStart;
  if (elapsed >= this._CELEBRATE_DURATION) {
    this._celebrateActive = false;
    return { icon: 1, num: 1, glow: 0 };
  }
  var t = elapsed / this._CELEBRATE_DURATION;
  // 两次脉冲 + 指数衰减
  var pulse = Math.abs(Math.sin(t * 2 * Math.PI));
  var decay = Math.exp(-t * 2.5);
  var amp = pulse * decay * this._CELEBRATE_AMPLITUDE;
  return {
    icon: 1 + amp,
    num: 1 + amp * 1.8,  // 数字比图标波动更大
    glow: pulse * decay * this._CELEBRATE_GLOW_PEAK,
  };
};

GoldWidget.prototype.render = function (ctx) {
  var baseX = this.x;
  var baseY = this.y;

  var celeb = this._getCelebrateScale();

  // === 金币图标（drop-shadow + 呼吸缩放 + 磁吸光晕） ===
  if (AssetPreloader.isReady('coin')) {
    var coinX = baseX + COIN_X;
    var coinY = baseY + COIN_Y;
    var coinCX = coinX + COIN_SIZE / 2;
    var coinCY = coinY + COIN_SIZE / 2;

    var iconScale = celeb.icon;  // 满额庆祝缩放（已无普通呼吸脉冲）

    // --- 庆祝金辉光晕（满额庆祝，从金币中心向外放射） ---
    if (celeb.glow > 0.01) {
      var glowR = COIN_SIZE * 0.7 + celeb.glow * 50;
      ctx.save();
      ctx.globalAlpha = celeb.glow * 0.8;
      var glowGrad = ctx.createRadialGradient(coinCX, coinCY, COIN_SIZE * 0.25, coinCX, coinCY, glowR);
      glowGrad.addColorStop(0, 'rgba(255, 240, 100, 0.9)');
      glowGrad.addColorStop(0.4, 'rgba(255, 200, 0, 0.5)');
      glowGrad.addColorStop(1, 'rgba(255, 150, 0, 0)');
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(coinCX, coinCY, glowR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // --- 磁吸光晕（飞行中金币快到达时呼吸光环） ---
    if (this._magnetGlow > 0.01) {
      var glowRadius = COIN_SIZE / 2 + 6 + this._magnetGlow * 14;
      var glowAlpha = this._magnetGlow * 0.5;
      ctx.save();
      ctx.globalAlpha = glowAlpha;
      var gradient = ctx.createRadialGradient(coinCX, coinCY, COIN_SIZE / 2, coinCX, coinCY, glowRadius);
      gradient.addColorStop(0, 'rgba(255, 215, 0, 0.6)');
      gradient.addColorStop(0.5, 'rgba(255, 215, 0, 0.15)');
      gradient.addColorStop(1, 'rgba(255, 215, 0, 0)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(coinCX, coinCY, glowRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;

    if (iconScale !== 1) {
      ctx.translate(coinCX, coinCY);
      ctx.scale(iconScale, iconScale);
      ctx.translate(-coinCX, -coinCY);
    }

    ctx.drawImage(AssetPreloader.get('coin'), coinX, coinY, COIN_SIZE, COIN_SIZE);
    ctx.restore();
  }

  // === 金币数字（庆祝期间放大 + 金橙渐变色） ===
  var text = String(this._getRollDisplay());
  var numScale = celeb.num;
  ctx.font = TEXT_SIZE + 'px ' + Theme.font.family;   // 必须先设字体，measureText 才能量对宽度
  ctx.save();
  if (numScale !== 1) {
    var textCX = baseX + TEXT_X + ctx.measureText(text).width / 2;
    var textCY = baseY + TEXT_Y + TEXT_SIZE / 2;
    ctx.translate(textCX, textCY);
    ctx.scale(numScale, numScale);
    ctx.translate(-textCX, -textCY);
  }
  if (celeb.glow > 0.05) {
    // 庆祝色：从白渐变到金橙
    var r = Math.round(255);
    var g = Math.round(255 - 40 * celeb.glow);
    var b = Math.round(255 - 255 * celeb.glow);
    ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
  } else {
    ctx.fillStyle = '#FFFFFF';
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(text, baseX + TEXT_X, baseY + TEXT_Y - 2);
  ctx.restore();

  // === "+N" 浮动文字（金币到达时弹出，向上飘移 + 淡出） ===
  var now = Date.now();
  var active = [];
  for (var i = 0; i < this._floatTexts.length; i++) {
    var ft = this._floatTexts[i];
    var elapsed = now - ft.startTime;
    if (elapsed >= ft.duration) continue;

    var t = elapsed / ft.duration;
    var fy = ft.y - t * 28;  // 上飘 28px
    var alpha = 1 - t;       // 线性淡出

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = '14px ' + Theme.font.family;
    ctx.fillStyle = '#FFD700';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ft.text, ft.x, fy);
    ctx.restore();

    active.push(ft);
  }
  this._floatTexts = active;
};

module.exports = GoldWidget;
