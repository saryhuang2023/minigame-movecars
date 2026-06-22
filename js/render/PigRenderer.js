// PigRenderer — 猪的独立渲染模块（v26.13）
// 从 GameplayEngine 抽离，减少 token 消耗
// require/module.exports，wx API
// v26.13: 三宫格单图切片 → 尾固定/中拉伸/头固定，替代三图拼接

const databus = require('../databus');

const PIG_COLOR = '#FFD700';
const PIG_STROKE = '#FFB300';
const SELECTED_COLOR = '#2196F3';

// ============================================================
// === 三宫格切片比例 ===
// ============================================================
// 单张猪图中：尾部占比 / 头部占比，中段 = 1 - TAIL_SLICE - HEAD_SLICE
const TAIL_SLICE = 0.37;
const HEAD_SLICE = 0.51;

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
// 动画类型枚举（未来可扩展 JUMP、DIE 等）
const AnimType = Object.freeze({ IDLE: 'idle', RUN: 'run', ESCAPE: 'escape' });

const IDLE_FRAME_COUNT = 11;
const RUN_FRAME_COUNT = 8;
const ESCAPE_FRAME_COUNT = 8;
const IDLE_FRAME_INTERVAL = 600 / IDLE_FRAME_COUNT;
const RUN_FRAME_INTERVAL = 300 / RUN_FRAME_COUNT;
const ESCAPE_FRAME_INTERVAL = 200 / ESCAPE_FRAME_COUNT;
const WOBBLE_FREQ = 10;           // 身体摆动：每秒次数
const WOBBLE_AMPLITUDE = 0.005;  // 身体摆动：幅度（弧度）
const WOBBLE_PIVOT = 0.75;       // 身体摆动轴心位置（0=尾部端点, 1=中心）
const TAIL_WOBBLE_FREQ = 5;      // 尾部甩动：每秒次数（比身体快）
const TAIL_WOBBLE_AMPLITUDE = 0.015; // 尾部甩动：幅度（弧度，约0.86°）

class PigRenderer {
  constructor(engine) {
    this.e = engine; // GameplayEngine 引用（读取 holes / topBarH / boardOffsetY / diameter / dragState）
    this._animState = new Map(); // pigId → { frame, lastAdvance }
  }

  // ---- 猪身体尺寸 ----
  get pigBodyWidth() { return this.e.scaledDiameter * 1.2; }
  get pigBodyHalf()  { return this.pigBodyWidth / 2; }

  // ---- 拖拽中的显示角度（旋转追逐动画） ----
  getDisplayAngle(pig) {
    const ds = this.e.dragState;
    if (!ds || ds.displayAngle == null) return pig.angle;
    if (ds.type === 'rotate' && pig.id === ds.pigId) return ds.displayAngle;
    return pig.angle;
  }

  // ---- 坐标计算辅助 ----
  _pigCenter(pig, offDx, offDy) {
    const r = this.e.getPigRect(pig.tailIndex, pig.length, this.getDisplayAngle(pig));
    if (!r) return null;
    const cx = this.e.boardOffsetX + r.cx + (offDx || 0);
    const cy = this.e.topBarH + this.e.boardOffsetY + r.cy + (offDy || 0);
    return { cx, cy, rad: r.rad, totalLen: r.hw * 2 + this.e.scaledDiameter };
  }

