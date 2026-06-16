// 关卡编辑器引擎（v26 — 组合 GameplayEngine，编辑/试玩一键切换）
// 纯 Canvas 2D 渲染，无 DOM 依赖
// require/module.exports，wx API，InputManager 事件路由

// wxfile://usr 在开发者工具中对应真实文件系统路径
// 仅用于日志输出，fs.writeFileSync 仍走 wxfile 协议
const WXFILE_USR_REAL = (() => {
  // 此路径每台机器不同，格式：
  // C:/Users/<用户名>/AppData/Local/微信开发者工具/User Data/<hash>/WeappSimulator/WeappFileSystem/<appid>/usr
  return 'C:/Users/58275/AppData/Local/微信开发者工具/User Data/80d774828fc67c7dafc59cd74ce70db0/WeappSimulator/WeappFileSystem/wxe02448bcf0540ff0/usr';
})();
const resolveRealPath = (wxfilePath) => wxfilePath.replace(/^wxfile:\/\/usr/, WXFILE_USR_REAL);

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
    this.levelBtns = [];
    this.showPigSheet = false;
    this.showLevelSheet = false;

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
      // 关卡选择面板优先
      if (this.showLevelSheet) {
        this.checkLevelSheetButtons(x, y);
        return;
      }
      // 小猪信息面板
      if (this.showPigSheet) {
        if (this.checkSheetButtons(x, y)) return;
        return;
      }
      // 底部控制条（关卡管理 + 棋盘参数 + 小猪面板）
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
      // 预览模式需走阈值逻辑 → 无条件调 onDragMove（即使 dragState 为空）
      if (this.gp.dragState || this.mode === 'preview') this.onDragMove(x, y);
    } else if (e.type === 'touchend') {
      if (this.gp.heightDragState) {
        this.gp.heightDragState = null;
        this.gp.recenterBoard();
        this.markCurrentDirty();
        return;
      }
      if (this.showPigSheet) return;
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
    // 放置拖拽中不强制头部落孔（与 adjustLength 行为对齐）
    const check = this.gp.checkAngleValid(tailIdx, len, excludeId, angle, false);
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
      this.gp.pigs = this.gp.pigs.filter(p => p.id !== this.gp.dragState.pendingId);
      if (lv && verifyHeadOnHole(lv.tailIndex, lv.length, lv.angle)) {
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
        // 头部未落孔 → 恢复原状态
        this.gp.pigs.push(this.gp.dragState.originalPig);
        this.gp.selectedPigId = this.gp.dragState.originalPig.id;
        this.gp.rebuildOccupancy();
        this.showToast('头部未落孔，已恢复');
      }
      // 没有 originalPig 的新建场景 → 猪已被过滤删除
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
        } else {
          // 头部未落孔 → 清理 temp 占用
          this.gp.rebuildOccupancy();
        }
      } else if (this.gp.dragState.originalPig) {
        this.gp.pigs.push(this.gp.dragState.originalPig);
        this.gp.rebuildOccupancy();
        this.gp.selectedPigId = this.gp.dragState.originalPig.id;
      } else {
        // lv 不存在且无原始猪 → 清理 temp 占用
        this.gp.rebuildOccupancy();
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
    const fullPath = `${dir}/${entry.fileName}`;
    fs.writeFileSync(fullPath, JSON.stringify(entry.data, null, 2), 'utf8');
    console.log(`关卡保存成功, 完整路径: ${resolveRealPath(fullPath)}`);
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

  switchToLevel(idx, force) {
    if (idx === this.currentLevelIdx && !force) return;
    if (idx < 0 || idx >= this.levelList.length) return;
    if (this.currentLevelIdx >= 0 && this.currentLevelIdx !== idx) {
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
  }

  // ---- 清空所有小猪 ----
  clearLevel() {
    const count = this.gp.pigs.length;
    if (count === 0) { this.showToast('棋盘已空'); return; }
    this.gp.pigs = [];
    this.gp.selectedPigId = null;
    this.gp.dragState = null;
    this.gp.rebuildOccupancy();
    this.markCurrentDirty();
    this.showToast(`已清空 ${count} 只小猪`);
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

    if (this.showPigSheet) this.renderPigSheet();
    if (this.showLevelSheet) this.renderLevelSheet();
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
  // 第一行：[列 -5+] [行 -5+] | [猪]
  // 第二行：[0002 ▼] [新建] [保存] [删除] [清空] [重置]
  // ============================================================
  renderBottomStrip() {
    const baseY = SCREEN_HEIGHT - this.gp.bottomStripH;
    const H = this.gp.bottomStripH;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, baseY, SCREEN_WIDTH, H);
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, baseY);
    ctx.lineTo(SCREEN_WIDTH, baseY);
    ctx.stroke();

    this.bottomBtns = [];
    this.levelBtns = [];

    const row1H = 34;
    const row1Y = baseY + 2;
    const row2H = 34;
    const row2Y = baseY + row1H + 2;

    // ============================
    // 第一行：棋盘尺寸 + 小猪按钮
    // ============================
    const btnH = 26;
    const btnY1 = row1Y + (row1H - btnH) / 2;
    const midY1 = row1Y + row1H / 2;

    let x = 4;

    // 列控制
    this._drawCompactStepper(x, btnY1, btnH, '列', this.gp.cols, 2, 20,
      (v) => { this.gp.cols = v; this.gp.recomputeBoard(); this.markCurrentDirty(); });
    x += 58;

    // 行控制
    this._drawCompactStepper(x, btnY1, btnH, '行', this.gp.rows, 2, 20,
      (v) => { this.gp.rows = v; this.gp.recomputeBoard(); this.markCurrentDirty(); });
    x += 58;

    // 分隔线
    x += 4;
    ctx.strokeStyle = '#ddd';
    ctx.beginPath();
    ctx.moveTo(x, row1Y + 4);
    ctx.lineTo(x, row1Y + row1H - 4);
    ctx.stroke();
    x += 6;

    // 小猪按钮
    const pigW = 26;
    const pigLabel = this.gp.selectedPigId != null ? '#' + this.gp.selectedPigId : '猪';
    ctx.fillStyle = '#FF9800';
    roundRect(ctx, x, btnY1, pigW, btnH, 4);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(pigLabel, x + pigW / 2, midY1);
    this.bottomBtns.push({ x, y: btnY1, w: pigW, h: btnH, onClick: () => {
      if (this.gp.selectedPigId == null) {
        this.showToast('请先在棋盘上选中小猪');
        return;
      }
      this.showPigSheet = !this.showPigSheet;
    }});

    // ============================
    // 第二行：关卡管理
    // ============================
    const btnY2 = row2Y + (row2H - btnH) / 2;
    const midY2 = row2Y + row2H / 2;
    x = 4;

    // 分隔线（顶边）
    ctx.strokeStyle = '#ddd';
    ctx.beginPath();
    ctx.moveTo(0, row2Y - 1);
    ctx.lineTo(SCREEN_WIDTH, row2Y - 1);
    ctx.stroke();

    // 关卡选择按钮 [0002 ▼]
    const hasLevels = this.levelList.length > 0;
    const curName = hasLevels && this.currentLevelIdx >= 0
      ? this.levelList[this.currentLevelIdx].name : '---';
    const isDirty = hasLevels && this.currentLevelIdx >= 0
      && this.levelList[this.currentLevelIdx].isDirty;

    const lvlBtnW = 58;
    ctx.fillStyle = '#f5f5f5';
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    roundRect(ctx, x, btnY2, lvlBtnW, btnH, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = isDirty ? '#E65100' : '#333';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lvlLabel = (isDirty ? '*' : '') + curName + ' ▼';
    ctx.fillText(lvlLabel, x + lvlBtnW / 2, midY2);
    this.levelBtns.push({ x, y: btnY2, w: lvlBtnW, h: btnH, action: 'showLevelSheet' });
    x += lvlBtnW + 4;

    // 操作按钮：新建 / 保存 / 删除 / 清空 / 重置
    const opBtns = [
      { label: '新建', color: '#4CAF50', action: 'newLevel' },
      { label: '保存', color: '#2196F3', action: 'saveLevel' },
      { label: '删除', color: '#f44336', action: 'deleteLevel' },
      { label: '清空', color: '#FF9800', action: 'clearLevel' },
      { label: '重置', color: '#9C27B0', action: 'resetLevel' },
    ];

    const opW = 30;
    for (const b of opBtns) {
      ctx.fillStyle = b.color;
      roundRect(ctx, x, btnY2, opW, btnH, 4);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.label, x + opW / 2, midY2);
      this.levelBtns.push({ x, y: btnY2, w: opW, h: btnH, action: b.action });
      x += opW + 3;
    }
  }

  // ---- 紧凑步进器：label [- value +] ----
  _drawCompactStepper(x, btnY, btnH, label, value, min, max, onChange) {
    const midY = btnY + btnH / 2;
    const btnW = 18;

    // 标签
    ctx.fillStyle = '#999';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, midY);
    x += 12;

    // 减号
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    roundRect(ctx, x, btnY, btnW, btnH, 4);
    ctx.stroke();
    ctx.fillStyle = '#333';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('−', x + btnW / 2, midY);
    this.bottomBtns.push({ x, y: btnY, w: btnW, h: btnH, onClick: () => onChange(Math.max(min, value - 1)) });
    x += btnW + 2;

    // 数值
    ctx.fillStyle = '#333';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(value), x + 6, midY);
    x += 12;

    // 加号
    ctx.strokeStyle = '#ccc';
    roundRect(ctx, x, btnY, btnW, btnH, 4);
    ctx.stroke();
    ctx.fillStyle = '#333';
    ctx.fillText('+', x + btnW / 2, midY);
    this.bottomBtns.push({ x, y: btnY, w: btnW, h: btnH, onClick: () => onChange(Math.min(max, value + 1)) });
  }

  addBottomBtn(x, y, w, h, text, onClick) {
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    roundRect(ctx, x, y, w, h, 5);
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
    roundRect(ctx, x, y, w, h, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w / 2, y + h / 2);
    this.bottomBtns.push({ x, y, w, h, onClick });
  }

  checkBottomButtons(x, y) {
    // 关卡管理按钮
    for (const btn of this.levelBtns) {
      if (x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
        this._handleLevelAction(btn.action);
        return true;
      }
    }
    // 棋盘参数按钮（列/行 ±）
    for (const btn of this.bottomBtns) {
      if (btn.onClick && x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
        btn.onClick();
        return true;
      }
    }
    return false;
  }

  _handleLevelAction(action) {
    switch (action) {
      case 'showLevelSheet': {
        if (this.levelList.length === 0) {
          this.showToast('暂无关卡');
          return;
        }
        this.showLevelSheet = !this.showLevelSheet;
        break;
      }
      case 'newLevel': this.newLevel(); break;
      case 'saveLevel': this.saveLevel(); break;
      case 'deleteLevel': this.deleteLevel(); break;
      case 'clearLevel': this.clearLevel(); break;
      case 'resetLevel': {
        if (this.currentLevelIdx < 0 || this.currentLevelIdx >= this.levelList.length) {
          this.showToast('未选中关卡');
          return;
        }
        this.switchToLevel(this.currentLevelIdx, true);
        this.showToast('已重置');
        break;
      }
      case 'togglePig': {
        if (this.gp.selectedPigId == null) {
          this.showToast('请先在棋盘上选中小猪');
          return;
        }
        this.showPigSheet = !this.showPigSheet;
        break;
      }
    }
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
  // === 关卡选择子页面 ===
  // ============================================================
  renderLevelSheet() {
    const sheetH = Math.min(SCREEN_HEIGHT * 0.65, this.levelList.length * 36 + 60);
    const sheetY = SCREEN_HEIGHT - sheetH;

    // 半透明遮罩
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    // 面板背景
    ctx.fillStyle = '#fff';
    roundRect(ctx, 0, sheetY, SCREEN_WIDTH, sheetH, 16, true);
    ctx.fill();

    // 拖拽指示条
    ctx.fillStyle = '#ddd';
    roundRect(ctx, SCREEN_WIDTH / 2 - 18, sheetY + 8, 36, 4, 2);
    ctx.fill();

    // 标题
    ctx.fillStyle = '#333';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('选择关卡', 16, sheetY + 22);

    // 关闭按钮
    const closeX = SCREEN_WIDTH - 40;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.font = '16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('✕', closeX + 12, sheetY + 20);

    // 关卡列表
    const listY = sheetY + 48;
    const itemH = 32;
    this.levelSheetItems = [];

    for (let i = 0; i < this.levelList.length; i++) {
      const itemY = listY + i * itemH;
      if (itemY + itemH > sheetY + sheetH - 8) break;

      const lv = this.levelList[i];
      const isActive = i === this.currentLevelIdx;

      // 选中项背景
      if (isActive) {
        ctx.fillStyle = '#E3F2FD';
        ctx.fillRect(12, itemY, SCREEN_WIDTH - 24, itemH);
      }

      // 选中指示器
      if (isActive) {
        ctx.fillStyle = '#2196F3';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('▶', 20, itemY + itemH / 2);
      }

      // 关卡名称
      ctx.fillStyle = isActive ? '#1565C0' : '#333';
      ctx.font = (isActive ? 'bold ' : '') + '13px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const nameX = isActive ? 38 : 20;
      const dirtyMark = lv.isDirty ? ' *' : '';
      ctx.fillText(lv.name + dirtyMark, nameX, itemY + itemH / 2);

      // 底部分隔线
      if (i < this.levelList.length - 1) {
        ctx.strokeStyle = '#f0f0f0';
        ctx.beginPath();
        ctx.moveTo(20, itemY + itemH);
        ctx.lineTo(SCREEN_WIDTH - 20, itemY + itemH);
        ctx.stroke();
      }

      this.levelSheetItems.push({ x: 12, y: itemY, w: SCREEN_WIDTH - 24, h: itemH, index: i });
    }

    this.sheetLevelRect = { x: 0, y: sheetY, w: SCREEN_WIDTH, h: sheetH };
    this.sheetLevelCloseRect = { x: closeX, y: sheetY + 16, w: 32, h: 32 };
  }

  checkLevelSheetButtons(x, y) {
    if (!this.showLevelSheet) return false;

    if (this.sheetLevelCloseRect && this.hitRect(x, y, this.sheetLevelCloseRect)) {
      this.showLevelSheet = false;
      return true;
    }

    if (this.sheetLevelRect && y < this.sheetLevelRect.y) {
      this.showLevelSheet = false;
      return true;
    }

    if (this.levelSheetItems) {
      for (const item of this.levelSheetItems) {
        if (this.hitRect(x, y, item)) {
          this.switchToLevel(item.index);
          this.showLevelSheet = false;
          return true;
        }
      }
    }

    return true;
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
