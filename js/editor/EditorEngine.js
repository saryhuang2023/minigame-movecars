// 关卡编辑器引擎（v23 — 自适应追逐步长：撞墙减半，无障碍恢复全速）
// 纯 Canvas 2D 渲染，无 DOM 依赖
// require/module.exports，wx API，InputManager 事件路由

const { ctx, canvas, SCREEN_WIDTH, SCREEN_HEIGHT } = require('../render.js');
const databus = require('../databus.js');

// ========== 常量 ==========
const PIG_COLOR = '#FFD700';
const PIG_STROKE = '#FFB300';
const HOLE_EMPTY = 'rgba(255,255,255,0.22)';
const HOLE_OCCUPIED = 'rgba(255,182,193,0.55)';
const HOLE_STROKE = 'rgba(255,255,255,0.45)';
const SELECTED_COLOR = '#2196F3';
const BG_COLOR = '#1a1a2e';
const FLASH_DURATION = 500;
const PUSH_ANIM_DURATION = 6400; // 逃离动画时长（预览+编辑幽灵猪）
const CHASE_SPEED = 12; // 旋转追逐速度（度/帧），每帧最多向目标旋转12度
const CHASE_SPEED_MIN = 1; // 自适应降速下限，撞墙时步长减半不会低于此值

class EditorEngine {
  constructor(inputManager) {
    this.input = inputManager;

    // ===== 布局常量 =====
    this.topBarH = 48;
    this.bottomStripH = 44;

    // ===== 棋盘参数 =====
    this.cols = 5;
    this.rows = 5;
    this.heightRatio = 1.2;
    this.cellGapRatio = 1.5;

    // ===== 动态计算 =====
    this.boardW = SCREEN_WIDTH;
    this.boardH = 0;
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
    this.lastDragTime = 0;       // touchmove 节流，防止旋转卡顿

    // ===== 棋盘高度拖拽 =====
    this.heightDragState = null;  // { startY, startBoardH }
    this.handleZoneH = 20;        // 拖拽手柄触摸区域高度

    // ===== 模式 =====
    this.mode = 'edit';
    this.backupPigs = null;

    // ===== 动画 =====
    this.animations = [];
    this.ghostAnimations = [];
    this.flashingPigs = {};

    // ===== 关卡管理 =====
    this.levelList = [];
    this.currentLevelIdx = -1;

    // ===== UI 状态 =====
    this.buttons = [];          // 顶部工具栏按钮
    this.bottomBtns = [];       // 底部控制条按钮
    this.showLevelSheet = false;  // 关卡底部弹出面板
    this.levelSheetScrollY = 0;
    this.showPigSheet = false;    // 小猪信息底部弹出面板
    this.sheetDrag = false;
    this.sheetDragStartY = 0;
    this.sheetDragStartScroll = 0;

    // ===== Toast =====
    this.toastText = '';
    this.toastAlpha = 0;
    this.toastFade = null;
  }

  // ============================================================
  // 激活 / 反激活
  // ============================================================
  activate() {
    this.recomputeBoard();
    this.loadLevelList();
    this.input.on('editor', (e) => this.handleEvent(e));
  }

  deactivate() {
    this.input.off('editor');
  }

  // ============================================================
  // 事件处理
  // ============================================================
  handleEvent(e) {
    const t0 = e.touches[0] || e.changedTouches[0];
    if (!t0) return;
    const x = t0.x, y = t0.y;

    if (e.type === 'touchstart') {
      // 底部弹出面板优先
      if (this.showLevelSheet || this.showPigSheet) {
        if (this.checkSheetButtons(x, y)) return;
        this.sheetDrag = true;
        this.sheetDragStartY = y;
        this.sheetDragStartScroll = this.levelSheetScrollY;
        return;
      }
      // 底部控制条
      if (y > SCREEN_HEIGHT - this.bottomStripH) {
        this.checkBottomButtons(x, y);
        return;
      }
      // 棋盘高度拖拽手柄（在底部控制条上方）
      if (this.isInHeightHandle(x, y)) {
        this.heightDragState = { startY: y, startBoardH: this.boardH };
        return;
      }
      // 顶部工具栏
      if (y < this.topBarH) {
        this.checkTopButtons(x, y);
        return;
      }
      // 棋盘
      this.onBoardTouchStart(x, y);
    } else if (e.type === 'touchmove') {
      // 棋盘高度拖拽中
      if (this.heightDragState) {
        this.handleHeightDrag(y);
        return;
      }
      if ((this.showLevelSheet || this.showPigSheet) && this.sheetDrag) {
        const dy = this.sheetDragStartY - y;
        const maxScroll = Math.max(0, this.sheetContentH - 260);
        this.levelSheetScrollY = Math.max(0, Math.min(maxScroll,
          Math.max(0, this.sheetDragStartScroll + dy)));
        return;
      }
      if (this.dragState) this.onDragMove(x, y);
    } else if (e.type === 'touchend') {
      if (this.heightDragState) {
        this.heightDragState = null;
        this.markCurrentDirty();
        return;
      }
      if (this.showLevelSheet || this.showPigSheet) {
        this.sheetDrag = false;
        return;
      }
      if (this.dragState) this.onDragEnd(x, y);
    }
  }

  onBoardTouchStart(x, y) {
    if (y < this.topBarH || y > SCREEN_HEIGHT - this.bottomStripH) return;

    if (this.mode === 'edit') {
      this.handleEditTouchStart(x, y);
    } else {
      this.handlePreviewTouchStart(x, y);
    }
  }

  // ============================================================
  // 编辑模式 — 触摸处理
  // ============================================================
  handleEditTouchStart(x, y) {
    // 点到已有小猪 → 根据触碰部位进入不同调整模式
    const pigInfo = this.getPigAtPoint(x, y);
    if (pigInfo) {
      const pig = this.pigs.find(p => p.id === pigInfo.id);
      if (!pig) return;
      // 删掉原猪，改由临时猪代替
      this.pigs = this.pigs.filter(p => p.id !== pigInfo.id);
      this.rebuildOccupancy();
      this.selectedPigId = pigInfo.id;

      const tempId = -999;
      const isHead = pigInfo.cellIndex === pigInfo.totalLen - 1; // 最后一格为头部

      if (isHead) {
        // === 按住头部 → 仅调整长度，角度锁定 ===
        this.pigs.push({ id: tempId, tailIndex: pig.tailIndex, length: pig.length, angle: pig.angle });
        this.dragState = {
          type: 'adjustLength',
          tailIndex: pig.tailIndex,
          pigId: pigInfo.id,
          originalPig: pig,
          pendingId: tempId,
          lockedAngle: pig.angle,
          lastValid: { tailIndex: pig.tailIndex, length: pig.length, angle: pig.angle },
          headHoleIdx: -1
        };
      } else {
        // === 按住身体或尾部 → 仅调整角度，长度锁定 ===
        this.pigs.push({ id: tempId, tailIndex: pig.tailIndex, length: pig.length, angle: pig.angle });
        this.dragState = {
          type: 'adjustAngle',
          tailIndex: pig.tailIndex,
          pigId: pigInfo.id,
          originalPig: pig,
          pendingId: tempId,
          lockedLength: pig.length,
          displayAngle: pig.angle,
          targetAngle: pig.angle,
          currentChaseStep: CHASE_SPEED,
          lastValid: { tailIndex: pig.tailIndex, length: pig.length, angle: pig.angle },
          headHoleIdx: -1
        };
      }
      return;
    }

    // 点到空孔 → 新放置
    const holeIdx = this.getHoleAtPoint(x, y, 6);
    if (holeIdx >= 0 && this.holeOccupied[holeIdx] === -1) {
      this.dragState = {
        type: 'place',
        tailIndex: holeIdx,
        pigId: null,
        pendingId: null,
        lastValid: null
      };
      this.selectedPigId = null;
      return;
    }

    // 点击空白 → 取消选中
    this.selectedPigId = null;
    this.dragState = null;
  }

  // ============================================================
  // 预览模式 — 触摸处理
  // ============================================================
  handlePreviewTouchStart(x, y) {
    const pigInfo = this.getPigAtPoint(x, y);
    if (pigInfo) {
      const pig = this.pigs.find(p => p.id === pigInfo.id);
      if (!pig) return;
      this.selectedPigId = pigInfo.id;
      this.dragState = {
        type: 'rotate',
        tailIndex: pig.tailIndex,
        pigId: pigInfo.id,
        displayAngle: pig.angle,
        targetAngle: pig.angle,
        currentChaseStep: CHASE_SPEED,
        lastValid: { tailIndex: pig.tailIndex, length: pig.length, angle: pig.angle },
        previewMode: true,
        headHoleIdx: -1
      };
    }
  }

