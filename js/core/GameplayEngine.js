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
const CHASE_SPEED_MIN = 1;
const HEAD_CELLS = 2;  // 头部占用 cell 数量

class GameplayEngine {
  constructor() {
    // ===== 布局常量 =====
    this.topBarH = 48;
    this.bottomStripH = 78;

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

  // 每段 cell 长度 = 孔位半径（diameter/2）
  get cellLength() { return this.diameter / 2; }

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

  updatePigOccupancy(pigId, tailIdx, length, angle, _cells) {
    for (let i = 0; i < this.holeOccupied.length; i++) {
      if (this.holeOccupied[i] === pigId) this.holeOccupied[i] = -1;
    }
    const occ = this.getPigOccupiedHoles(tailIdx, length, angle, _cells);
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
  // 小猪几何计算
  // ============================================================
  getPigCells(tailIndex, length, angle) {
    if (tailIndex < 0 || tailIndex >= this.holes.length) return [];
    const tail = this.holes[tailIndex];
    const rad = angle * Math.PI / 180;
    const dirX = Math.cos(rad), dirY = -Math.sin(rad);
    const cells = [];
    for (let i = 0; i < length; i++) {
      cells.push({ x: tail.x + i * this.cellLength * dirX, y: tail.y + i * this.cellLength * dirY });
    }
    return cells;
  }

  cellOverlapsHole(cellX, cellY, holeX, holeY) {
    const holeR = this.diameter / 2;
    const cellHalf = this.cellLength / 2;
    const maxDist = holeR + cellHalf * 0.7;
    const dx = cellX - holeX, dy = cellY - holeY;
    return dx * dx + dy * dy <= maxDist * maxDist;
  }

  getPigOccupiedHoles(tailIndex, length, angle, cells) {
    if (!cells) cells = this.getPigCells(tailIndex, length, angle);
    const occupied = [];
    for (let hi = 0; hi < this.holes.length; hi++) {
      for (const cell of cells) {
        if (this.cellOverlapsHole(cell.x, cell.y, this.holes[hi].x, this.holes[hi].y)) {
          occupied.push(hi);
          break;
        }
      }
    }
    return occupied;
  }

  findCellCollision(cells, excludeId) {
    const minDist = this.cellLength * 0.85;
    for (const otherPig of this.pigs) {
      if (otherPig.id === excludeId) continue;
      const otherCells = this.getPigCells(otherPig.tailIndex, otherPig.length, otherPig.angle);
      for (const c1 of cells) {
        for (const c2 of otherCells) {
          const dx = c1.x - c2.x;
          const dy = c1.y - c2.y;
          if (dx * dx + dy * dy < minDist * minDist) {
            return otherPig.id;
          }
        }
      }
    }
    return -1;
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

  getPigAtPoint(x, y) {
    const offY = this.topBarH + this.boardOffsetY;
    for (const pig of this.pigs) {
      const cells = this.getPigCells(pig.tailIndex, pig.length, pig.angle);
      for (let ci = 0; ci < cells.length; ci++) {
        const cell = cells[ci];
        const cx = cell.x, cy = offY + cell.y;
        const half = this.cellLength / 2 + 2;
        if (x >= cx - half && x <= cx + half && y >= cy - half && y <= cy + half) {
          return { id: pig.id, cellIndex: ci, totalLen: pig.length };
        }
      }
    }
    return null;
  }

  // ============================================================
  // 碰撞检测 & snap
  // ============================================================
  checkAngleValid(tailIdx, len, excludeId, angle, requireHeadOnHole = true, _cells) {
    const cells = _cells || this.getPigCells(tailIdx, len, angle);
    const occupied = this.getPigOccupiedHoles(tailIdx, len, angle, cells);
    for (const hi of occupied) {
      if (this.holeOccupied[hi] !== -1 && this.holeOccupied[hi] !== excludeId) {
        return { valid: false, collidedId: this.holeOccupied[hi] };
      }
    }
    const cellCollidedId = this.findCellCollision(cells, excludeId);
    if (cellCollidedId >= 0) return { valid: false, collidedId: cellCollidedId };
    if (!requireHeadOnHole) return { valid: true };
    // 头部 = 最后 HEAD_CELLS 个 cell 的中点，单次判定
    return { valid: this.findHeadHole(tailIdx, len, angle, cells) >= 0 };
  }

  snapAngleToHoles(tailIndex, length, rawAngle) {
    const tailHole = this.holes[tailIndex];
    if (!tailHole) return rawAngle;
    const cells = this.getPigCells(tailIndex, length, rawAngle);
    // 以头部尖端 (最后一个 cell) 为吸附锚点
    const tipCell = cells[length - 1];
    let bestHole = null;
    let bestDist = Infinity;
    for (const hole of this.holes) {
      const dx = hole.x - tipCell.x;
      const dy = hole.y - tipCell.y;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist && this.cellOverlapsHole(tipCell.x, tipCell.y, hole.x, hole.y)) {
        bestDist = dist;
        bestHole = hole;
      }
    }
    if (!bestHole) return null;
    const dx = bestHole.x - tailHole.x;
    const dy = bestHole.y - tailHole.y;
    let snapAngle = Math.atan2(-dy, dx) * 180 / Math.PI;
    if (snapAngle < 0) snapAngle += 360;
    // 验证吸附后头部尖端落孔
    if (this.findHeadHole(tailIndex, length, snapAngle) < 0) return null;
    return snapAngle;
  }

  // 落孔判定：优先以尖端 cell 调 cellOverlapsHole（与身体占孔同源），
  // 尖端点到的孔就是落孔。尖端未命中则退取倒数第 2 个 cell。
  findHeadHole(tailIndex, length, angle, _cells) {
    if (angle == null && !_cells) return -1;
    const cells = _cells || this.getPigCells(tailIndex, length, angle);
    // 优先尖端 cell
    const tip = cells[length - 1];
    for (let i = 0; i < this.holes.length; i++) {
      if (this.cellOverlapsHole(tip.x, tip.y, this.holes[i].x, this.holes[i].y)) return i;
    }
    // 退取倒数第 2 个 cell
    if (length >= 2) {
      const sub = cells[length - 2];
      for (let i = 0; i < this.holes.length; i++) {
        if (this.cellOverlapsHole(sub.x, sub.y, this.holes[i].x, this.holes[i].y)) return i;
      }
    }
    return -1;
  }

  // ============================================================
  // 碰撞效果
  // ============================================================
  triggerCollisionEffect(pigId) {
    this.flashingPigs[pigId] = Date.now();
  }

  // ============================================================
  // 旋转追逐（核心玩法：三模式共享）
  // 小猪逐步向手指方向旋转，碰壁即停，自适应步长减半
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

    const step = Math.max(-ds.currentChaseStep, Math.min(ds.currentChaseStep, diff));
    let newAngle = ds.displayAngle + step;
    newAngle = ((newAngle % 360) + 360) % 360;
    newAngle = Math.round(newAngle);

    // 一次计算 cells，复用于 checkAngleValid + findHeadHole + updatePigOccupancy
    const cells = this.getPigCells(ds.tailIndex, len, newAngle);
    const check = this.checkAngleValid(ds.tailIndex, len, targetId, newAngle, false, cells);

    if (check.valid) {
      ds.currentChaseStep = CHASE_SPEED;
      ds.displayAngle = newAngle;
      const headHoleIdx = this.findHeadHole(ds.tailIndex, len, newAngle, cells);
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
        this.updatePigOccupancy(targetId, ds.tailIndex, len, newAngle, cells);
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
      ds.currentChaseStep = Math.max(CHASE_SPEED_MIN, Math.floor(ds.currentChaseStep / 2));
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
  canPushPig(pigId) {
    const pig = this.pigs.find(p => p.id === pigId);
    if (!pig) return { canPush: false, reason: '猪不存在' };

    const cells = this.getPigCells(pig.tailIndex, pig.length, pig.angle);
    if (cells.length === 0) return { canPush: false, reason: '无有效位置' };

    const rad = pig.angle * Math.PI / 180;
    const dirX = Math.cos(rad), dirY = -Math.sin(rad);
    const stepSize = this.cellLength;
    const maxSteps = 100;

    for (let step = 1; step <= maxSteps; step++) {
      const movedCells = cells.map(c => ({
        x: c.x + step * stepSize * dirX,
        y: c.y + step * stepSize * dirY
      }));

      for (const mc of movedCells) {
        for (let hi = 0; hi < this.holes.length; hi++) {
          if (this.holeOccupied[hi] !== -1 && this.holeOccupied[hi] !== pigId) {
            if (this.cellOverlapsHole(mc.x, mc.y, this.holes[hi].x, this.holes[hi].y)) {
              return { canPush: false, reason: `碰到猪 #${this.holeOccupied[hi]}`, collidedPigId: this.holeOccupied[hi] };
            }
          }
        }
      }

      const cellCollidedId = this.findCellCollision(movedCells, pigId);
      if (cellCollidedId >= 0) {
        return { canPush: false, reason: `碰到猪 #${cellCollidedId}`, collidedPigId: cellCollidedId };
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

    // 孤儿动画猪
    for (const a of this.animations) {
      if (!this.pigs.find(p => p.id === a.pigId) && a.tailIndex !== undefined) {
        pr.drawOrphan(ctx, a);
      }
    }

    // 选中高亮（无拖拽时）
    if (options.showSelection && this.selectedPigId != null && !this.dragState) {
      const pig = this.pigs.find(p => p.id === this.selectedPigId);
      if (pig) {
        pr.drawHeadOverlay(ctx, pig);
        pr.drawSelection(ctx, pig);
      }
    }

    // 底部提示文字
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
GameplayEngine.CHASE_SPEED_MIN = CHASE_SPEED_MIN;
GameplayEngine.HEAD_CELLS = HEAD_CELLS;

module.exports = GameplayEngine;
