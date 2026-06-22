/**
 * 小金猪图标统一绘制模块
 * 供 PlayingEngine / LevelSelectEngine 共用，避免两处造型不一致
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx - 中心 X
 * @param {number} cy - 中心 Y
 * @param {number} s  - 尺寸（身体椭圆宽度 ≈ s * 0.65）
 * @param {boolean} isGold - true=金色, false=灰色
 * @param {number} [alpha] - 可选透明度覆盖，默认 isGold?0.9:0.35
 */
function drawPigIcon(ctx, cx, cy, s, isGold, alpha) {
  if (alpha === undefined) alpha = isGold ? 0.95 : 0.55;

  var bodyColor   = isGold ? '#FCD34D' : '#C0813D';
  var noseColor   = isGold ? '#FBBF24' : '#D4955A';
  var detailColor = isGold ? '#B45309' : '#6B3A20';

  ctx.save();
  ctx.globalAlpha = alpha;

  // 身体
  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.ellipse(cx, cy + s * 0.25, s * 0.65, s * 0.48, 0, 0, Math.PI * 2);
  ctx.fill();

  // 头
  ctx.beginPath();
  ctx.arc(cx - s * 0.45, cy - s * 0.2, s * 0.38, 0, Math.PI * 2);
  ctx.fill();

  // 鼻子
  ctx.fillStyle = noseColor;
  ctx.beginPath();
  ctx.ellipse(cx - s * 0.5, cy - s * 0.08, s * 0.18, s * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();

  // 鼻孔
  ctx.fillStyle = detailColor;
  ctx.beginPath();
  ctx.arc(cx - s * 0.55, cy - s * 0.08, s * 0.045, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx - s * 0.45, cy - s * 0.08, s * 0.045, 0, Math.PI * 2);
  ctx.fill();

  // 眼睛
  ctx.beginPath();
  ctx.arc(cx - s * 0.4, cy - s * 0.25, s * 0.055, 0, Math.PI * 2);
  ctx.fill();

  // 耳朵
  ctx.fillStyle = noseColor;
  ctx.beginPath();
  ctx.moveTo(cx - s * 0.25, cy - s * 0.38);
  ctx.lineTo(cx - s * 0.08, cy - s * 0.52);
  ctx.lineTo(cx - s * 0.1, cy - s * 0.3);
  ctx.fill();

  // 腿
  ctx.fillStyle = detailColor;
  var lw = s * 0.1, lh = s * 0.28;
  ctx.fillRect(cx - s * 0.2, cy + s * 0.5, lw, lh);
  ctx.fillRect(cx + s * 0.1, cy + s * 0.5, lw, lh);
  ctx.fillRect(cx - s * 0.45, cy + s * 0.5, lw, lh);
  ctx.fillRect(cx + s * 0.35, cy + s * 0.5, lw, lh);

  // 小卷尾
  ctx.strokeStyle = detailColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx + s * 0.6, cy + s * 0.1, s * 0.15, Math.PI * 0.5, Math.PI * 1.8);
  ctx.stroke();

  ctx.restore();
}

module.exports = { drawPigIcon };
