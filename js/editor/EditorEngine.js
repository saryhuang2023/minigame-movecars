// 关卡编辑器引擎（v26 — 组合 GameplayEngine，编辑/试玩一键切换）
// 纯 Canvas 2D 渲染，无 DOM 依赖
// require/module.exports，wx API，InputManager 事件路由

const { entityProps, entityKey, entityLabel } = require('../entity/EntityTypes.js');

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
const audio = require('../audio/AudioManager.js');
const ButtonPress = require('../anim/ButtonPress.js');
const SceneDefaults = require('../game/SceneDefaults.js');
const Theme = require('../ui/Theme.js');


const DRAG_THRESHOLD = 20; // 最小移动距离（px），低于此值视为点击

class EditorEngine {
  constructor(inputManager) {
    this.input = inputManager;
    this.gp = new GameplayEngine();

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
    this._showInfo = false;              // "信息"按钮：展示提示数据+碰撞框
    this._btnPress = new ButtonPress(); // 按钮按压微交互

    // ===== 预设猪长度 =====
    this._selectedEntityType = 'pig';       // 当前选中精灵类型
    this._presetLength = null;        // null=灵活, 70/125/205/280/380=固定长度
    // 前7个猪模板可自定义，后2个（灵活/石头）不参与
    this._presetLabels = ['70', '125', '205', '275', '342', '397', '468', '灵活', '石头'];
    this._presetValues = [70, 125, 205, 275, 342, 397, 468, null, 44];
    this._presetTypes  = ['pig', 'pig', 'pig', 'pig', 'pig', 'pig', 'pig', 'pig', 'rock'];

    // ===== Toast =====
    this.toastText = '';
    this.toastAlpha = 0;
    this.toastFade = null;

    // ===== 云端同步加载状态 =====
    this._cloudLoading = false;

    // ===== 点击 vs 拖拽区分 =====
    this._pendingTouch = null;  // { x, y, pigInfo } — 未超过阈值前暂存

    // ===== 关卡选择面板滚动 =====
    this._levelSheetScrollY = 0;
    this._levelSheetTouchStartY = 0;
    this._levelSheetTouchStartScrollY = 0;
    this._levelSheetIsScrolling = false;

    // ===== 金猪阈值 =====
    this._crownSteps = 0;

    // ===== 碰撞框全局开关 =====
    this._showAllCollisionBoxes = false;

    // ===== 场景背景图 =====
    this._sceneBgImg = wx.createImage();
    this._sceneBgLoaded = false;
    var self = this;
    this._sceneBgImg.onload = function () {
      self._sceneBgLoaded = true;
    };
    this._sceneBgImg.src = SceneDefaults.background;
  }

  // ============================================================
  // 激活 / 反激活
  // ============================================================
  activate() {
    // 从试玩返回时不重置状态，仅恢复输入监听
    if (databus.returnState === 'editor') {
      this._cloudLoading = false;
      this.input.on('editor', (e) => this.handleEvent(e));
      // 试玩返回：从关卡数据同步 hintId/hintAngle 到编辑器猪
      if (databus.currentLevel && databus.currentLevel.data && databus.currentLevel.data.pigs) {
        var dataPigs = databus.currentLevel.data.pigs;
        var hintChanged = false;
        for (var i = 0; i < dataPigs.length; i++) {
          var dp = dataPigs[i];
          var ep = this.gp.pigs.find(function(p) { return p.id === dp.id; });
          if (ep) {
            var newHid = (dp.hintId != null) ? dp.hintId : null;
            var newHA = (dp.hintAngle != null) ? dp.hintAngle : null;
            if (ep.hintId !== newHid || ep.hintAngle !== newHA) hintChanged = true;
            ep.hintId = newHid;
            ep.hintAngle = newHA;
          }
        }
        if (hintChanged) {
          this.dirty = true;
          if (this.currentLevelIdx >= 0 && this.currentLevelIdx < this.levelList.length) {
            this.levelList[this.currentLevelIdx].isDirty = true;
          }
        }
      }
      return;
    }

    this.gp.bottomStripH = 92;
    this.gp.recomputeBoard();
    this.gp.recenterBoard();
    this.dirty = false;
    this.input.on('editor', (e) => this.handleEvent(e));

    // 从主界面进入：首次全量拉取云端覆盖本地，后续直接读本地缓存
    if (this._cloudSynced === true) {
      this.loadLevelList();
      return;
    }
    this._cloudLoading = true;
    var self = this;
    var cloudPromise = this._pullCloudLevels()
      .then(function() { self._cloudSynced = true; });  // 首次拉取成功后标记，后续不再拉
    var timeoutPromise = new Promise(function(_, reject) {
      setTimeout(function() { reject(new Error('cloud_timeout')); }, 20000);
    });
    Promise.race([cloudPromise, timeoutPromise])
      .then(function() { self.loadLevelList(); })
      .catch(function(err) {
        console.log('[Editor] 云端拉取超时/失败:', err && err.message);
        self.loadLevelList();
      })
      .finally(function() { self._cloudLoading = false; });
  }

  deactivate() {
    this.input.off('editor');
    this.confirmDialog = null;
    this._cloudLoading = false;
    this._pendingTouch = null;
  }

