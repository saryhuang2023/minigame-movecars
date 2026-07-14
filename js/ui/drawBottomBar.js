// js/ui/drawBottomBar.js
// 主菜单底部功能区域：拉伸背景 + 可复用圆形按钮控件
//
// 坐标换算约定（来自 Figma 设计稿）：
//   - 设计稿宽度 DESIGN_W = 393
//   - 背景图 393 x 122，水平铺满整屏，底部对齐，保持宽高比
//   - 背景顶部在 Figma 屏幕 y = 721（= 843 - 122）
//   - 容器内控件以「屏幕坐标」给出，需转化为实际屏幕坐标：
//       x = fx * scale
//       y = barY + (fy - 721) * scale
//     其中 scale = SCREEN_WIDTH / 393，barY = SCREEN_HEIGHT - barH

var AssetPreloader = require('../ui/AssetPreloader.js');
var Theme = require('../define/GameDefine.js').THEME;
var { SCREEN_WIDTH, SCREEN_HEIGHT } = require('../render.js');

var DESIGN_W = 393;
var BAR_W = 393;
var BAR_H = 122;
var BAR_TOP_FIGMA = 721; // 背景顶部在 Figma 屏幕的 y

/**
 * 绘制底部拉伸背景（main_buttom.png），保持宽高比、底部对齐、铺满屏宽。
 * 带 drop-shadow(0px -4px 6px rgba(0,0,0,0.2))。
 * @returns {Object|null} 容器几何 { x, y, w, h, scale }，资源未就绪时返回 null
 */
function drawMenuBottomBar(ctx) {
  if (!AssetPreloader.isReady('main_bottom')) return null;
  var img = AssetPreloader.get('main_bottom');
  var scale = SCREEN_WIDTH / DESIGN_W;
  var barW = SCREEN_WIDTH;
  var barH = BAR_H * scale;
  var barX = 0;
  var barY = SCREEN_HEIGHT - barH;

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
  ctx.shadowBlur = 6 * scale;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = -4 * scale;
  ctx.drawImage(img, barX, barY, barW, barH);
  ctx.restore();

  return { x: barX, y: barY, w: barW, h: barH, scale: scale };
}

/**
 * Figma 屏幕坐标 → 实际屏幕坐标（基于容器几何）
 */
function figmaToScreen(bar, fx, fy) {
  return {
    x: fx * bar.scale,
    y: bar.y + (fy - BAR_TOP_FIGMA) * bar.scale,
  };
}

/**
 * 可复用圆形控件：金色外圈 + 橙色内圈 + 居中描边文字
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x   控件左上角（实际屏幕坐标）
 * @param {number} y   控件左上角（实际屏幕坐标）
 * @param {number} size 实际像素尺寸
 * @param {string} label 单字（如 衣 / 赛）
 */
function drawRoundMenuButton(ctx, x, y, size, label) {
  var cx = x + size / 2;
  var cy = y + size / 2;
  var r = size / 2;
  var scale = size / 58; // 相对 Figma 58px 基准

  // ===== 外圈：金色圆 + 向下投影 =====
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
  ctx.shadowBlur = 4 * scale;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 4 * scale;
  ctx.fillStyle = '#F6CF78';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // ===== 外圈内阴影：顶部白高光 + 底部 #D88C3B 暗边（inset）=====
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  var grad = ctx.createLinearGradient(0, y, 0, y + size);
  grad.addColorStop(0, 'rgba(255, 255, 255, 0.25)');
  grad.addColorStop(0.45, 'rgba(255, 255, 255, 0)');
  grad.addColorStop(0.55, 'rgba(216, 140, 59, 0)');
  grad.addColorStop(1, 'rgba(216, 140, 59, 0.9)');
  ctx.fillStyle = grad;
  ctx.fillRect(cx - r, cy - r, size, size);
  ctx.restore();

  // ===== 内圈：橙色椭圆（48/58），居中 =====
  var ir = (size * 48 / 58) / 2;
  ctx.save();
  ctx.fillStyle = '#FFAC56';
  ctx.beginPath();
  ctx.arc(cx, cy, ir, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, ir, 0, Math.PI * 2);
  ctx.clip();
  var rgrad = ctx.createRadialGradient(cx, cy, ir * 0.4, cx, cy, ir);
  rgrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
  rgrad.addColorStop(1, 'rgba(0, 0, 0, 0.25)');
  ctx.fillStyle = rgrad;
  ctx.fillRect(cx - ir, cy - ir, ir * 2, ir * 2);
  ctx.restore();

  // ===== 居中文字：白色 + #733C29 描边 =====
  ctx.save();
  ctx.fillStyle = '#FFFFFF';
  ctx.strokeStyle = '#733C29';
  ctx.lineWidth = 1 * scale;
  ctx.lineJoin = 'round';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) {
    try { ctx.letterSpacing = (2 * scale) + 'px'; } catch (e) { /* 不支持则忽略 */ }
  }
  ctx.font = '400 ' + (24 * scale) + 'px ' + (Theme.font && Theme.font.family ? Theme.font.family : 'sans-serif');
  ctx.strokeText(label, cx, cy);
  ctx.fillText(label, cx, cy);
  ctx.restore();
}

module.exports = {
  drawMenuBottomBar: drawMenuBottomBar,
  drawRoundMenuButton: drawRoundMenuButton,
  figmaToScreen: figmaToScreen,
};
