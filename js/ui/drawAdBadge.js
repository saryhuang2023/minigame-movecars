// drawAdBadge — 统一广告角标（红圆 + 白色播放三角）
// 关卡内道具栏、体力广告窗领取按钮、胜利面板双倍金币按钮共用同一视觉元素。
//
// 用法：drawAdBadge(ctx, cx, cy, r)
//   cy, cy = 红圆圆心坐标（屏幕逻辑像素）
//   r     = 红圆半径（默认 13.5，与原道具栏一致）

function drawAdBadge(ctx, cx, cy, r) {
  if (r == null) r = 13.5;

  // 红圆
  ctx.save();
  ctx.fillStyle = '#FF6363';
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 白色播放三角（与原道具栏尺寸/位置一致）
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.moveTo(cx + 8, cy);        // 顶点（右）
  ctx.lineTo(cx - 4, cy - 8);    // 左上
  ctx.lineTo(cx - 4, cy + 8);    // 左下
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

module.exports = { drawAdBadge };
