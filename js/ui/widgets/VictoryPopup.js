// 通关结算弹窗 — PlayingEngine 通关后弹出
// 弹簧入场动画 + 内容错开显示 + 内嵌金币奖励/双倍按钮

var UIComponent = require('../base/UIComponent.js');
var Theme = require('../../define/GameDefine.js').THEME;
var Easing = require('../../core/Easing.js');
var AssetPreloader = require('../AssetPreloader.js');
var { drawGreenButton } = require('./greenButton.js');
var audio = require('../../audio/AudioManager.js');
var CommonButton = require('./CommonButton.js');
var { SCREEN_WIDTH, SCREEN_HEIGHT } = require('../../render.js');
var { drawAdBadge } = require('../drawAdBadge.js');
var ItemFlyEffect = require('../../effects/ItemFlyEffect.js');

/**
 * @param {Object} opts
 * @param {Function} opts.onContinue - 继续/通关按钮回调
 * @param {Function} opts.onReplay - 重玩按钮回调（保留兼容，UI 已移除重玩钮）
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
  this._stars = 0;                 // 本次通关星级（0~4；4=彩星）
  this._returnState = 'menu';
  this._goldAmount = 0;
  this._showGold = false;
  this._goldClaimed = false;  // 双倍金币是否已领取

  // 通用按钮（仅双倍金币）
  this._doubleGoldCommonBtn = new CommonButton({ w: 208, h: 54, color: 'gold', label: '金币X2' });

  // 动画
  this._animStart = 0;
  this._animator = null;  // PopupAnimator 实例（引擎注入）
  this._closing = false;
  this._closeCallback = null;

  // 树枝引用（飞行起点取树枝花朵屏幕坐标）
  this._branchWidget = null;
  // 星星飞入特效：复用「加步数道具」飞行算法（二次贝塞尔+弹出缩放+速度拉伸+拖尾+光晕），金色光晕
  this._flyEffect = new ItemFlyEffect('normal_flower', { glow: 'gold', size: 84, noRotate: true });
  this._flyStarted = false;       // 开场动画结束后才逐颗触发飞入
  this._flyTriggers = [];         // [{ slot, start }] 每颗升空的起飞时间戳
  this._flyLanded = [false, false, false];  // 每颗是否已飞到（飞到后才画静态星）

  // 按钮区域
  this._exitBtn = null;
  this._restartBtn = null;
  this._nextBtn = null;
  this._doubleGoldBtn = null;

  // 绿钮文案（setData 覆写；三态由引擎判定：继续闯关 / 恭喜通关 / 返回）
  this._btnLabel = '继续闯关';

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
  // 星级（0~4）：4 星=3 颗彩星；1~3 星=对应数量普通星；0=仅空格子
  this._stars = (typeof data.stars === 'number') ? data.stars : 0;
  // 绿钮文案由引擎按三态判定后直接传入（继续闯关 / 恭喜通关 / 返回）
  this._btnLabel = data.btnLabel || '继续闯关';
  // 飞入星星图片：4 星=彩星 big_flower，1~3 星=普通星 normal_flower
  this._flyEffect.setImgKey(this._stars >= 4 ? 'big_flower' : 'normal_flower');
};

VictoryPopup.prototype.setBranchWidget = function (w) {
  this._branchWidget = w;
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
    // 新一次弹窗：重置星星飞入状态（重新从树枝飞入）
    this._flyStarted = false;
    this._flyTriggers = [];
    this._flyLanded = [false, false, false];
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

  var pw = 351;
  var ph = 409;
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

  // === 星级展示（Figma：3 个 75×75 槽位，top:150，left:58/138/218）===
  // 底板：flower_bg.png（69×67）默认 3 个空格子；按星级从左到右叠加星星覆盖：
  //   1~3 星 → normal_flower.png（75×75）；4 星 → 3 颗彩星 big_flower.png（75×75）。
  // 花朵（与游戏内 drawFlower 一致：普通/空格带 drop-shadow；彩花无阴影）
  var _drawFlowerImg = function (cx, cy, size, key) {
    var img = AssetPreloader.get(key);
    if (!img) return;
    ctx.save();
    if (key !== 'big_flower') {
      var k = size / 25;
      ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
      ctx.shadowBlur = 2 * k;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 1 * k;
    }
    ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
    ctx.restore();
  };
  // 底板（非正方形，单独绘制）：flower_bg.png 69×67，带阴影（与空格子同款）
  var _drawStarBg = function (cx, cy) {
    var img = AssetPreloader.get('flower_bg');
    if (!img) return;
    ctx.save();
    var k = 67 / 25;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 2 * k;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 1 * k;
    ctx.drawImage(img, cx - 69 / 2, cy - 67 / 2, 69, 67);
    ctx.restore();
  };

  var STAR_SLOT = 75;       // 槽位定位框（Figma 75×75）基准
  var STAR_FLOWER = 75;     // 星星/彩星尺寸（75×75）
  var STAR_TOP = 150;
  var STAR_LEFTS = [58, 138, 218];
  var rawStars = this._stars || 0;
  var starIsFour = rawStars >= 4;

  // === 星星飞入：开场动画结束后，从树枝对应花朵位置飞到槽位（复用加步数道具飞行算法）===
  var STAR_FLY_LEAD = 140;       // 开场动画结束后再延迟 ms 起飞
  var STAR_FLY_STAGGER = 170;    // 相邻星星起飞间隔 ms（逐颗飞入）
  var openEndAt = this._animator.getOpenStartTime() + this._animator.getOpenDur() + STAR_FLY_LEAD;
  if (!this._flyStarted && this._stars > 0 && Date.now() >= openEndAt) {
    this._flyStarted = true;
    if (this._branchWidget) {
      for (var fi = 0; fi < this._stars && fi < 3; fi++) {
        var from = this._branchWidget._flowerCenter(fi);  // 树枝第 fi 颗星屏幕坐标
        var toX = px + STAR_LEFTS[fi] + STAR_SLOT / 2;
        var toY = py + STAR_TOP + STAR_SLOT / 2;
        var delay = fi * STAR_FLY_STAGGER;
        this._flyEffect.trigger(from.x, from.y, toX, toY, delay);
        this._flyTriggers.push({ slot: fi, start: Date.now() + delay });
      }
    } else {
      // 无树枝引用（异常态）：直接落定，不飞
      for (var fi2 = 0; fi2 < this._stars && fi2 < 3; fi2++) this._flyLanded[fi2] = true;
    }
  }
  // 更新每颗是否已飞到（飞到后才显示静态星）
  var FLY_DUR = this._flyEffect.getDuration();
  for (var li = 0; li < this._flyTriggers.length; li++) {
    if (Date.now() - this._flyTriggers[li].start >= FLY_DUR) this._flyLanded[this._flyTriggers[li].slot] = true;
  }
  // 底板：flower_bg.png 用于「未得星 / 已得星但还没飞到」的空格子；飞到后直接画星星
  for (var si = 0; si < 3; si++) {
    var sx = px + STAR_LEFTS[si];
    var sy = py + STAR_TOP;
    var scx = sx + STAR_SLOT / 2;
    var scy = sy + STAR_SLOT / 2;
    var hasStar = si < rawStars;
    // 未得星 → 画 flower_bg 占位
    // 已得星但尚未飞到 → 继续显示占位（飞入过程中先占位，落定后才显示星）
    if (!hasStar || !this._flyLanded[si]) {
      _drawStarBg(scx, scy);
    }
    // 已得星且已飞到 → 画星星（1~3 普通星，4 星 3 颗彩星），不画占位
    if (hasStar && this._flyLanded[si]) {
      _drawFlowerImg(scx, scy, STAR_FLOWER, starIsFour ? 'big_flower' : 'normal_flower');
    }
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

  // === 信息行（金币 / 步数）：结构保持原样（金色胶囊底框 + 独立图标 + 独立标签 + 独立数值），
  //   仅整体位置按需求：162 宽居中，金币 bottom:102 / 步数 bottom:140 ===
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

  var badgeW = 70, badgeH = 28;
  var iconW = 32, iconH = 32;

  // 标签背景色块（金色，与金币一致；胶囊形 6px 24px 24px 6px）
  var _drawBadge = function (anim, x, y, color) {
    ctx.save();
    ctx.globalAlpha = anim.alpha;
    ctx.fillStyle = color;
    var rl = Math.min(6, badgeH / 2);
    var rr = Math.min(24, badgeH / 2);
    ctx.beginPath();
    ctx.moveTo(x + rl, y);
    ctx.lineTo(x + badgeW - rr, y);
    ctx.arc(x + badgeW - rr, y + rr, rr, -Math.PI / 2, 0);
    ctx.lineTo(x + badgeW, y + badgeH - rr);
    ctx.arc(x + badgeW - rr, y + badgeH - rr, rr, 0, Math.PI / 2);
    ctx.lineTo(x + rl, y + badgeH);
    ctx.arc(x + rl, y + badgeH - rl, rl, Math.PI / 2, Math.PI);
    ctx.lineTo(x, y + rl);
    ctx.arc(x + rl, y + rl, rl, Math.PI, -Math.PI / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  // 图标（盖在色块左侧）
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

  // 数值（icon 右边缘 + 2px，左对齐）
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

  // 整体 frame：宽 162、水平居中；内部沿用原相对排布（标签在左，胶囊底框在右）
  var infoFrameLeft = px + (pw - 162) / 2;
  var REL_LABEL_X = 0, REL_ICON_X = 93, REL_BADGE_X = 107, REL_VALUE_X = 127;
  var REL_ICON_Y = 0, REL_BADGE_Y = 2, REL_LABEL_Y = 4, REL_VALUE_Y = 9;
  var dataX = infoFrameLeft + REL_VALUE_X;

  // === 步数：y 基准（bottom:140）===
  var stepsFrameTop = py + ph - 140 - 28;
  var stepsBadgeAnim = _elAnim();
  _drawBadge(stepsBadgeAnim, infoFrameLeft + REL_BADGE_X, stepsFrameTop + REL_BADGE_Y, '#FFC500');
  var stepsIconAnim = _elAnim();
  _drawIcon(stepsIconAnim, 'main_battle_icon', infoFrameLeft + REL_ICON_X, stepsFrameTop + REL_ICON_Y);
  var stepsLabelAnim = _elAnim();
  _drawInfoText(stepsLabelAnim, '本关步数', infoFrameLeft + REL_LABEL_X, stepsFrameTop + REL_LABEL_Y);
  var stepsDataAnim = _elAnim();
  _drawDataText(stepsDataAnim, this._steps + '步', stepsFrameTop + REL_VALUE_Y);

  // === 金币：y 基准（bottom:102）===
  var goldFrameTop = py + ph - 102 - 28;
  var goldBadgeAnim = _elAnim();
  _drawBadge(goldBadgeAnim, infoFrameLeft + REL_BADGE_X, goldFrameTop + REL_BADGE_Y, '#FFC500');
  var goldIconAnim = _elAnim();
  _drawIcon(goldIconAnim, 'coin', infoFrameLeft + REL_ICON_X, goldFrameTop + REL_ICON_Y);
  var goldLabelAnim = _elAnim();
  _drawInfoText(goldLabelAnim, '获得金币', infoFrameLeft + REL_LABEL_X, goldFrameTop + REL_LABEL_Y);
  // 双倍翻滚中循环播放 coin_roll 音效
  if (this._goldRolling) {
    var rollElapsed = Date.now() - this._goldRollStart;
    if (rollElapsed - this._goldRollSoundLast >= this._GOLD_ROLL_SOUND_INTERVAL) {
      audio.play('coin_roll');
      this._goldRollSoundLast = rollElapsed;
    }
  }
  var displayGold = this._getRollDisplayGold();
  var goldDataAnim = _elAnim();
  _drawDataText(goldDataAnim, '+' + displayGold + '币', goldFrameTop + REL_VALUE_Y);

  // === 按钮：单一绿钮（与失败面板「重新挑战」同款 button_green.png，水平居中）===
  // 文案：有下一关「继续闯关」→ 进下一关；无下一关「恭喜通关」→ 回主菜单（由 setData 的 _btnLabel 决定）
  // 位置：相对背景面板底部 bottom 25px，水平居中
  var s = SCREEN_WIDTH / 393;
  var GREEN_W = 189 * s;
  var GREEN_H = 62 * s;
  var btnX = px + (pw - GREEN_W) / 2;            // 水平居中
  var btnY = py + ph - 25 - GREEN_H;            // 底边距背景底 25px

  var contAnim = _elAnim();
  ctx.save();
  ctx.globalAlpha = contAnim.alpha;

  // 绿钮底图 + 文字（统一由 drawGreenButton 绘制，与失败面板「重新挑战」同款）
  drawGreenButton(ctx, {
    x: btnX, y: btnY, w: GREEN_W, h: GREEN_H,
    label: this._btnLabel || '继续闯关', s: s,
  });
  ctx.restore();

  // 命中区（仅绿钮）
  this._nextBtn = { x: btnX, y: btnY, w: GREEN_W, h: GREEN_H };
  this._restartBtn = null;
  this._exitBtn = null;

  ctx.restore();

  // 星星飞入动画：屏幕坐标系绘制（覆盖在遮罩/面板之上），飞向对应槽位后由 _flyLanded 接管显示静态星
  if (this._flyStarted) {
    this._flyEffect.update();
    if (this._flyEffect.isActive()) this._flyEffect.render(ctx);
  }
};

module.exports = VictoryPopup;
