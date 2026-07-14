// 设置按钮 — 纯代码绘制（不再依赖 setting.png 图片）
// 设计稿（Figma Rectangle 3469909 + Vector）：
//   圆形底 32×32，背景 rgba(8, 58, 24, 0.2)，0.5px 描边 rgba(23, 51, 23, 0.3)，
//   内高光 inset 顶/底白色 0.5；白色齿轮图标，rotate(-30deg)。
// 可复用于任何需要设置按钮的地方（传入 ctx 与左上角坐标 + 尺寸即可）。

/**
 * 绘制齿轮（带中心镂空，露出按钮底色）
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx 圆心 x
 * @param {number} cy 圆心 y
 * @param {number} rTip 齿尖半径
 * @param {number} rRoot 齿根半径
 * @param {number} teeth 齿数
 * @param {number} rHole 中心孔半径
 * @param {number} rotation 旋转弧度
 */
function _drawGear(ctx, cx, cy, rTip, rRoot, teeth, rHole, rotation) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);

  var step = (Math.PI * 2) / teeth;
  var topHalf = step * 0.16;   // 齿顶半角（窄 → 梯形平顶）
  var rootHalf = step * 0.30;  // 齿根半角（宽 → 与下一齿留有可见齿谷）

  ctx.beginPath();
  for (var i = 0; i < teeth; i++) {
    var a = i * step;
    var aRL = a - rootHalf;
    var aTL = a - topHalf;
    var aTR = a + topHalf;
    var aRR = a + rootHalf;
    if (i === 0) {
      ctx.moveTo(Math.cos(aRL) * rRoot, Math.sin(aRL) * rRoot);
    } else {
      ctx.lineTo(Math.cos(aRL) * rRoot, Math.sin(aRL) * rRoot);
    }
    ctx.lineTo(Math.cos(aTL) * rTip, Math.sin(aTL) * rTip);
    ctx.lineTo(Math.cos(aTR) * rTip, Math.sin(aTR) * rTip);
    ctx.lineTo(Math.cos(aRR) * rRoot, Math.sin(aRR) * rRoot);
  }
  ctx.closePath();

  // 中心镂空（evenodd 让中心透明，露出按钮底色）
  ctx.moveTo(rHole, 0);
  ctx.arc(0, 0, rHole, 0, Math.PI * 2);

  ctx.fill('evenodd');
  ctx.restore();
}

/**
 * 绘制设置按钮（圆形底 + 白色齿轮）
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x 按钮左上角 x
 * @param {number} y 按钮左上角 y
 * @param {number} size 按钮边长（正方形）
 * @param {number} [rotation] 齿轮旋转弧度，默认 -30°
 * @returns {{x:number, y:number, w:number, h:number}} 命中区域（与绘制框一致）
 */
function drawSettingsButton(ctx, x, y, size, rotation) {
  var cx = x + size / 2;
  var cy = y + size / 2;
  var r = size / 2;
  if (rotation == null) rotation = -Math.PI / 6;

  ctx.save();

  // === 圆形底（Figma Rectangle 3469909）===
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(8, 58, 24, 0.2)';
  ctx.fill();

  // 描边 0.5px
  ctx.lineWidth = 0.5;
  ctx.strokeStyle = 'rgba(23, 51, 23, 0.3)';
  ctx.stroke();

  // 内高光（inset 顶/底白色 0.5）
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r - 0.25, 0, Math.PI * 2);
  ctx.clip();

  var gTop = ctx.createLinearGradient(0, cy - r, 0, cy);
  gTop.addColorStop(0, 'rgba(255, 255, 255, 0.55)');
  gTop.addColorStop(0.35, 'rgba(255, 255, 255, 0)');
  gTop.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gTop;
  ctx.fillRect(cx - r, cy - r, size, r);

  var gBot = ctx.createLinearGradient(0, cy, 0, cy + r);
  gBot.addColorStop(0, 'rgba(255, 255, 255, 0)');
  gBot.addColorStop(0.65, 'rgba(255, 255, 255, 0)');
  gBot.addColorStop(1, 'rgba(255, 255, 255, 0.55)');
  ctx.fillStyle = gBot;
  ctx.fillRect(cx - r, cy, size, r);
  ctx.restore();

  // === 齿轮图标（Vector，白色，rotate(-30deg)）===
  ctx.fillStyle = '#FFFFFF';
  // 齿轮外径约 20px（size*0.31*2≈19.8）以贴合 Figma Vector 20×18 的视觉尺寸
  _drawGear(ctx, cx, cy, size * 0.31, size * 0.23, 8, size * 0.12, rotation);

  ctx.restore();

  return { x: x, y: y, w: size, h: size };
}

module.exports = { drawSettingsButton };
