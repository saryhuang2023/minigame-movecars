const { ctx } = require('../../render.js');
const AssetPreloader = require('../../ui/AssetPreloader.js');
const BPWidget = require('./BranchProgressWidget.js');

// Figma 父 frame：117 × 115，锚点 (cx, cy) = frame 中心
const FRAME_W = 117;
const FRAME_H = 115;

const LevelButton = {
  // 当前步骤：整体 frame 参考框(117×115，三态共用画布) + 已通关钮 main_level_btn_passed.png（70×68 居中贴于画布中心）
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

    // 当前关：main_level_btn_current.png（70×68，与已通关钮同尺寸居中贴于画布中心）。
    if (opts && opts.state === 'current') {
      this._drawCurrent(c, opts);
      c.restore();
      return;
    }

    // 已通关钮：main_level_btn_passed.png（70×68），按新设计稿居中贴在 frame 中心。
    //   与 locked/current（69×68）几乎同尺寸，仅状态图不同；公共画布仍用 117×115，
    //   这里把 70×68 钮居中铺在画布中心（ox=oy=(117-70)/2=23.5）。
    var PASSED_W = 70, PASSED_H = 68;
    var ox = (FRAME_W - PASSED_W) / 2;   // 23.5
    var oy = (FRAME_H - PASSED_H) / 2;   // 23.5
    if (AssetPreloader.isReady('main_level_btn_passed')) {
      c.drawImage(AssetPreloader.get('main_level_btn_passed'), ox, oy, PASSED_W, PASSED_H);
    } else {
      // 素材未就绪时的占位，方便确认位置
      c.fillStyle = 'rgba(255,210,90,0.25)';
      c.fillRect(ox, oy, PASSED_W, PASSED_H);
    }

    // 关卡 ID 文字（20×32，水平居中、距钮顶 6px，相对 70×68 钮左上角）
    //   文字框中心 = (35, 22)；color #FFFFFF，border 1px solid #1C8E0D，
    //   text-shadow 0px 1px 2px #21840F。
    var tx = ox + 35;          // 58.5
    var ty = oy + 26;          // 49.5（全局「所有钮文字下移 4px」）
    // Figma 关卡ID文字明确指定 font-family: 'PingFang SC'，故强制该字体
    // （不用 Theme.font.family 的 GenSenRounded2TW，否则与稿不一致）
    var family = 'PingFang SC';
    c.save();
    c.font = '400 32px ' + family;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    // 绿色投影（text-shadow: 0 1px 2px #21840F）
    c.shadowColor = '#21840F';
    c.shadowBlur = 2;
    c.shadowOffsetX = 0;
    c.shadowOffsetY = 1;
    c.fillStyle = '#FFFFFF';
    c.fillText(String(opts && opts.levelId != null ? opts.levelId : 0), tx, ty);
    // 绿色描边（border: 1px solid #1C8E0D）
    c.shadowColor = 'transparent';
    c.shadowBlur = 0;
    c.shadowOffsetY = 0;
    c.lineWidth = 1;
    c.strokeStyle = '#1C8E0D';
    c.strokeText(String(opts && opts.levelId != null ? opts.levelId : 0), tx, ty);
    c.restore();

    // 星星（之前的小花）：normal_flower.png 已得星；未得星用 empty_flower.png 占位。
    //   3 个固定槽位（相对 70×68 钮左上角，center 坐标，尺寸均 25×25）：
    //     星1 (12.5,52.5)  星2 (36.5,58.5)  星3 (60.5,52.5)
    //   4 星成就 → 已得星画彩花(colored→big_flower)，槽位仍 3 个。
    var rawStars = (opts && typeof opts.stars === 'number') ? opts.stars : 0;
    var isFourStar = rawStars >= 4;          // 4 星成就 → 已得星画彩花
    var flowerColored = isFourStar;          // 普通 1~3 星=黄花(colored:false)；4 星=彩花(colored:true)
    var STAR_SLOTS = [
      { x: ox + 12.5, y: oy + 52.5 },
      { x: ox + 36.5, y: oy + 58.5 },
      { x: ox + 60.5, y: oy + 52.5 },
    ];
    for (var fi = 0; fi < 3; fi++) {
      var sp = STAR_SLOTS[fi];
      var obtained = fi < rawStars;
      var imgKey = obtained ? (flowerColored ? null : 'normal_flower') : 'empty_flower';
      BPWidget.prototype.drawFlower.call({}, c, sp.x, sp.y, 25, 1, 0, flowerColored && obtained, 1, imgKey);
    }

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
    // 关卡数字：Figma 规范（/* 3 */）白字 + 灰描边 + 灰投影，32px/400/PingFang SC
    //   文字框 20×32，相对 69×68 钮左上角：left=calc(50% - 20/2 + 0.5px)≈25、top=9
    //   → 文字中心 = (24 + 35, 27 + 25) = (59, 52)（相对 frame 局部）
    //   color #FFFFFF；border 1px solid #717171；text-shadow 0px 1px 2px #797979
    var nx = 24 + 35;   // 59（钮宽 69：50% - 20/2 + 0.5 + 20/2 = 35）
    var ny = 27 + 29;   // 56（top 9 + 32/2 + 4 = 29，全局下移 4px）
    c.save();
    c.font = '400 32px PingFang SC';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    // 灰投影（text-shadow: 0 1px 2px #797979）
    c.shadowColor = '#797979';
    c.shadowBlur = 2;
    c.shadowOffsetX = 0;
    c.shadowOffsetY = 1;
    c.fillStyle = '#FFFFFF';
    c.fillText(String(opts && opts.levelId != null ? opts.levelId : 0), nx, ny);
    // 灰描边（border: 1px solid #717171）
    c.shadowColor = 'transparent';
    c.shadowBlur = 0;
    c.shadowOffsetY = 0;
    c.lineWidth = 1;
    c.strokeStyle = '#717171';
    c.strokeText(String(opts && opts.levelId != null ? opts.levelId : 0), nx, ny);
    c.restore();
  },

  // 当前关：main_level_btn_current.png（70×68，与已通关钮同尺寸、同中心贴于画布）。
  //   关卡数字居中于按钮中心。无额外呼吸环/光环效果。
  //   按钮体中心（frame 局部）= ((117-70)/2 + 35, (115-68)/2 + 34) = (58.5, 57.5)
  _drawCurrent(c, opts) {
    var CUR_W = 70, CUR_H = 68;
    var cx0 = (FRAME_W - CUR_W) / 2;  // 23.5
    var cy0 = (FRAME_H - CUR_H) / 2;  // 23.5
    if (AssetPreloader.isReady('main_level_btn_current')) {
      c.drawImage(AssetPreloader.get('main_level_btn_current'), cx0, cy0, CUR_W, CUR_H);
    } else {
      c.fillStyle = 'rgba(120,124,130,0.82)';
      c.fillRect(cx0, cy0, CUR_W, CUR_H);
    }

    // 关卡数字：Figma 规范（/* 1 */，当前正在玩）白字 + 橙描边 + 橙投影
    //   color #FFFFFF；border 1px solid #C9780F；text-shadow 0px 1px 2px #BE8800
    //   文字框 18×32，相对 70×68 钮左上角：left=26、top=6 → 中心 (35, 22)
    //   全局「所有钮文字下移 4px」→ 中心 y = 22 + 4 = 26（钮局部）→ abs (58.5, 49.5)
    var nx = cx0 + 35;   // 58.5
    var ny = cy0 + 26;   // 49.5
    c.save();
    c.font = '400 32px PingFang SC';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    // 橙投影（text-shadow: 0 1px 2px #BE8800）
    c.shadowColor = '#BE8800';
    c.shadowBlur = 2;
    c.shadowOffsetX = 0;
    c.shadowOffsetY = 1;
    c.fillStyle = '#FFFFFF';
    c.fillText(String(opts && opts.levelId != null ? opts.levelId : 0), nx, ny);
    // 橙描边（border: 1px solid #C9780F）
    c.shadowColor = 'transparent';
    c.shadowBlur = 0;
    c.shadowOffsetY = 0;
    c.lineWidth = 1;
    c.strokeStyle = '#C9780F';
    c.strokeText(String(opts && opts.levelId != null ? opts.levelId : 0), nx, ny);
    c.restore();
  },
};

module.exports = LevelButton;