  // ---- 三宫格绘制：单张源图切片，中段拉伸，头尾固定 ----
  // 在已 translate+rotate 的 ctx 中绘制，local 坐标系：x ∈ [-totalLen/2, totalLen/2]
  // animType: AnimType 枚举值，默认 IDLE
  // 返回 true 表示图片已画出，false 表示图片未加载需 fallback
  _drawPigImage(ctx, totalLen, pig, animType) {
    animType = animType || AnimType.IDLE;
    var parts, frameCount, frameInterval;
    if (animType === AnimType.RUN) {
      parts = _loadRunParts();
      frameCount = RUN_FRAME_COUNT;
      frameInterval = RUN_FRAME_INTERVAL;
    } else if (animType === AnimType.ESCAPE) {
      parts = _loadEscapeParts();
      frameCount = ESCAPE_FRAME_COUNT;
      frameInterval = ESCAPE_FRAME_INTERVAL;
    } else {
      parts = _loadPigParts();
      frameCount = IDLE_FRAME_COUNT;
      frameInterval = IDLE_FRAME_INTERVAL;
    }
    if (!parts.allLoaded) return false;

    var frameImg = parts.frameImg;

    // 序列帧动画：有 pig 且全部帧已加载 → 按时间推进帧号
    if (pig && parts.idleAllLoaded) {
      var state = this._animState.get(pig.id);
      if (!state) {
        state = { frame: 0, lastAdvance: Date.now() };
        this._animState.set(pig.id, state);
      }

      var now = Date.now();
      if (now - state.lastAdvance >= frameInterval) {
        state.frame = (state.frame + 1) % frameCount;
        state.lastAdvance = now;
      }
      if (parts.idleFrameImgs[state.frame]) {
        frameImg = parts.idleFrameImgs[state.frame];
      }
    }

    const bodyH = this.pigBodyWidth;
    const imgScale = bodyH / parts.height;
    const drawH = bodyH;
    const halfH = drawH / 2;
    const halfLen = totalLen / 2;

    // 三宫格切片：尾(左) / 中(拉伸) / 头(右)
    const srcW = parts.frameW;
    const tailSrcW = Math.round(srcW * TAIL_SLICE);
    const headSrcW = Math.round(srcW * HEAD_SLICE);
    const midSrcW = srcW - tailSrcW - headSrcW;

    let tailDrawW = tailSrcW * imgScale;
    let headDrawW = headSrcW * imgScale;

    // 如果猪太短，头尾等比缩小
    if (tailDrawW + headDrawW > totalLen) {
      const altScale = totalLen / (tailDrawW + headDrawW);
      tailDrawW *= altScale;
      headDrawW *= altScale;
    }
    const midDrawW = totalLen - tailDrawW - headDrawW;

    // 尾（左端固定）
    ctx.drawImage(frameImg,
      0, 0, tailSrcW, parts.height,
      -halfLen, -halfH, tailDrawW, drawH);

    // 中段（拉伸填充中间空间）
    if (midDrawW > 0.5) {
      ctx.drawImage(frameImg,
        tailSrcW, 0, midSrcW, parts.height,
        -halfLen + tailDrawW, -halfH, midDrawW, drawH);
    }

    // 头（右端固定）
    ctx.drawImage(frameImg,
      tailSrcW + midSrcW, 0, headSrcW, parts.height,
      halfLen - headDrawW, -halfH, headDrawW, drawH);

    return true;
  }

  // ---- 正常猪绘制 ----
  // animType: 可选 AnimType 枚举值，不传则自动判断（拖拽→RUN，否则→IDLE）
  draw(ctx, pig, offDx, offDy, animType) {
    const c = this._pigCenter(pig, offDx, offDy);
    if (!c) return;

    const ds = this.e.dragState;
    animType = animType || ((ds && ds.pigId === pig.id) ? AnimType.RUN : AnimType.IDLE);

    ctx.save();
    ctx.translate(c.cx, c.cy);
    ctx.rotate(-c.rad);

    // 风筝抖动：idle 和 escape 时生效（拖拽/编辑器不晃）
    // 方案二：轴心前移（身体整体摇晃 + 尾部独立微摆）
    if ((animType === AnimType.IDLE) && databus.gameState !== 'editor') {
      const halfLen = c.totalLen / 2;
      const now = Date.now();

      // 身体摆动：轴心放在尾部往前 25% 处，头尾都动
      const bodyPivotOff = halfLen * WOBBLE_PIVOT;
      const bodyWobble = Math.sin(now * 0.001 * WOBBLE_FREQ + pig.id * 1.7) * WOBBLE_AMPLITUDE;
      ctx.translate(-bodyPivotOff, 0);
      ctx.rotate(bodyWobble);
      ctx.translate(bodyPivotOff, 0);

      // 尾部独立甩动：快速小幅度，模拟风筝尾巴抖动
      const tailWobble = Math.sin(now * 0.001 * TAIL_WOBBLE_FREQ + pig.id * 2.3) * TAIL_WOBBLE_AMPLITUDE;
      ctx.translate(-halfLen, 0);
      ctx.rotate(tailWobble);
      ctx.translate(halfLen, 0);
    }

    this._drawPigImage(ctx, c.totalLen, pig, animType);

    ctx.restore();
  }

