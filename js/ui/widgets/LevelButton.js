const { ctx } = require('../../render.js');
const AssetPreloader = require('../../ui/AssetPreloader.js');
const BPWidget = require('./BranchProgressWidget.js');

// Figma 父 frame：117 × 115，锚点 (cx, cy) = frame 中心
const FRAME_W = 117;
const FRAME_H = 115;

const LevelButton = {
  // 当前步骤：整体 frame 参考框 + 整张按钮图 main_level_btn_passed.png（117×115）
  draw(c, cx, cy, opts) {
    if (!c) c = ctx;

    c.save();
    // 进入 frame 局部坐标：原点 = frame 左上角（frame 中心 = (cx, cy)）
    c.translate(cx - FRAME_W / 2, cy - FRAME_H / 2);

    // 未解锁态：单独一版（图片自带锁定外观，body 与已通关钮同位）
    if (opts && opts.state === 'locked') {
      this._drawLocked(c, opts);
      c.restore();
      return;
    }

    // 当前关：与未解锁同图，外圈加呼吸光环做区分（后续换图不影响逻辑）
    if (opts && opts.state === 'current') {
      this._drawCurrent(c, opts);
      c.restore();
      return;
    }

    // 1) 整张按钮图 main_level_btn_passed.png（117×115，居中填满 frame）
    //    left = calc(50% - 117/2) = 0    top = calc(50% - 115/2) = 0
    if (AssetPreloader.isReady('main_level_btn_passed')) {
      c.drawImage(AssetPreloader.get('main_level_btn_passed'), 0, 0, FRAME_W, FRAME_H);
    } else {
      // 素材未就绪时的占位，方便确认位置
      c.fillStyle = 'rgba(255,210,90,0.25)';
      c.fillRect(0, 0, FRAME_W, FRAME_H);
    }

    // 3) 关卡 ID 文字（17×32，居中偏上）
    //    left = calc(50% - 17/2 - 1) = 49.0    top = 37（Figma 直接给定）
    //    文字框中心 = (49.0 + 8.5, 37 + 16) = (57.5, 53.0)
    var tx = 49.0 + 17 / 2; // 57.5
    var ty = 37 + 32 / 2;   // 53.0
    c.fillStyle = '#FF906A';
    c.font = '32px ' + (typeof Theme !== 'undefined' && Theme.font && Theme.font.family ? Theme.font.family : 'sans-serif');
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(String(opts && opts.levelId != null ? opts.levelId : 0), tx, ty);

    // 4) 星级花：按 opts.stars 顺序点亮前 N 朵（位置固定，不重排）
    //   第1朵=中间(58.5,89.5,rot0)  第2朵=左边(26.69,91.69,rot-15°)  第3朵=右边(90.31,91.69,rot+15°)
    //   普通 1~3 星 → N 朵「普通花」(colored:false，花瓣统一 #FFEE00 黄花)
    //   特殊 4 星（魔法棒成就）→ 3 朵「彩花」(colored:true，彩色花瓣 / big_flower)
    //   用户语义：3 朵普通花 = 3 星；3 朵彩花 = 4 星（数量同为 3，靠颜色区分档位）
    //   Figma: filter: drop-shadow(0px 1px 3px rgba(0,0,0,0.25))
    var rawStars = (opts && typeof opts.stars === 'number') ? opts.stars : 0;
    var isFourStar = rawStars >= 4;          // 4 星成就 → 画彩花
    var starCount = rawStars;
    if (starCount < 0) starCount = 0;
    if (starCount > 3) starCount = 3;        // 花数上限 3（4 星也只画 3 朵，仅变色）
    var flowerColored = isFourStar;          // 普通 1~3 星=黄花(colored:false)；4 星=彩花(colored:true)
    var FLOWER_SLOTS = [
      { x: 58.5,  y: 89.5,  r: 0 },
      { x: 26.69, y: 91.69, r: -15 },
      { x: 90.31, y: 91.69, r: 15 },
    ];
    for (var fi = 0; fi < starCount; fi++) {
      var fp = FLOWER_SLOTS[fi];
      c.save();
      c.shadowColor = 'rgba(0,0,0,0.25)';
      c.shadowBlur = 3;
      c.shadowOffsetX = 0;
      c.shadowOffsetY = 1;
      BPWidget.prototype.drawFlower.call({}, c, fp.x, fp.y, 25, 1, fp.r * Math.PI / 180, flowerColored, 1);
      c.restore();
    }

    c.restore();
  },

  // 呼吸光环（绿，青绿 #3FB6A8）：标记「可点击进入的关」。current 态常驻；选中已通关态临时显示。
  //   中心 (cx, cy) 在 frame 局部坐标（draw 已 translate 到 frame 左上角）。
  _drawBreathingRing(c, cx, cy) {
    var pulse = (Math.sin(Date.now() / 1000 * 3) + 1) / 2; // 0..1 呼吸

    // 外晕：柔光呼吸圈
    c.save();
    c.globalAlpha = 0.22 + pulse * 0.28;
    c.strokeStyle = '#3FB6A8';
    c.lineWidth = 6 + pulse * 3;
    c.beginPath();
    c.arc(cx, cy, 38 + pulse * 5, 0, Math.PI * 2);
    c.stroke();
    c.restore();

    // 内实环：固定清晰描边
    c.save();
    c.strokeStyle = '#3FB6A8';
    c.lineWidth = 3;
    c.beginPath();
    c.arc(cx, cy, 35, 0, Math.PI * 2);
    c.stroke();
    c.restore();
  },

  // 未解锁态：main_level_btn_unlocked.png（69×68），body 与已通关钮同位
  //   已通关钮的 body（白钮 Rect3469907）在 frame 局部 (24, 27)，尺寸 69×68 → 未解锁钮图贴同位
  _drawLocked(c, opts) {
    if (AssetPreloader.isReady('main_level_btn_unlocked')) {
      c.drawImage(AssetPreloader.get('main_level_btn_unlocked'), 24, 27, 69, 68);
    } else {
      // 素材未就绪时的占位，方便确认位置（灰底圆角块）
      c.fillStyle = 'rgba(120,124,130,0.82)';
      c.fillRect(24, 27, 69, 68);
    }
    // 关卡数字：居中于按钮体（灰圆中心 = (58.5, 61)）
    //   与已通关态的 #FF906A 同色系；字号略小（灰圆 69×68 < 已通关 117×115）
    var nx = 24 + 69 / 2;   // 58.5（灰圆水平中心）
    var ny = 27 + 68 / 2;   // 61  （灰圆垂直中心）
    // Figma 样式：大宝桃桃体 / 32px / weight 400 / color #7E8B97 / line-height 32px（=100%）
    c.fillStyle = '#7E8B97';
    c.font = '400 32px ' + (typeof Theme !== 'undefined' && Theme.font && Theme.font.family ? Theme.font.family : 'sans-serif');
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(String(opts && opts.levelId != null ? opts.levelId : 0), nx, ny);
  },

  // 当前关：与未解锁完全相同的图片，仅在外部加一圈呼吸光环做区分
  //   按钮体中心（frame 局部）= (24 + 69/2, 27 + 68/2) = (58.5, 61)
  _drawCurrent(c, opts) {
    if (AssetPreloader.isReady('main_level_btn_unlocked')) {
      c.drawImage(AssetPreloader.get('main_level_btn_unlocked'), 24, 27, 69, 68);
    } else {
      c.fillStyle = 'rgba(120,124,130,0.82)';
      c.fillRect(24, 27, 69, 68);
    }

    // 关卡数字（同 locked 态：居中、同色、同字）
    var nx = 24 + 69 / 2;   // 58.5
    var ny = 27 + 68 / 2;   // 61
    c.fillStyle = '#7E8B97';
    c.font = '400 32px ' + (typeof Theme !== 'undefined' && Theme.font && Theme.font.family ? Theme.font.family : 'sans-serif');
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(String(opts && opts.levelId != null ? opts.levelId : 0), nx, ny);

    var bx = 24 + 69 / 2;  // 58.5
    var by = 27 + 68 / 2;  // 61
    this._drawBreathingRing(c, bx, by);
  },
};

module.exports = LevelButton;
