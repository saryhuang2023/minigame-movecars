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
const cloud = require('../cloud.js');

const BG_COLOR = '#1a1a2e';
const DRAG_THRESHOLD = 20; // 最小移动距离（px），低于此值视为点击

class EditorEngine {
  constructor(inputManager) {
    this.input = inputManager;
    this.gp = new GameplayEngine();
    this.gp.effectiveWidth = SCREEN_WIDTH;  // 编辑模式永远用真实设备宽度

    // ===== 编辑状态 =====
    this.dirty = false;
    this.confirmDialog = null;  // { title, message, onSave, onSkip }

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
    this.gp.effectiveWidth = SCREEN_WIDTH;
    this.gp.bottomStripH = 170;
    this.gp.recomputeBoard();
    this.gp.recenterBoard();
    this.loadLevelList();
    this.dirty = false;
    this.showRedFrame = false;
    this.input.on('editor', (e) => this.handleEvent(e));
    // 异步从云端拉取关卡列表
    this._pullCloudLevels();
  }

  deactivate() {
    this.input.off('editor');
    this.confirmDialog = null;
  }

  // ============================================================
  // 事件处理
  // ============================================================
  handleEvent(e) {
    const t0 = e.touches[0] || e.changedTouches[0];
    if (!t0) return;
    const x = t0.x, y = t0.y;

    if (e.type === 'touchstart') {
      // 确认对话框优先
      if (this.confirmDialog) {
        this.checkConfirmDialog(x, y);
        return;
      }
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
      // 顶部工具栏
      if (y < this.gp.topBarH) {
        this.checkTopButtons(x, y);
        return;
      }
      // 屏幕宽度面板（左上角浮动）
      if (this.widthPanelBtns && this.checkWidthPanelBtns(x, y)) return;
      // 棋盘
      this.onBoardTouchStart(x, y);
    } else if (e.type === 'touchmove') {
      if (this.gp.dragState) this.onDragMove(x, y);
    } else if (e.type === 'touchend') {
      if (this.showPigSheet) return;
      if (this.gp.dragState) this.onDragEnd(x, y);
    }
  }

  onBoardTouchStart(x, y) {
    if (y < this.gp.topBarH || y > SCREEN_HEIGHT - this.gp.bottomStripH) return;
    this.handleEditTouchStart(x, y);
  }

