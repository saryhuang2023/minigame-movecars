// GameplayEngine — 核心玩法引擎（v1）
// 棋盘计算、占用管理、碰撞检测、旋转追逐、推出机制、渲染
// 被 EditorEngine / TestEngine / RealGameEngine 共同组合使用

const { ctx, canvas, SCREEN_WIDTH, SCREEN_HEIGHT } = require('../render.js');
const { PigRenderer, roundRect } = require('../render/PigRenderer.js');

// ========== 常量 ==========
const HOLE_EMPTY = '#C4A882';
const HOLE_OCCUPIED = '#6B3A20';
const HOLE_STROKE = 'rgba(255,255,255,0.45)';
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

    // ===== 渲染 =====
    this.pigRenderer = new PigRenderer(this);
  }

  // ============================================================
  // 棋盘计算
  // ============================================================
  recomputeBoard() {
    const maxBoardW = SCREEN_WIDTH;
    const maxBoardH = SCREEN_HEIGHT - this.topBarH - this.bottomStripH;

    // 屏幕适配缩放：以 375 为基准
    this.boardScale = Math.max(0.75, Math.min(1.5, this.effectiveWidth / 375));
    const sd = this.diameter * this.boardScale;
    const shg = this.hGap * this.boardScale;
    const svg = this.vGap * this.boardScale;
    this.scaledDiameter = sd;
    this.scaledHalfDiameter = sd / 2;
    this.scaledHeadZone = sd * HEAD_ZONE_MULT;
    this.hSpacing = sd + shg;
    this.vSpacing = sd + svg;

    // 棋盘超出屏幕时压缩间距
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
  get pigBodyWidth() { return this.scaledDiameter; }

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
          this.holeOccupied[hi] = pig.id;
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
    // collisionHw = OBB 矩形覆盖整头猪（含头部半圆），用于碰撞检测
    // hw 仅覆盖矩形身体部分，供渲染和落孔判定使用
    const collisionHw = hw + this.scaledHalfDiameter;
    // 碰撞区宽度 = 孔直径的 2/3（窄于视觉宽度，更贴近猪身）
    const collisionHh = this.scaledDiameter * 2 / 3 / 2;
    // 触控区：半高 = 孔半径（和孔的直径一样宽，方便手指点选）
    const touchHh = this.scaledHalfDiameter;
    return { cx, cy, hw, hh, collisionHw, collisionHh, touchHw: collisionHw, touchHh, cosL, sinL, cosP, sinP, rad };
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

  // ---- OBB 碰撞（分离轴定理） ----
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

  // ---- OBB 位移后的碰撞检测 ----
  _shiftedObbCollision(rect, dx, dy, excludeId) {
    const moved = { ...rect, cx: rect.cx + dx, cy: rect.cy + dy };
    for (const other of this.pigs) {
      if (other.id === excludeId) continue;
      const ob = this.getPigRect(other.tailIndex, other.length, other.angle);
      if (!ob) continue;
      if (this.obbIntersect(moved, ob)) return other.id;
    }
    return -1;
  }

  // ---- 孔位占用（矩形版） ----
  getPigOccupiedHoles(tailIndex, length, angle) {
    const r = this.getPigRect(tailIndex, length, angle);
    if (!r) return [];
    const occupied = [];
    for (let hi = 0; hi < this.holes.length; hi++) {
      const h = this.holes[hi];
      const dx = h.x - r.cx;
      const dy = h.y - r.cy;
      // 逆变换到矩形局部坐标
      const lx = dx * Math.cos(r.rad) - dy * Math.sin(r.rad);
      const ly = dx * Math.sin(r.rad) + dy * Math.cos(r.rad);
      if (Math.abs(lx) <= r.collisionHw && Math.abs(ly) <= r.collisionHh) {
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
      if (Math.abs(lx) <= r.touchHw && Math.abs(ly) <= r.touchHh) {
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
  // 碰撞检测（OBB 矩形版）
  checkAngleValid(tailIdx, len, excludeId, angle, requireHeadOnHole = true) {
    const r = this.getPigRect(tailIdx, len, angle);
    if (!r) return { valid: false };
    // ① 孔位占用
    const occupied = this.getPigOccupiedHoles(tailIdx, len, angle);
    for (const hi of occupied) {
      if (this.holeOccupied[hi] !== -1 && this.holeOccupied[hi] !== excludeId) {
        return { valid: false, collidedId: this.holeOccupied[hi] };
      }
    }
    // ② OBB 碰撞
    for (const other of this.pigs) {
      if (other.id === excludeId) continue;
      const ob = this.getPigRect(other.tailIndex, other.length, other.angle);
      if (!ob) continue;
      if (this.obbIntersect(r, ob)) return { valid: false, collidedId: other.id };
    }
    if (!requireHeadOnHole) return { valid: true };
    // ③ 头部落孔
    return { valid: this.findHeadHole(tailIdx, len, angle) >= 0 };
  }

  snapAngleToHoles(tailIndex, length, rawAngle) {
    const tailHole = this.holes[tailIndex];
    if (!tailHole) return rawAngle;
    const r = this.getPigRect(tailIndex, length, rawAngle);
    if (!r) return rawAngle;
    const center = this._headSquareCenter(r);
    const thresh = this.scaledHalfDiameter;  // R
    const thresh2 = thresh * thresh;
    let bestHole = null;
    let bestDist = Infinity;
    for (const hole of this.holes) {
      const dx = hole.x - center.x;
      const dy = hole.y - center.y;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist && dist <= thresh2) {
        bestDist = dist;
        bestHole = hole;
      }
    }
    if (!bestHole) return null;
    const dx = bestHole.x - tailHole.x;
    const dy = bestHole.y - tailHole.y;
    let snapAngle = Math.atan2(-dy, dx) * 180 / Math.PI;
    if (snapAngle < 0) snapAngle += 360;
    if (this.findHeadHole(tailIndex, length, snapAngle) < 0) return null;
    return snapAngle;
  }

  // 松手对齐：三点共线 + 长度回退搜索（全模式共用）
  // 对齐 = 尾部孔中心 → 头部落孔中心 → 猪头中心，三点在同一直线上
  snapAlignPig(tailIndex, length, hintAngle) {
    const r = this.getPigRect(tailIndex, length, hintAngle);
    if (!r) return null;
    const headCenter = this._headSquareCenter(r);
    const tailHole = this.holes[tailIndex];
    if (!tailHole) return null;

    // 找到离头部最近的孔（无距离限制，跳过尾孔）
    let bestIdx = -1, bestD2 = Infinity;
    for (let i = 0; i < this.holes.length; i++) {
      if (i === tailIndex) continue;
      const dx = this.holes[i].x - headCenter.x;
      const dy = this.holes[i].y - headCenter.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) { bestD2 = d2; bestIdx = i; }
    }
    if (bestIdx < 0) return null;

    // 计算尾孔 → 最近孔的精确角度（三点共线）
    const bestHole = this.holes[bestIdx];
    let snapAngle = Math.atan2(-(bestHole.y - tailHole.y), bestHole.x - tailHole.x) * 180 / Math.PI;
    if (snapAngle < 0) snapAngle += 360;

    // 尝试让头部真正落孔（优先原长度）
    if (this.findHeadHole(tailIndex, length, snapAngle) >= 0) {
      return { tailIndex, length, angle: snapAngle };
    }
    for (let dl = -1; dl >= -5; dl--) {
      const tryLen = length + dl;
      if (tryLen < 1) break;
      if (this.findHeadHole(tailIndex, tryLen, snapAngle) >= 0) {
        return { tailIndex, length: tryLen, angle: snapAngle };
      }
    }
    for (let dl = 1; dl <= 5; dl++) {
      const tryLen = length + dl;
      if (this.findHeadHole(tailIndex, tryLen, snapAngle) >= 0) {
        return { tailIndex, length: tryLen, angle: snapAngle };
      }
    }

    // 长度对不上孔也不管了，角度优先 —— 三点共线对齐
    return { tailIndex, length, angle: snapAngle };
  }

  // ============================================================
  findHeadHole(tailIndex, length, angle) {
    if (angle == null) return -1;
    const r = this.getPigRect(tailIndex, length, angle);
    if (!r) return -1;
    const center = this._headSquareCenter(r);
    const thresh = this.scaledHalfDiameter;  // R
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
  // 推出检测（OBB 矩形版）
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
      // 孔位碰撞
      const moved = {
        cx: r0.cx + dx, cy: r0.cy + dy,
        hw: r0.hw, hh: r0.hh,
        cosL: r0.cosL, sinL: r0.sinL, cosP: r0.cosP, sinP: r0.sinP
      };
      for (let hi = 0; hi < this.holes.length; hi++) {
        if (this.holeOccupied[hi] !== -1 && this.holeOccupied[hi] !== pigId) {
          const h = this.holes[hi];
          const ldx = h.x - moved.cx;
          const ldy = h.y - moved.cy;
          const lx = ldx * Math.cos(r0.rad) - ldy * Math.sin(r0.rad);
          const ly = ldx * Math.sin(r0.rad) + ldy * Math.cos(r0.rad);
          if (Math.abs(lx) <= r0.collisionHw && Math.abs(ly) <= r0.collisionHh) {
            return { canPush: false, reason: `碰到猪 #${this.holeOccupied[hi]}`, collidedPigId: this.holeOccupied[hi] };
          }
        }
      }
      // OBB 碰撞
      const cid = this._shiftedObbCollision(r0, dx, dy, pigId);
      if (cid >= 0) {
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

    // 孔位
    for (let i = 0; i < this.holes.length; i++) {
      const h = this.holes[i];
      const occ = this.holeOccupied[i];
      const hx = this.boardOffsetX + h.x, hy = offY + h.y;
      ctx.beginPath();
      ctx.arc(hx, hy, r, 0, Math.PI * 2);
      if (occ !== -1) {
        ctx.fillStyle = HOLE_OCCUPIED;
      } else {
        ctx.fillStyle = HOLE_EMPTY;
      }
      ctx.fill();
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
      if (flashAlpha < 1) {
        ctx.globalAlpha = flashAlpha;
      }
      pr.draw(ctx, pig, off.dx, off.dy);
      ctx.globalAlpha = 1;

      // 拖拽中：头部绿点 + 碰撞区棕色虚线框（仅编辑模式）
      if (options.showCollisionBox && isDragPig) {
        pr.drawHeadDot(ctx, pig, off.dx, off.dy);
        pr.drawCollisionBox(ctx, pig, off.dx, off.dy);
      }
    }

    // 幽灵动画
    for (const g of this.ghostAnimations) {
      const pig = this.pigs.find(p => p.id === g.pigId);
      if (pig) {
        ctx.globalAlpha = 0.25;
        pr.draw(ctx, pig, g.currentDx, g.currentDy);
        ctx.globalAlpha = 1;
      }
    }

    // 飞行猪（已从逻辑层 pigs 移除，纯 UI 层渲染）
    for (const fp of this.flyingPigs) {
      const off = animOffs[fp.id] || { dx: 0, dy: 0 };
      pr.draw(ctx, fp, off.dx, off.dy);
    }

    // 选中时：碰撞区棕色虚线框 + 头部绿色圆点（仅编辑模式，无拖拽时）
    if (options.showCollisionBox && options.showSelection && this.selectedPigId != null && !this.dragState) {
      const pig = this.pigs.find(p => p.id === this.selectedPigId);
      if (pig) {
        pr.drawCollisionBox(ctx, pig, 0, 0);
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
