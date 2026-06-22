// GameplayEngine — 核心玩法引擎（v1）
// 棋盘计算、占用管理、碰撞检测、旋转追逐、推出机制、渲染
// 被 EditorEngine / TestEngine / RealGameEngine 共同组合使用

const { ctx, canvas, SCREEN_WIDTH, SCREEN_HEIGHT } = require('../render.js');
const { PigRenderer, roundRect, AnimType } = require('../render/PigRenderer.js');

// ========== 常量 ==========
// Claymorphism 风格：格子 = 棋盘上的凹陷引导，非独立视觉元素
// 用内阴影制造浮雕感，颜色贴近白色但不消失
const HOLE_EMPTY = '#FFFFFF';       // 空闲格子：淡紫灰 + 内阴影 0.3
const HOLE_OCCUPIED = '#E8DFF0';    // 已占用：略浅 + 内阴影 0.25
const HOLE_SHADOW_EMPTY = '#D4C5DF';   // 空闲内阴影边缘色（向 rgba(112,97,120,0.3) 方向）
const HOLE_SHADOW_OCCUPIED = '#D9CBE8'; // 已占用内阴影边缘色（向 rgba(112,97,120,0.25) 方向）
const BG_COLOR = '#1a1a2e';
const PUSH_ANIM_DURATION = 6400;
const CHASE_SPEED = 12;
const HEAD_ZONE_MULT = 1;  // 头部区域 = HEAD_ZONE_MULT × diameter 像素

class GameplayEngine {
  constructor() {
    // ===== 布局常量 =====
    this.topBarH = 48;
    this.bottomStripH = 175;

    // ===== 棋盘参数 =====
    this.cols = 5;
    this.rows = 5;
    this.hGap = 10;
    this.vGap = 10;
    this.diameter = 30;
    // ===== 屏幕适配 =====
    this.effectiveWidth = SCREEN_WIDTH;
    // ===== 动态计算 =====
    this.boardScale = 1;
    this.scaledDiameter = 30;
    this.scaledHalfDiameter = 15;
    this.scaledHeadZone = 30;
    this.boardOffsetX = 0;
    this.boardOffsetY = 0;
    this.hSpacing = 0;
    this.vSpacing = 0;
    this.holes = [];
    this.holeOccupied = [];

    // ===== 小猪 =====
    this.pigs = [];
    this.nextPigId = 0;
    this.selectedPigId = null;

    // ===== 拖拽状态 =====
    this.dragState = null;
    this.lastDragTime = 0;

    // ===== 动画 =====
    this.animations = [];
    this.ghostAnimations = [];
    this.flyingPigs = [];
    this.flashingPigs = {};
    this._hintOC = null;  // 提示粉色遮罩专用离屏画布（复用）

    // ===== 渲染 =====
    this.pigRenderer = new PigRenderer(this);
  }

  // ============================================================
  // 棋盘计算
  // ============================================================
  // maxBoardHOverride: 可选，强制使用指定的最大棋盘高度（编辑器传入游戏等效值，确保角度修正一致）
  recomputeBoard(maxBoardHOverride) {
    const maxBoardW = SCREEN_WIDTH;
    const maxBoardH = maxBoardHOverride != null ? maxBoardHOverride : (SCREEN_HEIGHT - this.topBarH - this.bottomStripH);

    // 屏幕适配缩放：宽+高双约束，取较小者，保证棋盘等比缩放不压扁
    const widthScale = this.effectiveWidth / 375;
    const heightScale = this.rows > 0
      ? maxBoardH / (this.rows * (this.diameter + this.vGap))
      : widthScale;
    this.boardScale = Math.max(0.75, Math.min(1.5, Math.min(widthScale, heightScale)));
    const sd = this.diameter * this.boardScale;
    const shg = this.hGap * this.boardScale;
    const svg = this.vGap * this.boardScale;
    this.scaledDiameter = sd;
    this.scaledHalfDiameter = sd / 2;
    this.scaledHeadZone = sd * HEAD_ZONE_MULT;
    this.hSpacing = sd + shg;
    this.vSpacing = sd + svg;

    // 安全兜底：极端情况（例如 boardScale 触及 0.75 floor 后仍溢出）压缩间距
    if (this.cols * this.hSpacing > maxBoardW) {
      this.hSpacing = Math.floor(maxBoardW / this.cols);
    }
    if (this.rows * this.vSpacing > maxBoardH) {
      this.vSpacing = Math.floor(maxBoardH / this.rows);
    }

    this.computeHoles();
    this.rebuildOccupancy();
  }

  // 碰撞检测射线推进步长 = 孔位半径（diameter/2）
  get collisionStep() { return this.scaledHalfDiameter; }

  // 猪身体宽度 = 渲染对齐，碰撞也用这个值
  get pigBodyWidth() { return this.scaledDiameter * 1.3; }

