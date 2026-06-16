// 关卡编辑器引擎（v26 — 组合 GameplayEngine，编辑/试玩一键切换）
// 纯 Canvas 2D 渲染，无 DOM 依赖
// require/module.exports，wx API，InputManager 事件路由

const { ctx, SCREEN_WIDTH, SCREEN_HEIGHT } = require('../render.js');
const databus = require('../databus.js');
const GameplayEngine = require('../core/GameplayEngine.js');
const { roundRect } = require('../render/PigRenderer.js');

const BG_COLOR = '#1a1a2e';
const DRAG_THRESHOLD = 20; // 最小移动距离（px），低于此值视为点击

class EditorEngine {
  constructor(inputManager) {
    this.input = inputManager;
    this.gp = new GameplayEngine();

    // ===== 模式 =====
    this.mode = 'edit';
    this.backupPigs = null;

    // ===== 关卡管理 =====
    this.levelList = [];
    this.currentLevelIdx = -1;

    // ===== UI 状态 =====
    this.buttons = [];
    this.bottomBtns = [];
    this.showLevelSheet = false;
    this.levelSheetScrollY = 0;
    this.showPigSheet = false;
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
    this.gp.recomputeBoard();
    this.gp.recenterBoard();
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
      if (y > SCREEN_HEIGHT - this.gp.bottomStripH) {
        this.checkBottomButtons(x, y);
        return;
      }
      // 棋盘高度拖拽手柄
      if (this.gp.isInHeightHandle(x, y)) {
        this.gp.heightDragState = { startY: y, startBoardH: this.gp.boardH };
        return;
      }
      // 顶部工具栏
      if (y < this.gp.topBarH) {
        this.checkTopButtons(x, y);
        return;
      }
      // 棋盘
      this.onBoardTouchStart(x, y);
    } else if (e.type === 'touchmove') {
      if (this.gp.heightDragState) {
        this.gp.handleHeightDrag(y);
        return;
      }
      if ((this.showLevelSheet || this.showPigSheet) && this.sheetDrag) {
        const dy = this.sheetDragStartY - y;
        const maxScroll = Math.max(0, this.sheetContentH - 260);
        this.levelSheetScrollY = Math.max(0, Math.min(maxScroll,
          Math.max(0, this.sheetDragStartScroll + dy)));
        return;
      }
      // 预览模式需走阈值逻辑 → 无条件调 onDragMove（即使 dragState 为空）
      if (this.gp.dragState || this.mode === 'preview') this.onDragMove(x, y);
    } else if (e.type === 'touchend') {
      if (this.gp.heightDragState) {
        this.gp.heightDragState = null;
        this.gp.recenterBoard();
        this.markCurrentDirty();
        return;
      }
      if (this.showLevelSheet || this.showPigSheet) {
        this.sheetDrag = false;
        return;
      }
      // 预览模式或已有拖拽 → 无条件调 onDragEnd（统一处理轻点推出 & 拖拽结束）
      if (this.gp.dragState || this._previewTouchState) this.onDragEnd(x, y);
    }
  }

  onBoardTouchStart(x, y) {
    if (y < this.gp.topBarH || y > SCREEN_HEIGHT - this.gp.bottomStripH) return;

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
    const pigInfo = this.gp.getPigAtPoint(x, y);
    if (pigInfo) {
      const pig = this.gp.pigs.find(p => p.id === pigInfo.id);
      if (!pig) return;
      this.gp.pigs = this.gp.pigs.filter(p => p.id !== pigInfo.id);
      this.gp.rebuildOccupancy();
      this.gp.selectedPigId = pigInfo.id;

      const tempId = -999;
      const isHead = pigInfo.cellIndex === pigInfo.totalLen - 1;

      if (isHead) {
        this.gp.pigs.push({ id: tempId, tailIndex: pig.tailIndex, length: pig.length, angle: pig.angle });
        this.gp.dragState = {
          type: 'adjustLength',
          tailIndex: pig.tailIndex,
          pigId: pigInfo.id,
          originalPig: pig,
          pendingId: tempId,
          lockedAngle: pig.angle,
          lastValid: { tailIndex: pig.tailIndex, length: pig.length, angle: pig.angle },
          headHoleIdx: -1,
          lastCollidedId: null,
          isValidNow: true
        };
      } else {
        this.gp.pigs.push({ id: tempId, tailIndex: pig.tailIndex, length: pig.length, angle: pig.angle });
        this.gp.dragState = {
          type: 'adjustAngle',
          tailIndex: pig.tailIndex,
          pigId: pigInfo.id,
          originalPig: pig,
          pendingId: tempId,
          lockedLength: pig.length,
          displayAngle: pig.angle,
          targetAngle: pig.angle,
          currentChaseStep: GameplayEngine.CHASE_SPEED,
          lastValid: { tailIndex: pig.tailIndex, length: pig.length, angle: pig.angle },
          headHoleIdx: -1,
          lastCollidedId: null,
          isValidNow: true
        };
      }
      return;
    }

    const holeIdx = this.gp.getHoleAtPoint(x, y, 6);
    if (holeIdx >= 0 && this.gp.holeOccupied[holeIdx] === -1) {
      this.gp.dragState = {
        type: 'place',
        tailIndex: holeIdx,
        pigId: null,
        pendingId: null,
        lastValid: null
      };
      this.gp.selectedPigId = null;
      return;
    }

    this.gp.selectedPigId = null;
    this.gp.dragState = null;
  }

  // ============================================================
  // 预览模式 — 触摸处理
  // ============================================================
  handlePreviewTouchStart(x, y) {
    const pigInfo = this.gp.getPigAtPoint(x, y);
    if (pigInfo) {
      const pig = this.gp.pigs.find(p => p.id === pigInfo.id);
      if (!pig) return;
      // 记录触控起点，不立即创建 dragState（等移动超阈值再激活拖拽）
      this._previewTouchState = {
        startX: x,
        startY: y,
        pigId: pig.id,
        tailIndex: pig.tailIndex,
        length: pig.length,
        angle: pig.angle
      };
    }
  }

  // ============================================================
  // 拖拽移动
  // ============================================================
  onDragMove(x, y) {
    const now = Date.now();
    if (now - this.gp.lastDragTime < 33) return;
    this.gp.lastDragTime = now;

    // 预览模式：尚未激活拖拽时检查移动距离阈值
    if (this._previewTouchState && !this.gp.dragState) {
      const dx = x - this._previewTouchState.startX;
      const dy = y - this._previewTouchState.startY;
      if (dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD) {
        const pts = this._previewTouchState;
        this.gp.dragState = {
          type: 'rotate',
          tailIndex: pts.tailIndex,
          pigId: pts.pigId,
          displayAngle: pts.angle,
          targetAngle: pts.angle,
          currentChaseStep: GameplayEngine.CHASE_SPEED,
          lastValid: { tailIndex: pts.tailIndex, length: pts.length, angle: pts.angle },
          previewMode: true,
          headHoleIdx: -1,
          lastCollidedId: null,
          isValidNow: true
        };
      }
    }

    if (this.gp.dragState && this.gp.dragState.type === 'rotate') {
      this.gp.handleRotateDrag(x, y);
    } else if (this.gp.dragState && this.gp.dragState.type === 'adjustLength') {
      this.handleAdjustLengthDrag(x, y);
    } else if (this.gp.dragState && this.gp.dragState.type === 'adjustAngle') {
      this.gp.handleRotateDrag(x, y, this.gp.dragState.pendingId);
    } else if (this.gp.dragState) {
      this.handlePlaceDrag(x, y);
    }
  }

  // 放置拖拽：检测碰撞 + 合法性
  handlePlaceDrag(x, y) {
    const result = this.findBestDragConfig(x, y);
    if (result.cfg) {
      this.applyDragConfig(result.cfg);
      this.gp.dragState.lastValid = result.cfg;
      this.gp.dragState.lastCollidedId = null;
      this.gp.dragState.isValidNow = true;
    } else {
      this.gp.dragState.isValidNow = false;
      if (result.collidedId != null && result.collidedId !== this.gp.dragState.lastCollidedId) {
        this.gp.triggerCollisionEffect(result.collidedId);
        this.gp.dragState.lastCollidedId = result.collidedId;
      }
    }
  }

  // 调整长度拖拽（按住头部）：角度锁定，仅改长度
  handleAdjustLengthDrag(x, y) {
    const ds = this.gp.dragState;
    const tail = this.gp.holes[ds.tailIndex];
    if (!tail) return;

    const dx = x - tail.x;
    const dy = y - this.gp.topBarH - this.gp.boardOffsetY - tail.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    let len = Math.max(5, Math.min(30, Math.floor(dist / this.gp.cellLength) + 1));

    // 长度没变 → 跳过（避免无谓的占用重建）
    if (ds._lastLen === len) return;
    ds._lastLen = len;

    const excludeId = ds.pendingId;
    // 调整长度拖拽只检查碰撞（requireHeadOnHole=false），不强制头部落孔
    const check = this.gp.checkAngleValid(ds.tailIndex, len, excludeId, ds.lockedAngle, false);
    if (check.valid) {
      // 原地更新临时猪，避免 filter+push
      const tempPig = this.gp.pigs.find(p => p.id === excludeId);
      if (tempPig) tempPig.length = len;
      this.gp.updatePigOccupancy(excludeId, ds.tailIndex, len, ds.lockedAngle);
      ds.lastValid = { tailIndex: ds.tailIndex, length: len, angle: ds.lockedAngle };
      ds.lastCollidedId = null;
      ds.isValidNow = true;
    } else {
      ds.isValidNow = false;
      if (check.collidedId !== undefined && check.collidedId !== ds.lastCollidedId) {
        this.gp.triggerCollisionEffect(check.collidedId);
        ds.lastCollidedId = check.collidedId;
      }
      // 还原到上一个合法长度
      if (ds.lastValid) {
        const tempPig = this.gp.pigs.find(p => p.id === excludeId);
        if (tempPig) tempPig.length = ds.lastValid.length;
        this.gp.updatePigOccupancy(excludeId, ds.tailIndex, ds.lastValid.length, ds.lockedAngle);
      }
    }
  }

  findBestDragConfig(x, y) {
    const tailIdx = this.gp.dragState.tailIndex;
    const tail = this.gp.holes[tailIdx];
    if (!tail) return { cfg: null };

    const dx = x - tail.x;
    const dy = y - this.gp.topBarH - this.gp.boardOffsetY - tail.y;
    let angle = Math.atan2(-dy, dx) * 180 / Math.PI;
    if (angle < 0) angle += 360;
    angle = Math.round(angle);

    const dist = Math.sqrt(dx * dx + dy * dy);
    const len = Math.max(5, Math.min(30, Math.floor(dist / this.gp.cellLength) + 1));

    const pig = this.gp.dragState.pigId != null ? this.gp.pigs.find(p => p.id === this.gp.dragState.pigId) : null;

    const excludeId = this.gp.dragState.pendingId != null ? this.gp.dragState.pendingId
      : (pig ? pig.id : -1);
    const check = this.gp.checkAngleValid(tailIdx, len, excludeId, angle);
    if (!check.valid) return { cfg: null, collidedId: check.collidedId };
    return { cfg: { tailIndex: tailIdx, length: len, angle, inBounds: true } };
  }

  applyDragConfig(cfg) {
    if (this.gp.dragState.type === 'place') {
      if (this.gp.dragState.pendingId !== null) {
        this.gp.pigs = this.gp.pigs.filter(p => p.id !== this.gp.dragState.pendingId);
      }
      const tempId = -999;
      this.gp.pigs.push({ id: tempId, tailIndex: cfg.tailIndex, length: cfg.length, angle: cfg.angle });
      this.gp.dragState.pendingId = tempId;
      this.gp.updatePigOccupancy(tempId, cfg.tailIndex, cfg.length, cfg.angle);
    }
  }

  // ============================================================
  // 拖拽结束
  // ============================================================
  onDragEnd(x, y) {
    // 预览模式轻点（未超拖拽阈值）→ 直接推出
    if (this._previewTouchState && !this.gp.dragState) {
      const pigId = this._previewTouchState.pigId;
      this._previewTouchState = null;
      this.tryPushDirect(pigId);
      return;
    }
    this._previewTouchState = null;

    if (!this.gp.dragState) return;

    if (this.gp.dragState.previewMode) {
      this.handlePreviewMouseUp(x, y);
      return;
    }

    const lv = this.gp.dragState.lastValid;

    const verifyHeadOnHole = (tailIdx, len, angle) => {
      return this.gp.findHeadHole(tailIdx, len, angle) >= 0;
    };

    if (this.gp.dragState.type === 'rotate') {
      const pig = this.gp.pigs.find(p => p.id === this.gp.dragState.pigId);
      if (pig && lv) {
        const snappedAngle = this.gp.snapAngleToHoles(this.gp.dragState.tailIndex, pig.length, lv.angle);
        if (verifyHeadOnHole(this.gp.dragState.tailIndex, pig.length, snappedAngle)) {
          pig.angle = snappedAngle;
          this.gp.updatePigOccupancy(pig.id, this.gp.dragState.tailIndex, pig.length, snappedAngle);
          this.markCurrentDirty();
          this.showToast(`小猪 #${pig.id} 角度 → ${pig.angle}°`);
          this.tryGhostPush(pig.id);
        } else {
          pig.angle = lv.angle;
          this.gp.updatePigOccupancy(pig.id, this.gp.dragState.tailIndex, pig.length, lv.angle);
        }
      } else if (pig) {
        this.gp.updatePigOccupancy(pig.id, this.gp.dragState.tailIndex, pig.length, pig.angle);
      }
    } else if (this.gp.dragState.type === 'adjustLength') {
      // 调整长度：直接应用，不做落孔检查（头部落孔由玩家自行旋转对齐）
      this.gp.pigs = this.gp.pigs.filter(p => p.id !== this.gp.dragState.pendingId);
      if (lv) {
        const realId = this.gp.dragState.pigId;
        this.gp.pigs.push({ id: realId, tailIndex: lv.tailIndex, length: lv.length, angle: lv.angle });
        this.gp.selectedPigId = realId;
        for (let i = 0; i < this.gp.holeOccupied.length; i++) {
          if (this.gp.holeOccupied[i] === -999) this.gp.holeOccupied[i] = realId;
        }
        this.gp.updatePigOccupancy(realId, lv.tailIndex, lv.length, lv.angle);
        this.showToast(`小猪 #${realId} 长度 → ${lv.length}格`);
        this.markCurrentDirty();
        this.tryGhostPush(realId);
      } else if (this.gp.dragState.originalPig) {
        this.gp.pigs.push(this.gp.dragState.originalPig);
        this.gp.selectedPigId = this.gp.dragState.originalPig.id;
        this.gp.rebuildOccupancy();
      }
    } else if (this.gp.dragState.type === 'adjustAngle') {
      this.gp.pigs = this.gp.pigs.filter(p => p.id !== this.gp.dragState.pendingId);
      if (lv) {
        const snappedAngle = this.gp.snapAngleToHoles(lv.tailIndex, lv.length, lv.angle);
        if (verifyHeadOnHole(lv.tailIndex, lv.length, snappedAngle)) {
          const realId = this.gp.dragState.pigId;
          this.gp.pigs.push({ id: realId, tailIndex: lv.tailIndex, length: lv.length, angle: snappedAngle });
          this.gp.selectedPigId = realId;
          for (let i = 0; i < this.gp.holeOccupied.length; i++) {
            if (this.gp.holeOccupied[i] === -999) this.gp.holeOccupied[i] = realId;
          }
          this.gp.updatePigOccupancy(realId, lv.tailIndex, lv.length, snappedAngle);
          const label = '角度';
          const val = `${snappedAngle}°`;
          this.showToast(`小猪 #${realId} ${label} → ${val}`);
          this.markCurrentDirty();
          this.tryGhostPush(realId);
        } else if (this.gp.dragState.originalPig) {
          this.gp.pigs.push(this.gp.dragState.originalPig);
          this.gp.selectedPigId = this.gp.dragState.originalPig.id;
          this.gp.rebuildOccupancy();
        }
      } else if (this.gp.dragState.originalPig) {
        this.gp.pigs.push(this.gp.dragState.originalPig);
        this.gp.selectedPigId = this.gp.dragState.originalPig.id;
        this.gp.rebuildOccupancy();
      }
    } else if (this.gp.dragState.type === 'place') {
      this.gp.pigs = this.gp.pigs.filter(p => p.id !== this.gp.dragState.pendingId);
      if (lv) {
        const snappedAngle = this.gp.snapAngleToHoles(lv.tailIndex, lv.length, lv.angle);
        if (verifyHeadOnHole(lv.tailIndex, lv.length, snappedAngle)) {
          let realId;
          if (this.gp.dragState.pigId != null) {
            realId = this.gp.dragState.pigId;
            this.gp.pigs.push({ id: realId, tailIndex: lv.tailIndex, length: lv.length, angle: snappedAngle });
            this.gp.selectedPigId = realId;
            this.showToast(`小猪 #${realId} 已调整 (${lv.length}格, ${snappedAngle}°)`);
          } else {
            realId = this.gp.nextPigId++;
            this.gp.pigs.push({ id: realId, tailIndex: lv.tailIndex, length: lv.length, angle: snappedAngle });
            this.gp.selectedPigId = realId;
            this.showToast(`小猪 #${realId} 已放置 (${lv.length}格, ${snappedAngle}°)`);
          }
          for (let i = 0; i < this.gp.holeOccupied.length; i++) {
            if (this.gp.holeOccupied[i] === -999) this.gp.holeOccupied[i] = realId;
          }
          this.gp.updatePigOccupancy(realId, lv.tailIndex, lv.length, snappedAngle);
          this.markCurrentDirty();
          this.tryGhostPush(realId);
        }
      } else if (this.gp.dragState.originalPig) {
        this.gp.pigs.push(this.gp.dragState.originalPig);
        this.gp.rebuildOccupancy();
        this.gp.selectedPigId = this.gp.dragState.originalPig.id;
      }
    }

    this.gp.dragState = null;
    this.gp.recenterBoard();
  }

  handlePreviewMouseUp(x, y) {
    if (!this.gp.dragState || !this.gp.dragState.previewMode) return;

    const pigId = this.gp.dragState.pigId;
    const pig = this.gp.pigs.find(p => p.id === pigId);
    if (!pig) { this.gp.dragState = null; return; }

    if (this.gp.dragState.lastValid) {
      pig.angle = this.gp.dragState.lastValid.angle;
    }
    this.gp.updatePigOccupancy(pig.id, this.gp.dragState.tailIndex, pig.length, pig.angle);

    const result = this.gp.canPushPig(pigId);
    if (!result.canPush) {
      if (result.collidedPigId !== undefined) {
        this.gp.triggerCollisionEffect(result.collidedPigId);
        this.showToast(`碰到了猪 #${result.collidedPigId}!`);
      } else {
        this.showToast(result.reason || '路径受阻');
      }
    } else {
      this.showToast(`猪 #${pigId} 被推出!`);
      const anim = {
        pigId, dirX: result.dirX, dirY: result.dirY,
        totalDist: result.totalDist, currentDx: 0, currentDy: 0,
        startTime: Date.now(), duration: 6400,
        tailIndex: pig.tailIndex, length: pig.length, angle: pig.angle
      };
      this.gp.animations.push(anim);
      this.gp.pigs = this.gp.pigs.filter(p => p.id !== pigId);
      this.gp.clearPigOccupancy(pigId);
      setTimeout(() => {
        this.gp.animations = this.gp.animations.filter(a => a.pigId !== pigId);
      }, 6500);
    }
    this.gp.dragState = null;
  }

  // ============================================================
  // 推出机制（编辑器包装）
  // ============================================================
  tryPushDirect(pigId) {
    const pig = this.gp.pigs.find(p => p.id === pigId);
    if (!pig) return;
    const result = this.gp.canPushPig(pigId);
    if (!result.canPush) {
      if (result.collidedPigId !== undefined) {
        this.gp.triggerCollisionEffect(result.collidedPigId);
        this.showToast(`碰到了猪 #${result.collidedPigId}!`);
      } else {
        this.showToast(result.reason || '路径受阻');
      }
    } else {
      this.showToast(`猪 #${pigId} 被推出!`);
      const anim = {
        pigId, dirX: result.dirX, dirY: result.dirY,
        totalDist: result.totalDist, currentDx: 0, currentDy: 0,
        startTime: Date.now(), duration: 6400,
        tailIndex: pig.tailIndex, length: pig.length, angle: pig.angle
      };
      this.gp.animations.push(anim);
      this.gp.pigs = this.gp.pigs.filter(p => p.id !== pigId);
      this.gp.clearPigOccupancy(pigId);
      setTimeout(() => {
        this.gp.animations = this.gp.animations.filter(a => a.pigId !== pigId);
      }, 6500);
    }
  }

  tryGhostPush(pigId) {
    const result = this.gp.canPushPig(pigId);
    if (result.canPush) {
      this.gp.ghostAnimations.push({
        pigId, dirX: result.dirX, dirY: result.dirY,
        totalDist: result.totalDist, currentDx: 0, currentDy: 0,
        startTime: Date.now(), duration: 6400
      });
      setTimeout(() => {
        this.gp.ghostAnimations = this.gp.ghostAnimations.filter(g => g.pigId !== pigId);
      }, 6500);
    } else if (result.collidedPigId !== undefined) {
      this.gp.triggerCollisionEffect(result.collidedPigId);
      this.showToast(`碰到了猪 #${result.collidedPigId}!`);
    }
  }

  // ============================================================
  // 模式切换
  // ============================================================
  toggleMode() {
    if (this.mode === 'edit') {
      this.mode = 'preview';
      this.backupPigs = this.gp.pigs.map(p => ({ ...p }));
      this.gp.selectedPigId = null;
      this.gp.dragState = null;
      this.showToast('试玩中 — 拖动小猪旋转后松手推出');
    } else {
      this.mode = 'edit';
      if (this.backupPigs) {
        this.gp.pigs = this.backupPigs;
        this.backupPigs = null;
        this.gp.nextPigId = this.gp.pigs.length > 0 ? Math.max(...this.gp.pigs.map(p => p.id)) + 1 : 0;
      }
      this.gp.animations = [];
      this.gp.ghostAnimations = [];
      this.gp.flashingPigs = {};
      this.gp.dragState = null;
      this.gp.rebuildOccupancy();
      this.showToast('编辑模式');
    }
  }

  // ============================================================
  // 关卡数据
  // ============================================================
  getLevelData() {
    return {
      board: { cols: this.gp.cols, rows: this.gp.rows, heightRatio: this.gp.heightRatio, cellGapRatio: this.gp.cellGapRatio },
      pigs: this.gp.pigs.map(p => ({ id: p.id, tail: p.tailIndex, length: p.length, angle: p.angle }))
    };
  }

  loadLevelData(data) {
    if (data.board) {
      this.gp.cols = data.board.cols || 5;
      this.gp.rows = data.board.rows || 5;
      this.gp.heightRatio = data.board.heightRatio || 1.2;
      this.gp.cellGapRatio = data.board.cellGapRatio || 1.5;
    }
    this.gp.pigs = (data.pigs || []).map(p => ({
      id: p.id, tailIndex: p.tail, length: p.length, angle: p.angle
    }));
    this.gp.nextPigId = this.gp.pigs.length > 0 ? Math.max(...this.gp.pigs.map(p => p.id)) + 1 : 0;
    this.gp.selectedPigId = null;
    this.gp.dragState = null;
    this.gp.flashingPigs = {};
    this.gp.animations = [];
    this.gp.ghostAnimations = [];
    this.gp.recomputeBoard();
    this.gp.recenterBoard();
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
      this.currentLevelIdx = -1;
      this.newLevel();
    }
  }

  saveLevel() {
    if (this.currentLevelIdx < 0 || this.currentLevelIdx >= this.levelList.length) {
      this.showToast('无关卡可保存'); return;
    }
    const entry = this.levelList[this.currentLevelIdx];
    if (!entry) { this.showToast('无关卡可保存'); return; }
    entry.data = this.getLevelData();
    entry.isDirty = false;

    const fs = wx.getFileSystemManager();
    const dir = `${wx.env.USER_DATA_PATH}/levels`;
    try { fs.accessSync(dir); } catch (e) { fs.mkdirSync(dir, true); }
    fs.writeFileSync(`${dir}/${entry.fileName}`, JSON.stringify(entry.data, null, 2), 'utf8');
    this.showToast(`已保存: ${entry.fileName}`);
  }

  newLevel() {
    if (this.currentLevelIdx >= 0 && this.currentLevelIdx < this.levelList.length) {
      this.levelList[this.currentLevelIdx].data = this.getLevelData();
    }
    let maxNum = 0;
    for (const lv of this.levelList) {
      const m = lv.name.match(/^(\d{4})$/);
      if (m) maxNum = Math.max(maxNum, parseInt(m[1]));
    }
    const num = maxNum + 1;
    const name = String(num).padStart(4, '0');
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
    if (this.gp.selectedPigId == null) {
      this.showToast('请先选中小猪');
      return;
    }
    this.gp.pigs = this.gp.pigs.filter(p => p.id !== this.gp.selectedPigId);
    this.gp.selectedPigId = null;
    this.showPigSheet = false;
    this.gp.rebuildOccupancy();
    this.markCurrentDirty();
    this.showToast('已删除小猪');
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
  // === 渲染入口 ===
  // ============================================================
  render() {
    this.gp.update();
    ctx.clearRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    // 计算提示文字
    let hintText = '';
    if (this.gp.selectedPigId != null && !this.gp.dragState) {
      const pig = this.gp.pigs.find(p => p.id === this.gp.selectedPigId);
      if (pig) {
        hintText = `小猪 #${pig.id} | 长度:${pig.length} | 角度:${pig.angle}°`;
      }
    }
    if (!hintText) {
      hintText = this.mode === 'edit'
        ? '按住小猪头部调长度 | 按住身体/尾部调方向 | 点击空孔放置'
        : '拖动小猪旋转 | 松手推出';
    }

    this.gp.renderBoard(ctx, { hintText, showSelection: this.mode === 'edit' });
    this.renderTopBar();
    this.renderBottomStrip();
    this.renderToast();

    if (this.showLevelSheet) this.renderLevelSheet();
    if (this.showPigSheet) this.renderPigSheet();
  }

  // ============================================================
  // === 渲染 — 顶部工具栏 ===
  // ============================================================
  renderTopBar() {
    const topBarH = this.gp.topBarH;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, SCREEN_WIDTH, topBarH);

    // 返回按钮（左上角）
    const backW = 32, backH = 28;
    const backX = 4, backY = (topBarH - backH) / 2;
    ctx.fillStyle = '#f0f0f0';
    roundRect(ctx,backX, backY, backW, backH, 5);
    ctx.fill();
    ctx.fillStyle = '#666';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('←', backX + backW / 2, backY + backH / 2);

    const titleX = backX + backW + 6;

    ctx.fillStyle = '#333';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('小猪推推乐 - 关卡编辑器', titleX, topBarH / 2);

    const rightBase = SCREEN_WIDTH - 8;

    // 编辑/试玩切换按钮（合并为一个）
    const btnW = 58, btnH = 30;
    const btnX = rightBase - btnW, btnY = (topBarH - btnH) / 2;
    const isEdit = this.mode === 'edit';
    ctx.fillStyle = isEdit ? '#2196F3' : '#f44336';
    roundRect(ctx,btnX, btnY, btnW, btnH, 5);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(isEdit ? '试玩' : '编辑', btnX + btnW / 2, btnY + btnH / 2);

    this.topBtns = [
      { x: backX, y: backY, w: backW, h: backH, action: 'back' },
      { x: btnX, y: btnY, w: btnW, h: btnH, action: 'toggleMode' }
    ];
  }

  checkTopButtons(x, y) {
    for (const btn of this.topBtns) {
      if (x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
        if (btn.action === 'toggleMode') this.toggleMode();
        if (btn.action === 'back') databus.gameState = 'menu';
        return true;
      }
    }
    return false;
  }

  // ============================================================
  // === 渲染 — 底部控制条 ===
  // ============================================================
  renderBottomStrip() {
    const y = SCREEN_HEIGHT - this.gp.bottomStripH;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, y, SCREEN_WIDTH, this.gp.bottomStripH);
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(SCREEN_WIDTH, y);
    ctx.stroke();

    this.bottomBtns = [];

    let x = 6;
    const midY = y + this.gp.bottomStripH / 2;
    const btnSize = 32;
    const btnY = y + (this.gp.bottomStripH - btnSize) / 2;

    // 列控制
    ctx.fillStyle = '#999';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('列', x + 14, midY);
    x += 22;

    this.addBottomBtn(x, btnY, btnSize, btnSize, '−', () => {
      this.gp.cols = Math.max(2, this.gp.cols - 1);
      this.gp.recomputeBoard();
      this.markCurrentDirty();
    });
    x += btnSize + 4;

    ctx.fillStyle = '#333';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(this.gp.cols), x + 14, midY);
    x += 30;

    this.addBottomBtn(x, btnY, btnSize, btnSize, '+', () => {
      this.gp.cols = Math.min(20, this.gp.cols + 1);
      this.gp.recomputeBoard();
      this.markCurrentDirty();
    });
    x += btnSize + 12;

    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + 8);
    ctx.lineTo(x, y + this.gp.bottomStripH - 8);
    ctx.stroke();
    x += 10;

    // 行控制
    ctx.fillStyle = '#999';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('行', x + 14, midY);
    x += 22;

    this.addBottomBtn(x, btnY, btnSize, btnSize, '−', () => {
      this.gp.rows = Math.max(2, this.gp.rows - 1);
      this.gp.recomputeBoard();
      this.markCurrentDirty();
    });
    x += btnSize + 4;

    ctx.fillStyle = '#333';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(this.gp.rows), x + 14, midY);
    x += 30;

    this.addBottomBtn(x, btnY, btnSize, btnSize, '+', () => {
      this.gp.rows = Math.min(20, this.gp.rows + 1);
      this.gp.recomputeBoard();
      this.markCurrentDirty();
    });
    x += btnSize + 12;

    ctx.strokeStyle = '#ddd';
    ctx.beginPath();
    ctx.moveTo(x, y + 8);
    ctx.lineTo(x, y + this.gp.bottomStripH - 8);
    ctx.stroke();
    x += 10;

    const remaining = SCREEN_WIDTH - x - 6;
    const actBtnW = Math.min(60, (remaining - 6) / 2);
    const actBtnH = 32;
    const actBtnY = y + (this.gp.bottomStripH - actBtnH) / 2;

    const levelBtnX = x;
    this.addColoredBtn(levelBtnX, actBtnY, actBtnW, actBtnH, '关卡', '#4CAF50', () => {
      this.showLevelSheet = !this.showLevelSheet;
      this.showPigSheet = false;
      this.levelSheetScrollY = 0;
    });
    x += actBtnW + 4;

    const pigBtnW = remaining - (actBtnW + 4);
    const pigLabel = this.gp.selectedPigId != null ? `#${this.gp.selectedPigId}` : '小猪';
    this.addColoredBtn(x, actBtnY, pigBtnW, actBtnH, pigLabel, '#FF9800', () => {
      if (this.gp.selectedPigId == null) {
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
    roundRect(ctx,x, y, w, h, 5);
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
    roundRect(ctx,x, y, w, h, 6);
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
    const sheetH = Math.min(320, SCREEN_HEIGHT - this.gp.topBarH);
    const sheetY = SCREEN_HEIGHT - sheetH;

    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    ctx.fillStyle = '#fff';
    roundRect(ctx,0, sheetY, SCREEN_WIDTH, sheetH, 16, true);
    ctx.fill();

    ctx.fillStyle = '#ddd';
    roundRect(ctx,SCREEN_WIDTH / 2 - 18, sheetY + 8, 36, 4, 2);
    ctx.fill();

    ctx.fillStyle = '#555';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('关卡列表', 16, sheetY + 22);

    const closeX = SCREEN_WIDTH - 40;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('✕', closeX + 12, sheetY + 20);

    const addBtnX = SCREEN_WIDTH - 110;
    ctx.fillStyle = '#4CAF50';
    roundRect(ctx,addBtnX, sheetY + 18, 50, 26, 4);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('+新建', addBtnX + 25, sheetY + 31);

    ctx.strokeStyle = '#eee';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(12, sheetY + 52);
    ctx.lineTo(SCREEN_WIDTH - 12, sheetY + 52);
    ctx.stroke();

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

      ctx.fillStyle = isActive ? '#E8F5E9' : 'rgba(0,0,0,0.02)';
      roundRect(ctx,10, itemY, SCREEN_WIDTH - 20, itemH - 4, 6);
      ctx.fill();
      if (isActive) {
        ctx.strokeStyle = '#4CAF50';
        ctx.lineWidth = 1;
        roundRect(ctx,10, itemY, SCREEN_WIDTH - 20, itemH - 4, 6);
        ctx.stroke();
      }

      ctx.fillStyle = isActive ? '#2E7D32' : '#333';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const dirtyMark = lv.isDirty ? ' *' : '';
      ctx.fillText(lv.name + dirtyMark, 22, itemY + (itemH - 4) / 2);

      ctx.fillStyle = '#999';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(lv.fileName || '未保存', 22, itemY + (itemH - 4) / 2 + 14);

      const delX = SCREEN_WIDTH - 58;
      const delY = itemY + 6;
      ctx.fillStyle = '#f44336';
      roundRect(ctx,delX, delY, 44, 28, 4);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('删除', delX + 22, delY + 14);
    }

    ctx.restore();

    const footerY = sheetY + sheetH - 44;
    if (this.currentLevelIdx >= 0 && this.currentLevelIdx < this.levelList.length) {
      ctx.fillStyle = '#4CAF50';
      roundRect(ctx,12, footerY, 64, 32, 6);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('保存', 12 + 32, footerY + 16);

      ctx.fillStyle = '#f44336';
      roundRect(ctx,84, footerY, 64, 32, 6);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('删除', 84 + 32, footerY + 16);
    }

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
    roundRect(ctx,0, sheetY, SCREEN_WIDTH, sheetH, 16, true);
    ctx.fill();

    ctx.fillStyle = '#ddd';
    roundRect(ctx,SCREEN_WIDTH / 2 - 18, sheetY + 8, 36, 4, 2);
    ctx.fill();

    ctx.fillStyle = '#555';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('选中小猪', 16, sheetY + 22);

    const closeX = SCREEN_WIDTH - 40;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('✕', closeX + 12, sheetY + 20);

    const pig = this.gp.pigs.find(p => p.id === this.gp.selectedPigId);
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

      const delBtnX = SCREEN_WIDTH - 100;
      const delBtnY = sheetY + sheetH - 48;
      ctx.fillStyle = '#f44336';
      roundRect(ctx,delBtnX, delBtnY, 84, 34, 6);
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
    if (this.showLevelSheet) {
      if (this.sheetCloseRect && this.hitRect(x, y, this.sheetCloseRect)) {
        this.showLevelSheet = false;
        return true;
      }
      if (this.sheetAddRect && this.hitRect(x, y, this.sheetAddRect)) {
        this.newLevel();
        return true;
      }
      if (this.sheetSaveRect && this.hitRect(x, y, this.sheetSaveRect)) {
        this.saveLevel();
        return true;
      }
      if (this.sheetDeleteRect && this.hitRect(x, y, this.sheetDeleteRect)) {
        this.deleteLevel();
        return true;
      }
      if (this.sheetRect && (x < this.sheetRect.x || x > this.sheetRect.x + this.sheetRect.w ||
          y < this.sheetRect.y)) {
        this.showLevelSheet = false;
        return true;
      }
      if (this.sheetListTop !== undefined) {
        for (let i = 0; i < this.levelList.length; i++) {
          const itemY = this.sheetListTop + i * this.sheetItemH + 4 - this.levelSheetScrollY;
          const delRect = { x: SCREEN_WIDTH - 58, y: itemY + 6, w: 44, h: 28 };
          if (this.hitRect(x, y, delRect)) {
            this.deleteLevelByIndex(i);
            return true;
          }
          const itemRect = { x: 10, y: itemY, w: SCREEN_WIDTH - 20, h: this.sheetItemH - 4 };
          if (this.hitRect(x, y, itemRect)) {
            this.switchToLevel(i);
            return true;
          }
        }
      }
    }

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
    const y = this.gp.topBarH + 6;

    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    roundRect(ctx,x, y, w, h, 8);
    ctx.fill();

    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.toastText, x + w / 2, y + h / 2);
    ctx.restore();
  }

}

module.exports = EditorEngine;