  // ============================================================
  // 事件处理
  // ============================================================
  handleEvent(e) {
    // 云端同步中，屏蔽所有操作
    if (this._cloudLoading) return;

    const t0 = e.touches[0] || e.changedTouches[0];
    if (!t0) return;
    const x = t0.x, y = t0.y;

    if (e.type === 'touchstart') {
      // 确认对话框优先
      if (this.confirmDialog) {
        this.checkConfirmDialog(x, y);
        return;
      }
      // 关卡选择面板优先（含滚动处理）
      if (this.showLevelSheet) {
        this._levelSheetTouchStart(x, y);
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
      // 顶部工具栏（含预设按钮行）
      var topBarGate = (databus.safeTop || 28) + 116;
      if (y < topBarGate) {
        this.checkTopButtons(x, y);
        return;
      }
      this.onBoardTouchStart(x, y);
    } else if (e.type === 'touchmove') {
      // 关卡选择面板滚动
      if (this.showLevelSheet) {
        this._levelSheetTouchMove(x, y);
        return;
      }
      // 有暂存触摸 → 检查是否超过拖拽阈值
      if (this._pendingTouch) {
        const dx = x - this._pendingTouch.x;
        const dy = y - this._pendingTouch.y;
        if (dx * dx + dy * dy >= DRAG_THRESHOLD * DRAG_THRESHOLD) {
          this._activatePigDrag(this._pendingTouch.pig, this._pendingTouch.pigInfo);
          this._pendingTouch = null;
        }
      }
      if (this.gp.dragState) this.onDragMove(x, y);
    } else if (e.type === 'touchend') {
      // 关卡选择面板
      if (this.showLevelSheet) {
        this._levelSheetTouchEnd(x, y);
        return;
      }
      if (this.showPigSheet) return;
      // 暂存触摸 + 无拖拽 → 纯点击
      if (this._pendingTouch) {
        this.onPigTap(this._pendingTouch.pig);
        this._pendingTouch = null;
        return;
      }
      if (this.gp.dragState) this.onDragEnd(x, y);
    }
  }

  onBoardTouchStart(x, y) {
    if (y < this.gp.topBarH || y > SCREEN_HEIGHT - this.gp.bottomStripH) return;
    this.handleEditTouchStart(x, y);
  }

  // ============================================================
  // === 提示模式触摸处理 ===
  // ============================================================
  // ============================================================
  // 编辑模式 — 触摸处理
  // ============================================================
  handleEditTouchStart(screenX, screenY) {
    // 棋盘触摸坐标转换（auto-scale 适配）
    var boardPos = this.gp.screenToBoard(screenX, screenY);
    var x = boardPos.x;
    var y = boardPos.y;

    const pigInfo = this.gp.getPigAtPoint(x, y);
    if (pigInfo) {
      const pig = this.gp.pigs.find(p => p.id === pigInfo.id);
      if (!pig) return;
      this.gp.selectedPigId = pigInfo.id;

      // 暂存触摸信息，等 move 超阈值后再激活拖拽；未超阈值则为点击
      this._pendingTouch = { x: screenX, y: screenY, pig, pigInfo };
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

  // 移动超过阈值 → 激活拖拽（原 handleEditTouchStart 中拖拽初始化逻辑）
  _activatePigDrag(pig, pigInfo) {
    // 非可拖拽类型（如 rock）不进入拖拽
    var props = entityProps(pig);
    if (!props.draggable) return;

    const isHead = pigInfo.offset >= pigInfo.totalLen - this.gp.scaledHeadZone;
    // 仅"灵活"模式下头部拖拽才可调整长度；固定长度 preset 下头部拖拽 = 纯旋转
    const canAdjustHead = isHead && this._presetLength === null;
    this.gp.dragState = null;

    if (canAdjustHead) {
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
        lastCollideTime: 0,
        isValidNow: true
      };
    } else {
      // 身体/尾部旋转：rotate 路径，猪保持在原位
      this.gp.dragState = {
        type: 'rotate',
        tailIndex: pig.tailIndex,
        pigId: pigInfo.id,
        displayAngle: pig.angle,
        targetAngle: pig.angle,
        lastValid: { tailIndex: pig.tailIndex, length: pig.length, angle: pig.angle },
        headHoleIdx: -1,
        lastCollidedId: null,
        lastCollideTime: 0,
        isValidNow: true
      };
    }
  }

  // 纯点击（未超过拖拽阈值）—— 检测前方猪并触发受击动画
  onPigTap(pig) {
    const result = this.gp.canPushPig(pig.id);
    if (result.collidedPigId !== undefined) {
      this.gp.triggerCollisionEffect(result.collidedPigId);
    }
  }

  // ============================================================
  // 拖拽移动
  // ============================================================
  onDragMove(x, y) {
    const now = Date.now();
    if (now - this.gp.lastDragTime < 33) return;
    this.gp.lastDragTime = now;

    if (this.gp.dragState && this.gp.dragState.type === 'rotate') {
      // handleRotateDrag 是 GP 方法，需传入棋盘坐标
      var boardPos = this.gp.screenToBoard(x, y);
      this.gp.handleRotateDrag(boardPos.x, boardPos.y);
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
    // rock 精灵固定长度 = 孔直径（REFERENCE_DIAMETER），不受拖拽距离/预设影响
    var len;
    if (this._selectedEntityType === 'rock') {
      len = 50;
    } else if (this._presetLength != null) {
      len = this._presetLength;
    } else {
      len = Math.max(this.gp.scaledDiameter, Math.min(this.gp.scaledDiameter * 30, Math.round(scaledDist)));
    }

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
    // rock 精灵固定长度 = 孔直径（REFERENCE_DIAMETER），不受拖拽距离/预设影响
    var len;
    if (this._selectedEntityType === 'rock') {
      len = 50;
    } else if (this._presetLength != null) {
      len = this._presetLength;
    } else {
      len = Math.max(this.gp.scaledDiameter, Math.min(this.gp.scaledDiameter * 30, Math.round(scaledDist)));
    }

    const pig = this.gp.dragState.pigId != null ? this.gp.pigs.find(p => p.id === this.gp.dragState.pigId) : null;

    const excludeId = this.gp.dragState.pendingId != null ? this.gp.dragState.pendingId
      : (pig ? pig.id : -1);
    // 放置拖拽中不强制头部落孔（与 adjustHead 行为对齐）
    const check = this.gp.checkAngleValid(tailIdx, len, excludeId, angle, false);
    if (!check.valid) return { cfg: null, collidedId: check.collidedId };
    return { cfg: { tailIndex: tailIdx, length: len, angle, inBounds: true } };
  }

  // 松手时将猪头部对准最近的孔 —— 三点共线对齐（委托给 GameplayEngine 共享方法）
  _snapWithLengthFallback(tailIndex, length, hintAngle, excludeId) {
    return this.gp.snapAlignPig(tailIndex, length, hintAngle, excludeId);
  }

  applyDragConfig(cfg) {
    if (this.gp.dragState.type === 'place') {
      if (this.gp.dragState.pendingId !== null) {
        this.gp.pigs = this.gp.pigs.filter(p => p.id !== this.gp.dragState.pendingId);
      }
      const tempId = -999;
      this.gp.pigs.push({ id: tempId, tailIndex: cfg.tailIndex, length: cfg.length, angle: cfg.angle,
        type: this._selectedEntityType || 'pig' });
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
        this.gp.rebuildOccupancy();
        const snapped = this._snapWithLengthFallback(
          this.gp.dragState.tailIndex, pig.length, lv.angle, pig.id
        );
        if (snapped) {
          pig.length = snapped.length;
          pig.angle = snapped.angle;
          this.gp.updatePigOccupancy(pig.id, snapped.tailIndex, snapped.length, snapped.angle);
          this.markCurrentDirty();
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
      this.gp.rebuildOccupancy();
      if (lv) {
        const snapped = this._snapWithLengthFallback(
          lv.tailIndex, lv.length, lv.angle, this.gp.dragState.pigId
        );
        if (snapped) {
          const realId = this.gp.dragState.pigId;
          const orig = this.gp.dragState.originalPig;
          this.gp.pigs.push({ id: realId, tailIndex: snapped.tailIndex, length: snapped.length, angle: snapped.angle,
            hintId: (orig && orig.hintId != null) ? orig.hintId : null,
            hintAngle: (orig && orig.hintAngle != null) ? orig.hintAngle : snapped.angle });
          this.gp.selectedPigId = realId;
          for (let i = 0; i < this.gp.holeOccupied.length; i++) {
            if (this.gp.holeOccupied[i] === -999) this.gp.holeOccupied[i] = realId;
          }
          this.gp.updatePigOccupancy(realId, snapped.tailIndex, snapped.length, snapped.angle);
          this.markCurrentDirty();
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
      this.gp.rebuildOccupancy();
      if (lv) {
        // rock 精灵：固定角度=0、长度=50，跳过 snap
        var finalLen, finalAngle, finalTail;
        if (this._selectedEntityType === 'rock') {
          finalLen = 50;
          finalAngle = 0;
          finalTail = lv.tailIndex;
        } else {
          const snapped = this._snapWithLengthFallback(
            lv.tailIndex, lv.length, lv.angle, undefined
          );
          if (snapped) {
            finalLen = snapped.length;
            finalAngle = snapped.angle;
            finalTail = snapped.tailIndex;
          } else {
            finalLen = null;
          }
        }
        if (finalLen != null) {
          let realId;
          if (this.gp.dragState.pigId != null) {
            realId = this.gp.dragState.pigId;
            // 保留原猪的 hintId/hintAngle
            var origPig = this.gp.dragState.originalPig;
            this.gp.pigs.push({ id: realId, tailIndex: finalTail, length: finalLen, angle: finalAngle,
              hintId: (origPig && origPig.hintId != null) ? origPig.hintId : null,
              hintAngle: (origPig && origPig.hintAngle != null) ? origPig.hintAngle : finalAngle });
            this.gp.selectedPigId = realId;
          } else {
            realId = this.gp.nextPigId++;
            this.gp.pigs.push({ id: realId, tailIndex: finalTail, length: finalLen, angle: finalAngle,
              type: this._selectedEntityType || 'pig' });
            this.gp.selectedPigId = realId;
          }
          for (let i = 0; i < this.gp.holeOccupied.length; i++) {
            if (this.gp.holeOccupied[i] === -999) this.gp.holeOccupied[i] = realId;
          }
          this.gp.updatePigOccupancy(realId, finalTail, finalLen, finalAngle);
          this._clearAllHints();
          this.markCurrentDirty();
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

  // ============================================================
  // 跳转控制
  // ============================================================
  _goToPlaying() {
    var lv = this.getLevelData();
    var trialName = (this.currentLevelIdx >= 0 && this.currentLevelIdx < this.levelList.length)
      ? this.levelList[this.currentLevelIdx].name : '试玩';
    databus.currentLevel = { name: trialName, data: lv };
    databus.currentLevelIndex = -1;  // 试玩不属于正式关卡序列，禁用"下一关"
    databus.returnState = 'editor';
    databus.gameState = 'playing';
  }

  _goToMenu() {
    databus.gameState = 'menu';
  }

  /** "设为模板"：将选中猪的长度写入当前预设按钮 */
  _doSetTemplate() {
    if (this.gp.selectedPigId == null) return;
    // 仅前7个猪模板参与（_presetLength 必须是前7个值之一）
    var idx = this._presetValues.indexOf(this._presetLength);
    if (idx < 0 || idx >= 7) return;

    var pig = this.gp.pigs.find(function(p) { return p.id === this.gp.selectedPigId; }.bind(this));
    if (!pig) return;

    var newLen = Math.round(pig.length);
    this._presetValues[idx] = newLen;
    this._presetLabels[idx] = String(newLen);
    this._presetLength = newLen;  // 保持选中状态一致
    this.markCurrentDirty();
    this.showToast('模板已更新: ' + newLen);
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
    // 以原始数据为基，编辑器状态全覆盖 —— 避免丢掉原始数据中 editor 不感知的字段
    const base = curData ? Object.assign({}, curData) : {};
    base.board = { rows: this.gp.rows, oddCols: this.gp.oddCols, boardWidth: this.gp.boardWidth, boardRate: this.gp.boardRate };
    base.pigs = this.gp.pigs.map(p => {
      const obj = { id: p.id, tail: p.tailIndex, length: p.length, angle: p.angle };
      if (p.type && p.type !== 'pig') obj.type = p.type;
      if (p.skinId) obj.skinId = p.skinId;
      if (p.hintId != null) {
        obj.hintId = p.hintId;
        obj.hintAngle = (p.hintAngle != null) ? p.hintAngle : p.angle;
      }
      return obj;
    });
    base.crownSteps = this._crownSteps || 0;
    base.ready = (curData && curData.ready != null) ? curData.ready : 0;
    return base;
  }

  loadLevelData(data) {
    if (data.board) {
      this.gp.rows = data.board.rows || data.board.cols || 5;
      this.gp.oddCols = data.board.oddCols || data.board.oddRows || 3;
      this.gp.boardWidth = data.board.boardWidth || 375;
      this.gp.boardRate = data.board.boardRate || 2.74;
    }
    this._crownSteps = (data && data.crownSteps) || 0;
    this.gp.pigs = (data.pigs || []).map(p => ({
      id: p.id, tailIndex: p.tail, length: p.length, angle: p.angle,
      type: p.type || 'pig', skinId: p.skinId || 0,
      hintId: p.hintId != null ? p.hintId : null,
      hintAngle: p.hintAngle != null ? p.hintAngle : null
    }));
    this.gp.nextPigId = this.gp.pigs.length > 0 ? Math.max(...this.gp.pigs.map(p => p.id)) + 1 : 0;
    this.gp.selectedPigId = null;
    this.gp.dragState = null;
    this.gp.flashingPigs = {};
    this.gp.animations = [];
    this.gp.ghostAnimations = [];
    this.gp.recomputeBoard();
    var corrected = this.gp.snapAllPigsAngles();
    // 与 render() 中的布局对齐（无白色卡片，直接渲染棋盘在背景上）
    var safeTop = databus.safeTop || 0;
    this.gp.topBarH = safeTop + 116 + 4;  // 48+68 两行顶栏
    this.gp.bottomStripH = 92;
    this.gp.recenterBoard();
    this.dirty = corrected > 0;  // 角度有修正则标记脏，交给用户决定是否保存
    // 切换关卡时重置预设模板为默认值
    this._presetLabels = ['70', '125', '205', '275', '342', '397', '468', '灵活', '石头'];
    this._presetValues = [70, 125, 205, 275, 342, 397, 468, null, 44];
    this._presetTypes  = ['pig', 'pig', 'pig', 'pig', 'pig', 'pig', 'pig', 'pig', 'rock'];
  }

  // ============================================================
  // 关卡管理
  // ============================================================
  loadLevelList() {
    const fs = wx.getFileSystemManager();
    const dir = `${wx.env.USER_DATA_PATH}/levels`;
    try { fs.accessSync(dir); } catch (e) { try { fs.mkdirSync(dir, true); } catch (e2) {} }

    // 收集已缓存关卡名（用于后续三级合并去重）
    var cachedNames = new Set();

    try {
      const files = fs.readdirSync(dir);
      this.levelList = files.filter(f => f.endsWith('.json')).map(f => {
        try {
          const raw = fs.readFileSync(`${dir}/${f}`, 'utf8');
          const data = JSON.parse(raw);
          const name = f.replace('.json', '');
          cachedNames.add(name);
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
    } catch (e) {
      this.levelList = [];
    }

    // === 三级合并：从 assets/levels/ 补充缓存中没有的关卡（云端 > 缓存 > 本地 assets）===
    try {
      const assetsIndexPath = 'assets/levels/index.json';
      const indexRaw = fs.readFileSync(assetsIndexPath, 'utf8');
      const index = JSON.parse(indexRaw);

      // 支持两种 index.json 格式：
      //   range:  { "minLevel": 1, "maxLevel": 8 } → 生成 0001~0008
      //   array:  [{ "file": "0001.json" }, ...]
      var assetEntries = [];
      if (typeof index.maxLevel === 'number') {
        // range 格式
        for (var lv = index.minLevel || 1; lv <= index.maxLevel; lv++) {
          var fn = String(lv).padStart(4, '0') + '.json';
          assetEntries.push({ file: fn, name: fn.replace('.json', '') });
        }
      } else if (Array.isArray(index)) {
        // array 格式
        for (var i = 0; i < index.length; i++) {
          var entry = index[i];
          assetEntries.push({ file: entry.file, name: entry.file.replace('.json', '') });
        }
      }

      for (var i = 0; i < assetEntries.length; i++) {
        var entry = assetEntries[i];
        var name = entry.name;
        if (cachedNames.has(name)) continue;  // 云端/缓存优先
        try {
          var raw = fs.readFileSync('assets/levels/' + entry.file, 'utf8');
          var data = JSON.parse(raw);
          // 本地 assets 关卡无 cloudId/version/published
          // ready: 0 表示「设计中」
          if (data.ready === undefined) data.ready = 0;
          this.levelList.push({ name: name, fileName: entry.file, data: data, isDirty: false, _cloudId: null, _version: 0 });
        } catch (e2) { /* 跳过损坏的 assets 文件 */ }
      }
      console.log('[Editor] 三级合并完成: 缓存 ' + cachedNames.size + ' 个, 本地 assets 补充 ' + (this.levelList.length - cachedNames.size) + ' 个');
    } catch (e3) {
      console.log('[Editor] assets/levels/index.json 读取失败，跳过本地合并:', e3 && e3.message);
    }

    // 按关卡名称排序（自然排序，0001 < 0002 < ...）
    this.levelList.sort(function(a, b) {
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });

    if (this.levelList.length > 0) {
      // 从试玩返回时保持原关卡不动，只在首次进入时自动选最后一关
      if (this.currentLevelIdx == null || this.currentLevelIdx < 0 || this.currentLevelIdx >= this.levelList.length) {
        this.currentLevelIdx = this.levelList.length - 1;
      }
      this.loadLevelData(this.levelList[this.currentLevelIdx].data);
    } else {
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
    // 已发布关卡禁止修改
    if (entry.data && entry.data.ready === 1) {
      this.showToast('关卡已发布，禁止修改');
      return;
    }
    entry.data = this.getLevelData();
    // 发送当前版本号，云端负责 +1 并返回新版本（乐观并发控制要求 clientVersion === serverVersion）
    entry.data.version = entry.data.version || 0;
    entry._version = entry.data.version;
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

    // 发布前先保存当前编辑内容到 entry.data
    entry.data = this.getLevelData();
    entry.data.ready = newReady;

    if (newReady === 1) {
      // 切换为「已发布」：立即上传到云端，不再标记 dirty（已发布状态通过云端传递）
      entry.isDirty = false;
      this.dirty = false;
      this.showToast('已发布，正在上传...');
      this._uploadToCloud(entry);
    } else {
      // 切换为「设计中」：仅标记本地修改
      entry.isDirty = true;
      this.dirty = true;
      this.showToast('已设为设计中');
    }
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
    // 复制关卡强制重置为「设计中」状态
    copiedData.ready = 0;
    copiedData.version = 0;
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
    // 已发布关卡禁止删除
    if (entry.data && entry.data.ready === 1) {
      this.showToast('关卡已发布，禁止删除');
      return;
    }
    // 弹出确认对话框
    const self = this;
    this.confirmDialog = {
      title: '删除关卡',
      message: `确定删除"${entry.name}"吗？此操作不可恢复`,
      buttonLabels: ['删除', '取消'],
      buttonColors: ['#f44336', '#999'],
      onSave: function() { self._doDeleteLevel(idx, entry); },
      onSkip: function() {}
    };
  }

  _doDeleteLevel(idx, entry) {
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
      board: { rows: 5, oddCols: 3, boardWidth: 375, boardRate: 2.74 },
      pigs: [],
      crownSteps: 0,
      ready: 0,
      version: 0
    };
  }

  // ---- 云端操作 ----

  // 异步上传关卡到云端（乐观并发控制）
  async _uploadToCloud(entry) {
    try {
      // 每次上传前深拷贝一份纯净数据，避免后续对 entry.data 的修改（如 version 回写）
      // 污染正在传输中的对象
      const uploadData = JSON.parse(JSON.stringify(entry.data));
      const version = entry._version || 0;
      const published = (entry.data && entry.data.ready === 1);
      const res = await cloud.uploadLevel(entry.name, uploadData, version, published);

      if (res.code === 2) {
        // 版本冲突：其他设备已保存更新版本 → 用云端最新数据覆盖本地
        console.log(`[Cloud] 关卡 ${entry.name} 版本冲突 (本地v${version}, 云端v${res.serverVersion})，拉取云端覆盖本地`);
        this.showToast('关卡已被其他设备更新，已刷新为最新版本');
        if (res.data) {
          res.data.version = res.serverVersion;
          entry.data = res.data;
          entry.isDirty = false;
          this.dirty = false;
          const fs = wx.getFileSystemManager();
          const dir = `${wx.env.USER_DATA_PATH}/levels`;
          const fullPath = `${dir}/${entry.fileName}`;
          fs.writeFileSync(fullPath, JSON.stringify(res.data, null, 2), 'utf8');
          entry._version = res.serverVersion;
          entry._cloudId = res.id || entry._cloudId;
          this._saveCloudMeta(entry.name, res.id || entry._cloudId, res.serverVersion);
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

  // 从云端下载关卡（增量同步：仅下载有变化的关卡）
  // 客户端传入本地版本号映射，云函数只返回 version 大于本地的关卡
  async _pullCloudLevels() {
    try {
      // ① 收集本地版本号映射（.meta 目录下的 {name}.json → version）
      var fs = wx.getFileSystemManager();
      var metaDir = `${wx.env.USER_DATA_PATH}/levels/.meta`;
      var versions = {};
      try {
        var metaFiles = fs.readdirSync(metaDir);
        for (var i = 0; i < metaFiles.length; i++) {
          var fn = metaFiles[i];
          if (!fn.endsWith('.json')) continue;
          try {
            var meta = JSON.parse(fs.readFileSync(`${metaDir}/${fn}`, 'utf8'));
            var nm = fn.replace('.json', '');
            versions[nm] = meta.version || 0;
          } catch (e) { /* ignore corrupted meta */ }
        }
      } catch (e) { /* .meta dir may not exist yet */ }

      // ② 调用批量下载云函数（增量模式：传入 versions）
      var res = await wx.cloud.callFunction({
        name: 'batchDownloadLevels',
        data: { versions: versions }
      });
      var result = res.result;
      if (!result || !result.ok) return;

      // 无变更则直接返回（changed 可能 undefined — 兼容旧云函数）
      var changed = result.changed;
      if (changed === undefined) changed = (result.count || 0) - (result.skipped || 0);

      console.log('[Cloud] 增量同步: ' + result.count + ' 个云端关卡, ' +
        changed + ' 个变更, ' + (result.skipped || 0) + ' 个跳过');

      if (!changed || !result.base64) return;

      // ③ base64 → Uint8Array → pako.inflate → JSON
      var binaryStr = atob(result.base64);
      var compressed = new Uint8Array(binaryStr.length);
      for (var j = 0; j < binaryStr.length; j++) {
        compressed[j] = binaryStr.charCodeAt(j);
      }
      var pako = require('../libs/pako_inflate.min');
      var decompressed = pako.inflate(compressed, { to: 'string' });
      var payload = JSON.parse(decompressed);

      if (result.compressedSize != null) {
        console.log('[Cloud] 解压完成: ' + result.compressedSize + 'B → ' + result.originalSize + 'B (' +
          Math.round(result.compressedSize / result.originalSize * 100) + '%)');
      }

      // ④ 逐关卡写入本地文件 + .meta
      var dir = `${wx.env.USER_DATA_PATH}/levels`;
      try { fs.accessSync(dir); } catch (e) { fs.mkdirSync(dir, true); }

      for (var entry of Object.entries(payload)) {
        var name = entry[0];
        var info = entry[1];
        var fileName = name + '.json';

        info.data.version = info.version;
        if (info.data.crownSteps == null && info.crownSteps != null) {
          info.data.crownSteps = info.crownSteps;
        }
        if (info.published === true) {
          info.data.ready = 1;
        } else if (info.data.ready === undefined) {
          info.data.ready = 0;
        }
        fs.writeFileSync(`${dir}/${fileName}`, JSON.stringify(info.data, null, 2), 'utf8');
        this._saveCloudMeta(name, info._id, info.version);
      }
      console.log('[Cloud] 云端数据已覆盖本地: ' + Object.keys(payload).length + ' 个关卡');
    } catch (e) {
      console.warn('[Cloud] 批量下载失败，回退到逐个下载:', e);
      await this._pullCloudLevelsFallback();
    }
  }

  // 逐个下载（兜底方案，当 batchDownloadLevels 不可用时）
  // listLevels() 返回 {minLevel, maxLevel}，按数字区间逐个下载
  async _pullCloudLevelsFallback() {
    const range = await cloud.listLevels();
    if (!range || range.maxLevel === 0) return;

    const fs = wx.getFileSystemManager();
    const dir = `${wx.env.USER_DATA_PATH}/levels`;
    try { fs.accessSync(dir); } catch (e) { fs.mkdirSync(dir, true); }

    const minLevel = range.minLevel || 0;
    const maxLevel = range.maxLevel || 0;
    for (let lv = minLevel; lv <= maxLevel; lv++) {
      var name = String(lv).padStart(4, '0');
      var fileName = name + '.json';

      try {
        const full = await cloud.downloadLevel(null, name, false);
        if (full && full.data) {
          const cloudVersion = (full.version != null) ? full.version : (full._version || 1);
          full.data.version = cloudVersion;
          if (full.data.crownSteps == null && full.crownSteps != null) {
            full.data.crownSteps = full.crownSteps;
          }
          if (full.data.ready === undefined) {
            full.data.ready = (full.published === true) ? 1 : 0;
          }
          fs.writeFileSync(`${dir}/${fileName}`, JSON.stringify(full.data, null, 2), 'utf8');
          this._saveCloudMeta(name, full._id, cloudVersion);
        }
      } catch (e) {
        console.warn('[Cloud] Fallback 下载关卡 ' + name + ' 失败:', e && e.message);
      }
    }
    console.log('[Cloud] Fallback 同步完成');
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
      id: p.id, tailIndex: p.tailIndex, length: p.length, angle: p.angle,
      hintId: p.hintId, hintAngle: p.hintAngle
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
        this.gp.pigs.push({ id: snap.id, tailIndex: snap.tailIndex, length: bestLength, angle: bestAngle,
          hintId: (snap.hintId != null) ? snap.hintId : null,
          hintAngle: (snap.hintAngle != null) ? snap.hintAngle : bestAngle });
        this.gp.updatePigOccupancy(snap.id, snap.tailIndex, bestLength, bestAngle);
      } else {
        lostPigs.push(snap.id);
      }
    }

    // 4. 兜底：尝试 tailIndex 附近孔位（距离最近的 6 个，网格无关）
    if (lostPigs.length > 0) {
      for (const pid of lostPigs) {
        const snap = snapshot.find(s => s.id === pid);
        if (!snap) continue;
        const tailHole = this.gp.holes[snap.tailIndex];
        // 按距离排序找最近的 N 个孔（排除自身）
        const candidates = this.gp.holes
          .map((h, i) => {
            const dx = h.x - tailHole.x, dy = h.y - tailHole.y;
            return { idx: i, dist2: dx * dx + dy * dy };
          })
          .filter(c => c.idx !== snap.tailIndex)
          .sort((a, b) => a.dist2 - b.dist2)
          .slice(0, 8);  // 8 个候选覆盖蜂窝 6 邻居 + 2 兜底
        let found = false;
        for (const { idx: newTail } of candidates) {
          if (this.gp.holeOccupied[newTail] !== -1) continue;
          for (let tryLen = snap.length; tryLen >= 1; tryLen--) {
            for (const sign of [0, -1, 1]) {
              const a = sign === 0 ? snap.angle : snap.angle + sign * 22.5;
              const sa = this.gp.snapAngleToHoles(newTail, tryLen, a);
              if (sa !== null) {
                this.gp.pigs.push({ id: snap.id, tailIndex: newTail, length: tryLen, angle: sa,
                  hintId: (snap.hintId != null) ? snap.hintId : null,
                  hintAngle: (snap.hintAngle != null) ? snap.hintAngle : sa });
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
    // 已发布关卡禁止删除
    if (entry.data && entry.data.ready === 1) {
      this.showToast('关卡已发布，禁止删除');
      return;
    }
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

  // ---- 清空所有关卡缓存（删除 USER_DATA_PATH/levels/ 下全部文件） ----
  clearAllCache() {
    const self = this;
    wx.showModal({
      title: '清空所有关卡缓存',
      content: '将删除本地保存的全部关卡数据，不可恢复。确定继续？',
      confirmText: '确定清空',
      confirmColor: '#D32F2F',
      success(res) {
        if (!res.confirm) return;
        const fs = wx.getFileSystemManager();
        const dir = `${wx.env.USER_DATA_PATH}/levels`;

        // 递归删除目录下所有文件和子目录
        function rmdirRecursive(path) {
          try {
            const entries = fs.readdirSync(path);
            for (const entry of entries) {
              const full = `${path}/${entry}`;
              try {
                // 判断是否为目录：尝试 readdir，失败则为文件
                fs.readdirSync(full);
                rmdirRecursive(full);           // 子目录
                fs.rmdirSync(full);
              } catch (e) {
                fs.unlinkSync(full);            // 文件
              }
            }
          } catch (e) {
            // 目录不存在，忽略
          }
        }

        try {
          rmdirRecursive(dir);
          try { fs.rmdirSync(dir); } catch (e) {}

          // 重置编辑器状态
          self.levelList = [];
          self.currentLevelIdx = -1;
          self._cloudSynced = false;
          self.dirty = false;
          self.gp.pigs = [];
          self.gp.selectedPigId = null;
          self.gp.dragState = null;
          self.showLevelSheet = false;

          // 创建新空白关卡
          self.newLevel();
          self.showToast('缓存已清空');
        } catch (e) {
          self.showToast('清空失败: ' + e.message);
        }
      },
    });
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
    this._clearAllHints();
    this.markCurrentDirty();
    this.showToast('已删除小猪');
  }

  /** 微调选中猪的长度 ±1px */
  _adjustSelectedPigLength(delta) {
    if (this.gp.selectedPigId == null) return;
    var pig = this.gp.pigs.find(function(p) { return p.id === this.gp.selectedPigId; }.bind(this));
    if (!pig) return;
    var newLen = Math.max(10, pig.length + delta);  // 最小 10px
    if (newLen === pig.length) return;
    pig.length = newLen;
    this.gp.updatePigOccupancy(pig.id, pig.tailIndex, pig.length, pig.angle);
    this.gp.rebuildOccupancy();
    this.markCurrentDirty();
    this.showToast('长度: ' + Math.round(pig.length) + 'px');
  }

  /** 清空所有猪的提示信息（新增/删除精灵时调用） */
  _clearAllHints() {
    var cleared = false;
    for (var i = 0; i < this.gp.pigs.length; i++) {
      if (this.gp.pigs[i].hintId != null) {
        this.gp.pigs[i].hintId = null;
        this.gp.pigs[i].hintAngle = null;
        cleared = true;
      }
    }
    if (cleared) {
      this.showToast('提示信息已清空');
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
  // === 渲染入口 ===
  // ============================================================
  render() {
    var self = this;
    this.gp.update();
    ctx.clearRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    // ===== 场景背景图（与 PlayingEngine 一致）=====
    if (this._sceneBgLoaded) {
      var imgW = this._sceneBgImg.width;
      var imgH = this._sceneBgImg.height;
      var scale = Math.max(SCREEN_WIDTH / imgW, SCREEN_HEIGHT / imgH);
      var dw = imgW * scale;
      var dh = imgH * scale;
      var ddx = (SCREEN_WIDTH - dw) / 2;
      var ddy = (SCREEN_HEIGHT - dh) / 2;
      ctx.drawImage(this._sceneBgImg, ddx, ddy, dw, dh);
    } else {
      // 图片未加载 → 渐变兜底
      var bgGrad = ctx.createLinearGradient(0, 0, 0, SCREEN_HEIGHT);
      bgGrad.addColorStop(0, '#F0EAFA');
      bgGrad.addColorStop(0.4, '#FDE8EF');
      bgGrad.addColorStop(1, '#FDF2F8');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    }

    // 棋盘布局参数（不再画白色卡片，直接让棋盘渲染在背景上）
    var safeTop = databus.safeTop || 0;
    var barH = 116;  // 48 原顶栏 + 68 预设按钮两行
    this.gp.topBarH = safeTop + barH + 4;
    this.gp.bottomStripH = 92;

    // 计算提示文字（提示模式下不显示操作提示）
    var opts = { showSelection: true, showAllCollisionBoxes: this._showAllCollisionBoxes };

    this.gp.renderBoard(ctx, opts);

    // 冲突高亮 & 提示叠加：需与 renderBoard 内相同的 auto-scale 变换
    var xf = this.gp._xform;
    if (xf) {
      ctx.save();
      ctx.translate(xf.screenCX, xf.screenCY);
      ctx.scale(xf.scale, xf.scale);
      ctx.translate(-xf.boardCX, -xf.boardCY);
    }
    if (this._showInfo) this._renderHintOverlays();
    if (xf) {
      ctx.restore();
    }

    this.renderTopBar();
    this.renderBottomStrip();
    this.renderToast();

    if (this.showPigSheet) this.renderPigSheet();
    if (this.showLevelSheet) this.renderLevelSheet();
    if (this.confirmDialog) this.renderConfirmDialog();

    // 云端同步加载遮罩
    if (this._cloudLoading) this.renderCloudLoading();
  }

  // ============================================================
  // === 提示模式 — 叠加渲染 ===
  // ============================================================
  _renderHintOverlays() {
    // 在 auto-scale 变换内，使用棋盘局部坐标
    var xf = this.gp._xform;
    var offX = xf ? 0 : this.gp.boardOffsetX;
    var offY = xf ? 0 : (this.gp.topBarH + this.gp.boardOffsetY);
    var arrowLen = 38;

    for (var i = 0; i < this.gp.pigs.length; i++) {
      var pig = this.gp.pigs[i];
      var tailHole = this.gp.holes[pig.tailIndex];
      if (!tailHole) continue;
      var tx = offX + tailHole.x;
      var ty = offY + tailHole.y;
      var hasHintId = (pig.hintId != null);

      // hintId 数字
      var label = hasHintId ? '' + pig.hintId : '--';
      ctx.save();
      ctx.fillStyle = hasHintId ? '#8B5CF6' : 'rgba(0,0,0,0.25)';
      ctx.font = 'bold 13px ' + Theme.font.family + '';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, tx, ty);
      ctx.restore();

      // 方向指示器（仅在有 hintId 时绘制）
      if (hasHintId) {
        var ha = (pig.hintAngle != null ? pig.hintAngle : pig.angle);
        var rad = ha * Math.PI / 180;
        var ax = tx + Math.cos(rad) * arrowLen;
        var ay = ty - Math.sin(rad) * arrowLen;

        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = 'rgba(139,92,246,0.5)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(ax, ay);
        ctx.stroke();
        ctx.setLineDash([]);

        // 箭头
        var arrowSize = 8;
        var arrowRad = rad + Math.PI;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax + Math.cos(rad - 2.5) * arrowSize, ay - Math.sin(rad - 2.5) * arrowSize);
        ctx.lineTo(ax + Math.cos(rad + 2.5) * arrowSize, ay - Math.sin(rad + 2.5) * arrowSize);
        ctx.closePath();
        ctx.fillStyle = 'rgba(139,92,246,0.5)';
        ctx.fill();
        ctx.restore();
      }
    }
  }

  // ============================================================
  // === 渲染 — 顶部工具栏 ===
  // ============================================================
  renderTopBar() {
    const topBarH = 48;
    const presetBarH = 68;
    const offsetY = (databus.safeTop || 28);  // 躲开系统状态栏

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, offsetY, SCREEN_WIDTH, topBarH + presetBarH);

    // ===== 第一行：返回 + 标题 + 试玩 =====
    const backW = 44, backH = 36;
    const backX = 6, backY = offsetY + (topBarH - backH) / 2;
    var backCX = backX + backW / 2;
    var backCY = backY + backH / 2;

    var backScale = this._btnPress.getScale('top:back');
    ctx.save();
    ctx.translate(backCX, backCY);
    ctx.scale(backScale, backScale);
    ctx.translate(-backCX, -backCY);

    ctx.fillStyle = '#f0f0f0';
    roundRect(ctx,backX, backY, backW, backH, 6);
    ctx.fill();
    ctx.fillStyle = '#666';
    ctx.font = 'bold 18px ' + Theme.font.family + '';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('←', backX + backW / 2, backY + backH / 2);
    ctx.restore();

    const titleX = backX + backW + 8;

    ctx.fillStyle = '#333';
    ctx.font = 'bold 15px ' + Theme.font.family + '';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('返回主菜单', titleX, offsetY + topBarH / 2);

    const titleWidth = 85;
    const btnW = 52, btnH = 32;
    const btnX = titleX + titleWidth + 4, btnY = offsetY + (topBarH - btnH) / 2;

    var playScale = this._btnPress.getScale('top:play');
    var playCX = btnX + btnW / 2;
    var playCY = btnY + btnH / 2;
    ctx.save();
    ctx.translate(playCX, playCY);
    ctx.scale(playScale, playScale);
    ctx.translate(-playCX, -playCY);

    ctx.fillStyle = '#2196F3';
    roundRect(ctx,btnX, btnY, btnW, btnH, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px ' + Theme.font.family + '';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('试玩', btnX + btnW / 2, btnY + btnH / 2);
    ctx.restore();

    // ===== "设为模板"按钮 =====
    // 启用条件：选中猪 + 当前预设是前7个之一
    var canSetTemplate = (this.gp.selectedPigId != null) &&
      (this._selectedEntityType === 'pig' && this._presetLength != null &&
       this._presetValues.indexOf(this._presetLength) >= 0 &&
       this._presetValues.indexOf(this._presetLength) < 7);
    var tplBtnW = 68, tplBtnH = 32;
    var tplBtnX = btnX + btnW + 10, tplBtnY = btnY;

    var tplScale = this._btnPress.getScale('top:setTemplate');
    var tplCX = tplBtnX + tplBtnW / 2;
    var tplCY = tplBtnY + tplBtnH / 2;
    ctx.save();
    ctx.translate(tplCX, tplCY);
    ctx.scale(tplScale, tplScale);
    ctx.translate(-tplCX, -tplCY);

    if (canSetTemplate) {
      ctx.fillStyle = '#FF9800';
    } else {
      ctx.fillStyle = '#e0e0e0';
    }
    roundRect(ctx, tplBtnX, tplBtnY, tplBtnW, tplBtnH, 6);
    ctx.fill();
    ctx.fillStyle = canSetTemplate ? '#fff' : '#999';
    ctx.font = '12px ' + Theme.font.family + '';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('设为模板', tplBtnX + tplBtnW / 2, tplBtnY + tplBtnH / 2);
    ctx.restore();

    // ===== 第二行：预设长度按钮（最多6个一行） =====
    const presetRowY = offsetY + topBarH;
    var presetLabels = this._presetLabels;
    var presetTypes  = this._presetTypes;
    var presetValues = this._presetValues;
    const gap = 8;
    const maxPerRow = 6;

    // 每个按钮宽度按 6 个一行计算
    const presetBtnW = Math.floor((SCREEN_WIDTH - 24 - (maxPerRow - 1) * gap) / maxPerRow);
    const presetBtnH = 30;
    const rowH = presetBtnH + 4;       // 行高（含纵向间距）

    this._presetBtns = [];

    for (var i = 0; i < presetLabels.length; i++) {
      var row = Math.floor(i / maxPerRow);
      var col = i % maxPerRow;
      var px = 12 + col * (presetBtnW + gap);
      var py = presetRowY + 3 + row * rowH;
      var isSelected = (presetTypes[i] === 'pig' && this._selectedEntityType === 'pig' && this._presetLength === presetValues[i])
        || (presetTypes[i] === 'rock' && this._selectedEntityType === 'rock');

      var pscale = this._btnPress.getScale('preset:' + i);
      var pcx = px + presetBtnW / 2;
      var pcy = py + presetBtnH / 2;
      ctx.save();
      ctx.translate(pcx, pcy);
      ctx.scale(pscale, pscale);
      ctx.translate(-pcx, -pcy);

      if (isSelected) {
        ctx.fillStyle = '#2196F3';
      } else {
        ctx.fillStyle = '#f0f0f0';
      }
      roundRect(ctx, px, py, presetBtnW, presetBtnH, 6);
      ctx.fill();

      ctx.fillStyle = isSelected ? '#fff' : '#666';
      ctx.font = '13px ' + Theme.font.family + '';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(presetLabels[i], px + presetBtnW / 2, py + presetBtnH / 2);

      ctx.restore();

      this._presetBtns.push({
        x: px, y: py, w: presetBtnW, h: presetBtnH,
        label: presetLabels[i],
        value: presetValues[i],
        entityType: presetTypes[i],
        id: 'preset:' + i
      });
    }

    this.topBtns = [
      { x: backX, y: backY, w: backW, h: backH, action: 'back', id: 'top:back' },
      { x: btnX, y: btnY, w: btnW, h: btnH, action: 'play', id: 'top:play' },
      { x: tplBtnX, y: tplBtnY, w: tplBtnW, h: tplBtnH, action: 'setTemplate', id: 'top:setTemplate' }
    ];
    this._topBarTotalH = offsetY + topBarH + presetBarH;
  }

  checkTopButtons(x, y) {
    for (const btn of this.topBtns) {
      if (x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
        audio.play('button_click');
        this._btnPress.press(btn.id);
        this._btnPress.breathe(btn.id);
        if (btn.action === 'play') this._checkDirtyAndDo(() => this._goToPlaying());
        if (btn.action === 'back') this._checkDirtyAndDo(() => this._goToMenu());
        if (btn.action === 'setTemplate') this._doSetTemplate();
        return true;
      }
    }
    // 预设按钮
    if (this._presetBtns) {
      for (var i = 0; i < this._presetBtns.length; i++) {
        var b = this._presetBtns[i];
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
          audio.play('button_click');
          this._btnPress.press(b.id);
          this._btnPress.breathe(b.id);
          this._selectedEntityType = b.entityType;
          this._presetLength = b.value;
          return true;
        }
      }
    }
    return false;
  }

  /**
   * 带按压缩放的按钮绘制包装器
   * @param {string} id - 按钮唯一标识
   * @param {number} x, y, w, h - 按钮位置和尺寸
   * @param {function} drawFn - 按钮绘制回调（在缩放变换内执行）
   */
  _drawBtn(id, x, y, w, h, drawFn) {
    var scale = this._btnPress.getScale(id);
    var cx = x + w / 2;
    var cy = y + h / 2;
    if (scale !== 1) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -cy);
      drawFn();
      ctx.restore();
    } else {
      drawFn();
    }
  }

  // ============================================================
  // === 渲染 — 底部控制条 ===
  // 第一行：[猪] [提示] [金猪 输入框]
  // 第二行：[关卡▼] [新建] [保存] [复制] [本地同步] [发布]
  // 棋盘控件（列/行/径/横距/纵距）已迁至关卡选择面板
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

    const rowH = 38;
    const btnH = 30;
    var x;

    // ============================
    // 第一行：猪 + 提示 + 金猪
    // ============================
    const row1Y = baseY + 3;
    const btnY1 = row1Y + (rowH - btnH) / 2;
    const midY1 = row1Y + rowH / 2;

    x = 12;

    // 精灵按钮
    const pigW = 66;
    const pigLabel = this.gp.selectedPigId != null ? '#' + this.gp.selectedPigId : '精灵';
    this._drawBtn('btm:pig', x, btnY1, pigW, btnH, function() {
      ctx.fillStyle = '#FF9800';
      roundRect(ctx, x, btnY1, pigW, btnH, 6);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 14px ' + Theme.font.family + '';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(pigLabel, x + pigW / 2, midY1);
    });
    this.bottomBtns.push({ x, y: btnY1, w: pigW, h: btnH, id: 'btm:pig', onClick: () => {
      if (this.gp.selectedPigId == null) {
        this.showToast('请先在棋盘上选中小猪');
        return;
      }
      this.showPigSheet = !this.showPigSheet;
    }});
    x += pigW + 12;

    // 信息按钮（提示数据 + 碰撞框）
    const infoBtnW = 66;
    var infoActive = this._showInfo;
    this._drawBtn('btm:info', x, btnY1, infoBtnW, btnH, function() {
      ctx.fillStyle = infoActive ? '#8B5CF6' : 'rgba(139, 92, 246, 0.2)';
      roundRect(ctx, x, btnY1, infoBtnW, btnH, 6);
      ctx.fill();
      ctx.fillStyle = infoActive ? '#fff' : '#8B5CF6';
      ctx.font = 'bold 14px ' + Theme.font.family + '';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('信息', x + infoBtnW / 2, midY1);
    }.bind(this));
    this.bottomBtns.push({ x, y: btnY1, w: infoBtnW, h: btnH, id: 'btm:info', onClick: () => {
      this._showInfo = !this._showInfo;
      this._showAllCollisionBoxes = this._showInfo;
    }});
    x += infoBtnW + 12;

    // 金猪输入框
    ctx.fillStyle = '#999';
    ctx.font = '12px ' + Theme.font.family + '';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('金猪', x, midY1);
    x += 30;
    const crownW = 54, crownH = btnH;
    ctx.strokeStyle = '#FF8C00';
    ctx.lineWidth = 1.5;
    roundRect(ctx, x, btnY1, crownW, crownH, 6);
    ctx.stroke();
    ctx.fillStyle = '#FF8C00';
    ctx.font = 'bold 13px ' + Theme.font.family + '';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var crownLabel = this._crownSteps > 0 ? String(this._crownSteps) : '无';
    ctx.fillText(crownLabel, x + crownW / 2, midY1);
    this.bottomBtns.push({
      x: x, y: btnY1, w: crownW, h: crownH, id: 'btm:crown',
      onClick: (function() {
        var engine = this;
        wx.showModal({
          title: '金猪阈值',
          editable: true,
          placeholderText: '输入数字，0 表示无',
          content: String(engine._crownSteps),
          success: function(res) {
            if (res.confirm && res.content != null) {
              var v = parseInt(res.content, 10);
              if (!isNaN(v)) {
                v = Math.max(0, Math.min(999, v));
                engine._crownSteps = v;
                engine.markCurrentDirty();
              }
            }
          }
        });
      }).bind(this)
    });
    x += crownW;

    // ============================
    // 第二行：关卡管理
    // ============================
    const row2Y = baseY + 3 + rowH + 4;
    const btnY2 = row2Y + (rowH - btnH) / 2;
    const midY2 = row2Y + rowH / 2;

    // 顶边分隔线
    ctx.strokeStyle = '#ddd';
    ctx.beginPath();
    ctx.moveTo(0, row2Y - 2);
    ctx.lineTo(SCREEN_WIDTH, row2Y - 2);
    ctx.stroke();

    x = 12;

    // 关卡选择按钮 [0002 ▼]
    const hasLevels = this.levelList.length > 0;
    const curName = hasLevels && this.currentLevelIdx >= 0
      ? this.levelList[this.currentLevelIdx].name : '---';
    const isDirty = hasLevels && this.currentLevelIdx >= 0
      && this.levelList[this.currentLevelIdx].isDirty;

    const lvlBtnW = 72;
    this._drawBtn('lvl:show', x, btnY2, lvlBtnW, btnH, function() {
      ctx.fillStyle = '#f5f5f5';
      ctx.strokeStyle = '#ccc';
      ctx.lineWidth = 1;
      roundRect(ctx, x, btnY2, lvlBtnW, btnH, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = isDirty ? '#E65100' : '#333';
      ctx.font = 'bold 14px ' + Theme.font.family + '';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var lvlLabel2 = (isDirty ? '*' : '') + curName + ' ▼';
      ctx.fillText(lvlLabel2, x + lvlBtnW / 2, midY2);
    });
    this.levelBtns.push({ x, y: btnY2, w: lvlBtnW, h: btnH, id: 'lvl:show', action: 'showLevelSheet' });
    x += lvlBtnW + 4;

    // 操作按钮：新建 / 保存 / 复制
    const opBtns = [
      { label: '新建', color: '#4CAF50', action: 'newLevel', id: 'lvl:new' },
      { label: '保存', color: '#2196F3', action: 'saveLevel', id: 'lvl:save' },
      { label: '复制', color: '#00BCD4', action: 'exportLevel', id: 'lvl:clone' },
    ];

    const opW = 38;
    for (const b of opBtns) {
      this._drawBtn(b.id, x, btnY2, opW, btnH, function(bx, by, bw, bh, bmY) {
        return function() {
          ctx.fillStyle = b.color;
          roundRect(ctx, bx, btnY2, opW, btnH, 6);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 12px ' + Theme.font.family + '';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(b.label, bx + opW / 2, bmY);
        };
      }(x, btnY2, opW, btnH, midY2));
      this.levelBtns.push({ x, y: btnY2, w: opW, h: btnH, id: b.id, action: b.action });
      x += opW + 4;
    }

    // 本地同步按钮
    const syncW = 50;
    this._drawBtn('lvl:sync', x, btnY2, syncW, btnH, function() {
      ctx.fillStyle = '#ff9800';
      roundRect(ctx, x, btnY2, syncW, btnH, 6);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px ' + Theme.font.family + '';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('本地同步', x + syncW / 2, midY2);
    });
    this.levelBtns.push({ x, y: btnY2, w: syncW, h: btnH, id: 'lvl:sync', action: 'localSync' });
    x += syncW + 4;

    // 发布按钮：toggle ready 0↔1
    const ready = (this.currentLevelIdx >= 0 && this.currentLevelIdx < this.levelList.length)
      ? (this.levelList[this.currentLevelIdx].data.ready || 0) : 0;
    const publishW = 50;
    const publishColor = ready === 1 ? '#E91E63' : '#9E9E9E';
    this._drawBtn('lvl:publish', x, btnY2, publishW, btnH, function() {
      ctx.fillStyle = publishColor;
      roundRect(ctx, x, btnY2, publishW, btnH, 6);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px ' + Theme.font.family + '';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ready === 1 ? '已发布' : '设计中', x + publishW / 2, midY2);
    });
    this.levelBtns.push({ x, y: btnY2, w: publishW, h: btnH, id: 'lvl:publish', action: 'toggleReady' });
  }

  // ---- 紧凑步进器：label [-][+] — 手指友好 ----
  // 返回绘制后的 x 位置，供调用方精确控制间距
  _drawCompactStepper(x, btnY, btnH, label, value, min, max, onChange, step, targetArray, valueWidth) {
    step = step || 1;
    targetArray = targetArray || this.bottomBtns;
    valueWidth = valueWidth || 18;
    const midY = btnY + btnH / 2;
    const btnW = 27;

    // 标签
    ctx.fillStyle = '#999';
    ctx.font = '12px ' + Theme.font.family + '';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x, midY);
    x += 30;

    // 当前值
    ctx.fillStyle = '#FF8C00';
    ctx.font = 'bold 13px ' + Theme.font.family + '';
    ctx.textAlign = 'center';
    ctx.fillText(String(value), x + valueWidth / 2, midY);
    x += valueWidth;

    // 减号
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    roundRect(ctx, x, btnY, btnW, btnH, 4);
    ctx.stroke();
    ctx.fillStyle = '#333';
    ctx.font = 'bold 14px ' + Theme.font.family + '';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('−', x + btnW / 2, midY);
    targetArray.push({ x, y: btnY, w: btnW, h: btnH, id: 'stp:' + label + ':minus', onClick: () => onChange(Math.max(min, value - step)) });
    x += btnW + 3;

    // 加号
    ctx.strokeStyle = '#ccc';
    roundRect(ctx, x, btnY, btnW, btnH, 4);
    ctx.stroke();
    ctx.fillStyle = '#333';
    ctx.fillText('+', x + btnW / 2, midY);
    targetArray.push({ x, y: btnY, w: btnW, h: btnH, id: 'stp:' + label + ':plus', onClick: () => onChange(Math.min(max, value + step)) });
    x += btnW;

    return x;
  }

  addBottomBtn(x, y, w, h, text, onClick) {
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    roundRect(ctx, x, y, w, h, 5);
    ctx.stroke();
    ctx.fillStyle = '#333';
    ctx.font = 'bold 16px ' + Theme.font.family + '';
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
    ctx.font = 'bold 12px ' + Theme.font.family + '';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w / 2, y + h / 2);
    this.bottomBtns.push({ x, y, w, h, onClick });
  }

  checkBottomButtons(x, y) {
    // 关卡管理按钮
    for (const btn of this.levelBtns) {
      if (x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
        this._btnPress.press(btn.id);
        this._btnPress.breathe(btn.id);
        this._handleLevelAction(btn.action);
        return true;
      }
    }
    // 棋盘参数按钮（列/行 ±）
    for (const btn of this.bottomBtns) {
      if (btn.onClick && x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
        audio.play('button_click');
        this._btnPress.press(btn.id);
        this._btnPress.breathe(btn.id);
        btn.onClick();
        return true;
      }
    }
    return false;
  }

  _handleLevelAction(action) {
    // 编辑器操作音效（关卡列表打开不算操作）
    if (action !== 'showLevelSheet' && action !== 'closeLevelSheet') {
      audio.play('button_click');
    }
    switch (action) {
      case 'showLevelSheet': {
        if (this.levelList.length === 0) {
          this.showToast('暂无关卡');
          return;
        }
        this.showLevelSheet = !this.showLevelSheet;
        if (this.showLevelSheet) this._levelSheetScrollY = 0;
        break;
      }
      case 'newLevel': this.newLevel(); break;
      case 'saveLevel': this.saveLevel(); break;
      case 'deleteLevel': this.deleteLevel(); break;
      case 'clearLevel': this.clearLevel(); break;
      case 'clearAllCache': this.clearAllCache(); break;
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
    ctx.font = 'bold 15px ' + Theme.font.family + '';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('选中精灵', 20, sheetY + 24);

    const closeX = SCREEN_WIDTH - 50;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.font = '20px ' + Theme.font.family + '';
    ctx.textAlign = 'center';
    ctx.fillText('✕', closeX + 16, sheetY + 22);

    const pig = this.gp.pigs.find(p => p.id === this.gp.selectedPigId);
    if (pig) {
      ctx.fillStyle = '#555';
      ctx.font = '14px ' + Theme.font.family + '';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const infoY = sheetY + 56;
      ctx.fillText(`类型: ${entityLabel(pig.type || 'pig')}  编号: #${pig.id}`, 28, infoY);

      // 长度 + [-]/[+]
      ctx.fillText(`长度: ${Math.round(pig.length)}px`, 28, infoY + 26);
      var lenTextW = ctx.measureText(`长度: ${Math.round(pig.length)}px`).width;
      var btnSize = 28;
      var minusX = 28 + lenTextW + 10;
      var plusX = minusX + btnSize + 6;
      var lenBtnY = infoY + 22;

      // [-] 按钮
      ctx.fillStyle = '#f0f0f0';
      roundRect(ctx, minusX, lenBtnY, btnSize, btnSize, 4);
      ctx.fill();
      ctx.fillStyle = '#666';
      ctx.font = 'bold 16px ' + Theme.font.family + '';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('−', minusX + btnSize / 2, lenBtnY + btnSize / 2);

      // [+] 按钮
      ctx.fillStyle = '#f0f0f0';
      roundRect(ctx, plusX, lenBtnY, btnSize, btnSize, 4);
      ctx.fill();
      ctx.fillStyle = '#666';
      ctx.fillText('+', plusX + btnSize / 2, lenBtnY + btnSize / 2);

      this.sheetPigLenMinus = { x: minusX, y: lenBtnY, w: btnSize, h: btnSize };
      this.sheetPigLenPlus = { x: plusX, y: lenBtnY, w: btnSize, h: btnSize };

      ctx.fillStyle = '#555';
      ctx.font = '14px ' + Theme.font.family + '';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(`角度: ${Math.round(pig.angle)}°`, 28, infoY + 56);
      ctx.fillText(`尾部孔: #${pig.tailIndex}`, 180, infoY + 56);

      const delBtnX = SCREEN_WIDTH - 120;
      const delBtnY = sheetY + sheetH - 56;
      ctx.fillStyle = '#f44336';
      roundRect(ctx,delBtnX, delBtnY, 104, 40, 8);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 15px ' + Theme.font.family + '';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('删除', delBtnX + 52, delBtnY + 20);

      this.sheetPigDeleteRect = { x: delBtnX, y: delBtnY, w: 104, h: 40 };
    } else {
      ctx.fillStyle = '#aaa';
      ctx.font = '14px ' + Theme.font.family + '';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('未选中精灵', 28, sheetY + 56);
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
        audio.play('button_click');
        this._btnPress.press('sheet:close');
        this._btnPress.breathe('sheet:close');
        this.showPigSheet = false;
        return true;
      }
      if (this.sheetPigDeleteRect && this.hitRect(x, y, this.sheetPigDeleteRect)) {
        audio.play('button_click');
        this._btnPress.press('sheet:delete');
        this._btnPress.breathe('sheet:delete');
        this.deleteSelectedPig();
        return true;
      }
      if (this.sheetPigLenMinus && this.hitRect(x, y, this.sheetPigLenMinus)) {
        audio.play('button_click');
        this._adjustSelectedPigLength(-1);
        return true;
      }
      if (this.sheetPigLenPlus && this.hitRect(x, y, this.sheetPigLenPlus)) {
        audio.play('button_click');
        this._adjustSelectedPigLength(1);
        return true;
      }
      if (this.sheetPigRect && (x < this.sheetPigRect.x || x > this.sheetPigRect.x + this.sheetPigRect.w ||
          y < this.sheetPigRect.y)) {
        audio.play('button_click');
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
  // === 关卡选择面板（按钮网格 + 滚动） ===
  // ============================================================
  renderLevelSheet() {
    const barH = 48;  // 操作按钮栏高度
    const COLS = 6;
    const PAD = 12;
    const GAP = 8;
    const btnW = Math.floor((SCREEN_WIDTH - PAD * 2 - GAP * (COLS - 1)) / COLS);
    const btnH = 38;
    const rowGap = 6;
    const rows = Math.ceil(this.levelList.length / COLS);
    const gridH = (rows + 2) * btnH + (rows + 1) * rowGap;  // +2 行空底，防误点

    const boardSectionH = 128;       // 棋盘控件区（3 行 stepper: 每行 ~36px + 间距）
    const headerH = 48 + boardSectionH + 4 + barH;  // 标题 + 棋盘 + 间隙 + 操作栏
    const maxScrollH = SCREEN_HEIGHT * 0.75 - headerH;
    const scrollH = Math.min(gridH, maxScrollH);
    const sheetH = headerH + scrollH;
    const sheetY = SCREEN_HEIGHT - sheetH;

    // 限制滚动范围
    const maxScroll = Math.max(0, gridH - scrollH);
    if (this._levelSheetScrollY < 0) this._levelSheetScrollY = 0;
    if (this._levelSheetScrollY > maxScroll) this._levelSheetScrollY = maxScroll;

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
    ctx.font = 'bold 15px ' + Theme.font.family + '';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('选择关卡', 20, sheetY + 24);

    // 关闭按钮
    const closeX = SCREEN_WIDTH - 50;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.font = '20px ' + Theme.font.family + '';
    ctx.textAlign = 'center';
    ctx.fillText('\u2715', closeX + 16, sheetY + 22);

    // ---- 棋盘控件区 ----
    const stepperH = 28;
    const boardY1 = sheetY + 52;
    const boardY2 = sheetY + 88;
    const boardY3 = sheetY + 124;
    this._levelSheetStepperBtns = [];

    // 顶边分隔线
    ctx.strokeStyle = '#ddd';
    ctx.beginPath();
    ctx.moveTo(0, boardY1 - 2);
    ctx.lineTo(SCREEN_WIDTH, boardY1 - 2);
    ctx.stroke();

    // Row 1: 行 + 列
    let bx = 12;
    bx = this._drawCompactStepper(bx, boardY1, stepperH, '行', this.gp.rows, 2, 15,
      (v) => {
        if (this.gp.pigs.length > 0) {
          this.showToast('有猪的情况下不能改变格子数量');
          return;
        }
        this.gp.rows = v; this.gp.recomputeBoard(); this.gp.recenterBoard(); this.markCurrentDirty();
      }, 1, this._levelSheetStepperBtns) + 14;
    bx = this._drawCompactStepper(bx, boardY1, stepperH, '奇数列', this.gp.oddCols, 2, 10,
      (v) => {
        if (this.gp.pigs.length > 0) {
          this.showToast('有猪的情况下不能改变格子数量');
          return;
        }
        this.gp.oddCols = v; this.gp.recomputeBoard(); this.gp.recenterBoard(); this.markCurrentDirty();
      }, 1, this._levelSheetStepperBtns);

    // Row 2: boardWidth（棋盘总宽）
    bx = 12;
    bx = this._drawCompactStepper(bx, boardY2, stepperH, '宽', this.gp.boardWidth, 100, SCREEN_WIDTH - GameplayEngine.BOARD_MARGIN * 2,
      (v) => {
        this.gp.boardWidth = v; this.gp.recomputeBoard(); this.gp.recenterBoard();
        this._adaptPigsToBoard();
        this.markCurrentDirty();
      }, 5, this._levelSheetStepperBtns);

    // 孔半径（只读）
    ctx.fillStyle = '#999';
    ctx.font = '12px ' + Theme.font.family + '';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('R:' + Math.round(this.gp.scaledHalfDiameter), bx + 8, boardY2 + stepperH / 2);

    // Row 3: boardRate（孔间距/半径比，调节正六边形密度）
    bx = 12;
    this._drawCompactStepper(bx, boardY3, stepperH, 'Rate', this.gp.boardRate, 1.5, 4.0,
      (v) => {
        this.gp.boardRate = Math.round(v * 1000) / 1000;
        this.gp.recomputeBoard(); this.gp.recenterBoard();
        this._adaptPigsToBoard();
        this.markCurrentDirty();
      }, 0.01, this._levelSheetStepperBtns, 42);
    // 点击数值区域可直接输入（像金猪阈值一样）
    this._levelSheetStepperBtns.push({
      x: bx + 30, y: boardY3, w: 42, h: stepperH,
      onClick: () => {} // no-op — 小游戏不支持 showModal editable，Rate 已有 +/- 步进器
    });

    // ---- 操作按钮栏 ----
    const actionBarY = sheetY + 48 + boardSectionH + 4;
    const actionBtns = [
      { label: '\u5220\u9664', color: '#f44336', action: 'deleteLevel' },
      { label: '\u6e05\u7a7a', color: '#FF9800', action: 'clearLevel' },
      { label: '\u91cd\u8f7d', color: '#9C27B0', action: 'resetLevel' },
      { label: '\u6e05\u7a7a\u7f13\u5b58', color: '#D32F2F', action: 'clearAllCache' },
    ];
    const abW = Math.min(72, Math.floor((SCREEN_WIDTH - 24 - (actionBtns.length - 1) * 10) / actionBtns.length));
    const abH = 36;
    const totalW = actionBtns.length * abW + (actionBtns.length - 1) * 10;
    let abX = (SCREEN_WIDTH - totalW) / 2;
    const abY = actionBarY + (barH - abH) / 2;
    this.levelSheetActionBtns = [];
    for (const b of actionBtns) {
      ctx.fillStyle = b.color;
      roundRect(ctx, abX, abY, abW, abH, 6);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 13px ' + Theme.font.family + '';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.label, abX + abW / 2, abY + abH / 2);
      this.levelSheetActionBtns.push({ x: abX, y: abY, w: abW, h: abH, action: b.action });
      abX += abW + 10;
    }

    // ---- 按钮网格（可滚动区域） ----
    const gridTop = sheetY + headerH;
    this._levelSheetGridTop = gridTop;
    this._levelSheetGridH = scrollH;
    this._levelSheetGridContentH = gridH;

    // 裁剪区域
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, gridTop, SCREEN_WIDTH, scrollH);
    ctx.clip();

    const scrollOffset = -this._levelSheetScrollY;
    const startRow = gridTop + scrollOffset;
    this.levelSheetItems = [];

    for (let i = 0; i < this.levelList.length; i++) {
      const row = Math.floor(i / COLS);
      const col = i % COLS;
      const bx = PAD + col * (btnW + GAP);
      const by = startRow + row * (btnH + rowGap);

      // 跳过完全不可见的行
      if (by + btnH < gridTop || by > gridTop + scrollH) continue;

      const lv = this.levelList[i];
      const isActive = i === this.currentLevelIdx;
      const dirtyMark = lv.isDirty ? ' *' : '';

      // 按钮背景
      if (isActive) {
        ctx.fillStyle = '#1976D2';
      } else {
        ctx.fillStyle = '#F5F5F5';
      }
      roundRect(ctx, bx, by, btnW, btnH, 6);
      ctx.fill();

      // 文字
      ctx.fillStyle = isActive ? '#fff' : '#333';
      ctx.font = '12px ' + Theme.font.family + '';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const maxChars = Math.floor(btnW / 8);
      let label = lv.name;
      if (label.length > maxChars) label = label.substring(0, maxChars - 1) + '\u2026';
      ctx.fillText(label + dirtyMark, bx + btnW / 2, by + btnH / 2);

      this.levelSheetItems.push({ x: bx, y: by, w: btnW, h: btnH, index: i });
    }

    ctx.restore();

    this.sheetLevelRect = { x: 0, y: sheetY, w: SCREEN_WIDTH, h: sheetH };
    this.sheetLevelCloseRect = { x: closeX, y: sheetY + 16, w: 40, h: 40 };
  }

  _levelSheetTouchStart(x, y) {
    this._levelSheetTouchStartY = y;
    this._levelSheetTouchStartScrollY = this._levelSheetScrollY;
    this._levelSheetIsScrolling = false;
  }

  _levelSheetTouchMove(x, y) {
    const dy = y - this._levelSheetTouchStartY;
    if (Math.abs(dy) > 4) {
      this._levelSheetIsScrolling = true;
    }
    if (this._levelSheetIsScrolling) {
      this._levelSheetScrollY = this._levelSheetTouchStartScrollY - dy;
    }
  }

  _levelSheetTouchEnd(x, y) {
    if (this._levelSheetIsScrolling) {
      this._levelSheetIsScrolling = false;
      return;
    }
    // 没有滚动 → 当作点击处理
    this.checkLevelSheetButtons(x, y);
  }

  checkLevelSheetButtons(x, y) {
    if (!this.showLevelSheet) return false;

    if (this.sheetLevelCloseRect && this.hitRect(x, y, this.sheetLevelCloseRect)) {
      audio.play('button_click');
      this._closeLevelSheet();
      return true;
    }

    if (this.sheetLevelRect && y < this.sheetLevelRect.y) {
      audio.play('button_click');
      this._closeLevelSheet();
      return true;
    }

    // 棋盘控件 stepper 按钮（不关闭面板）
    if (this._levelSheetStepperBtns) {
      for (const btn of this._levelSheetStepperBtns) {
        if (this.hitRect(x, y, btn)) {
          audio.play('button_click');
          btn.onClick();
          return true;
        }
      }
    }

    // 操作按钮栏：删除 / 清空 / 重载
    if (this.levelSheetActionBtns) {
      for (const btn of this.levelSheetActionBtns) {
        if (this.hitRect(x, y, btn)) {
          this._closeLevelSheet();
          this._handleLevelAction(btn.action);
          return true;
        }
      }
    }

    if (this.levelSheetItems) {
      for (const item of this.levelSheetItems) {
        if (this.hitRect(x, y, item)) {
          audio.play('button_click');
          this._closeLevelSheet();
          this.switchToLevel(item.index);
          return true;
        }
      }
    }

    return true;
  }

  _closeLevelSheet() {
    this.showLevelSheet = false;
    this._levelSheetScrollY = 0;
  }

  // ============================================================
  // === 渲染 — Toast ===
  // ============================================================
  renderToast() {
    if (!this.toastText || this.toastAlpha <= 0) return;

    ctx.save();
    ctx.globalAlpha = this.toastAlpha;
    ctx.font = '13px ' + Theme.font.family + '';
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
    ctx.font = 'bold 16px ' + Theme.font.family + '';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(d.title, dx + dw / 2, dy + 38);

    // 消息
    ctx.fillStyle = '#666';
    ctx.font = '14px ' + Theme.font.family + '';
    ctx.fillText(d.message, dx + dw / 2, dy + 72);

    // 按钮
    const btnW = 110, btnH = 36;
    const btnY = dy + dh - 54;
    const gap = 16;
    const totalBtnW = btnW * 2 + gap;
    const btnBaseX = dx + (dw - totalBtnW) / 2;

    var saveLabel = '保存并跳转';
    var skipLabel = '直接跳转';
    if (d.buttonLabels && d.buttonLabels.length >= 2) {
      saveLabel = d.buttonLabels[0];
      skipLabel = d.buttonLabels[1];
    }

    // 保存按钮
    var saveColor = (d.buttonColors && d.buttonColors[0]) ? d.buttonColors[0] : '#4CAF50';
    ctx.fillStyle = saveColor;
    roundRect(ctx, btnBaseX, btnY, btnW, btnH, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 14px ' + Theme.font.family + '';
    ctx.fillText(saveLabel, btnBaseX + btnW / 2, btnY + btnH / 2);

    // 跳过按钮
    var skipColor = (d.buttonColors && d.buttonColors[1]) ? d.buttonColors[1] : '#999';
    const skipX = btnBaseX + btnW + gap;
    ctx.fillStyle = skipColor;
    roundRect(ctx, skipX, btnY, btnW, btnH, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(skipLabel, skipX + btnW / 2, btnY + btnH / 2);

    this._confirmSaveRect = { x: btnBaseX, y: btnY, w: btnW, h: btnH };
    this._confirmSkipRect = { x: skipX, y: btnY, w: btnW, h: btnH };
  }

  checkConfirmDialog(x, y) {
    if (this.hitRect(x, y, this._confirmSaveRect)) {
      audio.play('button_click');
      this._btnPress.press('confirm:save');
      this._btnPress.breathe('confirm:save');
      this.confirmDialog.onSave();
      this.confirmDialog = null;
      return true;
    }
    if (this.hitRect(x, y, this._confirmSkipRect)) {
      audio.play('button_click');
      this._btnPress.press('confirm:skip');
      this._btnPress.breathe('confirm:skip');
      this.confirmDialog.onSkip();
      this.confirmDialog = null;
      return true;
    }
    return true;  // 点击其他区域保持对话框
  }

  // ============================================================
  // === 渲染 — 云端同步加载遮罩 ===
  // ============================================================
  renderCloudLoading() {
    // 半透明遮罩
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    // 居中提示框
    const bw = 240, bh = 80;
    const bx = (SCREEN_WIDTH - bw) / 2;
    const by = (SCREEN_HEIGHT - bh) / 2;

    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    roundRect(ctx, bx, by, bw, bh, 12);
    ctx.fill();

    ctx.fillStyle = '#333';
    ctx.font = 'bold 16px ' + Theme.font.family + '';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('同步云端关卡中...', bx + bw / 2, by + 33);

    ctx.fillStyle = '#999';
    ctx.font = '12px ' + Theme.font.family + '';
    ctx.fillText('请稍后', bx + bw / 2, by + 56);
  }
}

module.exports = EditorEngine;
