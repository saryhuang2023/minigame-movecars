// ItemButton — 关卡内底部道具按钮组件（提示 / +3 步 / 未来其它道具）
// 设计稿：Figma frame 77×77，内部统一布局，仅图标/文字/次数不同。
//
// 构造：new ItemButton({ x, y, iconKey, label, count, side })
//   x, y      屏幕坐标（frame 左上角）
//   iconKey   图标资源 key（如 'hint_icon' / 'addstep_icon'）
//   label     描述文字（如 '提示' / '+3'）
//   count     剩余次数（number）
//   side      'left' | 'right'，影响广告角标位置与布局对称
//
// 公开方法：
//   setData(count)             更新剩余次数
//   getHitRect()               → { x, y, w:77, h:77 } 供触控命中
//   render(ctx, pressScale)    绘制（pressScale 1=正常，0.95=按下）

var AssetPreloader = require('../AssetPreloader.js');
var Theme = require('../../define/GameDefine.js').THEME;
var { drawAdBadge } = require('../drawAdBadge.js');

// ===== Figma 设计常量（frame 内相对坐标）=====
var FRAME_W = 77, FRAME_H = 77;
var BG_KEY = 'level_item_bg';
var ICON_X = 8, ICON_Y = 8, ICON_SIZE = 52;     // 道具图标
var COUNT_X = 64, COUNT_Y = 46;                  // 次数数字（右上角）
var LABEL_TOP = 55;                              // 文字顶部
var LABEL_W = 32, LABEL_H = 20;                  // 文字框
var LABEL_OFFSET_X = -5.5;                       // 文字水平居中偏移

class ItemButton {
  constructor(opts) {
    this.x = opts.x || 0;
    this.y = opts.y || 0;
    this.iconKey = opts.iconKey || '';
    this.label = opts.label || '';
    this._count = (typeof opts.count === 'number') ? opts.count : 0;
    this.side = opts.side || 'right';
    this._bgImg = null;    // 延迟加载，render 时取 AssetPreloader.get
  }

  setData(count) {
    this._count = (typeof count === 'number') ? count : 0;
  }

  getHitRect() {
    return { x: this.x, y: this.y, w: FRAME_W, h: FRAME_H };
  }

  render(ctx, pressScale) {
    var s = pressScale || 1;
    var cx = this.x + FRAME_W / 2, cy = this.y + FRAME_H / 2;

    ctx.save();
    if (s !== 1) {
      ctx.translate(cx, cy);
      ctx.scale(s, s);
      ctx.translate(-cx, -cy);
    }

    // 1. 背景底框 77×77
    if (AssetPreloader.isReady(BG_KEY)) {
      ctx.drawImage(AssetPreloader.get(BG_KEY), this.x, this.y, FRAME_W, FRAME_H);
    }

    // 2. 道具图标 52×52，居中偏左上 (8,8)
    if (AssetPreloader.isReady(this.iconKey)) {
      ctx.drawImage(AssetPreloader.get(this.iconKey),
        this.x + ICON_X, this.y + ICON_Y, ICON_SIZE, ICON_SIZE);
    }

    // 3. 剩余次数（右上角，白色 11px）
    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '400 11px ' + (Theme.font && Theme.font.family ? Theme.font.family : 'sans-serif');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(String(this._count), this.x + COUNT_X, this.y + COUNT_Y);
    ctx.restore();

    // 4. 说明文字（居中偏底）
    var labelCX = this.x + FRAME_W / 2 + LABEL_OFFSET_X;
    var labelCY = this.y + LABEL_TOP + LABEL_H / 2;
    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '400 16px ' + (Theme.font && Theme.font.family ? Theme.font.family : 'sans-serif');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.label, labelCX, labelCY);
    ctx.restore();

    ctx.restore();
  }
}

module.exports = ItemButton;
