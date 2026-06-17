// PigRenderer — 猪的独立渲染模块（v26.12）
// 从 GameplayEngine 抽离，减少 token 消耗
// require/module.exports，wx API

const PIG_COLOR = '#FFD700';
const PIG_STROKE = '#FFB300';
const SELECTED_COLOR = '#2196F3';

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
  get pigBodyWidth() { return this.e.diameter; }
  get pigBodyHalf()  { return this.pigBodyWidth / 2; }

  // ---- 拖拽中的显示角度（旋转追逐动画） ----
  getDisplayAngle(pig) {
    const ds = this.e.dragState;
    if (!ds || ds.displayAngle == null) return pig.angle;
    if (ds.type === 'rotate' && pig.id === ds.pigId) return ds.displayAngle;
    if (ds.type === 'adjustAngle' && pig.id === ds.pendingId) return ds.displayAngle;
    return pig.angle;
  }

  // ---- 坐标计算辅助 ----
  _pigCenter(pig, offDx, offDy) {
    const r = this.e.getPigRect(pig.tailIndex, pig.length, this.getDisplayAngle(pig));
    if (!r) return null;
    const cx = this.e.boardOffsetX + r.cx + (offDx || 0);
    const cy = this.e.topBarH + this.e.boardOffsetY + r.cy + (offDy || 0);
    return { cx, cy, rad: r.rad, totalLen: r.hw * 2 + this.e.diameter };
  }

  // ---- 三图拼接绘制（头尾等比 + 中段拉伸） ----
  // 在已 translate+rotate 的 ctx 中绘制，local 坐标系：x ∈ [-totalLen/2, totalLen/2]
  // 返回 true 表示图片已画出，false 表示图片未加载需 fallback
  _drawPigImage(ctx, totalLen) {
    const parts = _loadPigParts();
    if (!parts.allLoaded) return false;

    const bodyH = this.pigBodyWidth;                // 猪体高度 = 孔直径
    const imgScale = bodyH / parts.height;          // 等比缩放（图片等高→按高度缩放）
    let tailW = parts.tailW * imgScale;
    let headW = parts.headW * imgScale;
    const drawH = bodyH;

    // 如果猪太短，头尾等比缩小
    if (tailW + headW > totalLen) {
      const altScale = totalLen / (tailW + headW);
      tailW *= altScale;
      headW *= altScale;
    }
    const midW = totalLen - tailW - headW;          // 中段拉伸填充
    const overlap = 2;                               // 相邻段交叉像素
    const halfLen = totalLen / 2;
    const halfH = drawH / 2;

    // 尾（左端对齐，先画）
    ctx.drawImage(parts.tailImg, -halfLen, -halfH, tailW, drawH);

    // 中段（左右各交叉 overlap px，覆盖尾部和头部边缘）
    if (midW > 0.5) {
      ctx.drawImage(parts.midImg, -halfLen + tailW - overlap, -halfH, midW + overlap * 2, drawH);
    }

    // 头（右端对齐，最后画，覆盖中段右边缘）
    ctx.drawImage(parts.headImg, halfLen - headW, -halfH, headW, drawH);

    return true;
  }

  // ---- 正常猪绘制 ----
  draw(ctx, pig, offDx, offDy) {
    const c = this._pigCenter(pig, offDx, offDy);
    if (!c) return;
    const bw = this.pigBodyWidth, bh = this.pigBodyHalf;

    ctx.save();
    ctx.translate(c.cx, c.cy);
    ctx.rotate(-c.rad);

    if (!this._drawPigImage(ctx, c.totalLen)) {
      // 图片未加载 → 矩形 fallback
      ctx.fillStyle = PIG_COLOR;
      roundRect(ctx, -c.totalLen / 2, -bh, c.totalLen, bw, 6);
      ctx.fill();
      ctx.strokeStyle = PIG_STROKE;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const eyeX = c.totalLen / 2 - this.e.diameter * 0.35;
      const eyeY = -bh * 0.45;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(eyeX, eyeY, this.e.diameter * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#333';
      ctx.beginPath();
      ctx.arc(eyeX + 1, eyeY, this.e.diameter * 0.11, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  // ---- 碰撞闪烁效果 ----
  drawFlash(ctx, pig, t) {
    const r = this.e.getPigRect(pig.tailIndex, pig.length, pig.angle);
    if (!r) return;
    const cx = this.e.boardOffsetX + r.cx;
    const cy = this.e.topBarH + this.e.boardOffsetY + r.cy;
    const totalLen = r.hw * 2;
    const bw = this.pigBodyWidth, bh = this.pigBodyHalf;
    const flashAlpha = 0.7 * (1 - t) * (1 - t);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-r.rad);

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


  // ---- 头部红色半透明遮罩（最后 1×diameter 范围） ----
  drawHeadOverlay(ctx, pig) {
    const r = this.e.getPigRect(pig.tailIndex, pig.length, pig.angle);
    if (!r) return;
    const offY = this.e.topBarH + this.e.boardOffsetY;
    const bw = this.pigBodyWidth;
    // 头部中心 = _headSquareCenter（OBB前端，正方形中心）
    const hsc = this.e._headSquareCenter(r);
    const headLen = this.e.diameter;  // 头部区域 = HEAD_ZONE_MULT × diameter
    ctx.save();
    ctx.translate(this.e.boardOffsetX + hsc.x, offY + hsc.y);
    ctx.rotate(-r.rad);
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = '#FF0000';
    roundRect(ctx, -headLen / 2, -bw / 2, headLen, bw, 4);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ---- 选中高亮虚线框（OBB身体+头尾正方形） ----
  drawSelection(ctx, pig) {
    const r = this.e.getPigRect(pig.tailIndex, pig.length, pig.angle);
    if (!r) return;
    const offY = this.e.topBarH + this.e.boardOffsetY;
    const R = this.e.diameter / 2;
    const fullHw = r.hw + R;
    ctx.save();
    ctx.translate(this.e.boardOffsetX + r.cx, offY + r.cy);
    ctx.rotate(-r.rad);
    ctx.strokeStyle = SELECTED_COLOR;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(-fullHw, -r.hh, fullHw * 2, r.hh * 2);
    ctx.setLineDash([]);
    ctx.restore();
  }
}

// ============================================================
// === 三图拼接小猪绘制（主界面等场景复用）===
// ============================================================
// 尾(tail) + 中段(mid, 拉伸2倍宽) + 头(head)，左中右拼接
// 三张图等高，垂直居中对齐，总宽 = tail.w + mid.w*2 + head.w

let _pigParts = null;

function _loadPigParts() {
  if (_pigParts) return _pigParts;
  const parts = {
    tailImg: wx.createImage(), midImg: wx.createImage(), headImg: wx.createImage(),
    _loaded: [false, false, false],
    tailW: 0, midW: 0, headW: 0, height: 0
  };
  Object.defineProperty(parts, 'allLoaded', {
    get() { return this._loaded[0] && this._loaded[1] && this._loaded[2]; }
  });

  const base = 'assets/animals/roles/pig/';
  parts.tailImg.src = base + 'pig_tail.png';
  parts.midImg.src  = base + 'pig_mid.png';
  parts.headImg.src = base + 'pig_head.png';

  parts.tailImg.onload = () => { parts._loaded[0] = true; parts.tailW = parts.tailImg.width;  parts.height = Math.max(parts.height, parts.tailImg.height); };
  parts.midImg.onload  = () => { parts._loaded[1] = true; parts.midW  = parts.midImg.width;   parts.height = Math.max(parts.height, parts.midImg.height);  };
  parts.headImg.onload = () => { parts._loaded[2] = true; parts.headW = parts.headImg.width;  parts.height = Math.max(parts.height, parts.headImg.height); };

  _pigParts = parts;
  return parts;
}

/**
 * 获取拼接小猪的自然尺寸（加载中返回 null）
 * @returns {{ naturalW: number, naturalH: number } | null}
 */
function getComposedPigSize() {
  const parts = _loadPigParts();
  if (!parts.allLoaded) return null;
  // 三段间各重叠 1px，总宽减去 2 个重叠像素
  return {
    naturalW: parts.tailW + parts.midW * 2 + parts.headW - 2,
    naturalH: parts.height
  };
}

/**
 * 绘制三图拼接小猪
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x - 左上角 X
 * @param {number} y - 左上角 Y
 * @param {number} [scale=1] - 整体缩放比例
 * @returns {number} 绘制总宽度（scale 后）
 */
function drawComposedPig(ctx, x, y, scale = 1) {
  const parts = _loadPigParts();
  if (!parts.allLoaded) return 0;

  const tw = parts.tailW, mw = parts.midW * 2, hw = parts.headW;
  const drawH = parts.height * scale;
  const overlap = 1 * scale; // 三段间各重叠 1 个原始像素

  // 尾 — 左
  ctx.drawImage(parts.tailImg, x, y, tw * scale, drawH);
  let curX = x + tw * scale - overlap;

  // 中段 — 拉伸2倍（与尾重叠 1px）
  ctx.drawImage(parts.midImg, curX, y, mw * scale, drawH);
  curX += mw * scale - overlap;

  // 头 — 右（与中段重叠 1px）
  ctx.drawImage(parts.headImg, curX, y, hw * scale, drawH);

  return (tw + mw + hw - 2) * scale;
}

module.exports.PigRenderer = PigRenderer;
module.exports.roundRect = roundRect;
module.exports.PIG_COLOR = PIG_COLOR;
module.exports.PIG_STROKE = PIG_STROKE;
module.exports.SELECTED_COLOR = SELECTED_COLOR;
module.exports.drawComposedPig = drawComposedPig;
module.exports.getComposedPigSize = getComposedPigSize;
