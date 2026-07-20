// 绿色通用按钮绘制 — 失败面板「重新挑战」/ 通关面板绿钮统一使用
// 一改全改：底图、文字样式、文字位置均在此定义，所有绿钮调用同一函数
//
// 文字位置约定（设计稿 393 空间，按 s 缩放）：
//   水平：相对按钮中心右偏 0.5px
//   垂直：相对按钮中心上偏 4.5px（canvas Y 向下为正，故取负；原 6.5，下移 2px 改为 4.5）

var AssetPreloader = require('../AssetPreloader.js');
var Theme = require('../../define/GameDefine.js').THEME;

var TX_OFFSET = 0.5;    // 水平：居中后往右 0.5px
var TY_OFFSET = -4.5;   // 垂直：居中后往上 4.5px（相对中心）
var FONT_SIZE = 24;     // 字号（设计稿空间）
var STROKE_W = 1;       // 绿描边宽度（设计稿空间）
var SHADOW_Y = 2;       // 下投影偏移（设计稿空间，text-shadow: 0 2px 0 #14671F）

// 绘制绿色按钮（底图 button_green.png + 居中白字/绿描边/绿投影）
// 调用方需确保 ctx 已处于正确的 alpha / 面板缩放变换上下文中；
// 本函数内部 save/restore 仅隔离字体与阴影状态，不改动 globalAlpha 与变换。
function drawGreenButton(ctx, opts) {
  var x = opts.x, y = opts.y, w = opts.w, h = opts.h;
  var label = opts.label || '';
  var s = opts.s || 1;
  var fontFamily = opts.fontFamily || Theme.font.family;

  // 底图
  if (AssetPreloader.isReady('button_green')) {
    ctx.drawImage(AssetPreloader.get('button_green'), x, y, w, h);
  }

  // 文字（白字 + 绿描边/投影）
  ctx.save();
  ctx.font = '400 ' + (FONT_SIZE * s) + 'px ' + fontFamily;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 阴影（text-shadow: 0 2px 0 #14671F）作用于整个文字层（描边与填充都带）
  ctx.shadowColor = '#14671F';
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = SHADOW_Y * s;
  ctx.shadowBlur = 0;
  var tx = x + w / 2 + TX_OFFSET * s;
  var ty = y + h / 2 + TY_OFFSET * s;
  // 1) 描边：border 1px solid #14671F（画布描边居中，可见约 1px 绿环）
  ctx.lineWidth = STROKE_W * s;
  ctx.strokeStyle = '#14671F';
  ctx.strokeText(label, tx, ty);
  // 2) 白字填充：压在描边内侧，露出 1px 绿环 + 其 2px 下绿投影
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(label, tx, ty);
  ctx.restore();
}

module.exports = { drawGreenButton };
