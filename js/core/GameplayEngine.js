// GameplayEngine — 核心玩法引擎（v1）
// 棋盘计算、占用管理、碰撞检测、旋转追逐、推出机制、渲染
// 被 EditorEngine / TestEngine / RealGameEngine 共同组合使用

const { ctx, canvas, SCREEN_WIDTH, SCREEN_HEIGHT } = require('../render.js');
const { PigRenderer, roundRect } = require('../render/PigRenderer.js');

// ========== 常量 ==========
const HOLE_EMPTY = 'rgba(255,255,255,0.22)';
const HOLE_OCCUPIED = 'rgba(255,182,193,0.55)';
const HOLE_STROKE = 'rgba(255,255,255,0.45)';
const BG_COLOR = '#1a1a2e';
const FLASH_DURATION = 500;
const PUSH_ANIM_DURATION = 6400;
const CHASE_SPEED = 12;
const HEAD_ZONE_MULT = 1;  // 头部区域 = HEAD_ZONE_MULT × diameter 像素

class GameplayEngine {
  constructor() {
    // ===== 布局常量 =====
    this.topBarH = 48;
    this.bottomStripH = 120;

    // ===== 棋盘参数 =====
    this.cols = 5;
    this.rows = 5;
    this.heightRatio = 1.2;
    this.cellGapRatio = 1.5;
    // ===== 动态计算 =====
    this.boardW = SCREEN_WIDTH;
    this.boardH = 0;
    this.boardOffsetY = 0;
    this.diameter = 0;
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

    // ===== 棋盘高度拖拽 =====
    this.heightDragState = null;
    this.handleZoneH = 20;

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
  recomputeBoard(boardHOverride) {
    this.boardW = SCREEN_WIDTH;
    const maxBoardH = SCREEN_HEIGHT - this.topBarH - this.bottomStripH;
    const minBoardH = 80;

    if (boardHOverride !== undefined) {
      this.boardH = Math.max(minBoardH, Math.min(maxBoardH, Math.round(boardHOverride)));
      this.heightRatio = this.boardH / this.boardW;
    } else {
      this.boardH = Math.round(this.boardW * this.heightRatio);
      if (this.boardH > maxBoardH) this.boardH = maxBoardH;
      if (this.boardH < minBoardH) this.boardH = minBoardH;
    }
    this.hSpacing = Math.round(this.boardW / this.cols);
    this.vSpacing = Math.round(this.boardH / this.rows);
    this.diameter = Math.round(this.hSpacing / (1 + this.cellGapRatio));

    this.computeHoles();
    this.rebuildOccupancy();
  }

  // 碰撞检测射线推进步长 = 孔位半径（diameter/2）
  get collisionStep() { return this.diameter / 2; }

  // 猪身体宽度 = 渲染对齐，碰撞也用这个值
  get pigBodyWidth() { return this.diameter; }

  isInHeightHandle(x, y) {
    const handleCenterY = this.topBarH + this.boardOffsetY + this.boardH;
    const hh = this.handleZoneH;
    return y >= handleCenterY - hh / 2 && y <= handleCenterY + hh / 2;
  }

  handleHeightDrag(y) {
    if (!this.heightDragState) return;
    const dy = y - this.heightDragState.startY;
    const newBoardH = this.heightDragState.startBoardH + dy;
    this.recomputeBoard(newBoardH);
  }

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
    const availH = SCREEN_HEIGHT - this.topBarH - this.bottomStripH;
    if (this.boardH < availH) {
      this.boardOffsetY = Math.round((availH - this.boardH) / 2);
    } else {
      this.boardOffsetY = 0;
    }
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
    const totalLen = length;  // length 即真实像素长度
    const hw = totalLen / 2;
    const hh = this.pigBodyWidth / 2;
    // OBB 锚定在孔心；尾正方形中心 = 孔心，头正方形中心 = _headSquareCenter
    const cx = tail.x + hw * cosL;
    const cy = tail.y + hw * sinL;
    // 垂直轴
    const cosP = Math.sin(rad);
    const sinP = Math.cos(rad);
    return { cx, cy, hw, hh, cosL, sinL, cosP, sinP, rad };
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
      const [minA, maxA] = proj(a.cx, a.cy, a.hw, a.hh, a.cosL, a.sinL, a.cosP, a.sinP, ax, ay);
      const [minB, maxB] = proj(b.cx, b.cy, b.hw, b.hh, b.cosL, b.sinL, b.cosP, b.sinP, ax, ay);
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
      if (Math.abs(lx) <= r.hw + 2 && Math.abs(ly) <= r.hh + 2) {
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
      const px = x - r.cx;
      const py = (y - offY) - r.cy;
      // 逆变换到矩形局部坐标
      const lx = px * Math.cos(r.rad) - py * Math.sin(r.rad);
      const ly = px * Math.sin(r.rad) + py * Math.cos(r.rad);
      if (Math.abs(lx) <= r.hw + 4 && Math.abs(ly) <= r.hh + 4) {
        // 像素偏移（从尾部 0 → 头部 totalLen）
        const offset = Math.max(0, Math.min(pig.length, lx + r.hw));
        return { id: pig.id, offset, totalLen: pig.length };
      }
    }
    return null;
  }