  // ============================================================
  // 拖拽移动
  // ============================================================
  onDragMove(x, y) {
    // 节流：最多 30fps 处理拖拽，大幅降低旋转卡顿
    const now = Date.now();
    if (now - this.lastDragTime < 33) return;
    this.lastDragTime = now;

    if (this.dragState.type === 'rotate') {
      this.handleRotateDrag(x, y);
    } else if (this.dragState.type === 'adjustLength') {
      this.handleAdjustLengthDrag(x, y);
    } else if (this.dragState.type === 'adjustAngle') {
      this.handleAdjustAngleDrag(x, y);
    } else {
      this.handlePlaceDrag(x, y);
    }
  }

  // 旋转拖拽（预览模式）：追逐式旋转 — 小猪逐步向手指方向旋转，碰壁即停
  handleRotateDrag(x, y) {
    const ds = this.dragState;
    const pig = this.pigs.find(p => p.id === ds.pigId);
    if (!pig) return;
    const tail = this.holes[ds.tailIndex];
    if (!tail) return;

    const dx = x - tail.x;
    const dy = y - this.topBarH - tail.y;
    let fingerAngle = Math.atan2(-dy, dx) * 180 / Math.PI;
    if (fingerAngle < 0) fingerAngle += 360;
    fingerAngle = Math.round(fingerAngle);

    ds.targetAngle = fingerAngle;
    const len = pig.length;

    // 计算 displayAngle 到 targetAngle 的最短角度差
    let diff = ds.targetAngle - ds.displayAngle;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    if (Math.abs(diff) < 0.5) return; // 已在目标位置

    // 每帧最多追 currentChaseStep 度（自适应：撞墙减半，无障碍恢复全速）
    const step = Math.max(-ds.currentChaseStep, Math.min(ds.currentChaseStep, diff));
    let newAngle = ds.displayAngle + step;
    newAngle = ((newAngle % 360) + 360) % 360;
    newAngle = Math.round(newAngle);

    // 检查新角度是否碰撞
    const check = this.checkAngleValid(ds.tailIndex, len, pig.id, newAngle, false);

    if (check.valid) {
      // 无碰撞：前进 + 恢复全速
      ds.currentChaseStep = CHASE_SPEED;
      ds.displayAngle = newAngle;
      const headHoleIdx = this.findHeadHole(ds.tailIndex, len, newAngle);
      if (headHoleIdx >= 0) {
        pig.angle = newAngle;
        this.updatePigOccupancy(pig.id, ds.tailIndex, len, newAngle);
        ds.lastValid = { tailIndex: ds.tailIndex, length: len, angle: newAngle };
        ds.headHoleIdx = headHoleIdx;
        ds.lastCollidedId = null;
        ds.isValidNow = true;
      } else {
        ds.headHoleIdx = -1;
        ds.isValidNow = false;
      }
    } else if (check.collidedId !== undefined) {
      // 碰撞阻挡：步长减半，逐步逼近边界
      ds.currentChaseStep = Math.max(CHASE_SPEED_MIN, Math.floor(ds.currentChaseStep / 2));
      if (check.collidedId !== ds.lastCollidedId) {
        this.triggerCollisionEffect(check.collidedId);
        ds.lastCollidedId = check.collidedId;
      }
      ds.isValidNow = false;
    } else {
      ds.isValidNow = false;
      ds.headHoleIdx = -1;
    }
  }

  // 放置拖拽：检测碰撞 + 合法性
  handlePlaceDrag(x, y) {
    const result = this.findBestDragConfig(x, y);
    if (result.cfg) {
      this.applyDragConfig(result.cfg);
      this.dragState.lastValid = result.cfg;
      this.dragState.lastCollidedId = null;
      this.dragState.isValidNow = true;
    } else {
      this.dragState.isValidNow = false;
      if (result.collidedId != null && result.collidedId !== this.dragState.lastCollidedId) {
        this.triggerCollisionEffect(result.collidedId);
        this.dragState.lastCollidedId = result.collidedId;
      }
    }
  }

  // 调整长度拖拽（按住头部）：角度锁定，仅改长度
  handleAdjustLengthDrag(x, y) {
    const ds = this.dragState;
    const tail = this.holes[ds.tailIndex];
    if (!tail) return;

    const dx = x - tail.x;
    const dy = y - this.topBarH - tail.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    let len = Math.max(2, Math.min(20, Math.floor(dist / this.diameter) + 1));

    // 检测合法性
    const excludeId = ds.pendingId;
    const check = this.checkAngleValid(ds.tailIndex, len, excludeId, ds.lockedAngle, false);
    if (check.valid) {
      const headHoleIdx = this.findHeadHole(ds.tailIndex, len, ds.lockedAngle);
      if (headHoleIdx >= 0) {
        this.pigs = this.pigs.filter(p => p.id !== excludeId);
        this.pigs.push({ id: ds.pendingId, tailIndex: ds.tailIndex, length: len, angle: ds.lockedAngle });
        this.updatePigOccupancy(excludeId, ds.tailIndex, len, ds.lockedAngle);
        ds.lastValid = { tailIndex: ds.tailIndex, length: len, angle: ds.lockedAngle };
        ds.headHoleIdx = headHoleIdx;
        ds.lastCollidedId = null;
        ds.isValidNow = true;
      } else {
        // 无碰撞但头部未落孔：回退显示，保留 lastValid
        ds.isValidNow = false;
        ds.headHoleIdx = -1;
        if (ds.lastValid) {
          this.pigs = this.pigs.filter(p => p.id !== excludeId);
          this.pigs.push({ id: ds.pendingId, tailIndex: ds.tailIndex, length: ds.lastValid.length, angle: ds.lockedAngle });
        }
      }
    } else {
      // 回退到上一个合法值，只更新碰撞反馈
      ds.isValidNow = false;
      ds.headHoleIdx = ds.lastValid
        ? this.findHeadHole(ds.tailIndex, ds.lastValid.length, ds.lockedAngle)
        : -1;
      if (check.collidedId !== undefined && check.collidedId !== ds.lastCollidedId) {
        this.triggerCollisionEffect(check.collidedId);
        ds.lastCollidedId = check.collidedId;
      }
      // 保持在上一个合法长度（视觉不跳变）
      if (ds.lastValid) {
        this.pigs = this.pigs.filter(p => p.id !== excludeId);
        this.pigs.push({ id: ds.pendingId, tailIndex: ds.tailIndex, length: ds.lastValid.length, angle: ds.lockedAngle });
      }
    }
  }

  // 调整角度拖拽（按住身体/尾部）：长度锁定，追逐式旋转
  handleAdjustAngleDrag(x, y) {
    const ds = this.dragState;
    const tail = this.holes[ds.tailIndex];
    if (!tail) return;

    const dx = x - tail.x;
    const dy = y - this.topBarH - tail.y;
    let fingerAngle = Math.atan2(-dy, dx) * 180 / Math.PI;
    if (fingerAngle < 0) fingerAngle += 360;
    fingerAngle = Math.round(fingerAngle);

    ds.targetAngle = fingerAngle;
    const excludeId = ds.pendingId;
    const len = ds.lockedLength;

    // 计算 displayAngle 到 targetAngle 的最短角度差
    let diff = ds.targetAngle - ds.displayAngle;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    if (Math.abs(diff) < 0.5) return; // 已在目标位置

    // 每帧最多追 currentChaseStep 度（自适应：撞墙减半，无障碍恢复全速）
    const step = Math.max(-ds.currentChaseStep, Math.min(ds.currentChaseStep, diff));
    let newAngle = ds.displayAngle + step;
    newAngle = ((newAngle % 360) + 360) % 360;
    newAngle = Math.round(newAngle);

    // 检查新角度是否碰撞
    const check = this.checkAngleValid(ds.tailIndex, len, excludeId, newAngle, false);

    if (check.valid) {
      ds.currentChaseStep = CHASE_SPEED;
      ds.displayAngle = newAngle;
      const headHoleIdx = this.findHeadHole(ds.tailIndex, len, newAngle);
      if (headHoleIdx >= 0) {
        this.pigs = this.pigs.filter(p => p.id !== excludeId);
        this.pigs.push({ id: ds.pendingId, tailIndex: ds.tailIndex, length: len, angle: newAngle });
        this.updatePigOccupancy(excludeId, ds.tailIndex, len, newAngle);
        ds.lastValid = { tailIndex: ds.tailIndex, length: len, angle: newAngle };
        ds.headHoleIdx = headHoleIdx;
        ds.lastCollidedId = null;
        ds.isValidNow = true;
      } else {
        ds.headHoleIdx = -1;
        ds.isValidNow = false;
        if (ds.lastValid) {
          this.pigs = this.pigs.filter(p => p.id !== excludeId);
          this.pigs.push({ id: ds.pendingId, tailIndex: ds.tailIndex, length: len, angle: ds.lastValid.angle });
        }
      }
    } else if (check.collidedId !== undefined) {
      // 碰撞阻挡：步长减半，逐步逼近边界
      ds.currentChaseStep = Math.max(CHASE_SPEED_MIN, Math.floor(ds.currentChaseStep / 2));
      if (check.collidedId !== ds.lastCollidedId) {
        this.triggerCollisionEffect(check.collidedId);
        ds.lastCollidedId = check.collidedId;
      }
      ds.isValidNow = false;
    } else {
      ds.isValidNow = false;
      ds.headHoleIdx = -1;
      if (ds.lastValid) {
        this.pigs = this.pigs.filter(p => p.id !== excludeId);
        this.pigs.push({ id: ds.pendingId, tailIndex: ds.tailIndex, length: len, angle: ds.lastValid.angle });
      }
    }
  }

