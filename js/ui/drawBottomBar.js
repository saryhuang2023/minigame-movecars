// js/ui/drawBottomBar.js
// 主菜单底部功能区域：拉伸背景 + 可复用圆形按钮控件
//
// 坐标换算约定（来自 Figma 设计稿）：
//   - 设计稿宽度 DESIGN_W = 393
//   - 背景图 393 x 109，底部对齐，固定高度 109（不随屏宽缩放，宽屏轻微横向形变）
//   - 宽度拉伸铺满屏幕宽度（barW = SCREEN_WIDTH）
//   - 背景顶部参考点 Figma y = 721（控件 fy 以此为基准锚定在 bar 顶，bar 高度变化不改变控件相对位置）
//   - 容器内控件以「屏幕坐标」给出，需转化为实际屏幕坐标：
//       x = fx * scale
//       y = barY + (fy - 721) * scale
//     其中 scale = SCREEN_WIDTH / 393（控件尺寸/水平定位用），barY = SCREEN_HEIGHT - 109（固定高）

var AssetPreloader = require('../ui/AssetPreloader.js');
var Theme = require('../define/GameDefine.js').THEME;
var { SCREEN_WIDTH, SCREEN_HEIGHT } = require('../render.js');

var DESIGN_W = 393;
var BAR_W = 393;
var BAR_H = 109;
var BAR_TOP_FIGMA = 721; // 背景顶部在 Figma 屏幕的 y

/**
 * 绘制底部拉伸背景（main_buttom.png），固定高度 BAR_H(109)、底部对齐、宽度铺满屏宽。
 * 宽屏下背景图按比例横向轻微拉伸（与关卡底栏 drawLevelBottomBar 同策略）。
 * 带 drop-shadow(0px -4px 6px rgba(0,0,0,0.2))（固定模糊半径，不随屏宽缩放）。
 * @returns {Object|null} 容器几何 { x, y, w, h, scale }，资源未就绪时返回 null
 *   scale 仍保留供 figmaToScreen 做控件水平定位/尺寸换算（bar 高度本身固定）。
 */
function drawMenuBottomBar(ctx) {
  if (!AssetPreloader.isReady('main_bottom')) return null;
  var img = AssetPreloader.get('main_bottom');
  var scale = SCREEN_WIDTH / DESIGN_W;       // 控件水平定位/尺寸用
  var barW = SCREEN_WIDTH;                    // 宽度铺满屏宽
  var barH = BAR_H;                           // 固定高度 109，不随屏宽缩放
  var barX = 0;
  var barY = SCREEN_HEIGHT - barH;

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = -4;
  ctx.drawImage(img, barX, barY, barW, barH);
  ctx.restore();

  return { x: barX, y: barY, w: barW, h: barH, scale: scale };
}

/**
 * 绘制关卡内底部拉伸背景（level_buttom.png）。
 * 与主菜单 drawMenuBottomBar 同风格（向上投影），宽度拉伸贴合屏幕左右、高度取图片自然高 115（不随屏宽拉伸、不变形），
 * 铺满屏宽、底部对齐。关卡内直接显示，不参与入场动画。
 * @returns {Object|null} 容器几何 { x, y, width, height }，资源未就绪时返回 null
 */
function drawLevelBottomBar(ctx) {
  if (!AssetPreloader.isReady('level_bottom')) return null;
  var img = AssetPreloader.get('level_bottom');
  var barW = SCREEN_WIDTH;                                          // 宽度拉伸贴合屏幕左右
  var barH = 115;                                                   // 高度取 level_buttom.png 自然高(393×115)，不随屏宽拉伸；底栏够高才能托住 bottom:42 的 +3 按钮（其 frame 顶在距底121px，115 仅露6px）
  var barX = 0;
  var barY = SCREEN_HEIGHT - barH;

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = -4;
  ctx.drawImage(img, barX, barY, barW, barH);
  ctx.restore();

  return { x: barX, y: barY, width: barW, height: barH };
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
function drawRoundMenuButton(ctx, x, y, size, label, withShadow, iconKey) {
  var cx = x + size / 2;
  var cy = y + size / 2;
  var r = size / 2;
  var scale = size / 58; // 相对 Figma 58px 基准

  // ===== 外圈：金色圆 + 可选投影 =====
  // 投影在入场动画期间关闭（避免与缩放回弹不同步），动画完成后由调用方开启
  ctx.save();
  if (withShadow) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 4 * scale;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 4 * scale;
  }
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

  // ===== 图标或文字：优先图标（居中 52×52，带 drop-shadow 0px 2px 2px rgba(0,0,0,0.25)），否则回退文字 =====
  if (iconKey && AssetPreloader.isReady(iconKey)) {
    var _icon = AssetPreloader.get(iconKey);
    var _iconSize = 52;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 2;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;
    ctx.drawImage(_icon, cx - _iconSize / 2, cy - _iconSize / 2, _iconSize, _iconSize);
    ctx.restore();
  } else {
    // ===== 居中文字：白色 + #733C29 描边（无图标时的回退） =====
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
}

module.exports = {
  drawMenuBottomBar: drawMenuBottomBar,
  drawLevelBottomBar: drawLevelBottomBar,
  drawRoundMenuButton: drawRoundMenuButton,
  figmaToScreen: figmaToScreen,
};
