// PigRenderer — 猪的独立渲染模块（v26.12）
// 从 GameplayEngine 抽离，减少 token 消耗
// require/module.exports，wx API

const PIG_COLOR = '#FFD700';
const PIG_STROKE = '#FFB300';
const SELECTED_COLOR = '#2196F3';
const HEAD_CELLS = 2;  // 头部占用 cell 数量

// ============================================================
// === canvas 工具 ===
// ============================================================
function roundRect(ctx, x, y, w, h, r, topOnly) {
  ctx.beginPath();
  if (topOnly) {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x, y + r, r);
  } else {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
  }
  ctx.closePath();
}

// ============================================================
// === PigRenderer ===
// ============================================================
class PigRenderer {
  constructor(engine) {
    this.e = engine; // GameplayEngine 引用（读取 holes / topBarH / boardOffsetY / diameter / dragState）
  }

  // ---- 猪身体尺寸 ----
  get pigBodyWidth() { return this.e.diameter * 2 / 3; }
  get pigBodyHalf()  { return this.pigBodyWidth / 2; }

  // ---- 拖拽中的显示角度（旋转追逐动画） ----
  getDisplayAngle(pig) {
    const ds = this.e.dragState;
    if (!ds || ds.displayAngle == null) return pig.angle;
    if (ds.type === 'rotate' && pig.id === ds.pigId) return ds.displayAngle;
    if ((ds.type === 'adjustAngle' || ds.type === 'adjustLength') && pig.id === ds.pendingId) return ds.displayAngle;
    return pig.angle;
  }

  // ---- 坐标计算辅助 ----
  _pigCenter(pig, offDx, offDy) {
    const angle = this.getDisplayAngle(pig);
    const rad = angle * Math.PI / 180;
    const dirX = Math.cos(rad), dirY = -Math.sin(rad);
    const tail = this.e.holes[pig.tailIndex];
    if (!tail) return null;
    const cl = this.e.cellLength;
    const totalLen = pig.length * cl;
    const cx = tail.x + (pig.length - 1) / 2 * cl * dirX + offDx;
    const cy = this.e.topBarH + this.e.boardOffsetY + tail.y + (pig.length - 1) / 2 * cl * dirY + offDy;
    return { cx, cy, rad, totalLen, dirX, dirY };
  }

  // ---- 正常猪绘制 ----
  draw(ctx, pig, offDx, offDy) {
    const c = this._pigCenter(pig, offDx, offDy);
    if (!c) return;
    const bw = this.pigBodyWidth, bh = this.pigBodyHalf;

    ctx.save();
    ctx.translate(c.cx, c.cy);
    ctx.rotate(-c.rad);
    ctx.fillStyle = PIG_COLOR;
    roundRect(ctx, -c.totalLen / 2, -bh, c.totalLen, bw, 6);
    ctx.fill();
    ctx.strokeStyle = PIG_STROKE;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const eyeX = c.totalLen / 2 - this.e.cellLength * 0.35;
    const eyeY = -bh * 0.45;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(eyeX, eyeY, this.e.diameter * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.arc(eyeX + 1, eyeY, this.e.diameter * 0.11, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ---- 碰撞闪烁效果 ----
  drawFlash(ctx, pig, t) {
    const rad = pig.angle * Math.PI / 180;
    const dirX = Math.cos(rad), dirY = -Math.sin(rad);
    const tail = this.e.holes[pig.tailIndex];
    if (!tail) return;
    const totalLen = pig.length * this.e.cellLength;
    const cx = tail.x + (pig.length - 1) / 2 * this.e.cellLength * dirX;
    const cy = this.e.topBarH + this.e.boardOffsetY + tail.y + (pig.length - 1) / 2 * this.e.cellLength * dirY;
    const bw = this.pigBodyWidth, bh = this.pigBodyHalf;
    const flashAlpha = 0.7 * (1 - t) * (1 - t);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-rad);

    ctx.beginPath();
    roundRect(ctx, -totalLen / 2, -bh, totalLen, bw, 6);
    ctx.clip();

    ctx.globalAlpha = flashAlpha;
    ctx.fillStyle = '#FFF8E7';
    ctx.fillRect(-totalLen / 2, -bh, totalLen, bw);

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ---- 非法位置红色遮罩 ----
  drawInvalidOverlay(ctx, pig, offDx, offDy) {
    const c = this._pigCenter(pig, offDx, offDy);
    if (!c) return;
    const bw = this.pigBodyWidth, bh = this.pigBodyHalf;
    ctx.save();
    ctx.translate(c.cx, c.cy);
    ctx.rotate(-c.rad);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#FF4444';
    roundRect(ctx, -c.totalLen / 2, -bh, c.totalLen, bw, 6);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ---- 推出孤儿猪（已从 pigs 移除，仅动画残影） ----
  drawOrphan(ctx, anim) {
    const rad = anim.angle * Math.PI / 180;
    const dirX = Math.cos(rad), dirY = -Math.sin(rad);
    const tail = this.e.holes[anim.tailIndex];
    if (!tail) return;
    const totalLen = anim.length * this.e.cellLength;
    const cx = tail.x + (anim.length - 1) / 2 * this.e.cellLength * dirX + anim.currentDx;
    const cy = this.e.topBarH + this.e.boardOffsetY + tail.y + (anim.length - 1) / 2 * this.e.cellLength * dirY + anim.currentDy;
    const bw = this.pigBodyWidth, bh = this.pigBodyHalf;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-rad);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = PIG_COLOR;
    roundRect(ctx, -totalLen / 2, -bh, totalLen, bw, 6);
    ctx.fill();
    ctx.strokeStyle = PIG_STROKE;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ---- 头部红色半透明遮罩（80%透明度，覆盖最后 HEAD_CELLS 个 cell） ----
  drawHeadOverlay(ctx, pig) {
    const rad = pig.angle * Math.PI / 180;
    const dirX = Math.cos(rad), dirY = -Math.sin(rad);
    const tail = this.e.holes[pig.tailIndex];
    if (!tail) return;
    const cl = this.e.cellLength;
    // 头部中心 = 最后 HEAD_CELLS 个 cell 的中心点
    const headMid = pig.length - HEAD_CELLS / 2;
    const headCx = tail.x + headMid * cl * dirX;
    const headCy = this.e.topBarH + this.e.boardOffsetY + tail.y + headMid * cl * dirY;
    const headLen = HEAD_CELLS * cl;
    const bw = this.pigBodyWidth;
    ctx.save();
    ctx.translate(headCx, headCy);
    ctx.rotate(-rad);
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = '#FF0000';
    roundRect(ctx, -headLen / 2, -bw / 2, headLen, bw, 4);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ---- 选中高亮虚线框 ----
  drawSelection(ctx, pig) {
    const rad = pig.angle * Math.PI / 180;
    const dirX = Math.cos(rad), dirY = -Math.sin(rad);
    const tail = this.e.holes[pig.tailIndex];
    if (!tail) return;
    const totalLen = pig.length * this.e.cellLength;
    const cx = tail.x + (pig.length - 1) / 2 * this.e.cellLength * dirX;
    const cy = this.e.topBarH + this.e.boardOffsetY + tail.y + (pig.length - 1) / 2 * this.e.cellLength * dirY;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-rad);
    ctx.strokeStyle = SELECTED_COLOR;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(-totalLen / 2 - 3, -this.e.diameter / 2 - 3, totalLen + 6, this.e.diameter + 6);
    ctx.setLineDash([]);
    ctx.restore();
  }
}

module.exports = { PigRenderer, roundRect, PIG_COLOR, PIG_STROKE, SELECTED_COLOR };