  // ============================================================
  // 编辑模式 — 触摸处理
  // ============================================================
  handleEditTouchStart(x, y) {
    const pigInfo = this.gp.getPigAtPoint(x, y);
    if (pigInfo) {
      const pig = this.gp.pigs.find(p => p.id === pigInfo.id);
      if (!pig) return;
      this.gp.selectedPigId = pigInfo.id;
      this.gp.dragState = null;

      const isHead = pigInfo.offset >= pigInfo.totalLen - this.gp.scaledHeadZone;

      if (isHead) {
        // 头部拖拽：移除原猪，用临时猪（避免自碰撞）
        this.gp.pigs = this.gp.pigs.filter(p => p.id !== pigInfo.id);
        const tempId = -999;
        this.gp.pigs.push({ id: tempId, tailIndex: pig.tailIndex, length: pig.length, angle: pig.angle });
        this.gp.rebuildOccupancy();
        this.gp.dragState = {
          type: 'adjustHead',
          tailIndex: pig.tailIndex,
          pigId: pigInfo.id,
          originalPig: pig,
          pendingId: tempId,
          lastValid: { tailIndex: pig.tailIndex, length: pig.length, angle: pig.angle },
          headHoleIdx: -1,
          lastCollidedId: null,
          isValidNow: true
        };
      } else {
        // 身体/尾部旋转：与正式游玩一致的 rotate 路径，猪保持在原位
        this.gp.dragState = {
          type: 'rotate',
          tailIndex: pig.tailIndex,
          pigId: pigInfo.id,
          displayAngle: pig.angle,
          targetAngle: pig.angle,
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
      // 防御检查：即使 getPigAtPoint + holeOccupied 都未发现，只要有任何猪的尾部
      // 正好在这个孔位上，就不能创建新猪（防止 OBB 碰撞模型与视觉渲染的细微偏差）
      const tailConflict = this.gp.pigs.find(p => p.tailIndex === holeIdx);
      if (tailConflict) {
        this.gp.selectedPigId = tailConflict.id;
        this.gp.dragState = null;
        return;
      }
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
  // 拖拽移动
  // ============================================================
  onDragMove(x, y) {
    const now = Date.now();
    if (now - this.gp.lastDragTime < 33) return;
    this.gp.lastDragTime = now;

    if (this.gp.dragState && this.gp.dragState.type === 'rotate') {
      this.gp.handleRotateDrag(x, y);
    } else if (this.gp.dragState && this.gp.dragState.type === 'adjustHead') {
      this.handleAdjustHeadDrag(x, y);
    } else if (this.gp.dragState) {
      this.handlePlaceDrag(x, y);
    }
  }

  // 放置拖拽：检测碰撞 + 合法性
  handlePlaceDrag(x, y) {
    // 拖拽过程中尾孔可能已被其他操作占用 → 停止本次拖拽
    // 但允许当前拖拽自身的 temp pig 通过（pendingId 可能是 -999）
    const isOwnTemp = this.gp.dragState.pendingId != null &&
      this.gp.holeOccupied[this.gp.dragState.tailIndex] === this.gp.dragState.pendingId;
    if (this.gp.holeOccupied[this.gp.dragState.tailIndex] !== -1 && !isOwnTemp) {
      this.gp.dragState.isValidNow = false;
      this.gp.dragState.headHoleIdx = -1;
      return;
    }
    const result = this.findBestDragConfig(x, y);
    if (result.cfg) {
      this.applyDragConfig(result.cfg);
      this.gp.dragState.lastValid = result.cfg;
      this.gp.dragState.lastCollidedId = null;
      this.gp.dragState.isValidNow = true;
      // 头部红圈：计算 headHoleIdx 使 renderBoard 绘制红色高亮环
      this.gp.dragState.headHoleIdx = this.gp.findHeadHole(
        result.cfg.tailIndex, result.cfg.length, result.cfg.angle
      );
    } else {
      this.gp.dragState.isValidNow = false;
      this.gp.dragState.headHoleIdx = -1;
      if (result.collidedId != null && result.collidedId !== this.gp.dragState.lastCollidedId) {
        this.gp.triggerCollisionEffect(result.collidedId);
        this.gp.dragState.lastCollidedId = result.collidedId;
      }
    }
  }

  // 头部拖拽（角度+长度同时跟随手指）
  handleAdjustHeadDrag(x, y) {
    const ds = this.gp.dragState;
    const tail = this.gp.holes[ds.tailIndex];
    if (!tail) return;

    const dx = x - this.gp.boardOffsetX - tail.x;
    const dy = y - this.gp.topBarH - this.gp.boardOffsetY - tail.y;
    let angle = Math.atan2(-dy, dx) * 180 / Math.PI;
    if (angle < 0) angle += 360;
    angle = Math.round(angle);

    const dist = Math.sqrt(dx * dx + dy * dy);
    const scaledDist = dist / this.gp.boardScale;
    const len = Math.max(this.gp.diameter, Math.min(this.gp.diameter * 15, Math.round(scaledDist)));

    // 长度和角度都没变 → 跳过（像素值允许 ±2px 误差）
    if (ds._lastLen !== undefined && Math.abs(ds._lastLen - len) < 3 && ds._lastAngle === angle) return;
    ds._lastLen = len;
    ds._lastAngle = angle;

    const excludeId = ds.pendingId;
    // 拖拽中不强制头部落孔（仅碰撞检查）
    const check = this.gp.checkAngleValid(ds.tailIndex, len, excludeId, angle, false);
    if (check.valid) {
      // 原地更新 temp 猪
      const tempPig = this.gp.pigs.find(p => p.id === excludeId);
      if (tempPig) { tempPig.length = len; tempPig.angle = angle; }
      this.gp.updatePigOccupancy(excludeId, ds.tailIndex, len, angle);
      ds.headHoleIdx = this.gp.findHeadHole(ds.tailIndex, len, angle);
      ds.lastValid = { tailIndex: ds.tailIndex, length: len, angle };
      ds.lastCollidedId = null;
      ds.isValidNow = true;
    } else {
      if (check.collidedId !== undefined && check.collidedId !== ds.lastCollidedId) {
        this.gp.triggerCollisionEffect(check.collidedId);
        ds.lastCollidedId = check.collidedId;
      }
      ds.headHoleIdx = -1;
      ds.isValidNow = false;
      // 碰撞 → 先找角度边界（与身体旋转一致），再限制长度
      if (ds.lastValid) {
        // 第一步：二分查找角度边界（lastValid.angle → 碰撞角度之间）
        const boundaryAngle = this.gp.findAngleBoundary(
          ds.lastValid.angle, angle, ds.tailIndex, ds.lastValid.length, excludeId
        );

        // 第二步：在边界角度上二分搜索最大有效长度
        let lo = ds.lastValid.length;
        let hi = len;
        for (let i = 0; i < 10; i++) {
          const mid = Math.floor((lo + hi) / 2);
          if (mid <= lo || mid >= hi) break;
          const mc = this.gp.checkAngleValid(ds.tailIndex, mid, excludeId, boundaryAngle, false);
          if (mc.valid) { lo = mid; } else { hi = mid; }
        }

        // 最终验证：边界角度 + 搜索出的长度是否有效
        const finalCheck = this.gp.checkAngleValid(ds.tailIndex, lo, excludeId, boundaryAngle, false);
        const tempPig = this.gp.pigs.find(p => p.id === excludeId);
        if (finalCheck.valid) {
          if (tempPig) { tempPig.length = lo; tempPig.angle = boundaryAngle; }
          this.gp.updatePigOccupancy(excludeId, ds.tailIndex, lo, boundaryAngle);
          ds.lastValid = { tailIndex: ds.tailIndex, length: lo, angle: boundaryAngle };
        } else {
          // 无法找到有效配置 → 完全回退到上次有效状态
          if (tempPig) { tempPig.length = ds.lastValid.length; tempPig.angle = ds.lastValid.angle; }
          this.gp.updatePigOccupancy(excludeId, ds.tailIndex, ds.lastValid.length, ds.lastValid.angle);
        }
      }
    }
  }

  findBestDragConfig(x, y) {
    const tailIdx = this.gp.dragState.tailIndex;
    // 尾孔已被占用 → 不允许在此放置/创建新猪
    // 但允许当前拖拽自身的 temp pig 通过
    const isOwnTemp = this.gp.dragState.pendingId != null &&
      this.gp.holeOccupied[tailIdx] === this.gp.dragState.pendingId;
    if (this.gp.holeOccupied[tailIdx] !== -1 && !isOwnTemp) return { cfg: null };
    const tail = this.gp.holes[tailIdx];
    if (!tail) return { cfg: null };

    const dx = x - this.gp.boardOffsetX - tail.x;
    const dy = y - this.gp.topBarH - this.gp.boardOffsetY - tail.y;
    let angle = Math.atan2(-dy, dx) * 180 / Math.PI;
    if (angle < 0) angle += 360;
    angle = Math.round(angle);

    const dist = Math.sqrt(dx * dx + dy * dy);
    const scaledDist = dist / this.gp.boardScale;
    const len = Math.max(this.gp.diameter, Math.min(this.gp.diameter * 15, Math.round(scaledDist)));

    const pig = this.gp.dragState.pigId != null ? this.gp.pigs.find(p => p.id === this.gp.dragState.pigId) : null;

    const excludeId = this.gp.dragState.pendingId != null ? this.gp.dragState.pendingId
      : (pig ? pig.id : -1);
    // 放置拖拽中不强制头部落孔（与 adjustHead 行为对齐）
    const check = this.gp.checkAngleValid(tailIdx, len, excludeId, angle, false);
    if (!check.valid) return { cfg: null, collidedId: check.collidedId };
    return { cfg: { tailIndex: tailIdx, length: len, angle, inBounds: true } };
  }

  // 松手时将猪头部对准最近的孔 —— 三点共线对齐（委托给 GameplayEngine 共享方法）
  _snapWithLengthFallback(tailIndex, length, hintAngle) {
    return this.gp.snapAlignPig(tailIndex, length, hintAngle);
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
    if (!this.gp.dragState) return;

    const lv = this.gp.dragState.lastValid;

    if (this.gp.dragState.type === 'rotate') {
      const pig = this.gp.pigs.find(p => p.id === this.gp.dragState.pigId);
      if (pig && lv) {
        const snapped = this._snapWithLengthFallback(
          this.gp.dragState.tailIndex, pig.length, lv.angle
        );
        if (snapped) {
          pig.length = snapped.length;
          pig.angle = snapped.angle;
          this.gp.updatePigOccupancy(pig.id, snapped.tailIndex, snapped.length, snapped.angle);
          this.markCurrentDirty();
          this.showToast(`小猪 #${pig.id} → ${snapped.length}px ${snapped.angle}°`);
          this.tryGhostPush(pig.id);
        } else {
          // 无法落孔 → 回退到 lastValid（保持无碰撞状态）
          pig.angle = lv.angle;
          this.gp.updatePigOccupancy(pig.id, this.gp.dragState.tailIndex, pig.length, lv.angle);
          this.showToast('头部未落孔');
        }
      } else if (pig) {
        this.gp.updatePigOccupancy(pig.id, this.gp.dragState.tailIndex, pig.length, pig.angle);
      }
    } else if (this.gp.dragState.type === 'adjustHead') {
      this.gp.pigs = this.gp.pigs.filter(p => p.id !== this.gp.dragState.pendingId);
      if (lv) {
        const snapped = this._snapWithLengthFallback(
          lv.tailIndex, lv.length, lv.angle
        );
        if (snapped) {
          const realId = this.gp.dragState.pigId;
          this.gp.pigs.push({ id: realId, tailIndex: snapped.tailIndex, length: snapped.length, angle: snapped.angle });
          this.gp.selectedPigId = realId;
          for (let i = 0; i < this.gp.holeOccupied.length; i++) {
            if (this.gp.holeOccupied[i] === -999) this.gp.holeOccupied[i] = realId;
          }
          this.gp.updatePigOccupancy(realId, snapped.tailIndex, snapped.length, snapped.angle);
          this.showToast(`小猪 #${realId} → ${snapped.length}px ${snapped.angle}°`);
          this.markCurrentDirty();
          this.tryGhostPush(realId);
        } else if (this.gp.dragState.originalPig) {
          this.gp.pigs.push(this.gp.dragState.originalPig);
          this.gp.selectedPigId = this.gp.dragState.originalPig.id;
          this.gp.rebuildOccupancy();
          this.showToast('头部未落孔，已恢复');
        }
      } else if (this.gp.dragState.originalPig) {
        this.gp.pigs.push(this.gp.dragState.originalPig);
        this.gp.selectedPigId = this.gp.dragState.originalPig.id;
        this.gp.rebuildOccupancy();
      }
    } else if (this.gp.dragState.type === 'place') {
      this.gp.pigs = this.gp.pigs.filter(p => p.id !== this.gp.dragState.pendingId);
      if (lv) {
        const snapped = this._snapWithLengthFallback(
          lv.tailIndex, lv.length, lv.angle
        );
        if (snapped) {
          let realId;
          if (this.gp.dragState.pigId != null) {
            realId = this.gp.dragState.pigId;
            this.gp.pigs.push({ id: realId, tailIndex: snapped.tailIndex, length: snapped.length, angle: snapped.angle });
            this.gp.selectedPigId = realId;
            this.showToast(`小猪 #${realId} 已调整 (${snapped.length}px, ${snapped.angle}°)`);
          } else {
            realId = this.gp.nextPigId++;
            this.gp.pigs.push({ id: realId, tailIndex: snapped.tailIndex, length: snapped.length, angle: snapped.angle });
            this.gp.selectedPigId = realId;
            this.showToast(`小猪 #${realId} 已放置 (${snapped.length}px, ${snapped.angle}°)`);
          }
          for (let i = 0; i < this.gp.holeOccupied.length; i++) {
            if (this.gp.holeOccupied[i] === -999) this.gp.holeOccupied[i] = realId;
          }
          this.gp.updatePigOccupancy(realId, snapped.tailIndex, snapped.length, snapped.angle);
          this.markCurrentDirty();
          this.tryGhostPush(realId);
        } else {
          // 无法落孔 → 清理 temp 占用
          this.gp.rebuildOccupancy();
          this.showToast('头部未落孔');
        }
      } else if (this.gp.dragState.originalPig) {
        this.gp.pigs.push(this.gp.dragState.originalPig);
        this.gp.rebuildOccupancy();
        this.gp.selectedPigId = this.gp.dragState.originalPig.id;
      } else {
        this.gp.rebuildOccupancy();
      }
    }

    this.gp.dragState = null;
    this.gp.recenterBoard();
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
  // 跳转控制
  // ============================================================
  _goToPlaying() {
    databus.currentLevel = { name: '试玩', data: this.getLevelData() };
    databus.returnState = 'editor';
    databus.gameState = 'playing';
  }

  _goToMenu() {
    databus.gameState = 'menu';
  }

  _checkDirtyAndDo(action) {
    if (this.dirty) {
      this.confirmDialog = {
        title: '关卡未保存',
        message: '是否保存当前关卡？',
        onSave: () => { this.saveLevel(); this.dirty = false; action(); },
        onSkip: () => { this.dirty = false; action(); }
      };
    } else {
      action();
    }
  }

  // ============================================================
  // 关卡数据
  // ============================================================
  getLevelData() {
    const curData = this.currentLevelIdx >= 0 && this.currentLevelIdx < this.levelList.length
      ? this.levelList[this.currentLevelIdx].data : null;
    return {
      board: { cols: this.gp.cols, hGap: this.gp.hGap, rows: this.gp.rows, vGap: this.gp.vGap, diameter: this.gp.diameter },
      pigs: this.gp.pigs.map(p => ({ id: p.id, tail: p.tailIndex, length: p.length, angle: p.angle })),
      ready: (curData && curData.ready != null) ? curData.ready : 0
    };
  }

  loadLevelData(data) {
    if (data.board) {
      this.gp.cols = data.board.cols || 5;
      this.gp.rows = data.board.rows || 5;
      this.gp.hGap = data.board.hGap || 10;
      this.gp.vGap = data.board.vGap || 10;
      this.gp.diameter = data.board.diameter || 30;
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
    this.dirty = false;
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
          const name = f.replace('.json', '');
          // 读取已保存的 _cloudId 和 _version
          // 优先从 data.version 读取版本号（上传时写入），.meta 作为兜底
          let cloudId = null, localVersion = data.version || 0;
          const metaPath = `${dir}/.meta/${name}.json`;
          try {
            const metaRaw = fs.readFileSync(metaPath, 'utf8');
            const meta = JSON.parse(metaRaw);
            cloudId = meta.cloudId || null;
            if (!localVersion) localVersion = meta.version || 0;
          } catch (e) {}
          return { name, fileName: f, data, isDirty: false, _cloudId: cloudId, _version: localVersion };
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
    if (!this.gp.pigs || this.gp.pigs.length === 0) {
      this.showToast('没有猪，不能保存'); return;
    }
    const entry = this.levelList[this.currentLevelIdx];
    if (!entry) { this.showToast('无关卡可保存'); return; }
    entry.data = this.getLevelData();
    entry.isDirty = false;
    this.dirty = false;

    const fs = wx.getFileSystemManager();
    const dir = `${wx.env.USER_DATA_PATH}/levels`;
    try { fs.accessSync(dir); } catch (e) { fs.mkdirSync(dir, true); }
    const fullPath = `${dir}/${entry.fileName}`;
    fs.writeFileSync(fullPath, JSON.stringify(entry.data, null, 2), 'utf8');
    console.log(`关卡保存成功, 完整路径: ${resolveRealPath(fullPath)}`);
    this.showToast(`已保存: ${entry.fileName}`);

    // 异步上传到云端
    this._uploadToCloud(entry);
  }

  // ---- 本地同步：从正式关卡目录覆盖 board/pigs，保留编辑器元数据 ----
  localSync() {
    if (this.currentLevelIdx < 0 || this.currentLevelIdx >= this.levelList.length) {
      this.showToast('无关卡可同步'); return;
    }
    const entry = this.levelList[this.currentLevelIdx];
    const name = entry.name;
    const srcPath = `assets/levels/${name}.json`;
    const dstPath = `${wx.env.USER_DATA_PATH}/levels/${name}.json`;

    const fs = wx.getFileSystemManager();
    try {
      const formalRaw = fs.readFileSync(srcPath, 'utf8');
      const formal = JSON.parse(formalRaw);
      // 保留编辑器元数据（正式关卡文件不含 ready/version 等字段）
      if (entry.data && entry.data.ready !== undefined) {
        formal.ready = entry.data.ready;
      }
      if (entry.data && entry.data.version !== undefined) {
        formal.version = entry.data.version;
      }
      // 写入合并后的数据
      fs.writeFileSync(dstPath, JSON.stringify(formal, null, 2), 'utf8');
      // 更新内存
      entry.data = formal;
      entry.isDirty = false;
      entry._version = formal.version || 0;
      entry._cloudId = null;
      this.dirty = false;
      this.loadLevelData(formal);
      this.showToast(`已同步: ${name}`);
    } catch (e) {
      this.showToast(`正式关卡无: ${name}`);
    }
  }

  // ---- 切换关卡 ready 状态：0(设计中) ↔ 1(待发布) ----
  toggleReady() {
    if (this.currentLevelIdx < 0 || this.currentLevelIdx >= this.levelList.length) {
      this.showToast('无关卡可切换'); return;
    }
    const entry = this.levelList[this.currentLevelIdx];
    const curReady = entry.data.ready || 0;
    const newReady = curReady === 1 ? 0 : 1;
    entry.data.ready = newReady;
    entry.isDirty = true;
    this.dirty = true;
    this.showToast(newReady === 1 ? '已设为待发布' : '已设为设计中');
  }

  // ---- 复制关卡：新建关卡并拷贝当前内容 ----
  exportLevel() {
    if (this.currentLevelIdx < 0 || this.currentLevelIdx >= this.levelList.length) {
      this.showToast('无关卡可复制'); return;
    }
    // 先保存当前编辑内容到当前关卡
    this.levelList[this.currentLevelIdx].data = this.getLevelData();

    // 生成新编号
    let maxNum = 0;
    for (const lv of this.levelList) {
      const m = lv.name.match(/^(\d{4})$/);
      if (m) maxNum = Math.max(maxNum, parseInt(m[1]));
    }
    const num = maxNum + 1;
    const name = String(num).padStart(4, '0');
    const fileName = name + '.json';

    // 深拷贝当前关卡数据作为新关卡内容
    const copiedData = JSON.parse(JSON.stringify(this.levelList[this.currentLevelIdx].data));
    this.levelList.push({ name, fileName, data: copiedData, isDirty: true, _version: 0 });
    this.currentLevelIdx = this.levelList.length - 1;
    this.loadLevelData(this.levelList[this.currentLevelIdx].data);
    this.showToast(`已复制为: ${name}`);
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
    this.levelList.push({ name, fileName, data: this.getDefaultLevelData(), isDirty: true, _version: 0 });
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
      // 清理 .meta
      try { fs.unlinkSync(`${wx.env.USER_DATA_PATH}/levels/.meta/${entry.name}.json`); } catch (e) {}
    } catch (e) {}
    // 异步从云端删除
    if (entry._cloudId) {
      cloud.deleteLevel(entry._cloudId).catch(e => console.warn('云端删除失败:', e));
    }
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
      board: { cols: 5, rows: 5, hGap: 10, vGap: 10, diameter: 30 },
      pigs: [],
      ready: 0
    };
  }

  // ---- 云端操作 ----

  // 异步上传关卡到云端（乐观并发控制）
  async _uploadToCloud(entry) {
    try {
      const version = entry._version || 0;
      const res = await cloud.uploadLevel(entry.name, entry.data, version);

      if (res.code === 2) {
        // 版本冲突：其他设备已保存 → 自动刷新为云端最新版本
        console.log(`[Cloud] 关卡 ${entry.name} 版本冲突 (本地v${version}, 云端v${res.serverVersion})，自动刷新`);
        this.showToast('关卡已被其他设备更新，已刷新为最新版本');
        // 用服务器返回的最新数据覆盖本地
        if (res.data) {
          // 将服务器 version 写入数据再存储
          res.data.version = res.serverVersion;
          entry.data = res.data;
          entry.isDirty = false;
          this.dirty = false;
          const fs = wx.getFileSystemManager();
          const dir = `${wx.env.USER_DATA_PATH}/levels`;
          const fullPath = `${dir}/${entry.fileName}`;
          fs.writeFileSync(fullPath, JSON.stringify(res.data, null, 2), 'utf8');
          entry._version = res.serverVersion;
          entry._cloudId = res.id;
          this._saveCloudMeta(entry.name, res.id, res.serverVersion);
          // 如果当前正在编辑这个关卡，刷新编辑器内容
          if (this.currentLevelIdx >= 0 && this.levelList[this.currentLevelIdx] === entry) {
            this.loadLevelData(entry.data);
          }
        }
        return;
      }

      if (res.code === 0 && res.id) {
        entry._cloudId = res.id;
        entry._version = res.version || 1;
        this._saveCloudMeta(entry.name, res.id, res.version || 1);
        // 将服务器 version 写入关卡 JSON 文件，方便后续对比
        entry.data.version = res.version || 1;
        const fs = wx.getFileSystemManager();
        const dir = `${wx.env.USER_DATA_PATH}/levels`;
        const fullPath = `${dir}/${entry.fileName}`;
        fs.writeFileSync(fullPath, JSON.stringify(entry.data, null, 2), 'utf8');
        console.log(`[Cloud] 关卡 ${entry.name} 已同步云端 v${res.version}`);
      }
    } catch (e) {
      console.warn(`[Cloud] 上传 ${entry.name} 失败:`, e);
    }
  }

  // 保存 .meta 文件，记录 cloudId 映射和版本号
  _saveCloudMeta(name, cloudId, version) {
    const fs = wx.getFileSystemManager();
    const metaDir = `${wx.env.USER_DATA_PATH}/levels/.meta`;
    try { fs.accessSync(metaDir); } catch (e) { fs.mkdirSync(metaDir, true); }
    fs.writeFileSync(`${metaDir}/${name}.json`, JSON.stringify({ cloudId, version: version || 0 }), 'utf8');
  }

  // 异步从云端拉取关卡列表，合并到本地
  async _pullCloudLevels() {
    try {
      const cloudList = await cloud.listLevels();
      if (!cloudList || cloudList.length === 0) return;

      const nameSet = new Set(this.levelList.map(lv => lv.name));
      const fs = wx.getFileSystemManager();
      const dir = `${wx.env.USER_DATA_PATH}/levels`;
      try { fs.accessSync(dir); } catch (e) { fs.mkdirSync(dir, true); }

      for (const cl of cloudList) {
        if (!nameSet.has(cl.name)) {
          // 云端有但本地没有 → 下载完整数据写入本地
          try {
              const full = await cloud.downloadLevel(cl._id);
            if (full && full.data) {
              const cloudVersion = (full.version != null) ? full.version : (cl.version || 1);
              const fileName = cl.name + '.json';
              fs.writeFileSync(`${dir}/${fileName}`, JSON.stringify(full.data, null, 2), 'utf8');
              this._saveCloudMeta(cl.name, cl._id, cloudVersion);
              this.levelList.push({
                name: cl.name, fileName, data: full.data, isDirty: false,
                _cloudId: cl._id, _version: cloudVersion
              });
              nameSet.add(cl.name);
            }
          } catch (e) {
            console.warn(`[Cloud] 下载 ${cl.name} 失败:`, e);
          }
        } else {
          // 本地已有 → 同步 cloudId 和 version
          const local = this.levelList.find(lv => lv.name === cl.name);
          if (local) {
            const cloudVersion = cl.version || 1;
            if (!local._cloudId) {
              local._cloudId = cl._id;
              this._saveCloudMeta(cl.name, cl._id, cloudVersion);
            }
            // 云端版本比本地新 → 自动拉取最新数据
            if (cloudVersion > (local._version || 0) && !local.isDirty) {
              try {
                const full = await cloud.downloadLevel(cl._id);
                if (full && full.data) {
                  const dir = `${wx.env.USER_DATA_PATH}/levels`;
                  const fullPath = `${dir}/${local.fileName}`;
                  fs.writeFileSync(fullPath, JSON.stringify(full.data, null, 2), 'utf8');
                  local.data = full.data;
                  local._version = cloudVersion;
                  this._saveCloudMeta(cl.name, cl._id, cloudVersion);
                  // 如果当前正在编辑这个关卡，刷新编辑器
                  if (this.currentLevelIdx >= 0 && this.levelList[this.currentLevelIdx] === local) {
                    this.loadLevelData(local.data);
                  }
                  console.log(`[Cloud] 关卡 ${cl.name} 已自动更新到 v${cloudVersion}`);
                }
              } catch (e) {
                console.warn(`[Cloud] 自动更新 ${cl.name} 失败:`, e);
              }
            }
            // 同步版本号（即使数据没更新）
            if (!local._version || cloudVersion > local._version) {
              local._version = cloudVersion;
            }
          }
        }
      }

      // 刷新当前关卡选择
      this.levelList.sort((a, b) => a.name.localeCompare(b.name));
      if (this.currentLevelIdx < 0 && this.levelList.length > 0) {
        this.currentLevelIdx = 0;
        this.loadLevelData(this.levelList[0].data);
      }
    } catch (e) {
      console.warn('[Cloud] 拉取云端列表失败:', e);
      // 静默失败 — 继续使用本地数据
    }
  }

  markCurrentDirty() {
    this.dirty = true;
    if (this.currentLevelIdx >= 0 && this.currentLevelIdx < this.levelList.length) {
      this.levelList[this.currentLevelIdx].isDirty = true;
    }
  }

  // ---- 棋盘参数变更后，让猪重新吸附合法位置 ----
  _adaptPigsToBoard() {
    if (this.gp.pigs.length === 0) return;

    // 1. 快照所有猪
    const snapshot = this.gp.pigs.map(p => ({
      id: p.id, tailIndex: p.tailIndex, length: p.length, angle: p.angle
    }));

    // 2. 清空
    this.gp.pigs = [];
    this.gp.selectedPigId = null;
    this.gp.holeOccupied = new Array(this.gp.holes.length).fill(-1);

    // 3. 逐猪恢复
    const lostPigs = [];
    for (const snap of snapshot) {
      // tailIndex 不变（cols/rows 未变，索引有效）
      let bestAngle = this.gp.snapAngleToHoles(snap.tailIndex, snap.length, snap.angle);
      let bestLength = snap.length;

      // 吸附失败 → 尝试 length ±1…±5
      if (bestAngle === null) {
        for (let dl = 1; dl <= 5; dl++) {
          for (const sign of [-1, 1]) {
            const tryLen = snap.length + sign * dl;
            if (tryLen < 1) continue;
            const tryAngle = this.gp.snapAngleToHoles(snap.tailIndex, tryLen, snap.angle);
            if (tryAngle !== null) {
              bestAngle = tryAngle;
              bestLength = tryLen;
              break;
            }
          }
          if (bestAngle !== null) break;
        }
      }

      if (bestAngle !== null) {
        this.gp.pigs.push({ id: snap.id, tailIndex: snap.tailIndex, length: bestLength, angle: bestAngle });
        this.gp.updatePigOccupancy(snap.id, snap.tailIndex, bestLength, bestAngle);
      } else {
        lostPigs.push(snap.id);
      }
    }

    // 4. 兜底：尝试 tailIndex 附近孔位
    if (lostPigs.length > 0) {
      const offsets = [
        1, -1, this.gp.cols, -this.gp.cols,
        2, -2, this.gp.cols * 2, -this.gp.cols * 2,
        this.gp.cols + 1, this.gp.cols - 1,
        -this.gp.cols + 1, -this.gp.cols - 1
      ];
      for (const pid of lostPigs) {
        const snap = snapshot.find(s => s.id === pid);
        if (!snap) continue;
        let found = false;
        for (const offset of offsets) {
          const newTail = snap.tailIndex + offset;
          if (newTail < 0 || newTail >= this.gp.holes.length) continue;
          if (this.gp.holeOccupied[newTail] !== -1) continue;  // 不能落在已占用孔上
          for (let tryLen = snap.length; tryLen >= 1; tryLen--) {
            for (const sign of [0, -1, 1]) {
              const a = sign === 0 ? snap.angle : snap.angle + sign * 22.5;
              const sa = this.gp.snapAngleToHoles(newTail, tryLen, a);
              if (sa !== null) {
                this.gp.pigs.push({ id: snap.id, tailIndex: newTail, length: tryLen, angle: sa });
                this.gp.updatePigOccupancy(snap.id, newTail, tryLen, sa);
                found = true;
                break;
              }
            }
            if (found) break;
          }
          if (found) break;
        }
        if (!found) {
          this.showToast('猪#' + snap.id + ' 无法适配已被移除');
        }
      }
    }
  }

  deleteLevelByIndex(idx) {
    const entry = this.levelList[idx];
    if (!entry) return;
    try {
      const fs = wx.getFileSystemManager();
      fs.unlinkSync(`${wx.env.USER_DATA_PATH}/levels/${entry.fileName}`);
      try { fs.unlinkSync(`${wx.env.USER_DATA_PATH}/levels/.meta/${entry.name}.json`); } catch (e) {}
    } catch (e) {}
    if (entry._cloudId) {
      cloud.deleteLevel(entry._cloudId).catch(e => console.warn('云端删除失败:', e));
    }
    if (this.currentLevelIdx === idx) {
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
    } else {
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
        hintText = `小猪 #${pig.id} | 长度:${Math.round(pig.length)}px | 角度:${pig.angle}°`;
      }
    }
    if (!hintText) {
      hintText = '按住小猪头部调长度 | 按住身体/尾部调方向 | 点击空孔放置';
    }

    this.gp.renderBoard(ctx, { hintText, showSelection: true, showCollisionBox: true });
    if (this.showRedFrame) this._renderEffectiveArea();
    this.renderTopBar();
    this.renderWidthPanel();
    this.renderBottomStrip();
    this.renderToast();

    if (this.showPigSheet) this.renderPigSheet();
    if (this.showLevelSheet) this.renderLevelSheet();
    if (this.confirmDialog) this.renderConfirmDialog();
  }

  // ============================================================
  // === 渲染 — 顶部工具栏 ===
  // ============================================================
  renderTopBar() {
    const topBarH = this.gp.topBarH;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, SCREEN_WIDTH, topBarH);

    // 返回按钮（左上角）— 手指友好
    const backW = 44, backH = 36;
    const backX = 6, backY = (topBarH - backH) / 2;
    ctx.fillStyle = '#f0f0f0';
    roundRect(ctx,backX, backY, backW, backH, 6);
    ctx.fill();
    ctx.fillStyle = '#666';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('←', backX + backW / 2, backY + backH / 2);

    const titleX = backX + backW + 8;

    ctx.fillStyle = '#333';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('小猪推推乐 - 关卡编辑器', titleX, topBarH / 2);

    const rightBase = SCREEN_WIDTH - 10;

    // 试玩按钮 — 手指友好
    const btnW = 72, btnH = 36;
    const btnX = rightBase - btnW, btnY = (topBarH - btnH) / 2;
    ctx.fillStyle = '#2196F3';
    roundRect(ctx,btnX, btnY, btnW, btnH, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('试玩', btnX + btnW / 2, btnY + btnH / 2);

    this.topBtns = [
      { x: backX, y: backY, w: backW, h: backH, action: 'back' },
      { x: btnX, y: btnY, w: btnW, h: btnH, action: 'play' }
    ];
  }

  checkTopButtons(x, y) {
    for (const btn of this.topBtns) {
      if (x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
        if (btn.action === 'play') this._checkDirtyAndDo(() => this._goToPlaying());
        if (btn.action === 'back') this._checkDirtyAndDo(() => this._goToMenu());
        return true;
      }
    }
    return false;
  }

  // ============================================================
  // === 渲染 — 底部控制条 ===
  // 第一行：[列 -5+] [行 -5+] | [猪]
  // 第二行：[径 -5+] [横距 -5+] [纵距 -5+]
  // 第三行：[关卡▼] [新建] [保存] [复制]
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

    const row1H = 50;
    const row1Y = baseY + 4;
    const row2H = 50;
    const row2Y = baseY + row1H + 4;

    // ============================
    // 第一行：棋盘尺寸 + 小猪按钮
    // ============================
    const btnH = 40;
    const btnY1 = row1Y + (row1H - btnH) / 2;
    const midY1 = row1Y + row1H / 2;

    let x = 12;

    // 列控制 — 手指友好
    x = this._drawCompactStepper(x, btnY1, btnH, '列', this.gp.cols, 2, 20,
      (v) => {
        if (this.gp.pigs.length > 0) {
          this.showToast('有猪的情况下不能改变格子数量');
          return;
        }
        this.gp.cols = v; this.gp.recomputeBoard(); this.gp.recenterBoard(); this.markCurrentDirty();
      });
    x += 16;

    // 行控制
    x = this._drawCompactStepper(x, btnY1, btnH, '行', this.gp.rows, 2, 20,
      (v) => {
        if (this.gp.pigs.length > 0) {
          this.showToast('有猪的情况下不能改变格子数量');
          return;
        }
        this.gp.rows = v; this.gp.recomputeBoard(); this.gp.recenterBoard(); this.markCurrentDirty();
      });
    x += 16;

    // 分隔线
    ctx.strokeStyle = '#ddd';
    ctx.beginPath();
    ctx.moveTo(x, row1Y + 6);
    ctx.lineTo(x, row1Y + row1H - 6);
    ctx.stroke();
    x += 14;

    // 小猪按钮 — 手指友好
    const pigW = 56;
    const pigLabel = this.gp.selectedPigId != null ? '#' + this.gp.selectedPigId : '猪';
    ctx.fillStyle = '#FF9800';
    roundRect(ctx, x, btnY1, pigW, btnH, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px sans-serif';
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
    // 第二行：直径 / 孔间距 — 手指友好
    // ============================
    const btnY2 = row2Y + (row2H - btnH) / 2;
    const midY2 = row2Y + row2H / 2;

    // 顶边分隔线
    ctx.strokeStyle = '#ddd';
    ctx.beginPath();
    ctx.moveTo(0, row2Y - 1);
    ctx.lineTo(SCREEN_WIDTH, row2Y - 1);
    ctx.stroke();

    x = 12;

    // 直径 stepper（步长 5）
    x = this._drawCompactStepper(x, btnY2, btnH, '径', this.gp.diameter, 10, 100,
      (v) => {
        this.gp.diameter = v; this.gp.recomputeBoard(); this.gp.recenterBoard();
        this._adaptPigsToBoard();
        this.markCurrentDirty();
      }, 5);
    x += 8;

    // 横向孔间距 stepper（步长 5）
    x = this._drawCompactStepper(x, btnY2, btnH, '横距', this.gp.hGap, 0, 60,
      (v) => {
        this.gp.hGap = v; this.gp.recomputeBoard(); this.gp.recenterBoard();
        this._adaptPigsToBoard();
        this.markCurrentDirty();
      }, 5);
    x += 8;

    // 纵向孔间距 stepper（步长 5）
    x = this._drawCompactStepper(x, btnY2, btnH, '纵距', this.gp.vGap, 0, 60,
      (v) => {
        this.gp.vGap = v; this.gp.recomputeBoard(); this.gp.recenterBoard();
        this._adaptPigsToBoard();
        this.markCurrentDirty();
      }, 5);

    // ============================
    // 关卡管理
    // ============================
    const row3Y = baseY + 2 * row1H + 8;
    const btnY3 = row3Y + (row2H - btnH) / 2;
    const midY3 = row3Y + row2H / 2;

    // 顶边分隔线
    ctx.strokeStyle = '#ddd';
    ctx.beginPath();
    ctx.moveTo(0, row3Y - 1);
    ctx.lineTo(SCREEN_WIDTH, row3Y - 1);
    ctx.stroke();

    x = 12;

    // 关卡选择按钮 [0002 ▼] — 手指友好
    const hasLevels = this.levelList.length > 0;
    const curName = hasLevels && this.currentLevelIdx >= 0
      ? this.levelList[this.currentLevelIdx].name : '---';
    const isDirty = hasLevels && this.currentLevelIdx >= 0
      && this.levelList[this.currentLevelIdx].isDirty;

    const lvlBtnW = 80;
    ctx.fillStyle = '#f5f5f5';
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    roundRect(ctx, x, btnY3, lvlBtnW, btnH, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = isDirty ? '#E65100' : '#333';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lvlLabel = (isDirty ? '*' : '') + curName + ' ▼';
    ctx.fillText(lvlLabel, x + lvlBtnW / 2, midY3);
    this.levelBtns.push({ x, y: btnY3, w: lvlBtnW, h: btnH, action: 'showLevelSheet' });
    x += lvlBtnW + 8;

    // 操作按钮：新建 / 保存 / 复制 — 手指友好
    const opBtns = [
      { label: '新建', color: '#4CAF50', action: 'newLevel' },
      { label: '保存', color: '#2196F3', action: 'saveLevel' },
      { label: '复制', color: '#00BCD4', action: 'exportLevel' },
    ];

    const opW = 44;
    for (const b of opBtns) {
      ctx.fillStyle = b.color;
      roundRect(ctx, x, btnY3, opW, btnH, 6);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.label, x + opW / 2, midY3);
      this.levelBtns.push({ x, y: btnY3, w: opW, h: btnH, action: b.action });
      x += opW + 8;
    }

    // 本地同步按钮
    const syncW = 56;
    ctx.fillStyle = '#ff9800';
    roundRect(ctx, x, btnY3, syncW, btnH, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('本地同步', x + syncW / 2, midY3);
    this.levelBtns.push({ x, y: btnY3, w: syncW, h: btnH, action: 'localSync' });
    x += syncW + 8;

    // 发布按钮：toggle ready 0↔1
    const ready = (this.currentLevelIdx >= 0 && this.currentLevelIdx < this.levelList.length)
      ? (this.levelList[this.currentLevelIdx].data.ready || 0) : 0;
    const publishW = 56;
    const publishColor = ready === 1 ? '#E91E63' : '#9E9E9E';
    ctx.fillStyle = publishColor;
    roundRect(ctx, x, btnY3, publishW, btnH, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ready === 1 ? '待发布' : '设计中', x + publishW / 2, midY3);
    this.levelBtns.push({ x, y: btnY3, w: publishW, h: btnH, action: 'toggleReady' });
  }

  // ---- 紧凑步进器：label [-][+] — 手指友好 ----
  // 返回绘制后的 x 位置，供调用方精确控制间距
  _drawCompactStepper(x, btnY, btnH, label, value, min, max, onChange, step) {
    step = step || 1;
    const midY = btnY + btnH / 2;
    const btnW = 24;

    // 标签
    ctx.fillStyle = '#999';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, midY);
    x += 30;

    // 减号
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1.5;
    roundRect(ctx, x, btnY, btnW, btnH, 5);
    ctx.stroke();
    ctx.fillStyle = '#333';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('−', x + btnW / 2, midY);
    this.bottomBtns.push({ x, y: btnY, w: btnW, h: btnH, onClick: () => onChange(Math.max(min, value - step)) });
    x += btnW + 4;

    // 加号
    ctx.strokeStyle = '#ccc';
    roundRect(ctx, x, btnY, btnW, btnH, 5);
    ctx.stroke();
    ctx.fillStyle = '#333';
    ctx.fillText('+', x + btnW / 2, midY);
    this.bottomBtns.push({ x, y: btnY, w: btnW, h: btnH, onClick: () => onChange(Math.min(max, value + step)) });
    x += btnW;

    return x;
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
        this.showToast('已重载');
        break;
      }
      case 'exportLevel': this.exportLevel(); break;
      case 'localSync': this.localSync(); break;
      case 'toggleReady': this.toggleReady(); break;
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
    const sheetH = 200;
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
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('选中小猪', 20, sheetY + 24);

    const closeX = SCREEN_WIDTH - 50;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.font = '20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('✕', closeX + 16, sheetY + 22);

    const pig = this.gp.pigs.find(p => p.id === this.gp.selectedPigId);
    if (pig) {
      ctx.fillStyle = '#555';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const infoY = sheetY + 56;
      ctx.fillText(`编号: #${pig.id}`, 28, infoY);
      ctx.fillText(`长度: ${Math.round(pig.length)}px`, 180, infoY);
      ctx.fillText(`角度: ${Math.round(pig.angle)}°`, 28, infoY + 26);
      ctx.fillText(`尾部孔: #${pig.tailIndex}`, 180, infoY + 26);

      const delBtnX = SCREEN_WIDTH - 120;
      const delBtnY = sheetY + sheetH - 56;
      ctx.fillStyle = '#f44336';
      roundRect(ctx,delBtnX, delBtnY, 104, 40, 8);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 15px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('删除', delBtnX + 52, delBtnY + 20);

      this.sheetPigDeleteRect = { x: delBtnX, y: delBtnY, w: 104, h: 40 };
    } else {
      ctx.fillStyle = '#aaa';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('未选中小猪', 28, sheetY + 56);
    }

    this.sheetPigRect = { x: 0, y: sheetY, w: SCREEN_WIDTH, h: sheetH };
    this.sheetPigCloseRect = { x: closeX, y: sheetY + 16, w: 40, h: 40 };
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
    const barH = 48;  // 操作按钮栏高度
    const sheetH = Math.min(SCREEN_HEIGHT * 0.65, this.levelList.length * 48 + 70 + barH);
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
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('选择关卡', 20, sheetY + 24);

    // 关闭按钮 — 手指友好
    const closeX = SCREEN_WIDTH - 50;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.font = '20px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('✕', closeX + 16, sheetY + 22);

    // ---- 操作按钮栏：删除 / 清空 / 重载 ----
    const actionBarY = sheetY + 52;
    const actionBtns = [
      { label: '删除', color: '#f44336', action: 'deleteLevel' },
      { label: '清空', color: '#FF9800', action: 'clearLevel' },
      { label: '重载', color: '#9C27B0', action: 'resetLevel' },
    ];
    const abW = 80, abH = 36;
    const totalW = actionBtns.length * abW + (actionBtns.length - 1) * 10;
    let abX = (SCREEN_WIDTH - totalW) / 2;
    const abY = actionBarY + (barH - abH) / 2;
    this.levelSheetActionBtns = [];
    for (const b of actionBtns) {
      ctx.fillStyle = b.color;
      roundRect(ctx, abX, abY, abW, abH, 6);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.label, abX + abW / 2, abY + abH / 2);
      this.levelSheetActionBtns.push({ x: abX, y: abY, w: abW, h: abH, action: b.action });
      abX += abW + 10;
    }

    // 关卡列表 — 手指友好
    const listY = sheetY + 52 + barH;
    const itemH = 44;
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
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('▶', 24, itemY + itemH / 2);
      }

      // 关卡名称
      ctx.fillStyle = isActive ? '#1565C0' : '#333';
      ctx.font = (isActive ? 'bold ' : '') + '15px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const nameX = isActive ? 44 : 24;
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
    this.sheetLevelCloseRect = { x: closeX, y: sheetY + 16, w: 40, h: 40 };
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

    // 操作按钮栏：删除 / 清空 / 重载
    if (this.levelSheetActionBtns) {
      for (const btn of this.levelSheetActionBtns) {
        if (this.hitRect(x, y, btn)) {
          this.showLevelSheet = false;
          this._handleLevelAction(btn.action);
          return true;
        }
      }
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

  // ============================================================
  // === 渲染 — 确认对话框 ===
  // ============================================================
  renderConfirmDialog() {
    const d = this.confirmDialog;
    if (!d) return;

    // 半透明遮罩
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    // 对话框
    const dw = 280, dh = 160;
    const dx = (SCREEN_WIDTH - dw) / 2;
    const dy = (SCREEN_HEIGHT - dh) / 2;

    ctx.fillStyle = '#fff';
    roundRect(ctx, dx, dy, dw, dh, 12);
    ctx.fill();

    // 标题
    ctx.fillStyle = '#333';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(d.title, dx + dw / 2, dy + 38);

    // 消息
    ctx.fillStyle = '#666';
    ctx.font = '14px sans-serif';
    ctx.fillText(d.message, dx + dw / 2, dy + 72);

    // 按钮
    const btnW = 110, btnH = 36;
    const btnY = dy + dh - 54;
    const gap = 16;
    const totalBtnW = btnW * 2 + gap;
    const btnBaseX = dx + (dw - totalBtnW) / 2;

    // "保存并跳转" — 绿色
    ctx.fillStyle = '#4CAF50';
    roundRect(ctx, btnBaseX, btnY, btnW, btnH, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('保存并跳转', btnBaseX + btnW / 2, btnY + btnH / 2);

    // "直接跳转" — 灰色
    const skipX = btnBaseX + btnW + gap;
    ctx.fillStyle = '#999';
    roundRect(ctx, skipX, btnY, btnW, btnH, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText('直接跳转', skipX + btnW / 2, btnY + btnH / 2);

    this._confirmSaveRect = { x: btnBaseX, y: btnY, w: btnW, h: btnH };
    this._confirmSkipRect = { x: skipX, y: btnY, w: btnW, h: btnH };
  }

  checkConfirmDialog(x, y) {
    if (this.hitRect(x, y, this._confirmSaveRect)) {
      this.confirmDialog.onSave();
      this.confirmDialog = null;
      return true;
    }
    if (this.hitRect(x, y, this._confirmSkipRect)) {
      this.confirmDialog.onSkip();
      this.confirmDialog = null;
      return true;
    }
    return true;  // 点击其他区域保持对话框
  }

  // ============================================================
  // === 屏幕宽度面板（左上角浮动） ===
  // ============================================================
  renderWidthPanel() {
    const storedW = databus.storedScreenWidth;
    const panelX = 8, panelY = this.gp.topBarH + 6;
    const panelW = 202, panelH = 44;
    const btnW = 30, btnH = 28;

    // 半透明背景
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    roundRect(ctx, panelX, panelY, panelW, panelH, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    roundRect(ctx, panelX, panelY, panelW, panelH, 8);
    ctx.stroke();

    this.widthPanelBtns = [];

    const midY = panelY + panelH / 2;

    // 标签
    ctx.fillStyle = '#666';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('屏幕宽度', panelX + 10, midY);

    // 数值
    ctx.fillStyle = '#333';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(storedW.toString(), panelX + 78, midY);

    // [-] 按钮
    const minusX = panelX + 100;
    const btnY = panelY + (panelH - btnH) / 2;
    ctx.fillStyle = '#f0f0f0';
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    roundRect(ctx, minusX, btnY, btnW, btnH, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#333';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('−', minusX + btnW / 2, btnY + btnH / 2);
    this.widthPanelBtns.push({ x: minusX, y: btnY, w: btnW, h: btnH,
      onClick: () => { databus.storedScreenWidth = Math.max(250, storedW - 25); }});

    // [+] 按钮
    const plusX = minusX + btnW + 4;
    ctx.fillStyle = '#f0f0f0';
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    roundRect(ctx, plusX, btnY, btnW, btnH, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#333';
    ctx.fillText('+', plusX + btnW / 2, btnY + btnH / 2);
    this.widthPanelBtns.push({ x: plusX, y: btnY, w: btnW, h: btnH,
      onClick: () => { databus.storedScreenWidth = Math.min(600, storedW + 25); }});

    // [显/隐] 按钮
    const visX = plusX + btnW + 4;
    const visW = 26;
    ctx.fillStyle = this.showRedFrame ? '#FFE0E0' : '#f0f0f0';
    ctx.strokeStyle = this.showRedFrame ? '#FF6B6B' : '#ccc';
    ctx.lineWidth = 1;
    roundRect(ctx, visX, btnY, visW, btnH, 5);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = this.showRedFrame ? '#CC3333' : '#333';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.showRedFrame ? '隐' : '显', visX + visW / 2, btnY + btnH / 2);
    this.widthPanelBtns.push({ x: visX, y: btnY, w: visW, h: btnH,
      onClick: () => { this.showRedFrame = !this.showRedFrame; }});
  }

  checkWidthPanelBtns(x, y) {
    if (!this.widthPanelBtns) return false;
    for (const btn of this.widthPanelBtns) {
      if (x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
        btn.onClick();
        return true;
      }
    }
    return false;
  }

  // ============================================================
  // === 棋盘有效区域红框 ===
  // ============================================================
  _renderEffectiveArea() {
    const g = this.gp;
    // 红框展示 storedScreenWidth 下的棋盘区域（独立计算，不依赖 gp 现有缩放值）
    const testScale = Math.max(0.75, Math.min(1.5, databus.storedScreenWidth / 375));
    const testD = g.diameter * testScale;
    const testHGap = g.hGap * testScale;
    const testVGap = g.vGap * testScale;
    const testHSpacing = testD + testHGap;
    const testVSpacing = testD + testVGap;
    const testVisualW = g.cols * testHSpacing;
    const testVisualH = g.rows * testVSpacing;
    const testBoardW = (g.cols - 1) * testHSpacing + testD;
    const testBoardH = (g.rows - 1) * testVSpacing + testD;

    const testOffsetX = Math.max(0, (SCREEN_WIDTH - testVisualW) / 2);
    const testOffsetY = Math.max(0, (SCREEN_HEIGHT - g.topBarH - g.bottomStripH - testVisualH) / 2);
    const x = testOffsetX + (testVisualW - testBoardW) / 2;
    const y = g.topBarH + testOffsetY + (testVisualH - testBoardH) / 2;

    // 红色虚线边框（只画线，不填充）
    ctx.strokeStyle = 'rgba(255, 0, 0, 0.45)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x, y, testBoardW, testBoardH);
    ctx.setLineDash([]);
  }

}

module.exports = EditorEngine;