  // 检查指定角度是否合法（不修改任何状态，纯查询）
  checkAngleValid(tailIdx, len, excludeId, angle, requireHeadOnHole = true) {
    const occupied = this.getPigOccupiedHoles(tailIdx, len, angle);
    for (const hi of occupied) {
      if (this.holeOccupied[hi] !== -1 && this.holeOccupied[hi] !== excludeId) {
        return { valid: false, collidedId: this.holeOccupied[hi] };
      }
    }
    const cells = this.getPigCells(tailIdx, len, angle);
    const cellCollidedId = this.findCellCollision(cells, excludeId);
    if (cellCollidedId >= 0) return { valid: false, collidedId: cellCollidedId };
    // 头部落孔（放置时必须，旋转/调整时允许头部超出棋盘）
    if (!requireHeadOnHole) return { valid: true };
    const headCell = cells[len - 1];
    for (const hole of this.holes) {
      if (this.cellOverlapsHole(headCell.x, headCell.y, hole.x, hole.y)) {
        return { valid: true };
      }
    }
    return { valid: false };
  }

  // 将角度修正为 tail hole → head hole 的精确连线，使格子中心对齐
  snapAngleToHoles(tailIndex, length, rawAngle) {
    const tailHole = this.holes[tailIndex];
    if (!tailHole) return rawAngle;
    const cells = this.getPigCells(tailIndex, length, rawAngle);
    const headCell = cells[length - 1];
    // 找到头部格子重叠的最优孔位
    let bestHole = null;
    let bestDist = Infinity;
    for (const hole of this.holes) {
      const dx = hole.x - headCell.x;
      const dy = hole.y - headCell.y;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist && this.cellOverlapsHole(headCell.x, headCell.y, hole.x, hole.y)) {
        bestDist = dist;
        bestHole = hole;
      }
    }
    if (!bestHole) return rawAngle;
    // 精确角度：tail → head hole 中心连线
    const dx = bestHole.x - tailHole.x;
    const dy = bestHole.y - tailHole.y;
    let snapAngle = Math.atan2(-dy, dx) * 180 / Math.PI;
    if (snapAngle < 0) snapAngle += 360;
    return Math.round(snapAngle);
  }

  // 查找头部格子占用的孔位索引（-1 表示未占孔）
  findHeadHole(tailIndex, length, angle) {
    const cells = this.getPigCells(tailIndex, length, angle);
    const headCell = cells[length - 1];
    for (let i = 0; i < this.holes.length; i++) {
      if (this.cellOverlapsHole(headCell.x, headCell.y, this.holes[i].x, this.holes[i].y)) {
        return i;
      }
    }
    return -1;
  }

  // === 统一碰撞效果入口 ===
  triggerCollisionEffect(pigId) {
    this.flashingPigs[pigId] = Date.now();
  }

  findBestDragConfig(x, y) {
    const tailIdx = this.dragState.tailIndex;
    const tail = this.holes[tailIdx];
    if (!tail) return { cfg: null };

    const dx = x - tail.x;
    const dy = y - this.topBarH - tail.y;
    let angle = Math.atan2(-dy, dx) * 180 / Math.PI;
    if (angle < 0) angle += 360;
    angle = Math.round(angle);

    let len;
    const dist = Math.sqrt(dx * dx + dy * dy);
    len = Math.max(2, Math.min(20, Math.floor(dist / this.diameter) + 1));

    const pig = this.dragState.pigId != null ? this.pigs.find(p => p.id === this.dragState.pigId) : null;

    // excludeId：优先用 pendingId（temp 猪），否则用 pig.id
    const excludeId = this.dragState.pendingId != null ? this.dragState.pendingId
      : (pig ? pig.id : -1);
    const check = this.checkAngleValid(tailIdx, len, excludeId, angle);
    if (!check.valid) return { cfg: null, collidedId: check.collidedId };
    return { cfg: { tailIndex: tailIdx, length: len, angle, inBounds: true } };
  }

  applyDragConfig(cfg) {
    if (this.dragState.type === 'place') {
      if (this.dragState.pendingId !== null) {
        this.pigs = this.pigs.filter(p => p.id !== this.dragState.pendingId);
      }
      const tempId = -999;
      this.pigs.push({ id: tempId, tailIndex: cfg.tailIndex, length: cfg.length, angle: cfg.angle });
      this.dragState.pendingId = tempId;
      this.updatePigOccupancy(tempId, cfg.tailIndex, cfg.length, cfg.angle);
    }
  }

  // ============================================================
  // 拖拽结束
  // ============================================================
  onDragEnd(x, y) {
    if (!this.dragState) return;

    if (this.dragState.previewMode) {
      this.handlePreviewMouseUp(x, y);
      return;
    }

    const lv = this.dragState.lastValid;

    // === 辅助：验证头部是否落孔，未落孔则撤回 ===
    const verifyHeadOnHole = (tailIdx, len, angle) => {
      const headIdx = this.findHeadHole(tailIdx, len, angle);
      return headIdx >= 0;
    };

    if (this.dragState.type === 'rotate') {
      const pig = this.pigs.find(p => p.id === this.dragState.pigId);
      if (pig && lv) {
        const snappedAngle = this.snapAngleToHoles(this.dragState.tailIndex, pig.length, lv.angle);
        if (verifyHeadOnHole(this.dragState.tailIndex, pig.length, snappedAngle)) {
          pig.angle = snappedAngle;
          this.updatePigOccupancy(pig.id, this.dragState.tailIndex, pig.length, snappedAngle);
          this.markCurrentDirty();
          this.showToast(`小猪 #${pig.id} 角度 → ${pig.angle}°`);
          this.tryGhostPush(pig.id);
        } else {
          // snap 后头部未落孔 → 回退到 lv 原始角度（已验证合法）
          pig.angle = lv.angle;
          this.updatePigOccupancy(pig.id, this.dragState.tailIndex, pig.length, lv.angle);
        }
      } else if (pig) {
        // lastValid 不应为空（已在 touchStart 初始化），仅作安全兜底
        this.updatePigOccupancy(pig.id, this.dragState.tailIndex, pig.length, pig.angle);
      }
    } else if (this.dragState.type === 'adjustLength' || this.dragState.type === 'adjustAngle') {
      // 调整模式：移除临时猪，放回修正后的猪
      this.pigs = this.pigs.filter(p => p.id !== this.dragState.pendingId);
      if (lv) {
        const snappedAngle = this.snapAngleToHoles(lv.tailIndex, lv.length, lv.angle);
        if (verifyHeadOnHole(lv.tailIndex, lv.length, snappedAngle)) {
          const realId = this.dragState.pigId;
          this.pigs.push({ id: realId, tailIndex: lv.tailIndex, length: lv.length, angle: snappedAngle });
          this.selectedPigId = realId;
          // 占用表：-999 → realId 扫描 + 增量修正为 snapping 角度
          for (let i = 0; i < this.holeOccupied.length; i++) {
            if (this.holeOccupied[i] === -999) this.holeOccupied[i] = realId;
          }
          this.updatePigOccupancy(realId, lv.tailIndex, lv.length, snappedAngle);
          const label = this.dragState.type === 'adjustLength' ? '长度' : '角度';
          const val = this.dragState.type === 'adjustLength' ? `${lv.length}格` : `${snappedAngle}°`;
          this.showToast(`小猪 #${realId} ${label} → ${val}`);
          this.markCurrentDirty();
          this.tryGhostPush(realId);
        } else if (this.dragState.originalPig) {
          // 头部未落孔 → 恢复原猪（全量重建，频率极低）
          this.pigs.push(this.dragState.originalPig);
          this.selectedPigId = this.dragState.originalPig.id;
          this.rebuildOccupancy();
        }
      } else if (this.dragState.originalPig) {
        // 无合法位置：恢复原猪（全量重建，频率极低）
        this.pigs.push(this.dragState.originalPig);
        this.selectedPigId = this.dragState.originalPig.id;
        this.rebuildOccupancy();
      }
    } else if (this.dragState.type === 'place') {
      // 移除临时猪
      this.pigs = this.pigs.filter(p => p.id !== this.dragState.pendingId);
      if (lv) {
        const snappedAngle = this.snapAngleToHoles(lv.tailIndex, lv.length, lv.angle);
        if (verifyHeadOnHole(lv.tailIndex, lv.length, snappedAngle)) {
          let realId;
          if (this.dragState.pigId != null) {
            // 更新已有猪
            realId = this.dragState.pigId;
            this.pigs.push({ id: realId, tailIndex: lv.tailIndex, length: lv.length, angle: snappedAngle });
            this.selectedPigId = realId;
            this.showToast(`小猪 #${realId} 已调整 (${lv.length}格, ${snappedAngle}°)`);
          } else {
            // 新建猪
            realId = this.nextPigId++;
            this.pigs.push({ id: realId, tailIndex: lv.tailIndex, length: lv.length, angle: snappedAngle });
            this.selectedPigId = realId;
            this.showToast(`小猪 #${realId} 已放置 (${lv.length}格, ${snappedAngle}°)`);
          }
          // 占用表：-999 → realId 扫描 + 增量修正为 snapping 角度
          for (let i = 0; i < this.holeOccupied.length; i++) {
            if (this.holeOccupied[i] === -999) this.holeOccupied[i] = realId;
          }
          this.updatePigOccupancy(realId, lv.tailIndex, lv.length, snappedAngle);
          this.markCurrentDirty();
          this.tryGhostPush(realId);
        }
      } else if (this.dragState.originalPig) {
        // 无合法位置：恢复原猪（全量重建，频率极低）
        this.pigs.push(this.dragState.originalPig);
        this.rebuildOccupancy();
        this.selectedPigId = this.dragState.originalPig.id;
      }
    }

    this.dragState = null;
  }

  handlePreviewMouseUp(x, y) {
    if (!this.dragState || !this.dragState.previewMode) return;

    const pigId = this.dragState.pigId;
    const pig = this.pigs.find(p => p.id === pigId);
    if (!pig) { this.dragState = null; return; }

    if (this.dragState.lastValid) {
      pig.angle = this.dragState.lastValid.angle;
    }
    this.updatePigOccupancy(pig.id, this.dragState.tailIndex, pig.length, pig.angle);

    const result = this.canPushPig(pigId);
    if (!result.canPush) {
      if (result.collidedPigId !== undefined) {
        this.triggerCollisionEffect(result.collidedPigId);
        this.showToast(`碰到了猪 #${result.collidedPigId}!`);
      } else {
        this.showToast(result.reason || '路径受阻');
      }
    } else {
      this.showToast(`猪 #${pigId} 被推出!`);
      const anim = {
        pigId, dirX: result.dirX, dirY: result.dirY,
        totalDist: result.totalDist, currentDx: 0, currentDy: 0,
        startTime: Date.now(), duration: PUSH_ANIM_DURATION,
        tailIndex: pig.tailIndex, length: pig.length, angle: pig.angle
      };
      this.animations.push(anim);
      this.pigs = this.pigs.filter(p => p.id !== pigId);
      this.clearPigOccupancy(pigId);
      setTimeout(() => {
        this.animations = this.animations.filter(a => a.pigId !== pigId);
      }, PUSH_ANIM_DURATION + 100);
    }
    this.dragState = null;
  }

  // ============================================================
  // 推出机制
  // ============================================================
  canPushPig(pigId) {
    const pig = this.pigs.find(p => p.id === pigId);
    if (!pig) return { canPush: false, reason: '猪不存在' };

    const cells = this.getPigCells(pig.tailIndex, pig.length, pig.angle);
    if (cells.length === 0) return { canPush: false, reason: '无有效位置' };

    const rad = pig.angle * Math.PI / 180;
    const dirX = Math.cos(rad), dirY = -Math.sin(rad);
    const stepSize = this.diameter;
    const maxSteps = 50;

    for (let step = 1; step <= maxSteps; step++) {
      // 移动后的格子
      const movedCells = cells.map(c => ({
        x: c.x + step * stepSize * dirX,
        y: c.y + step * stepSize * dirY
      }));

      // 孔位级碰撞
      for (const mc of movedCells) {
        for (let hi = 0; hi < this.holes.length; hi++) {
          if (this.holeOccupied[hi] !== -1 && this.holeOccupied[hi] !== pigId) {
            if (this.cellOverlapsHole(mc.x, mc.y, this.holes[hi].x, this.holes[hi].y)) {
              return { canPush: false, reason: `碰到猪 #${this.holeOccupied[hi]}`, collidedPigId: this.holeOccupied[hi] };
            }
          }
        }
      }

      // 格子级碰撞
      const cellCollidedId = this.findCellCollision(movedCells, pigId);
      if (cellCollidedId >= 0) {
        return { canPush: false, reason: `碰到猪 #${cellCollidedId}`, collidedPigId: cellCollidedId };
      }
    }
    return { canPush: true, dirX, dirY, totalDist: maxSteps * stepSize };
  }

  tryGhostPush(pigId) {
    const result = this.canPushPig(pigId);
    if (result.canPush) {
      this.ghostAnimations.push({
        pigId, dirX: result.dirX, dirY: result.dirY,
        totalDist: result.totalDist, currentDx: 0, currentDy: 0,
        startTime: Date.now(), duration: PUSH_ANIM_DURATION
      });
      setTimeout(() => {
        this.ghostAnimations = this.ghostAnimations.filter(g => g.pigId !== pigId);
      }, PUSH_ANIM_DURATION + 100);
    } else if (result.collidedPigId !== undefined) {
      this.triggerCollisionEffect(result.collidedPigId);
      this.showToast(`碰到了猪 #${result.collidedPigId}!`);
    }
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

  // 棋盘高度拖拽手柄
  isInHeightHandle(x, y) {
    const handleCenterY = this.topBarH + this.boardH;
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

  // 增量更新：只修改指定猪占用的孔位，不碰其他猪的数据
  // 先清除该 pigId 的全部旧标记，再写入新位置
  updatePigOccupancy(pigId, tailIdx, length, angle) {
    // 清除旧占用
    for (let i = 0; i < this.holeOccupied.length; i++) {
      if (this.holeOccupied[i] === pigId) this.holeOccupied[i] = -1;
    }
    // 写入新占用（先到先得：只写空格子或自己已有的格子）
    const occ = this.getPigOccupiedHoles(tailIdx, length, angle);
    for (const hi of occ) {
      if (hi >= 0 && hi < this.holeOccupied.length) {
        if (this.holeOccupied[hi] === -1 || this.holeOccupied[hi] === pigId) {
          this.holeOccupied[hi] = pigId;
        }
      }
    }
  }

  // 清除指定猪的全部占用（不重建整表）
  clearPigOccupancy(pigId) {
    for (let i = 0; i < this.holeOccupied.length; i++) {
      if (this.holeOccupied[i] === pigId) this.holeOccupied[i] = -1;
    }
  }

  // ============================================================
  // 小猪计算
  // ============================================================
  getPigCells(tailIndex, length, angle) {
    if (tailIndex < 0 || tailIndex >= this.holes.length) return [];
    const tail = this.holes[tailIndex];
    const rad = angle * Math.PI / 180;
    const dirX = Math.cos(rad), dirY = -Math.sin(rad);
    const cells = [];
    for (let i = 0; i < length; i++) {
      cells.push({ x: tail.x + i * this.diameter * dirX, y: tail.y + i * this.diameter * dirY });
    }
    return cells;
  }

  // 格子与孔位重叠检测（优化版：距离法代替逐点采样，大幅降低计算量）
  cellOverlapsHole(cellX, cellY, holeX, holeY) {
    const holeR = this.diameter / 2;
    const cellHalf = this.diameter / 2;
    // 中心距小于 holeR + cellHalf*0.7 即为有效重叠（0.7 为经验系数，等价于约 20% 面积覆盖）
    const maxDist = holeR + cellHalf * 0.7;
    const dx = cellX - holeX, dy = cellY - holeY;
    return dx * dx + dy * dy <= maxDist * maxDist;
  }

  getPigOccupiedHoles(tailIndex, length, angle) {
    const cells = this.getPigCells(tailIndex, length, angle);
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

  // 格子级碰撞检测：检查一组猪格是否与任何其他小猪的格子重叠，返回碰撞猪ID
  findCellCollision(cells, excludeId) {
    const minDist = this.diameter * 0.85;
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
    const offY = this.topBarH;
    for (let i = 0; i < this.holes.length; i++) {
      const hx = this.holes[i].x;
      const hy = offY + this.holes[i].y;
      const dx = x - hx, dy = y - hy;
      if (dx * dx + dy * dy <= r * r) return i;
    }
    return -1;
  }

  getPigAtPoint(x, y) {
    const offY = this.topBarH;
    for (const pig of this.pigs) {
      const cells = this.getPigCells(pig.tailIndex, pig.length, pig.angle);
      for (let ci = 0; ci < cells.length; ci++) {
        const cell = cells[ci];
        const cx = cell.x, cy = offY + cell.y;
        const half = this.diameter / 2 + 2;
        if (x >= cx - half && x <= cx + half && y >= cy - half && y <= cy + half) {
          return { id: pig.id, cellIndex: ci, totalLen: pig.length };
        }
      }
    }
    return null;
  }

  // ============================================================
  // 模式切换
  // ============================================================
  toggleMode() {
    if (this.mode === 'edit') {
      this.mode = 'preview';
      this.backupPigs = this.pigs.map(p => ({ ...p }));
      this.selectedPigId = null;
      this.dragState = null;
      this.showToast('预览模式 — 拖动小猪旋转后松手推出');
    } else {
      this.mode = 'edit';
      if (this.backupPigs) {
        this.pigs = this.backupPigs;
        this.backupPigs = null;
        this.nextPigId = this.pigs.length > 0 ? Math.max(...this.pigs.map(p => p.id)) + 1 : 0;
      }
      this.animations = [];
      this.ghostAnimations = [];
      this.flashingPigs = {};
      this.dragState = null;
      this.rebuildOccupancy();
      this.showToast('编辑模式');
    }
  }

  // ============================================================
  // 关卡数据
  // ============================================================
  getLevelData() {
    return {
      board: { cols: this.cols, rows: this.rows, heightRatio: this.heightRatio, cellGapRatio: this.cellGapRatio },
      pigs: this.pigs.map(p => ({ id: p.id, tail: p.tailIndex, length: p.length, angle: p.angle }))
    };
  }

  loadLevelData(data) {
    if (data.board) {
      this.cols = data.board.cols || 5;
      this.rows = data.board.rows || 5;
      this.heightRatio = data.board.heightRatio || 1.2;
      this.cellGapRatio = data.board.cellGapRatio || 1.5;
    }
    this.pigs = (data.pigs || []).map(p => ({
      id: p.id, tailIndex: p.tail, length: p.length, angle: p.angle
    }));
    this.nextPigId = this.pigs.length > 0 ? Math.max(...this.pigs.map(p => p.id)) + 1 : 0;
    this.selectedPigId = null;
    this.dragState = null;
    this.flashingPigs = {};
    this.animations = [];
    this.ghostAnimations = [];
    this.recomputeBoard();
  }

  // ============================================================
  // 关卡管理
  // ============================================================
  loadLevelList() {
    const fs = wx.getFileSystemManager();
    const dir = `${wx.env.USER_DATA_PATH}/levels`;
    try { fs.accessSync(dir); } catch (e) { try { fs.mkdirSync(dir, true); } catch (e2) {} }

    try {
      const files = fs.readdirSync(dir);
      this.levelList = files.filter(f => f.endsWith('.json')).map(f => {
        try {
          const raw = fs.readFileSync(`${dir}/${f}`, 'utf8');
          const data = JSON.parse(raw);
          return { name: f.replace('.json', ''), fileName: f, data, isDirty: false };
        } catch (e) { return null; }
      }).filter(Boolean);

      if (this.levelList.length > 0) {
        this.currentLevelIdx = this.levelList.length - 1;
        this.loadLevelData(this.levelList[this.currentLevelIdx].data);
      } else {
        this.newLevel();
      }
    } catch (e) {
      this.newLevel();
    }
  }

  saveLevel() {
    if (this.currentLevelIdx < 0) { this.showToast('无关卡可保存'); return; }
    const entry = this.levelList[this.currentLevelIdx];
    entry.data = this.getLevelData();
    entry.isDirty = false;

    const fs = wx.getFileSystemManager();
    const dir = `${wx.env.USER_DATA_PATH}/levels`;
    try { fs.accessSync(dir); } catch (e) { fs.mkdirSync(dir, true); }
    fs.writeFileSync(`${dir}/${entry.fileName}`, JSON.stringify(entry.data, null, 2), 'utf8');
    this.showToast(`已保存: ${entry.fileName}`);
  }

  newLevel() {
    if (this.currentLevelIdx >= 0) {
      this.levelList[this.currentLevelIdx].data = this.getLevelData();
    }
    let maxNum = 0;
    for (const lv of this.levelList) {
      const m = lv.name.match(/^level_(\d{4})$/);
      if (m) maxNum = Math.max(maxNum, parseInt(m[1]));
    }
    const num = maxNum + 1;
    const name = 'level_' + String(num).padStart(4, '0');
    const fileName = name + '.json';
    this.levelList.push({ name, fileName, data: this.getDefaultLevelData(), isDirty: true });
    this.currentLevelIdx = this.levelList.length - 1;
    this.loadLevelData(this.levelList[this.currentLevelIdx].data);
    this.showToast(`新建: ${name}`);
  }

  deleteLevel() {
    const idx = this.currentLevelIdx;
    if (idx < 0 || idx >= this.levelList.length) return;
    const entry = this.levelList[idx];
    try {
      const fs = wx.getFileSystemManager();
      fs.unlinkSync(`${wx.env.USER_DATA_PATH}/levels/${entry.fileName}`);
    } catch (e) {}
    this.levelList.splice(idx, 1);
    if (this.levelList.length === 0) {
      this.currentLevelIdx = -1;
      this.loadLevelData(this.getDefaultLevelData());
      this.newLevel();
    } else if (idx >= this.levelList.length) {
      this.currentLevelIdx = this.levelList.length - 1;
      this.loadLevelData(this.levelList[this.currentLevelIdx].data);
    } else {
      this.currentLevelIdx = idx;
      this.loadLevelData(this.levelList[idx].data);
    }
    this.showToast(`已删除: ${entry.name}`);
  }

  switchToLevel(idx) {
    if (idx === this.currentLevelIdx) return;
    if (idx < 0 || idx >= this.levelList.length) return;
    if (this.currentLevelIdx >= 0) {
      this.levelList[this.currentLevelIdx].data = this.getLevelData();
    }
    this.currentLevelIdx = idx;
    this.loadLevelData(this.levelList[idx].data);
  }

  getDefaultLevelData() {
    return {
      board: { cols: 5, rows: 5, heightRatio: 1.2, cellGapRatio: 1.5 },
      pigs: []
    };
  }

  markCurrentDirty() {
    if (this.currentLevelIdx >= 0 && this.currentLevelIdx < this.levelList.length) {
      this.levelList[this.currentLevelIdx].isDirty = true;
    }
  }

  // ============================================================
  // Toast
  // ============================================================
  showToast(text) {
    this.toastText = text;
    this.toastAlpha = 1;
    if (this.toastFade) clearTimeout(this.toastFade);
    this.toastFade = setTimeout(() => {
      this.toastAlpha = 0;
      this.toastText = '';
      this.toastFade = null;
    }, 1800);
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
  // === 渲染入口 ===
  // ============================================================
  render() {
    this.update();
    ctx.clearRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    this.renderBoard();
    this.renderTopBar();
    this.renderBottomStrip();
    this.renderToast();

    if (this.showLevelSheet) this.renderLevelSheet();
    if (this.showPigSheet) this.renderPigSheet();
  }

  // ============================================================
  // === 渲染 — 棋盘 ===
  // ============================================================
  renderBoard() {
    const r = this.diameter / 2;
    const offY = this.topBarH;

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
    const animOffs = {};
    for (const a of this.animations) animOffs[a.pigId] = { dx: a.currentDx, dy: a.currentDy };

    for (const pig of this.pigs) {
      const off = animOffs[pig.id] || { dx: 0, dy: 0 };
      const isDragPig = this.dragState && (
        this.dragState.pigId === pig.id || pig.id === this.dragState.pendingId
      );
      const isInvalidDrag = isDragPig && this.dragState.isValidNow === false;
      this.drawPig(pig, off.dx, off.dy);

      // 拖拽中不合法位置 → 红色遮罩提示
      if (isInvalidDrag) {
        this.drawPigInvalidOverlay(pig, off.dx, off.dy);
      }

      if (this.flashingPigs[pig.id]) {
        const elapsed = Date.now() - this.flashingPigs[pig.id];
        const t = elapsed / FLASH_DURATION;
        if (t < 1) {
          this.drawPigFlash(pig, t);
        }
      }
    }

    // 幽灵动画
    for (const g of this.ghostAnimations) {
      const pig = this.pigs.find(p => p.id === g.pigId);
      if (pig) {
        ctx.globalAlpha = 0.25;
        this.drawPig(pig, g.currentDx, g.currentDy);
        ctx.globalAlpha = 1;
      }
    }

    // 孤儿动画猪
    for (const a of this.animations) {
      if (!this.pigs.find(p => p.id === a.pigId) && a.tailIndex !== undefined) {
        this.drawOrphanPig(a);
      }
    }

    // 选中高亮（无拖拽时）
    if (this.selectedPigId != null && !this.dragState) {
      const pig = this.pigs.find(p => p.id === this.selectedPigId);
      if (pig) this.drawSelectionOutline(pig);
    }

    // 底部提示文字
    const hintY = Math.min(SCREEN_HEIGHT - this.bottomStripH - 12, this.topBarH + this.boardH + 8);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (this.selectedPigId != null && !this.dragState) {
      const pig = this.pigs.find(p => p.id === this.selectedPigId);
      if (pig) {
        ctx.fillText(`小猪 #${pig.id} | 长度:${pig.length} | 角度:${pig.angle}°`, SCREEN_WIDTH / 2, hintY);
        return;
      }
    }

    if (this.mode === 'edit') {
      ctx.fillText('按住小猪头部调长度 | 按住身体/尾部调方向 | 点击空孔放置', SCREEN_WIDTH / 2, hintY);
    } else {
      ctx.fillText('拖动小猪旋转 | 松手推出', SCREEN_WIDTH / 2, hintY);
    }

    // 棋盘底部拖拽手柄
    this.renderHeightHandle(offY);
  }

  // 棋盘底部拖拽手柄
  renderHeightHandle(offY) {
    const handleY = offY + this.boardH;
    const isDragging = !!this.heightDragState;

    // 触摸热区背景（半透明）
    const hh = this.handleZoneH;
    ctx.fillStyle = isDragging ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)';
    ctx.fillRect(0, handleY - hh / 2, SCREEN_WIDTH, hh);

    // 手柄本体（小圆角条）
    const barW = 48, barH = 5, barR = 2.5;
    const barX = SCREEN_WIDTH / 2 - barW / 2;
    const barY = handleY - barH / 2;
    ctx.fillStyle = isDragging ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.25)';
    this.roundRect(barX, barY, barW, barH, barR);
    ctx.fill();
  }

  // ============================================================
  // === 渲染 — 小猪绘制 ===
  // ============================================================
  drawPig(pig, offDx, offDy) {
    // 拖拽中：用 displayAngle 覆盖 pig.angle（显示跟随手指，真实状态保持合法值）
    let angle = pig.angle;
    if (this.dragState && this.dragState.displayAngle != null) {
      if (this.dragState.type === 'rotate' && pig.id === this.dragState.pigId) {
        angle = this.dragState.displayAngle;
      } else if ((this.dragState.type === 'adjustAngle' || this.dragState.type === 'adjustLength') && pig.id === this.dragState.pendingId) {
        angle = this.dragState.displayAngle;
      }
    }
    const rad = angle * Math.PI / 180;
    const dirX = Math.cos(rad), dirY = -Math.sin(rad);
    const tail = this.holes[pig.tailIndex];
    if (!tail) return;
    const totalLen = pig.length * this.diameter;
    const cx = tail.x + (pig.length - 1) / 2 * this.diameter * dirX + offDx;
    const cy = this.topBarH + tail.y + (pig.length - 1) / 2 * this.diameter * dirY + offDy;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-rad);
    ctx.fillStyle = PIG_COLOR;
    this.roundRect(-totalLen / 2, -this.diameter / 2, totalLen, this.diameter, 6);
    ctx.fill();
    ctx.strokeStyle = PIG_STROKE;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    const eyeX = totalLen / 2 - this.diameter * 0.35;
    const eyeY = -this.diameter * 0.15;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(eyeX, eyeY, this.diameter * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.arc(eyeX + 1, eyeY, this.diameter * 0.11, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  drawPigFlash(pig, t) {
    // t: 0→1，仅在小猪身体范围内做内部闪光，不超出边界
    const rad = pig.angle * Math.PI / 180;
    const dirX = Math.cos(rad), dirY = -Math.sin(rad);
    const tail = this.holes[pig.tailIndex];
    if (!tail) return;
    const totalLen = pig.length * this.diameter;
    const cx = tail.x + (pig.length - 1) / 2 * this.diameter * dirX;
    const cy = this.topBarH + tail.y + (pig.length - 1) / 2 * this.diameter * dirY;

    // 内部闪光：快速亮起 → 二次衰减，全程裁剪在猪身范围内
    const flashAlpha = 0.7 * (1 - t) * (1 - t);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-rad);

    // 裁剪区域：小猪身体
    ctx.beginPath();
    this.roundRect(-totalLen / 2, -this.diameter / 2, totalLen, this.diameter, 6);
    ctx.clip();

    // 内部高亮填充（暖白 → 透明）
    ctx.globalAlpha = flashAlpha;
    ctx.fillStyle = '#FFF8E7';
    ctx.fillRect(-totalLen / 2, -this.diameter / 2, totalLen, this.diameter);

    ctx.globalAlpha = 1;
    ctx.restore();
  }

  drawPigInvalidOverlay(pig, offDx, offDy) {
    let angle = pig.angle;
    if (this.dragState && this.dragState.displayAngle != null) {
      if (this.dragState.type === 'rotate' && pig.id === this.dragState.pigId) {
        angle = this.dragState.displayAngle;
      } else if ((this.dragState.type === 'adjustAngle' || this.dragState.type === 'adjustLength') && pig.id === this.dragState.pendingId) {
        angle = this.dragState.displayAngle;
      }
    }
    const rad = angle * Math.PI / 180;
    const dirX = Math.cos(rad), dirY = -Math.sin(rad);
    const tail = this.holes[pig.tailIndex];
    if (!tail) return;
    const totalLen = pig.length * this.diameter;
    const cx = tail.x + (pig.length - 1) / 2 * this.diameter * dirX + offDx;
    const cy = this.topBarH + tail.y + (pig.length - 1) / 2 * this.diameter * dirY + offDy;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-rad);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#FF4444';
    this.roundRect(-totalLen / 2, -this.diameter / 2, totalLen, this.diameter, 6);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  drawOrphanPig(anim) {
    const rad = anim.angle * Math.PI / 180;
    const dirX = Math.cos(rad), dirY = -Math.sin(rad);
    const tail = this.holes[anim.tailIndex];
    if (!tail) return;
    const totalLen = anim.length * this.diameter;
    const cx = tail.x + (anim.length - 1) / 2 * this.diameter * dirX + anim.currentDx;
    const cy = this.topBarH + tail.y + (anim.length - 1) / 2 * this.diameter * dirY + anim.currentDy;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-rad);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = PIG_COLOR;
    this.roundRect(-totalLen / 2, -this.diameter / 2, totalLen, this.diameter, 6);
    ctx.fill();
    ctx.strokeStyle = PIG_STROKE;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  drawSelectionOutline(pig) {
    const rad = pig.angle * Math.PI / 180;
    const dirX = Math.cos(rad), dirY = -Math.sin(rad);
    const tail = this.holes[pig.tailIndex];
    if (!tail) return;
    const totalLen = pig.length * this.diameter;
    const cx = tail.x + (pig.length - 1) / 2 * this.diameter * dirX;
    const cy = this.topBarH + tail.y + (pig.length - 1) / 2 * this.diameter * dirY;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-rad);
    ctx.strokeStyle = SELECTED_COLOR;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(-totalLen / 2 - 3, -this.diameter / 2 - 3, totalLen + 6, this.diameter + 6);
    ctx.setLineDash([]);
    ctx.restore();
  }

  // ============================================================
  // === 渲染 — 顶部工具栏 ===
  // ============================================================
  renderTopBar() {
    // 背景
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, SCREEN_WIDTH, this.topBarH);

    // 版本号
    const verX = 8, verY = 8, verW = 30, verH = 22;
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 1;
    this.roundRect(verX, verY, verW, verH, 4);
    ctx.stroke();
    ctx.fillStyle = '#aaa';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('v23', verX + verW / 2, verY + verH / 2);

    // 标题
    ctx.fillStyle = '#333';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('小猪推推乐 - 关卡编辑器', verX + verW + 6, this.topBarH / 2);

    // 右侧按钮区
    const rightBase = SCREEN_WIDTH - 8;

    // 模式切换按钮
    const btnW = 72, btnH = 30;
    const btnX = rightBase - btnW - 60, btnY = (this.topBarH - btnH) / 2;
    if (this.mode === 'edit') {
      ctx.fillStyle = '#2196F3';
      this.roundRect(btnX, btnY, btnW, btnH, 5);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('关卡试玩', btnX + btnW / 2, btnY + btnH / 2);
    } else {
      ctx.fillStyle = '#f44336';
      this.roundRect(btnX, btnY, btnW, btnH, 5);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('返回编辑', btnX + btnW / 2, btnY + btnH / 2);
    }

    // 模式标签
    const labelW = 62, labelH = 22;
    const labelX = rightBase - labelW, labelY = (this.topBarH - labelH) / 2;
    if (this.mode === 'edit') {
      ctx.fillStyle = '#E3F2FD';
    } else {
      ctx.fillStyle = '#FFF3E0';
    }
    this.roundRect(labelX, labelY, labelW, labelH, 4);
    ctx.fill();
    ctx.fillStyle = this.mode === 'edit' ? '#1565C0' : '#E65100';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.mode === 'edit' ? '编辑模式' : '预览模式', labelX + labelW / 2, labelY + labelH / 2);

    // 存储按钮位置
    this.topBtns = [
      { x: btnX, y: btnY, w: btnW, h: btnH, action: 'toggleMode' }
    ];
  }

  checkTopButtons(x, y) {
    for (const btn of this.topBtns) {
      if (x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
        if (btn.action === 'toggleMode') this.toggleMode();
        return true;
      }
    }
    return false;
  }

  // ============================================================
  // === 渲染 — 底部控制条 ===
  // ============================================================
  renderBottomStrip() {
    const y = SCREEN_HEIGHT - this.bottomStripH;

    // 背景
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, y, SCREEN_WIDTH, this.bottomStripH);
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(SCREEN_WIDTH, y);
    ctx.stroke();

    this.bottomBtns = [];

    let x = 6;
    const midY = y + this.bottomStripH / 2;
    const btnSize = 32;
    const btnY = y + (this.bottomStripH - btnSize) / 2;

    // === 列控制 ===
    ctx.fillStyle = '#999';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('列', x + 14, midY);
    x += 22;

    // −
    this.addBottomBtn(x, btnY, btnSize, btnSize, '−', () => {
      this.cols = Math.max(2, this.cols - 1);
      this.recomputeBoard();
      this.markCurrentDirty();
    });
    x += btnSize + 4;

    // 数字
    ctx.fillStyle = '#333';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(this.cols), x + 14, midY);
    x += 30;

    // +
    this.addBottomBtn(x, btnY, btnSize, btnSize, '+', () => {
      this.cols = Math.min(20, this.cols + 1);
      this.recomputeBoard();
      this.markCurrentDirty();
    });
    x += btnSize + 12;

    // 分隔线
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + 8);
    ctx.lineTo(x, y + this.bottomStripH - 8);
    ctx.stroke();
    x += 10;

    // === 行控制 ===
    ctx.fillStyle = '#999';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('行', x + 14, midY);
    x += 22;

    this.addBottomBtn(x, btnY, btnSize, btnSize, '−', () => {
      this.rows = Math.max(2, this.rows - 1);
      this.recomputeBoard();
      this.markCurrentDirty();
    });
    x += btnSize + 4;

    ctx.fillStyle = '#333';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(this.rows), x + 14, midY);
    x += 30;

    this.addBottomBtn(x, btnY, btnSize, btnSize, '+', () => {
      this.rows = Math.min(20, this.rows + 1);
      this.recomputeBoard();
      this.markCurrentDirty();
    });
    x += btnSize + 12;

    // 分隔线
    ctx.strokeStyle = '#ddd';
    ctx.beginPath();
    ctx.moveTo(x, y + 8);
    ctx.lineTo(x, y + this.bottomStripH - 8);
    ctx.stroke();
    x += 10;

    // 剩余空间给"关卡"和"小猪"
    const remaining = SCREEN_WIDTH - x - 6;
    const actBtnW = Math.min(60, (remaining - 6) / 2);
    const actBtnH = 32;
    const actBtnY = y + (this.bottomStripH - actBtnH) / 2;

    // 关卡按钮
    const levelBtnX = x;
    this.addColoredBtn(levelBtnX, actBtnY, actBtnW, actBtnH, '关卡', '#4CAF50', () => {
      this.showLevelSheet = !this.showLevelSheet;
      this.showPigSheet = false;
      this.levelSheetScrollY = 0;
    });
    x += actBtnW + 4;

    // 小猪按钮（始终显示，点击提示）
    const pigBtnW = remaining - (actBtnW + 4);
    const pigLabel = this.selectedPigId != null ? `#${this.selectedPigId}` : '小猪';
    this.addColoredBtn(x, actBtnY, pigBtnW, actBtnH, pigLabel, '#FF9800', () => {
      if (this.selectedPigId == null) {
        this.showToast('请先在棋盘上选中小猪');
        return;
      }
      this.showPigSheet = !this.showPigSheet;
      this.showLevelSheet = false;
    });
  }

  addBottomBtn(x, y, w, h, text, onClick) {
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    this.roundRect(x, y, w, h, 5);
    ctx.stroke();
    ctx.fillStyle = '#333';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w / 2, y + h / 2);
    this.bottomBtns.push({ x, y, w, h, onClick });
  }

  addColoredBtn(x, y, w, h, text, color, onClick) {
    ctx.fillStyle = color;
    this.roundRect(x, y, w, h, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w / 2, y + h / 2);
    this.bottomBtns.push({ x, y, w, h, onClick });
  }

  checkBottomButtons(x, y) {
    for (const btn of this.bottomBtns) {
      if (btn.onClick && x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
        btn.onClick();
        return true;
      }
    }
    return false;
  }

  // ============================================================
  // === 渲染 — 关卡底部弹出面板 ===
  // ============================================================
  renderLevelSheet() {
    const sheetH = Math.min(320, SCREEN_HEIGHT - this.topBarH);
    const sheetY = SCREEN_HEIGHT - sheetH;

    // 半透明遮罩
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    // 面板
    ctx.fillStyle = '#fff';
    this.roundRect(0, sheetY, SCREEN_WIDTH, sheetH, 16, true);
    ctx.fill();

    // 拖拽手柄
    ctx.fillStyle = '#ddd';
    this.roundRect(SCREEN_WIDTH / 2 - 18, sheetY + 8, 36, 4, 2);
    ctx.fill();

    // 标题
    ctx.fillStyle = '#555';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('关卡列表', 16, sheetY + 22);

    // 关闭按钮
    const closeX = SCREEN_WIDTH - 40;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('✕', closeX + 12, sheetY + 20);

    // 新建按钮
    const addBtnX = SCREEN_WIDTH - 110;
    ctx.fillStyle = '#4CAF50';
    this.roundRect(addBtnX, sheetY + 18, 50, 26, 4);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('+新建', addBtnX + 25, sheetY + 31);

    // 分割线
    ctx.strokeStyle = '#eee';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(12, sheetY + 52);
    ctx.lineTo(SCREEN_WIDTH - 12, sheetY + 52);
    ctx.stroke();

    // 关卡列表（可滚动区域）
    const listTop = sheetY + 56;
    const listH = sheetH - 60;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, listTop, SCREEN_WIDTH, listH);
    ctx.clip();

    const itemH = 44;
    this.sheetContentH = this.levelList.length * itemH + 20;

    for (let i = 0; i < this.levelList.length; i++) {
      const lv = this.levelList[i];
      const isActive = i === this.currentLevelIdx;
      const itemY = listTop + i * itemH + 4 - this.levelSheetScrollY;

      if (itemY + itemH < listTop || itemY > listTop + listH) continue;

      // 背景
      ctx.fillStyle = isActive ? '#E8F5E9' : 'rgba(0,0,0,0.02)';
      this.roundRect(10, itemY, SCREEN_WIDTH - 20, itemH - 4, 6);
      ctx.fill();
      if (isActive) {
        ctx.strokeStyle = '#4CAF50';
        ctx.lineWidth = 1;
        this.roundRect(10, itemY, SCREEN_WIDTH - 20, itemH - 4, 6);
        ctx.stroke();
      }

      // 关卡名
      ctx.fillStyle = isActive ? '#2E7D32' : '#333';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const dirtyMark = lv.isDirty ? ' *' : '';
      ctx.fillText(lv.name + dirtyMark, 22, itemY + (itemH - 4) / 2);

      // 文件名信息
      ctx.fillStyle = '#999';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(lv.fileName || '未保存', 22, itemY + (itemH - 4) / 2 + 14);

      // 删除按钮
      const delX = SCREEN_WIDTH - 58;
      const delY = itemY + 6;
      ctx.fillStyle = '#f44336';
      this.roundRect(delX, delY, 44, 28, 4);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('删除', delX + 22, delY + 14);
    }

    ctx.restore();

    // 当前关卡底部操作
    const footerY = sheetY + sheetH - 44;
    if (this.currentLevelIdx >= 0 && this.currentLevelIdx < this.levelList.length) {
      // 保存按钮
      ctx.fillStyle = '#4CAF50';
      this.roundRect(12, footerY, 64, 32, 6);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('保存', 12 + 32, footerY + 16);

      // 删除当前按钮
      ctx.fillStyle = '#f44336';
      this.roundRect(84, footerY, 64, 32, 6);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('删除', 84 + 32, footerY + 16);
    }

    // 存储按钮位置
    this.sheetRect = { x: 0, y: sheetY, w: SCREEN_WIDTH, h: sheetH };
    this.sheetCloseRect = { x: closeX, y: sheetY + 16, w: 32, h: 32 };
    this.sheetAddRect = { x: addBtnX, y: sheetY + 18, w: 50, h: 26 };
    this.sheetListTop = listTop;
    this.sheetItemH = itemH;
    this.sheetSaveRect = { x: 12, y: footerY, w: 64, h: 32 };
    this.sheetDeleteRect = { x: 84, y: footerY, w: 64, h: 32 };
  }

  // ============================================================
  // === 渲染 — 小猪信息底部弹出面板 ===
  // ============================================================
  renderPigSheet() {
    const sheetH = 180;
    const sheetY = SCREEN_HEIGHT - sheetH;

    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    ctx.fillStyle = '#fff';
    this.roundRect(0, sheetY, SCREEN_WIDTH, sheetH, 16, true);
    ctx.fill();

    // 手柄
    ctx.fillStyle = '#ddd';
    this.roundRect(SCREEN_WIDTH / 2 - 18, sheetY + 8, 36, 4, 2);
    ctx.fill();

    // 标题
    ctx.fillStyle = '#555';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('选中小猪', 16, sheetY + 22);

    // 关闭
    const closeX = SCREEN_WIDTH - 40;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('✕', closeX + 12, sheetY + 20);

    const pig = this.pigs.find(p => p.id === this.selectedPigId);
    if (pig) {
      ctx.fillStyle = '#555';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const infoY = sheetY + 52;
      ctx.fillText(`编号: #${pig.id}`, 24, infoY);
      ctx.fillText(`长度: ${pig.length} 格`, 180, infoY);
      ctx.fillText(`角度: ${Math.round(pig.angle)}°`, 24, infoY + 22);
      ctx.fillText(`尾部孔: #${pig.tailIndex}`, 180, infoY + 22);

      // 删除按钮
      const delBtnX = SCREEN_WIDTH - 100;
      const delBtnY = sheetY + sheetH - 48;
      ctx.fillStyle = '#f44336';
      this.roundRect(delBtnX, delBtnY, 84, 34, 6);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('删除', delBtnX + 42, delBtnY + 17);

      this.sheetPigDeleteRect = { x: delBtnX, y: delBtnY, w: 84, h: 34 };
    } else {
      ctx.fillStyle = '#aaa';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('未选中小猪', 24, sheetY + 52);
    }

    this.sheetPigRect = { x: 0, y: sheetY, w: SCREEN_WIDTH, h: sheetH };
    this.sheetPigCloseRect = { x: closeX, y: sheetY + 16, w: 32, h: 32 };
  }

  // ============================================================
  // === 底部面板 — 点击检测 ===
  // ============================================================
  checkSheetButtons(x, y) {
    // 关卡面板
    if (this.showLevelSheet) {
      // 关闭按钮
      if (this.sheetCloseRect && this.hitRect(x, y, this.sheetCloseRect)) {
        this.showLevelSheet = false;
        return true;
      }
      // 新建按钮
      if (this.sheetAddRect && this.hitRect(x, y, this.sheetAddRect)) {
        this.newLevel();
        return true;
      }
      // 保存按钮
      if (this.sheetSaveRect && this.hitRect(x, y, this.sheetSaveRect)) {
        this.saveLevel();
        return true;
      }
      // 删除按钮
      if (this.sheetDeleteRect && this.hitRect(x, y, this.sheetDeleteRect)) {
        this.deleteLevel();
        return true;
      }
      // 面板外点击关闭
      if (this.sheetRect && (x < this.sheetRect.x || x > this.sheetRect.x + this.sheetRect.w ||
          y < this.sheetRect.y)) {
        this.showLevelSheet = false;
        return true;
      }
      // 关卡列表项
      if (this.sheetListTop !== undefined) {
        for (let i = 0; i < this.levelList.length; i++) {
          const itemY = this.sheetListTop + i * this.sheetItemH + 4 - this.levelSheetScrollY;
          // 删除按钮
          const delRect = { x: SCREEN_WIDTH - 58, y: itemY + 6, w: 44, h: 28 };
          if (this.hitRect(x, y, delRect)) {
            this.deleteLevelByIndex(i);
            return true;
          }
          // 关卡项本体
          const itemRect = { x: 10, y: itemY, w: SCREEN_WIDTH - 20, h: this.sheetItemH - 4 };
          if (this.hitRect(x, y, itemRect)) {
            this.switchToLevel(i);
            return true;
          }
        }
      }
    }

    // 小猪面板
    if (this.showPigSheet) {
      if (this.sheetPigCloseRect && this.hitRect(x, y, this.sheetPigCloseRect)) {
        this.showPigSheet = false;
        return true;
      }
      if (this.sheetPigDeleteRect && this.hitRect(x, y, this.sheetPigDeleteRect)) {
        this.deleteSelectedPig();
        return true;
      }
      if (this.sheetPigRect && (x < this.sheetPigRect.x || x > this.sheetPigRect.x + this.sheetPigRect.w ||
          y < this.sheetPigRect.y)) {
        this.showPigSheet = false;
        return true;
      }
    }

    return false;
  }

  hitRect(x, y, r) {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  deleteLevelByIndex(idx) {
    if (this.currentLevelIdx === idx) {
      this.deleteLevel();
    } else {
      const entry = this.levelList[idx];
      try {
        const fs = wx.getFileSystemManager();
        fs.unlinkSync(`${wx.env.USER_DATA_PATH}/levels/${entry.fileName}`);
      } catch (e) {}
      this.levelList.splice(idx, 1);
      if (this.currentLevelIdx > idx) this.currentLevelIdx--;
    }
    this.levelSheetScrollY = 0;
  }

  deleteSelectedPig() {
    if (this.selectedPigId == null) {
      this.showToast('请先选中小猪');
      return;
    }
    this.pigs = this.pigs.filter(p => p.id !== this.selectedPigId);
    this.selectedPigId = null;
    this.showPigSheet = false;
    this.rebuildOccupancy();
    this.markCurrentDirty();
    this.showToast('已删除小猪');
  }

  // ============================================================
  // === 渲染 — Toast ===
  // ============================================================
  renderToast() {
    if (!this.toastText || this.toastAlpha <= 0) return;

    ctx.save();
    ctx.globalAlpha = this.toastAlpha;
    ctx.font = '13px sans-serif';
    const textW = ctx.measureText(this.toastText).width || 200;
    const w = Math.min(textW + 36, SCREEN_WIDTH - 20);
    const h = 36;
    const x = (SCREEN_WIDTH - w) / 2;
    const y = this.topBarH + 6;

    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    this.roundRect(x, y, w, h, 8);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.toastText, x + w / 2, y + h / 2);
    ctx.restore();
  }

  // ============================================================
  // === 工具方法 ===
  // ============================================================
  roundRect(x, y, w, h, r, topOnly) {
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
}

module.exports = EditorEngine;