  // ---- 头部中心绿点 ----
  drawHeadDot(ctx, pig, offDx, offDy) {
    const r = this.e.getPigRect(pig.tailIndex, pig.length, pig.angle);
    if (!r) return;
    const hsc = this.e._headSquareCenter(r);
    const cx = this.e.boardOffsetX + hsc.x + (offDx || 0);
    const cy = this.e.topBarH + this.e.boardOffsetY + hsc.y + (offDy || 0);
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#00C853';
    ctx.fill();
  }
  // ---- 碰撞区棕色虚线框 ----
  drawCollisionBox(ctx, pig, offDx, offDy) {
    const r = this.e.getPigRect(pig.tailIndex, pig.length, pig.angle);
    if (!r) return;
    const cx = this.e.boardOffsetX + r.cx + (offDx || 0);
    const cy = this.e.topBarH + this.e.boardOffsetY + r.cy + (offDy || 0);
    const hw = r.collisionHw;
    const hh = r.collisionHh;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-r.rad);

    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#8B6914';
    ctx.lineWidth = 2;
    ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);

    ctx.setLineDash([]);
    ctx.restore();
  }

  // ---- 触控区蓝色虚线框（比碰撞区宽，头部额外延伸） ----
  drawTouchBox(ctx, pig, offDx, offDy) {
    const r = this.e.getPigRect(pig.tailIndex, pig.length, pig.angle);
    if (!r) return;
    const cx = this.e.boardOffsetX + r.cx + (offDx || 0);
    const cy = this.e.topBarH + this.e.boardOffsetY + r.cy + (offDy || 0);
    const hw = r.touchHw;
    const hh = r.touchHh;
    const headExt = r.touchHeadExt;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-r.rad);

    // 触控区矩形：尾部端 hw，头部端 hw + headExt（非对称，需分两半）
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = '#4A90D9';
    ctx.lineWidth = 1.5;

    // 尾部半边（-hw → 0）
    ctx.strokeRect(-hw, -hh, hw, hh * 2);
    // 头部半边（0 → hw + headExt）
    ctx.strokeRect(0, -hh, hw + headExt, hh * 2);

    ctx.setLineDash([]);
    ctx.restore();
  }

}

// ============================================================
// === 单图序列帧加载（三宫格切片）===
// ============================================================
// 每帧一张完整猪图，通过 TAIL_SLICE/HEAD_SLICE 切片实现头尾固定/中段拉伸

// ---- idle ----
let _pigParts = null;

function _loadPigParts() {
  if (_pigParts) return _pigParts;

  var base = 'assets/animals/roles/pig/idle/1/';
  var parts = {
    frameImg: wx.createImage(),
    _loaded: false,
    frameW: 0, height: 0,

    idleFrameImgs: [],
    _idleLoaded: 0,
    get idleAllLoaded() { return this._idleLoaded >= IDLE_FRAME_COUNT; }
  };

  Object.defineProperty(parts, 'allLoaded', {
    get() { return this._loaded; }
  });

  // 加载首帧（也用作 drawComposedPig 等静态场景）
  parts.frameImg.src = base + '1.png';
  parts.frameImg.onload = function() {
    parts._loaded = true;
    parts.frameW = parts.frameImg.width;
    parts.height = parts.frameImg.height;
    parts.idleFrameImgs[0] = parts.frameImg;
    parts._idleLoaded++;
  };

  _preloadFrames(parts, base, IDLE_FRAME_COUNT);

  _pigParts = parts;
  return parts;
}

// ---- run ----
let _runParts = null;

function _loadRunParts() {
  if (_runParts) return _runParts;

  var base = 'assets/animals/roles/pig/run/1/';
  var parts = {
    frameImg: wx.createImage(),
    _loaded: false,
    frameW: 0, height: 0,

    idleFrameImgs: [],
    _idleLoaded: 0,
    get idleAllLoaded() { return this._idleLoaded >= RUN_FRAME_COUNT; }
  };

  Object.defineProperty(parts, 'allLoaded', {
    get() { return this._loaded; }
  });

  parts.frameImg.src = base + '1.png';
  parts.frameImg.onload = function() {
    parts._loaded = true;
    parts.frameW = parts.frameImg.width;
    parts.height = parts.frameImg.height;
    parts.idleFrameImgs[0] = parts.frameImg;
    parts._idleLoaded++;
  };

  _preloadFrames(parts, base, RUN_FRAME_COUNT);

  _runParts = parts;
  return parts;
}

// ---- escape ----
let _escapeParts = null;

