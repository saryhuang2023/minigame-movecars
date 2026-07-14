// ===== 可复用的花朵绘制函数 =====
// 设计：黄色花瓣 (#FFEE00) + 橙色花蕊 (#FFA600)，带轻微投影（drop-shadow）。
// 后续多处需要画花，统一走此函数，保证颜色/投影一致、可一处调整全局生效。
//
// 参数：
//   ctx    — Canvas 2D 上下文
//   x, y   — 花朵外接正方形左上角坐标（逻辑像素）
//   size   — 花朵外接正方形边长（逻辑像素）
//   options（可选）：
//     petalColor   — 花瓣颜色，默认 '#FFEE00'
//     centerColor  — 花蕊颜色，默认 '#FFA600'
//     petalCount   — 花瓣数量，默认 5
//     shadow       — 是否绘制投影（drop-shadow 0 1px 3px rgba(0,0,0,.25)），默认 true
//
// 说明：Figma 原始 Vector 仅导出两个椭圆（黄/橙）且百分比缩到 14px 量级退化为极小点，
// 无法还原成可见花朵，故采用标准双色五瓣花造型，严格沿用 Figma 给定的两种颜色与投影参数。

function drawFlower(ctx, x, y, size, options) {
  options = options || {};
  var petalColor = options.petalColor || '#FFEE00';
  var centerColor = options.centerColor || '#FFA600';
  var petalCount = options.petalCount || 5;
  var useShadow = options.shadow !== false;

  var cx = x + size / 2;
  var cy = y + size / 2;
  var r = size / 2;

  ctx.save();

  // 投影：drop-shadow(0px 1px 3px rgba(0, 0, 0, 0.25))
  if (useShadow) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 1;
  }

  // 花瓣：围绕中心均匀分布的椭圆
  ctx.fillStyle = petalColor;
  var petalLen = r * 0.92;
  var petalW = r * 0.52;
  for (var i = 0; i < petalCount; i++) {
    var ang = (Math.PI * 2 * i) / petalCount - Math.PI / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.ellipse(0, -petalLen * 0.58, petalW, petalLen * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // 花蕊（橙色）：关闭额外投影，避免中心区域叠出双影
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = centerColor;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.42, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

module.exports = { drawFlower: drawFlower };
