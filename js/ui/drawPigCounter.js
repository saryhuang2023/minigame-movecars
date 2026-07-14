// drawPigCounter.js — 可复用组件：展示「剩余未逃脱的猪」数量（或其它可变内容）
// 所有子元素坐标均以一个虚拟 frame（55×120）为基准的相对坐标，
// 调用方只需指定 frame 落点 (frameX, frameY) 即可在任何位置绘制同样的布局。
//
// 该组件整体置于 Figma 父 frame，原点 (160, -48)（375 设计画布），故关卡内调用
//   drawPigCounter(ctx, 160, -48, { iconKey: 'pig_icon', value: remaining })
// 即可还原设计稿。frame 内的相对坐标见下方 GEOM（已由用户给定的父 frame 原点换算）。

var AssetPreloader = require('./AssetPreloader.js');
var Theme = require('../define/GameDefine.js').THEME;

// 圆角矩形路径（本地实现，避免依赖外部 roundRect）
function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, Math.floor(w / 2), Math.floor(h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 相对坐标（origin = 父 frame 左上角 (160,-48)，x→右，y→下），由 Figma 屏幕绝对坐标 - 父 frame 原点折算：
//   bar   abs(196,-48)         → rel(36,0)
//   pill  abs(169,22)          → rel(9,70)
//   panel abs(173,26)          → rel(13,74)
//   pig   abs(177,30.5,40,34)  → rel(17,78.5,40,34) — 中心 (197,47.5) 与面板中心对齐，放大补偿 PNG 透明内边距
//   count abs(200,51)          → rel(40,99)
var GEOM = {
  bar:   { x: 36, y: 0,  w: 4,  h: 72,    color: '#87725F' },                                   // 竖条 3469912
  pill:  { x: 9,  y: 70, w: 55, h: 50,    r: 14, color: '#A35A34', hi: '#FFA661' },             // 外棕药丸 3469910
  panel: { x: 13, y: 74, w: 47, h: 42,    r: 12, color: '#FAD8A0' },                             // 内米色面板 3469911
  pig:   { x: 17, y: 78.5, w: 40, h: 34 },                                                          // 猪头图标（bg-removed PNG，略放大补偿透明内边距；中心对齐面板中心，位置正确不歪）
  count: { x: 40, y: 99, w: 18, h: 13 },                                                            // 数量数字框（Figma 33 节点）
};

/**
 * 绘制「剩余猪数量」组件
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frameX  frame 左上角 x（画布坐标）
 * @param {number} frameY  frame 左上角 y（画布坐标）
 * @param {object} opts
 *   - iconKey {string}  图标资源 key，默认 'pig_icon'（后续可传 'bird_icon' 等）
 *   - value   {number|string} 展示的数字/文本，默认 ''
 *   - font    {string}  字体，默认 Theme.font.family（大宝桃桃体）
 */
function drawPigCounter(ctx, frameX, frameY, opts) {
  opts = opts || {};
  var iconKey = opts.iconKey || 'pig_icon';
  var value = (opts.value != null) ? String(opts.value) : '';
  var fontFamily = opts.font || (Theme.font && Theme.font.family) || 'sans-serif';

  var ox = frameX;
  var oy = frameY;

  // 1) 竖条（最底层，无圆角，无阴影）
  ctx.fillStyle = GEOM.bar.color;
  ctx.fillRect(ox + GEOM.bar.x, oy + GEOM.bar.y, GEOM.bar.w, GEOM.bar.h);

  // 2) 外棕药丸（外投影 + 内高光）
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  roundRectPath(ctx, ox + GEOM.pill.x, oy + GEOM.pill.y, GEOM.pill.w, GEOM.pill.h, GEOM.pill.r);
  ctx.fillStyle = GEOM.pill.color;
  ctx.fill();
  ctx.restore();
  // 内高光：inset 2px 2px 4px #FFA661（clip 到圆角矩形后画左上渐变）
  ctx.save();
  roundRectPath(ctx, ox + GEOM.pill.x, oy + GEOM.pill.y, GEOM.pill.w, GEOM.pill.h, GEOM.pill.r);
  ctx.clip();
  var pg = ctx.createLinearGradient(
    ox + GEOM.pill.x, oy + GEOM.pill.y,
    ox + GEOM.pill.x + GEOM.pill.w, oy + GEOM.pill.y + GEOM.pill.h
  );
  pg.addColorStop(0, 'rgba(255, 166, 97, 0.9)');
  pg.addColorStop(0.35, 'rgba(255, 166, 97, 0)');
  ctx.fillStyle = pg;
  ctx.fillRect(ox + GEOM.pill.x, oy + GEOM.pill.y, GEOM.pill.w, GEOM.pill.h);
  ctx.restore();

  // 3) 内米色面板（内阴影 rgba(0,0,0,0.25)）
  roundRectPath(ctx, ox + GEOM.panel.x, oy + GEOM.panel.y, GEOM.panel.w, GEOM.panel.h, GEOM.panel.r);
  ctx.fillStyle = GEOM.panel.color;
  ctx.fill();
  ctx.save();
  roundRectPath(ctx, ox + GEOM.panel.x, oy + GEOM.panel.y, GEOM.panel.w, GEOM.panel.h, GEOM.panel.r);
  ctx.clip();
  var cxp = ox + GEOM.panel.x + GEOM.panel.w / 2;
  var cyp = oy + GEOM.panel.y + GEOM.panel.h / 2;
  var ig = ctx.createRadialGradient(
    cxp, cyp, Math.min(GEOM.panel.w, GEOM.panel.h) / 3,
    cxp, cyp, Math.max(GEOM.panel.w, GEOM.panel.h) / 1.4
  );
  ig.addColorStop(0, 'rgba(0, 0, 0, 0)');
  ig.addColorStop(1, 'rgba(0, 0, 0, 0.25)');
  ctx.fillStyle = ig;
  ctx.fillRect(ox + GEOM.panel.x, oy + GEOM.panel.y, GEOM.panel.w, GEOM.panel.h);
  ctx.restore();

  // 4) 猪头图标（iconKey 可替换为小鸟等）
  if (AssetPreloader.isReady(iconKey)) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.drawImage(
      AssetPreloader.get(iconKey),
      ox + GEOM.pig.x, oy + GEOM.pig.y, GEOM.pig.w, GEOM.pig.h
    );
    ctx.restore();
  }

  // 5) 数量数字（严格按 Figma 33 节点）
  // font 13px 大宝桃桃体、白字(#FFFFFF)、border:1px solid #733C29。
  // 说明：Figma 该 border 是文字「描边」(strokeText)，并非黑底方框——
  // 故用 strokeText 画 1px #733C29 描边，再白字填充；不画任何填充方框。
  var ccx = ox + GEOM.count.x + GEOM.count.w / 2;
  var ccy = oy + GEOM.count.y + GEOM.count.h / 2;
  ctx.font = '400 13px ' + fontFamily;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#733C29';
  ctx.strokeText(value, ccx, ccy);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(value, ccx, ccy);
}

module.exports = { drawPigCounter };