function _loadEscapeParts() {
  if (_escapeParts) return _escapeParts;

  var base = 'assets/animals/roles/pig/escape/1/';
  var parts = {
    frameImg: wx.createImage(),
    _loaded: false,
    frameW: 0, height: 0,

    idleFrameImgs: [],
    _idleLoaded: 0,
    get idleAllLoaded() { return this._idleLoaded >= ESCAPE_FRAME_COUNT; }
  };

  Object.defineProperty(parts, 'allLoaded', {
    get() { return this._loaded; }
  });

  parts.frameImg.src = base + '1.png';
  parts.frameImg.onload = function() {
    parts._loaded = true;
    parts.frameW = parts.frameImg.width;
    parts.height = parts.frameImg.height;
    parts.idleFrameImgs[0] = parts.frameImg;
    parts._idleLoaded++;
  };

  _preloadFrames(parts, base, ESCAPE_FRAME_COUNT);

  _escapeParts = parts;
  return parts;
}

// ---- seq frame lazy loader ----
function _preloadFrames(parts, base, frameCount) {
  for (var i = 2; i <= frameCount; i++) {
    _loadOneFrame(parts, base, i);
  }
}
function _loadOneFrame(parts, base, i) {
  var img = wx.createImage();
  img.src = base + i + '.png';
  img.onload = function() {
    parts.idleFrameImgs[i - 1] = img;
    parts._idleLoaded++;
  };
  img.onerror = function() {
    // 加载失败也计数，避免 idleAllLoaded 永远为 false；降级继续用首帧
    parts._idleLoaded++;
  };
}

// ============================================================
// === 静态猪绘制（主界面 loading 等场景复用）===
// ============================================================

/**
 * 获取小猪的自然尺寸（三宫格拼接后的逻辑大小）
 * @returns {{ naturalW: number, naturalH: number } | null}
 */
function getComposedPigSize() {
  const parts = _loadPigParts();
  if (!parts.allLoaded) return null;

  const srcW = parts.frameW;
  const tailSrcW = Math.round(srcW * TAIL_SLICE);
  const headSrcW = Math.round(srcW * HEAD_SLICE);
  const midSrcW = srcW - tailSrcW - headSrcW;

  return {
    naturalW: tailSrcW + midSrcW * 2 + headSrcW,
    naturalH: parts.height
  };
}

/**
 * 绘制三宫格小猪
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x - 左上角 X
 * @param {number} y - 左上角 Y
 * @param {number} [scale=1] - 整体缩放比例
 * @returns {number} 绘制总宽度（scale 后）
 */
function drawComposedPig(ctx, x, y, scale = 1) {
  const parts = _loadPigParts();
  if (!parts.allLoaded) return 0;

  const srcW = parts.frameW;
  const srcH = parts.height;
  const tailSrcW = Math.round(srcW * TAIL_SLICE);
  const headSrcW = Math.round(srcW * HEAD_SLICE);
  const midSrcW = srcW - tailSrcW - headSrcW;

  const tw = tailSrcW * scale;
  const mw = midSrcW * 2 * scale;
  const hw = headSrcW * scale;
  const drawH = srcH * scale;

  // 尾（左）
  ctx.drawImage(parts.frameImg, 0, 0, tailSrcW, srcH, x, y, tw, drawH);
  // 中段（右移，拉伸 2 倍）
  ctx.drawImage(parts.frameImg, tailSrcW, 0, midSrcW, srcH, x + tw, y, mw, drawH);
  // 头（右）
  ctx.drawImage(parts.frameImg, tailSrcW + midSrcW, 0, headSrcW, srcH, x + tw + mw, y, hw, drawH);

  return (tailSrcW + midSrcW * 2 + headSrcW) * scale;
}

// 模块加载时立即触发猪图片预加载，避免首帧渲染时图片未就绪出现黄色 fallback 矩形
_loadPigParts();
_loadRunParts();
_loadEscapeParts();

module.exports.PigRenderer = PigRenderer;
module.exports.AnimType = AnimType;
module.exports.roundRect = roundRect;
module.exports.PIG_COLOR = PIG_COLOR;
module.exports.PIG_STROKE = PIG_STROKE;
module.exports.SELECTED_COLOR = SELECTED_COLOR;
module.exports.drawComposedPig = drawComposedPig;
module.exports.getComposedPigSize = getComposedPigSize;