  getHoleAtPoint(x, y, margin) {
    const r = this.diameter / 2 + (margin || 0);
    const offY = this.topBarH + this.boardOffsetY;
    for (let i = 0; i < this.holes.length; i++) {
      const hx = this.holes[i].x;
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
    const thresh = this.diameter / 2;  // R
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

  // ============================================================
  findHeadHole(tailIndex, length, angle) {
    if (angle == null) return -1;
    const r = this.getPigRect(tailIndex, length, angle);
    if (!r) return -1;
    const center = this._headSquareCenter(r);
    const thresh = this.diameter / 2;  // R
    const thresh2 = thresh * thresh;
    let bestIdx = -1, bestDist2 = Infinity;
    for (let i = 0; i < this.holes.length; i++) {
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
  // 碰撞效果
  // ============================================================
  triggerCollisionEffect(pigId) {
    this.flashingPigs[pigId] = Date.now();
  }

  // ============================================================
  // 旋转追逐（核心玩法：三模式共享）
  // 小猪逐步向手指方向旋转，碰壁时一帧二分查找边界瞬间贴紧
  // ============================================================
  // pendingId 可选：编辑模式下 adjustAngle 传入临时猪 ID
  handleRotateDrag(x, y, pendingId) {
    const ds = this.dragState;
    const targetId = pendingId || ds.pigId;
    const pig = this.pigs.find(p => p.id === targetId);
    if (!pig) return;
    const tail = this.holes[ds.tailIndex];
    if (!tail) return;

    const dx = x - tail.x;
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
      ds.lastValid = { tailIndex: ds.tailIndex, length: len, angle: boundary };
      ds.headHoleIdx = this.findHeadHole(ds.tailIndex, len, boundary);
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
          if (Math.abs(lx) <= r0.hw + 2 && Math.abs(ly) <= r0.hh + 2) {
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
    const toDelete = [];
    for (const [pid, st] of Object.entries(this.flashingPigs)) {
      if (now - st > FLASH_DURATION) toDelete.push(pid);
    }
    for (const pid of toDelete) delete this.flashingPigs[pid];
  }

  // ============================================================
  // === 渲染 ===
  // ============================================================

  // 渲染完整棋盘：孔位 + 小猪 + 预览高亮 + 动画
  // options: { hintText, drawHint }
  renderBoard(ctx, options = {}) {
    const r = this.diameter / 2;
    const offY = this.topBarH + this.boardOffsetY;

    // 孔位
    for (let i = 0; i < this.holes.length; i++) {
      const h = this.holes[i];
      const occ = this.holeOccupied[i];
      const hx = h.x, hy = offY + h.y;
      ctx.beginPath();
      ctx.arc(hx, hy, r, 0, Math.PI * 2);
      if (occ !== -1) {
        ctx.fillStyle = HOLE_OCCUPIED;
      } else {
        ctx.fillStyle = HOLE_EMPTY;
        ctx.strokeStyle = HOLE_STROKE;
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
      ctx.fill();
    }

    // 拖拽中头部占孔 → 红色外边框高亮
    if (this.dragState && this.dragState.headHoleIdx >= 0) {
      const hh = this.holes[this.dragState.headHoleIdx];
      const hhx = hh.x, hhy = offY + hh.y;
      ctx.beginPath();
      ctx.arc(hhx, hhy, r + 3, 0, Math.PI * 2);
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
      const isInvalidDrag = isDragPig && this.dragState.isValidNow === false;
      pr.draw(ctx, pig, off.dx, off.dy);

      if (isInvalidDrag) {
        pr.drawInvalidOverlay(ctx, pig, off.dx, off.dy);
      }

      if (this.flashingPigs[pig.id]) {
        const elapsed = Date.now() - this.flashingPigs[pig.id];
        const t = elapsed / FLASH_DURATION;
        if (t < 1) {
          pr.drawFlash(ctx, pig, t);
        }
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

    // 选中高亮（无拖拽时）
    if (options.showSelection && this.selectedPigId != null && !this.dragState) {
      const pig = this.pigs.find(p => p.id === this.selectedPigId);
      if (pig) {
        pr.drawHeadOverlay(ctx, pig);
        pr.drawSelection(ctx, pig);

        // 调试：红线从头部正方形中心 → findHeadHole 命中的孔心
        const hr = this.getPigRect(pig.tailIndex, pig.length, pig.angle);
        if (hr) {
          const hsc = this._headSquareCenter(hr);
          // 绿点：头部正方形中心 B
          ctx.beginPath();
          ctx.arc(hsc.x, offY + hsc.y, 5, 0, Math.PI * 2);
          ctx.fillStyle = '#00FF00';
          ctx.fill();
          ctx.strokeStyle = '#008800';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          const headHoleIdx = this.findHeadHole(pig.tailIndex, pig.length, pig.angle);
          if (headHoleIdx >= 0) {
            const hh = this.holes[headHoleIdx];
            ctx.beginPath();
            ctx.moveTo(hsc.x, offY + hsc.y);
            ctx.lineTo(hh.x, offY + hh.y);
            ctx.strokeStyle = '#FF0000';
            ctx.lineWidth = 2;
            ctx.stroke();
          }
        }
      }
    }

    // 底部提示文字（屏幕坐标）
    if (options.hintText !== undefined) {
      const hintY = Math.min(SCREEN_HEIGHT - this.bottomStripH - 12, this.topBarH + this.boardOffsetY + this.boardH + 8);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(options.hintText, SCREEN_WIDTH / 2, hintY);
    }

    // 棋盘底部拖拽手柄
    this.renderHeightHandle(ctx, offY);
  }

  renderHeightHandle(ctx, offY) {
    const handleY = offY + this.boardH;
    const isDragging = !!this.heightDragState;

    const hh = this.handleZoneH;
    ctx.fillStyle = isDragging ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)';
    ctx.fillRect(0, handleY - hh / 2, SCREEN_WIDTH, hh);

    const barW = 48, barH = 5, barR = 2.5;
    const barX = SCREEN_WIDTH / 2 - barW / 2;
    const barY = handleY - barH / 2;
    ctx.fillStyle = isDragging ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.25)';
    roundRect(ctx, barX, barY, barW, barH, barR);
    ctx.fill();
  }

}

GameplayEngine.CHASE_SPEED = CHASE_SPEED;
GameplayEngine.HEAD_ZONE_MULT = HEAD_ZONE_MULT;

module.exports = GameplayEngine;