  computeHoles() {
    this.holes = [];
    const hStep = this.hSpacing;
    const vStep = this.vSpacing;
    const mx = hStep / 2;
    const my = vStep / 2;

    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        this.holes.push({ x: mx + c * hStep, y: my + r * vStep, type: 'grid', row: r, col: c });
      }
    }
    for (let r = 0; r < this.rows - 1; r++) {
      for (let c = 0; c < this.cols - 1; c++) {
        this.holes.push({
          x: mx + hStep / 2 + c * hStep,
          y: my + vStep / 2 + r * vStep,
          type: 'diag', row: r, col: c
        });
      }
    }
  }

  // ============================================================
  // 棋盘居中对齐
  // ============================================================
  recenterBoard() {
    const visualW = this.cols * this.hSpacing;
    const visualH = this.rows * this.vSpacing;
    const availH = SCREEN_HEIGHT - this.topBarH - this.bottomStripH;
    this.boardOffsetX = Math.max(0, Math.round((SCREEN_WIDTH - visualW) / 2));
    this.boardOffsetY = Math.max(0, Math.round((availH - visualH) / 2));
  }

  // ============================================================
  // 占用管理
  // ============================================================
  rebuildOccupancy() {
    this.holeOccupied = new Array(this.holes.length).fill(-1);
    for (const pig of this.pigs) {
      const occ = this.getPigOccupiedHoles(pig.tailIndex, pig.length, pig.angle);
      for (const hi of occ) {
        if (hi >= 0 && hi < this.holeOccupied.length) {
          if (this.holeOccupied[hi] === -1) {
            this.holeOccupied[hi] = pig.id;
          }
          // 不覆盖已被其他猪占据的孔，防止两猪共占一孔
        }
      }
    }
  }

  updatePigOccupancy(pigId, tailIdx, length, angle) {
    for (let i = 0; i < this.holeOccupied.length; i++) {
      if (this.holeOccupied[i] === pigId) this.holeOccupied[i] = -1;
    }
    const occ = this.getPigOccupiedHoles(tailIdx, length, angle);
    for (const hi of occ) {
      if (hi >= 0 && hi < this.holeOccupied.length) {
        if (this.holeOccupied[hi] === -1 || this.holeOccupied[hi] === pigId) {
          this.holeOccupied[hi] = pigId;
        }
      }
    }
  }

  clearPigOccupancy(pigId) {
    for (let i = 0; i < this.holeOccupied.length; i++) {
      if (this.holeOccupied[i] === pigId) this.holeOccupied[i] = -1;
    }
  }

  // ============================================================
  // 小猪几何计算（v30 改为矩形 OBB 模型）
  // ============================================================

  // ---- OBB 矩形几何 ----
  // 返回 { cx, cy, hw, hh, cosL, sinL, cosP, sinP, rad }
  // hw = 半长（沿方向）, hh = 半宽（垂直方向）
  getPigRect(tailIndex, length, angle) {
    const tail = this.holes[tailIndex];
    if (!tail) return null;
    const rad = angle * Math.PI / 180;
    const cosL = Math.cos(rad);
    const sinL = -Math.sin(rad);       // canvas y-flip
    const totalLen = length * this.boardScale;  // 逻辑长度 → 屏幕像素
    const hw = totalLen / 2;
    const hh = this.pigBodyWidth / 2;
    // OBB 锚定在孔心；尾正方形中心 = 孔心，头正方形中心 = _headSquareCenter
    const cx = tail.x + hw * cosL;
    const cy = tail.y + hw * sinL;
    // 垂直轴
    const cosP = Math.sin(rad);
    const sinP = Math.cos(rad);
    // 胶囊碰撞体（矩形身体 + 两端半圆，消除 OBB 旋转尖角误判）
    // 占用判定半径 = 孔直径 * 2/3（宽于碰撞半径，确保身体覆盖孔心即判定占用）
    const capRadius = this.scaledDiameter * 2 / 3;
    // 猪间碰撞半径 = 孔直径 * 1/3（保持窄，避免猪之间轻易碰撞）
    const collisionCapRadius = this.scaledDiameter / 3;
    // 胶囊线段端点（尾部孔心 → 头部正方形中心）
    const capTailX = tail.x;
    const capTailY = tail.y;
    const capHeadX = cx + hw * cosL;
    const capHeadY = cy + hw * sinL;
    // 触控区：半高 = 孔半径 × 1.5（孔直径的1.5倍宽，方便手指点选）
    const touchHh = this.scaledHalfDiameter * 1.5;
    // 触控区头部额外延伸 = 1/4 孔直径
    const touchHeadExt = this.scaledHalfDiameter * 0.5;
    // 保留 OBB 数据供触控和兼容代码使用
    const collisionHw = hw + this.scaledHalfDiameter;
    const collisionHh = this.scaledDiameter / 3;  // 猪间碰撞半径保持窄，不受占用半径影响
    return { cx, cy, hw, hh, collisionHw, collisionHh, touchHw: collisionHw, touchHh, touchHeadExt, cosL, sinL, cosP, sinP, rad,
      capTailX, capTailY, capHeadX, capHeadY, capRadius, collisionCapRadius };
  }

  // 矩形头端中心点（用于落孔判定）
  // 头部正方形碰撞区中心（对角线交点）
  // B = OBB前端边缘中点 - R * 头部方向（往回R进入正方形中心）
  _headSquareCenter(rect) {
    // B = OBB前端边缘中点，正方形中心 = F（不再是 F-R）
    return {
      x: rect.cx + rect.hw * rect.cosL,
      y: rect.cy + rect.hw * rect.sinL
    };
  }

  // ---- 胶囊碰撞体（矩形 + 两端半圆） ----
  // 替换 OBB SAT 碰撞，消除旋转时矩形尖角误判

  // 点到线段最近点 + 距离平方
  _pointToSegment(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) {
      const ex = px - ax, ey = py - ay;
      return { t: 0, dist2: ex * ex + ey * ey, cx: ax, cy: ay };
    }
    let t = ((px - ax) * dx + (py - ay) * dy) / len2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + t * dx, cy = ay + t * dy;
    const ex = px - cx, ey = py - cy;
    return { t, dist2: ex * ex + ey * ey, cx, cy };
  }

  // 线段到线段最近点对（距离平方）
  _segmentSegmentClosest(ax1, ay1, ax2, ay2, bx1, by1, bx2, by2) {
    const dax = ax2 - ax1, day = ay2 - ay1;
    const dbx = bx2 - bx1, dby = by2 - by1;
    // 检查端点对端点
    let bestDist2 = Infinity;
    let best = { ax: 0, ay: 0, bx: 0, by: 0 };
    const testPt = (px, py) => {
      const r = this._pointToSegment(px, py, ax1, ay1, ax2, ay2);
      if (r.dist2 < bestDist2) {
        bestDist2 = r.dist2;
        best = { ax: r.cx, ay: r.cy, bx: px, by: py };
      }
    };
    // B 端点 → A 线段
    testPt(bx1, by1);
    testPt(bx2, by2);
    // A 端点 → B 线段
    const revTest = (px, py) => {
      const r = this._pointToSegment(px, py, bx1, by1, bx2, by2);
      if (r.dist2 < bestDist2) {
        bestDist2 = r.dist2;
        best = { ax: px, ay: py, bx: r.cx, by: r.cy };
      }
    };
    revTest(ax1, ay1);
    revTest(ax2, ay2);
    return best;
  }

  _capsuleIntersect(a, b) {
    const cp = this._segmentSegmentClosest(
      a.capTailX, a.capTailY, a.capHeadX, a.capHeadY,
      b.capTailX, b.capTailY, b.capHeadX, b.capHeadY
    );
    const dx = cp.ax - cp.bx, dy = cp.ay - cp.by;
    const r = (a.collisionCapRadius || a.capRadius) + (b.collisionCapRadius || b.capRadius);
    return dx * dx + dy * dy <= r * r;
  }

  _capsuleContainsPoint(r, px, py) {
    const cp = this._pointToSegment(px, py, r.capTailX, r.capTailY, r.capHeadX, r.capHeadY);
    return cp.dist2 <= r.capRadius * r.capRadius;
  }

  // 两条线段最近点对的距离平方（用于后退判断）
  _segSegDist2(ax1, ay1, ax2, ay2, bx1, by1, bx2, by2) {
    const cp = this._segmentSegmentClosest(ax1, ay1, ax2, ay2, bx1, by1, bx2, by2);
    const dx = cp.ax - cp.bx;
    const dy = cp.ay - cp.by;
    return dx * dx + dy * dy;
  }

  // 判断 proposed 位置是否在远离 otherPigId（已重叠 → 后退豁免）
  _isRetreatingFrom(pigId, proposedTailIdx, proposedLen, proposedAngle, otherPigId) {
    const pig = this.pigs.find(p => p.id === pigId);
    if (!pig) return false;
    const other = this.pigs.find(p => p.id === otherPigId);
    if (!other) return false;

    // 当前是否已重叠？用 capRadius（占用半径，宽）而非 collisionCapRadius（碰撞半径，窄）
    // 因为视觉重叠对应的是占用半径级，碰撞半径仅为 1/2 会漏判
    const cr = this.getPigRect(pig.tailIndex, pig.length, pig.angle);
    const ob = this.getPigRect(other.tailIndex, other.length, other.angle);
    if (!cr || !ob) return false;
    const crWide = { ...cr, collisionCapRadius: undefined };
    const obWide = { ...ob, collisionCapRadius: undefined };
    if (!this._capsuleIntersect(crWide, obWide)) return false;

    // 提议位置胶囊
    const pr = this.getPigRect(proposedTailIdx, proposedLen, proposedAngle);
    if (!pr) return false;

    // 比较线段最近点距离平方：变大 = 在后退
    const d2Now = this._segSegDist2(
      cr.capTailX, cr.capTailY, cr.capHeadX, cr.capHeadY,
      ob.capTailX, ob.capTailY, ob.capHeadX, ob.capHeadY
    );
    const d2Next = this._segSegDist2(
      pr.capTailX, pr.capTailY, pr.capHeadX, pr.capHeadY,
      ob.capTailX, ob.capTailY, ob.capHeadX, ob.capHeadY
    );
    return d2Next > d2Now + 1;  // 阈值 1px² 防浮点抖动
  }

  // 判断平移 (dx,dy) 是否在远离 otherPigId（推出逃脱时使用）
  _isRetreatingFromShifted(pigId, dx, dy, otherPigId) {
    const pig = this.pigs.find(p => p.id === pigId);
    if (!pig) return false;
    const other = this.pigs.find(p => p.id === otherPigId);
    if (!other) return false;

    const cr = this.getPigRect(pig.tailIndex, pig.length, pig.angle);
    const ob = this.getPigRect(other.tailIndex, other.length, other.angle);
    if (!cr || !ob) return false;

    // 当前不重叠 → 不豁免（用 capRadius 宽检测，与视觉重叠保持一致）
    const crWide2 = { ...cr, collisionCapRadius: undefined };
    const obWide2 = { ...ob, collisionCapRadius: undefined };
    if (!this._capsuleIntersect(crWide2, obWide2)) return false;

    // 提议位移后的胶囊
    const pr = {
      capTailX: cr.capTailX + dx,
      capTailY: cr.capTailY + dy,
      capHeadX: cr.capHeadX + dx,
      capHeadY: cr.capHeadY + dy,
      collisionCapRadius: cr.collisionCapRadius,
      capRadius: cr.capRadius,
    };

    // 提议后不相交 → 一定是在远离
    if (!this._capsuleIntersect(pr, ob)) return true;

    // 都相交但距离增加 → 在后退
    const d2Now = this._segSegDist2(
      cr.capTailX, cr.capTailY, cr.capHeadX, cr.capHeadY,
      ob.capTailX, ob.capTailY, ob.capHeadX, ob.capHeadY
    );
    const d2Next = this._segSegDist2(
      pr.capTailX, pr.capTailY, pr.capHeadX, pr.capHeadY,
      ob.capTailX, ob.capTailY, ob.capHeadX, ob.capHeadY
    );
    return d2Next > d2Now + 1;
  }

  // ---- OBB 碰撞（分离轴定理） — 保留给触控检测 ----
  obbIntersect(a, b) {
    const proj = (cx, cy, hw, hh, cosL, sinL, cosP, sinP, ax, ay) => {
      const cp = cx * ax + cy * ay;
      const r = Math.abs(hw * (cosL * ax + sinL * ay)) + Math.abs(hh * (cosP * ax + sinP * ay));
      return [cp - r, cp + r];
    };
    const axes = [
      [a.cosL, a.sinL], [a.cosP, a.sinP],
      [b.cosL, b.sinL], [b.cosP, b.sinP],
    ];
    for (const [ax, ay] of axes) {
      const [minA, maxA] = proj(a.cx, a.cy, a.collisionHw, a.collisionHh, a.cosL, a.sinL, a.cosP, a.sinP, ax, ay);
      const [minB, maxB] = proj(b.cx, b.cy, b.collisionHw, b.collisionHh, b.cosL, b.sinL, b.cosP, b.sinP, ax, ay);
      if (maxA < minB || maxB < minA) return false;
    }
    return true;
  }

  // ---- 胶囊位移后的碰撞检测 ----
  _shiftedObbCollision(rect, dx, dy, excludeId) {
    const moved = {
      capTailX: rect.capTailX + dx, capTailY: rect.capTailY + dy,
      capHeadX: rect.capHeadX + dx, capHeadY: rect.capHeadY + dy,
      capRadius: rect.capRadius
    };
    for (const other of this.pigs) {
      if (other.id === excludeId) continue;
      const ob = this.getPigRect(other.tailIndex, other.length, other.angle);
      if (!ob) continue;
      if (this._capsuleIntersect(moved, ob)) return other.id;
    }
    return -1;
  }

  // ---- 孔位占用（胶囊版） ----
  getPigOccupiedHoles(tailIndex, length, angle) {
    const r = this.getPigRect(tailIndex, length, angle);
    if (!r) return [];
    const occupied = [];
    for (let hi = 0; hi < this.holes.length; hi++) {
      const h = this.holes[hi];
      if (this._capsuleContainsPoint(r, h.x, h.y)) {
        occupied.push(hi);
      }
    }
    return occupied;
  }

  // ---- 命中检测（矩形版） ----
  getPigAtPoint(x, y) {
    const offY = this.topBarH + this.boardOffsetY;
    for (const pig of this.pigs) {
      const r = this.getPigRect(pig.tailIndex, pig.length, pig.angle);
      if (!r) continue;
      const px = (x - this.boardOffsetX) - r.cx;
      const py = (y - offY) - r.cy;
      // 逆变换到矩形局部坐标
      const lx = px * Math.cos(r.rad) - py * Math.sin(r.rad);
      const ly = px * Math.sin(r.rad) + py * Math.cos(r.rad);
      // 触控区：头部方向额外延伸 touchHeadExt，尾部方向不变
      if (lx >= -r.touchHw && lx <= r.touchHw + r.touchHeadExt && Math.abs(ly) <= r.touchHh) {
        // 像素偏移（从尾部 0 → 头部 totalLen）
        const scaledLen = pig.length * this.boardScale;
        const offset = Math.max(0, Math.min(scaledLen, lx + r.hw));
        return { id: pig.id, offset, totalLen: scaledLen };
      }
    }
    return null;
  }

  getHoleAtPoint(x, y, margin) {
    const r = this.scaledHalfDiameter + (margin || 0);
    const offY = this.topBarH + this.boardOffsetY;
    for (let i = 0; i < this.holes.length; i++) {
      const hx = this.boardOffsetX + this.holes[i].x;
      const hy = offY + this.holes[i].y;
      const dx = x - hx, dy = y - hy;
      if (dx * dx + dy * dy <= r * r) return i;
    }
    return -1;
  }

  // ============================================================
  // 碰撞检测 & snap
  // ============================================================
  // 碰撞检测（胶囊版）
  checkAngleValid(tailIdx, len, excludeId, angle, requireHeadOnHole = true) {
    const r = this.getPigRect(tailIdx, len, angle);
    if (!r) return { valid: false };
    // ① 孔位占用（已重叠的后退可以豁免）
    const occupied = this.getPigOccupiedHoles(tailIdx, len, angle);
    for (const hi of occupied) {
      if (this.holeOccupied[hi] !== -1 && this.holeOccupied[hi] !== excludeId) {
        const otherId = this.holeOccupied[hi];
        if (this._isRetreatingFrom(excludeId, tailIdx, len, angle, otherId)) continue;
        return { valid: false, collidedId: otherId };
      }
    }
    // ② 胶囊碰撞（已重叠的后退可以豁免）
    for (const other of this.pigs) {
      if (other.id === excludeId) continue;
      const ob = this.getPigRect(other.tailIndex, other.length, other.angle);
      if (!ob) continue;
      if (this._capsuleIntersect(r, ob)) {
        if (this._isRetreatingFrom(excludeId, tailIdx, len, angle, other.id)) continue;
        return { valid: false, collidedId: other.id };
      }
    }
    if (!requireHeadOnHole) return { valid: true };
    // ③ 头部落孔（被其他猪占用但在后退 → 豁免占用检查）
    const headHole = this.findHeadHole(tailIdx, len, angle);
    if (headHole < 0) return { valid: false };
    if (this.holeOccupied[headHole] !== -1 && this.holeOccupied[headHole] !== excludeId) {
      const otherId = this.holeOccupied[headHole];
      if (!this._isRetreatingFrom(excludeId, tailIdx, len, angle, otherId)) {
        return { valid: false };
      }
    }
    return { valid: true };
  }

  snapAngleToHoles(tailIndex, length, rawAngle) {
    const tailHole = this.holes[tailIndex];
    if (!tailHole) return rawAngle;
    // 用角度比较代替空间距离：找 pig 当前方向所对的最近孔位
    // 角度计算 scale-invariant，不会因 boardScale 不同而选错孔
    let bestIdx = -1;
    let bestAngleDiff = Infinity;
    for (var i = 0; i < this.holes.length; i++) {
      if (i === tailIndex) continue;
      var hole = this.holes[i];
      var dx = hole.x - tailHole.x;
      var dy = -(hole.y - tailHole.y);  // y 轴与 canvas 反向
      var holeAngle = Math.atan2(dy, dx) * 180 / Math.PI;
      if (holeAngle < 0) holeAngle += 360;
      var diff = Math.abs(holeAngle - rawAngle);
      if (diff > 180) diff = 360 - diff;
      if (diff < bestAngleDiff) {
        bestAngleDiff = diff;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) return null;
    // 角度差太大 → 不对齐（阈值约 10°，容忍轻微偏差）
    if (bestAngleDiff > 10) return null;
    // 用最终角度再做一次 head hole 落孔验证
    var hole = this.holes[bestIdx];
    var dx2 = hole.x - tailHole.x;
    var dy2 = -(hole.y - tailHole.y);
    var snapAngle = Math.atan2(dy2, dx2) * 180 / Math.PI;
    if (snapAngle < 0) snapAngle += 360;
    if (this.findHeadHole(tailIndex, length, snapAngle) < 0) return null;
    return snapAngle;
  }

  // 关卡加载后修正所有猪的角度，确保与孔位对齐（历史关卡可能存有未对齐的角度）
  snapAllPigsAngles() {
    var corrected = 0;
    for (var i = 0; i < this.pigs.length; i++) {
      var pig = this.pigs[i];
      var snapped = this.snapAngleToHoles(pig.tailIndex, pig.length, pig.angle);
      if (snapped !== null && Math.abs(snapped - pig.angle) > 0.01) {
        console.log('[角度修正] 猪#' + pig.id + ' ' + pig.angle.toFixed(1) + '° → ' + snapped.toFixed(1) + '°');
        pig.angle = snapped;
        corrected++;
      }
    }
    if (corrected > 0) {
      this.rebuildOccupancy();
      console.log('[角度修正] 共修正 ' + corrected + ' 只猪的角度');
    }
    return corrected;
  }

  // 松手对齐：三点共线 + 长度回退搜索（全模式共用）
  // 对齐 = 尾部孔中心 → 头部落孔中心 → 猪头中心，三点在同一直线上
  // excludeId: 对齐搜索时排除被其他猪占用的孔。默认 -2（不跳过任何孔，向后兼容）。
  // 传 undefined 跳过所有已占用孔；传 pigId 跳过其他猪但保留自身占用的孔。
  snapAlignPig(tailIndex, length, hintAngle, excludeId = -2) {
    const r = this.getPigRect(tailIndex, length, hintAngle);
    if (!r) return null;
    const headCenter = this._headSquareCenter(r);
    const tailHole = this.holes[tailIndex];
    if (!tailHole) return null;

    // 收集所有候选头孔（未被其他猪占用，按距离排序）
    const candidates = [];
    for (let i = 0; i < this.holes.length; i++) {
      if (i === tailIndex) continue;
      if (this.holeOccupied[i] !== -1 && this.holeOccupied[i] !== excludeId) continue;
      const dx = this.holes[i].x - headCenter.x;
      const dy = this.holes[i].y - headCenter.y;
      candidates.push({ idx: i, d2: dx * dx + dy * dy });
    }
    candidates.sort((a, b) => a.d2 - b.d2);

    // 对每个候选头孔，尝试对齐并校验全孔占用（避免尾孔/中间孔冲突）
    for (const cand of candidates) {
      const bestHole = this.holes[cand.idx];
      let snapAngle = Math.atan2(-(bestHole.y - tailHole.y), bestHole.x - tailHole.x) * 180 / Math.PI;
      if (snapAngle < 0) snapAngle += 360;

      // 尝试原长度
      if (this.findHeadHole(tailIndex, length, snapAngle) >= 0) {
        if (this._checkConfigValid(tailIndex, length, snapAngle, excludeId)) {
          return { tailIndex, length, angle: snapAngle };
        }
      }
      // 缩短
      for (let dl = -1; dl >= -5; dl--) {
        const tryLen = length + dl;
        if (tryLen < 1) break;
        if (this.findHeadHole(tailIndex, tryLen, snapAngle) >= 0) {
          if (this._checkConfigValid(tailIndex, tryLen, snapAngle, excludeId)) {
            return { tailIndex, length: tryLen, angle: snapAngle };
          }
        }
      }
      // 加长
      for (let dl = 1; dl <= 5; dl++) {
        const tryLen = length + dl;
        if (this.findHeadHole(tailIndex, tryLen, snapAngle) >= 0) {
          if (this._checkConfigValid(tailIndex, tryLen, snapAngle, excludeId)) {
            return { tailIndex, length: tryLen, angle: snapAngle };
          }
        }
      }
      // 该候选头孔在任意长度下头都无法落孔 → 跳过，试下一个
    }

    return null;
  }

  // 检查配置是否合法（孔位占用 + 胶囊碰撞）
  _checkConfigValid(tailIndex, length, angle, excludeId) {
    // ① 孔位占用
    const occ = this.getPigOccupiedHoles(tailIndex, length, angle);
    for (const hi of occ) {
      if (this.holeOccupied[hi] !== -1 && this.holeOccupied[hi] !== excludeId) {
        return false;
      }
    }
    // ② 胶囊碰撞
    const pr = this.getPigRect(tailIndex, length, angle);
    if (!pr) return false;
    for (const other of this.pigs) {
      if (other.id === excludeId) continue;
      const ob = this.getPigRect(other.tailIndex, other.length, other.angle);
      if (!ob) continue;
      if (this._capsuleIntersect(pr, ob)) return false;
    }
    return true;
  }

  // ============================================================
  findHeadHole(tailIndex, length, angle) {
    if (angle == null) return -1;
    const r = this.getPigRect(tailIndex, length, angle);
    if (!r) return -1;
    const center = this._headSquareCenter(r);
    const thresh = this.scaledDiameter * 2 / 3;  // 孔的直径 * 2/3
    const thresh2 = thresh * thresh;
    let bestIdx = -1, bestDist2 = Infinity;
    for (let i = 0; i < this.holes.length; i++) {
      if (i === tailIndex) continue;  // 头部不能落在尾巴孔上
      const dx = center.x - this.holes[i].x;
      const dy = center.y - this.holes[i].y;
      const dist2 = dx * dx + dy * dy;
      if (dist2 <= thresh2) {
        if (dist2 < bestDist2) { bestDist2 = dist2; bestIdx = i; }
      }
    }
    return bestIdx;
  }

  // ============================================================
  // 二分查找碰撞边界：在 goodAngle(合法) ↔ badAngle(碰撞) 之间找最大合法角度
  // 仅碰撞帧调用，12 轮二分，精度 <0.01°
  // ============================================================
  findAngleBoundary(goodAngle, badAngle, tailIndex, length, excludeId) {
    let lo = goodAngle;
    let hi = badAngle;
    let diff = hi - lo;
    if (diff > 180) { lo += 360; }
    if (diff < -180) { hi += 360; }

    for (let i = 0; i < 12; i++) {
      const mid = ((lo + hi) / 2);
      const midNorm = ((mid % 360) + 360) % 360;
      const check = this.checkAngleValid(tailIndex, length, excludeId, midNorm, false);
      if (check.valid) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    return ((lo % 360) + 360) % 360;
  }

  // ============================================================
  // 碰撞效果（全身透明度闪烁 500ms，全模式生效）
  // ============================================================
  triggerCollisionEffect(pigId) {
    this.flashingPigs[pigId] = Date.now();
  }

  _cleanFlashingPigs() {
    const now = Date.now();
    const toDelete = [];
    for (const [pid, st] of Object.entries(this.flashingPigs)) {
      if (now - st > 500) toDelete.push(pid);
    }
    for (const pid of toDelete) delete this.flashingPigs[pid];
  }

  _getFlashAlpha(pigId) {
    const start = this.flashingPigs[pigId];
    if (!start) return 1;
    const elapsed = Date.now() - start;
    if (elapsed > 500) return 1;
    const t = elapsed / 500;
    return 0.25 + 0.75 * Math.abs(Math.sin(t * Math.PI * 4));
  }

  // ============================================================
  // 旋转追逐（核心玩法：三模式共享）
  // 小猪逐步向手指方向旋转，碰壁时一帧二分查找边界瞬间贴紧
  // ============================================================
  // pendingId 可选：编辑模式下 adjustHead 传入临时猪 ID
  handleRotateDrag(x, y, pendingId) {
    const ds = this.dragState;
    const targetId = pendingId || ds.pigId;
    const pig = this.pigs.find(p => p.id === targetId);
    if (!pig) return;
    const tail = this.holes[ds.tailIndex];
    if (!tail) return;

    const dx = x - this.boardOffsetX - tail.x;
    const dy = y - this.topBarH - this.boardOffsetY - tail.y;
    let fingerAngle = Math.atan2(-dy, dx) * 180 / Math.PI;
    if (fingerAngle < 0) fingerAngle += 360;
    fingerAngle = Math.round(fingerAngle);

    ds.targetAngle = fingerAngle;
    const len = pendingId ? ds.lockedLength : pig.length;

    let diff = ds.targetAngle - ds.displayAngle;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    if (Math.abs(diff) < 0.5) return;

    const step = Math.max(-CHASE_SPEED, Math.min(CHASE_SPEED, diff));
    let newAngle = ds.displayAngle + step;
    newAngle = ((newAngle % 360) + 360) % 360;
    newAngle = Math.round(newAngle);

    const check = this.checkAngleValid(ds.tailIndex, len, targetId, newAngle, false);

    if (check.valid) {
      ds.displayAngle = newAngle;
      const headHoleIdx = this.findHeadHole(ds.tailIndex, len, newAngle);
      if (headHoleIdx >= 0) {
        if (pendingId) {
          // 原地更新，避免 filter+push 重建数组
          const idx = this.pigs.findIndex(p => p.id === pendingId);
          if (idx >= 0) {
            this.pigs[idx] = { id: pendingId, tailIndex: ds.tailIndex, length: len, angle: newAngle };
          }
        } else {
          pig.angle = newAngle;
        }
        this.updatePigOccupancy(targetId, ds.tailIndex, len, newAngle);
        ds.lastValid = { tailIndex: ds.tailIndex, length: len, angle: newAngle };
        ds.headHoleIdx = headHoleIdx;
        ds.lastCollidedId = null;
        ds.isValidNow = true;
      } else {
        ds.headHoleIdx = -1;
        ds.isValidNow = false;
        if (pendingId && ds.lastValid) {
          const idx = this.pigs.findIndex(p => p.id === pendingId);
          if (idx >= 0) {
            this.pigs[idx] = { id: pendingId, tailIndex: ds.tailIndex, length: len, angle: ds.lastValid.angle };
          }
        }
      }
    } else if (check.collidedId !== undefined) {
      // 碰撞 → 一帧二分查找边界，瞬间贴紧
      const boundary = this.findAngleBoundary(ds.displayAngle, newAngle, ds.tailIndex, len, targetId);
      ds.displayAngle = boundary;
      if (pendingId) {
        const idx = this.pigs.findIndex(p => p.id === pendingId);
        if (idx >= 0) {
          this.pigs[idx] = { id: pendingId, tailIndex: ds.tailIndex, length: len, angle: boundary };
        }
      } else {
        pig.angle = boundary;
      }
      this.updatePigOccupancy(targetId, ds.tailIndex, len, boundary);
      ds.headHoleIdx = this.findHeadHole(ds.tailIndex, len, boundary);
      if (ds.headHoleIdx >= 0) {
        ds.lastValid = { tailIndex: ds.tailIndex, length: len, angle: boundary };
      }
      if (check.collidedId !== ds.lastCollidedId) {
        this.triggerCollisionEffect(check.collidedId);
        ds.lastCollidedId = check.collidedId;
      }
      ds.isValidNow = false;
    } else {
      ds.isValidNow = false;
      ds.headHoleIdx = -1;
      if (pendingId && ds.lastValid) {
        const idx = this.pigs.findIndex(p => p.id === pendingId);
        if (idx >= 0) {
          this.pigs[idx] = { id: pendingId, tailIndex: ds.tailIndex, length: len, angle: ds.lastValid.angle };
        }
      }
    }
  }

  // ============================================================
  // 推出检测
  // ============================================================
  // 推出检测（胶囊版）
  canPushPig(pigId) {
    const pig = this.pigs.find(p => p.id === pigId);
    if (!pig) return { canPush: false, reason: '猪不存在' };

    const r0 = this.getPigRect(pig.tailIndex, pig.length, pig.angle);
    if (!r0) return { canPush: false, reason: '无有效位置' };

    const rad = pig.angle * Math.PI / 180;
    const dirX = Math.cos(rad), dirY = -Math.sin(rad);
    const stepSize = this.collisionStep;
    const maxSteps = 100;

    for (let step = 1; step <= maxSteps; step++) {
      const dx = step * stepSize * dirX;
      const dy = step * stepSize * dirY;
      // 孔位碰撞（胶囊 vs 点）— 已重叠的后退可以豁免
      for (let hi = 0; hi < this.holes.length; hi++) {
        if (this.holeOccupied[hi] !== -1 && this.holeOccupied[hi] !== pigId) {
          const h = this.holes[hi];
          const ep = this._pointToSegment(h.x, h.y,
            r0.capTailX + dx, r0.capTailY + dy,
            r0.capHeadX + dx, r0.capHeadY + dy);
          if (ep.dist2 <= r0.capRadius * r0.capRadius) {
            const otherId = this.holeOccupied[hi];
            if (this._isRetreatingFromShifted(pigId, dx, dy, otherId)) continue;
            return { canPush: false, reason: `碰到猪 #${otherId}`, collidedPigId: otherId };
          }
        }
      }
      // OBB 碰撞 — 已重叠的后退可以豁免
      const cid = this._shiftedObbCollision(r0, dx, dy, pigId);
      if (cid >= 0) {
        if (this._isRetreatingFromShifted(pigId, dx, dy, cid)) continue;
        return { canPush: false, reason: `碰到猪 #${cid}`, collidedPigId: cid };
      }
    }
    return { canPush: true, dirX, dirY, totalDist: maxSteps * stepSize };
  }

  // ============================================================
  // 动画更新
  // ============================================================
  update() {
    const now = Date.now();
    for (const a of this.animations) {
      const elapsed = now - a.startTime;
      const progress = Math.min(1, elapsed / a.duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      a.currentDx = a.dirX * a.totalDist * eased;
      a.currentDy = a.dirY * a.totalDist * eased;
    }
    for (const g of this.ghostAnimations) {
      const elapsed = now - g.startTime;
      const progress = Math.min(1, elapsed / g.duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      g.currentDx = g.dirX * g.totalDist * eased;
      g.currentDy = g.dirY * g.totalDist * eased;
    }
    this._cleanFlashingPigs();
  }

  // ============================================================
  // === 渲染 ===
  // ============================================================

  // 渲染完整棋盘：孔位 + 小猪 + 预览高亮 + 动画
  // options: { hintText, drawHint }
  renderBoard(ctx, options = {}) {
    const r = this.scaledHalfDiameter;
    const offY = this.topBarH + this.boardOffsetY;

    // 孔位（Claymorphism 凹陷效果：径向渐变内阴影）
    for (let i = 0; i < this.holes.length; i++) {
      const h = this.holes[i];
      const occ = this.holeOccupied[i];
      const hx = this.boardOffsetX + h.x, hy = offY + h.y;

      ctx.beginPath();
      ctx.arc(hx, hy, r, 0, Math.PI * 2);

      if (occ !== -1) {
        // 已占用：浅色 + 弱内阴影，猪身之上隐约可见
        const grad = ctx.createRadialGradient(hx - 1, hy - 1, r * 0.1, hx, hy, r);
        grad.addColorStop(0, HOLE_OCCUPIED);
        grad.addColorStop(0.7, HOLE_OCCUPIED);
        grad.addColorStop(1, HOLE_SHADOW_OCCUPIED);
        ctx.fillStyle = grad;
        ctx.fill();
      } else {
        // 空闲：凹陷引导，内阴影更明显，透明度 70%
        ctx.save();
        ctx.globalAlpha = 0.7;
        const grad = ctx.createRadialGradient(hx - 1, hy - 1, r * 0.1, hx, hy, r);
        grad.addColorStop(0, HOLE_EMPTY);
        grad.addColorStop(0.65, HOLE_EMPTY);
        grad.addColorStop(1, HOLE_SHADOW_EMPTY);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.restore();
      }
    }

    // 拖拽中头部占孔 → 红色外边框高亮
    if (this.dragState && this.dragState.headHoleIdx >= 0) {
      const hh = this.holes[this.dragState.headHoleIdx];
      const hhx = this.boardOffsetX + hh.x, hhy = offY + hh.y;
      ctx.beginPath();
      ctx.arc(hhx, hhy, r, 0, Math.PI * 2);
      ctx.strokeStyle = '#FF3B30';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    // 小猪（含动画偏移）
    const pr = this.pigRenderer;
    const animOffs = {};
    for (const a of this.animations) animOffs[a.pigId] = { dx: a.currentDx, dy: a.currentDy };

    for (const pig of this.pigs) {
      const off = animOffs[pig.id] || { dx: 0, dy: 0 };
      const isDragPig = this.dragState && (
        this.dragState.pigId === pig.id || pig.id === this.dragState.pendingId
      );
      // 被撞效果：全身闪烁 500ms（通过透明度实现，全模式生效）
      const flashAlpha = this._getFlashAlpha(pig.id);

      // 正常绘制
      if (flashAlpha < 1) ctx.globalAlpha = flashAlpha;
      pr.draw(ctx, pig, off.dx, off.dy);
      ctx.globalAlpha = 1;

      // 提示目标染色：仅静止时染，拖拽/旋转中保持原色
      if (options.hintPigId != null && options.hintPigId === pig.id && !isDragPig) {
        var pigR = this.getPigRect(pig.tailIndex, pig.length, pig.angle);
        if (pigR) {
          var totalLen = Math.ceil(pigR.hw * 2 + this.scaledDiameter);
          var bodyH = Math.ceil(this.scaledDiameter * 1.3);
          var pad = 8;
          var ocW = totalLen + pad * 2;
          var ocH = bodyH * 2 + pad * 2;  // 猪头耳朵/尾巴会超出 bodyH，留足高度

          if (!this._hintOC) this._hintOC = wx.createCanvas();
          var oc = this._hintOC;
          oc.width = ocW; oc.height = ocH;
          var octx = oc.getContext('2d');
          octx.clearRect(0, 0, ocW, ocH);

          // 离屏画布：画猪（旋转后居中）
          octx.save();
          octx.translate(ocW / 2, ocH / 2);
          octx.rotate(-pigR.rad);
          if (flashAlpha < 1) octx.globalAlpha = flashAlpha;
          pr._drawPigImage(octx, totalLen, pig);
          octx.globalAlpha = 1;

          // 粉色染色（source-atop，离屏背景透明 → 只染猪像素）
          octx.globalCompositeOperation = 'source-atop';
          octx.globalAlpha = 0.35;
          octx.fillStyle = '#FF80A8';
          octx.fillRect(-ocW / 2, -ocH / 2, ocW, ocH);
          octx.restore();

          // 叠到主画布（离屏已旋转，只需平移）
          var pigCx = this.boardOffsetX + pigR.cx + off.dx;
          var pigCy = offY + pigR.cy + off.dy;
          ctx.drawImage(oc, pigCx - ocW / 2, pigCy - ocH / 2);
        }
      }

      // 拖拽中：头部绿点 + 碰撞区棕色虚线框 + 触控区蓝色虚线框（仅编辑模式）
      if (options.showCollisionBox && isDragPig) {
        pr.drawHeadDot(ctx, pig, off.dx, off.dy);
        pr.drawCollisionBox(ctx, pig, off.dx, off.dy);
        pr.drawTouchBox(ctx, pig, off.dx, off.dy);
      }
    }

    // 幽灵动画（面向 hintAngle 飞行）
    for (const g of this.ghostAnimations) {
      const pig = this.pigs.find(p => p.id === g.pigId);
      if (pig) {
        const savedAngle = pig.angle;
        pig.angle = g.hintAngle != null ? g.hintAngle : pig.angle;
        ctx.globalAlpha = 0.70;
        pr.draw(ctx, pig, g.currentDx, g.currentDy, AnimType.ESCAPE);
        ctx.globalAlpha = 1;
        pig.angle = savedAngle;
      }
    }

    // 飞行猪（已从逻辑层 pigs 移除，纯 UI 层渲染）
    for (const fp of this.flyingPigs) {
      const off = animOffs[fp.id] || { dx: 0, dy: 0 };
      pr.draw(ctx, fp, off.dx, off.dy, AnimType.ESCAPE);
    }

    // 选中时：碰撞区棕色虚线框 + 触控区蓝色虚线框 + 头部绿色圆点（仅编辑模式，无拖拽时）
    if (options.showCollisionBox && options.showSelection && this.selectedPigId != null && !this.dragState) {
      const pig = this.pigs.find(p => p.id === this.selectedPigId);
      if (pig) {
        pr.drawCollisionBox(ctx, pig, 0, 0);
        pr.drawTouchBox(ctx, pig, 0, 0);
        pr.drawHeadDot(ctx, pig, 0, 0);
      }
    }

    // 底部提示文字（屏幕坐标）
    if (options.hintText !== undefined) {
      const visualH = this.rows * this.vSpacing;
      const hintY = Math.min(SCREEN_HEIGHT - this.bottomStripH - 12, this.topBarH + this.boardOffsetY + visualH + 8);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(options.hintText, SCREEN_WIDTH / 2, hintY);
    }
  }

}
GameplayEngine.CHASE_SPEED = CHASE_SPEED;
GameplayEngine.HEAD_ZONE_MULT = HEAD_ZONE_MULT;

module.exports = GameplayEngine;
