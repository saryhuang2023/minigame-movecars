// 关卡游玩引擎 — 组合 GameplayEngine 实现正式玩法

const databus = require('../databus.js');
const cloud = require('../cloud.js');
const audio = require('../audio/AudioManager.js');
const settingsPanel = require('../ui/SettingsPanel.js');
const Easing = require('../core/Easing.js');
const ButtonPress = require('../anim/ButtonPress.js');
const PopupAnimator = require('../ui/PopupAnimator.js');
const { ctx, SCREEN_WIDTH, SCREEN_HEIGHT } = require('../render.js');
const GameplayEngine = require('../core/GameplayEngine.js');
const { drawPigIcon } = require('../render/PigIconRenderer.js');

// Ardot 设计稿色彩系统 (fileId: 694583967818218)
// 背景色 #FDF2F8 由 GameEngine.COLORS.bgBottom 统一绘制渐变
const PINK = '#EC4899';     // 关卡徽章
const DARK = '#0F172A';     // 深色文字
const MUTED = '#64748B';    // 次要文字
const PURPLE = '#8B5CF6';   // 提示按钮
const RED = '#DC2626';      // 重置按钮

// 布局常量（来自 Ardot 设计稿 375×812）
const TOP_BAR_H = 48;
const BOTTOM_BAR_H = 56;
const PADDING = 16;         // 内容区外边距
const CARD_GAP = 8;         // 卡片之间的间距
const CARD_PADDING = 12;    // 棋盘卡片内边距
const CARD_RADIUS = 32;     // 棋盘卡片圆角

const ESCAPE_SPEED = 150;  // 正常逃脱速度（逻辑像素/秒）
const GHOST_SPEED  = 100;   // 幽灵提示速度（正常速度的一半）

const SNAP_ANGLE_PUSH_THRESHOLD = 45;
const COMBO_WINDOW = 3000;             // 连击窗口（毫秒）
const COMBO_WIDGET_W = 120;            // 连击组件宽度
const COMBO_WIDGET_H = 30;             // 连击组件高度
const COMBO_WIDGET_R = 20;             // 连击组件圆角
const COMBO_WIDGET_OFFSET = 12;        // 距卡片内容区边缘偏移
// 进度条颜色阈值
const COMBO_COLOR_SAFE = '#4ADE80';   // >50% 绿色
const COMBO_COLOR_WARN = '#F59E0B';   // 25-50% 黄色
const COMBO_COLOR_DANGER = '#EF4444'; // <25% 红色

class PlayingEngine {
  constructor(input) {
    this.input = input;
    this.gp = new GameplayEngine();
    this.levelName = '';
    this.steps = 0;
    this.backBtn = null;
    this.restartBtn = null;
    this.hintBtn = null;       // 提示按钮
    this._btnPress = new ButtonPress();
    this._victory = false;
    this._exitBtn = null;
    this._nextBtn = null;
    // 连击系统
    this._comboCount = 0;           // 当前连击数
    this._comboTimer = null;        // 重置窗口定时器
    this._maxCombo = 0;             // 本局最大连击
    this._comboStartTime = 0;       // 当前连击窗口起始时间
    this._comboWidget = { visible: false, count: 0, bumpStart: 0 };
    this._comboAnimator = PopupAnimator.createPopupAnimator();
    // 关主系统
    this._levelMaster = null;       // { masterUserId, masterSteps, masterAvatarUrl, masterNickname } | null
    this._myRecord = null;          // 个人最好成绩（步数）| null
    this._masterLoading = false;
    this._myOpenId = null;          // 当前用户 openid（首次 activate 时异步获取）
    this._userInfo = null;          // { nickName, avatarUrl } 缓存
    this._authBtn = null;           // wx.createUserInfoButton 授权按钮
    this._authShown = false;        // 本局是否已弹出过授权按钮
    this._isNewMaster = false;      // 本局是否成为新关主（用于结算界面文案）
    this._gotCrown = false;         // 小金猪是否已显示为金色（动画完成后才置 true）
    this._earnedCrown = false;      // 本局是否达到了小金猪门槛（用于判断是否播动画）
    this._hadCrownBefore = false;   // 本局开始前是否已拥有小金猪（已获得则跳过所有皇冠逻辑）
    this._showVictoryPanel = false; // 结算面板是否可见（通关后可能先隐藏播动画）
    this._victoryAnimStart = 0;     // 结算面板入场动画起始时间
    this._victoryAnimator = PopupAnimator.createPopupAnimator();
    this._victoryClosing = false;   // 结算面板是否正在关闭动画中
    // 小金猪通关动画
    this._crownAnimPhase = null;    // null | 'flying' | 'flashing' | 'done'
    this._crownAnimStart = 0;
    this._crownFlyFromX = 0;
    this._crownFlyFromY = 0;
    // 关主获得动画（头像飞向左下角关主徽章）
    this._masterAnimPhase = null;   // null | 'flying' | 'flashing' | 'done' | 'waitingAvatar'
    this._masterAnimStart = 0;
    this._masterFlyFromX = 0;
    this._masterFlyFromY = 0;
    this._masterClaimPending = false; // _tryClaimMaster 异步请求是否还在进行
    // 关主授权对话框
    this._showAuthDialog = false;  // 是否显示授权对话框
    this._authAnimator = PopupAnimator.createPopupAnimator();
    this._skipAuthBtnRect = null;  // 跳过按钮碰撞区
    // 提示系统
    this._hintTarget = null;        // 当前被提示的猪
    this._hintTimer = null;         // 幽灵动画定时器 ID
    this._hasUsedRemove = false;    // 本局是否用过移除按钮
    this._removeBtn = null;         // 移除按钮碰撞区
  }

  /**
   * 进入关卡时统一重置所有运行时状态（仅依赖 this.levelName）。
   * 无论是 activate / restartLevel / _goNextLevel，都通过此方法保证状态干净。
   */
  _resetPlayState() {
    this.steps = 0;
    databus.currentStep = 0;
    this._victory = false;
    this._showVictoryPanel = false;
    this._victoryAnimStart = 0;
    this._victoryAnimator.close();  // 立即关闭（无动画）
    this._victoryClosing = false;
    this._resetCombo();
    this._clearHint();
    this._hasUsedRemove = false;
    // 小金猪状态
    this._hadCrownBefore = !!wx.getStorageSync('crown_' + this.levelName);
    this._gotCrown = this._hadCrownBefore;
    this._earnedCrown = false;
    // 通关动画状态
    this._crownAnimPhase = null;
    this._crownAnimStart = 0;
    this._masterAnimPhase = null;
    this._masterAnimStart = 0;
    this._masterClaimPending = false;
    // 授权/对话框状态
    this._showAuthDialog = false;
    this._authAnimator.close();  // 立即关闭（无动画）
    this._skipAuthBtnRect = null;
    this._authShown = false;
    this._destroyAuthBtn();
    // 关主
    this._isNewMaster = false;
    this._levelMaster = null;
    this._masterLoading = false;
    // 个人最好成绩
    this._myRecord = wx.getStorageSync('record_' + this.levelName) || null;
  }

  activate() {
    const lv = databus.currentLevel;
    this.levelName = lv ? lv.name : '';
    this.loadLevel(lv ? lv.data : null);
    // 关卡开始音效
    audio.play('level_start');
    this.input.on('playing', (e) => this.handleEvent(e));
    // 加载缓存的用户信息（避免每次都弹授权按钮）
    var cachedUserInfo = wx.getStorageSync('userinfo_cache');
    if (cachedUserInfo && cachedUserInfo.avatarUrl) {
      this._userInfo = cachedUserInfo;
      console.log('[关主] 从缓存加载用户信息 avatarUrl=' + (cachedUserInfo.avatarUrl ? '有' : '空') + ' nickName=' + cachedUserInfo.nickName);
    } else {
      this._userInfo = null;
    }
    // 异步获取 openid（fire-and-forget）
    this._fetchMyOpenId();
  }

  deactivate() {
    this.input.off('playing');
    this._resetCombo();
    this._destroyAuthBtn(true);  // 立即关闭，无动画
    this._isNewMaster = false;
  }

  loadLevel(data) {
    // 加载新关卡时统一重置所有运行时状态（所有入口无需单独调用）
    this._resetPlayState();
    if (data && data.board) {
      this.gp.rows = data.board.rows || data.board.cols || 5;
      this.gp.oddCols = data.board.oddCols || data.board.oddRows || 3;
      this.gp.boardWidth = data.board.boardWidth || 375;
      this.gp.boardRate = data.board.boardRate || 2.9;
    }
    this._crownSteps = (data && data.crownSteps) || 0;
    this.gp.pigs = (data && data.pigs ? data.pigs : []).map(p => ({
      id: p.id, tailIndex: p.tail, length: p.length, angle: p.angle,
      hintId: p.hintId != null ? p.hintId : null,
      hintAngle: p.hintAngle != null ? p.hintAngle : p.angle
    }));
    this.gp.dragState = null;
    this.gp.flashingPigs = {};
    this.gp.animations = [];
    this.gp.ghostAnimations = [];
    this.gp.flyingPigs = [];
    this.gp.topBarH = databus.safeTop + PADDING + TOP_BAR_H + CARD_GAP + CARD_PADDING;
    this.gp.bottomStripH = BOTTOM_BAR_H + PADDING + CARD_GAP + CARD_PADDING;
    this.gp.recomputeBoard();
    this.gp.recenterBoard();
    this.gp.snapAllPigsAngles();
    // 异步拉取关主信息
    this._fetchLevelMaster();
  }

  // ========== 输入 ==========
  handleEvent(e) {
    const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    if (!t) return;

    if (e.type === 'touchstart') {
      // 设置面板打开时，所有触控由面板处理
      if (settingsPanel.isOpen()) {
        settingsPanel.handleTouch(t.x, t.y, e.type);
        return;
      }

      // 关主授权对话框：只允许点跳过按钮，屏蔽其他触控
      if (this._showAuthDialog) {
        if (this._skipAuthBtnRect && t.x >= this._skipAuthBtnRect.x && t.x <= this._skipAuthBtnRect.x + this._skipAuthBtnRect.w &&
            t.y >= this._skipAuthBtnRect.y && t.y <= this._skipAuthBtnRect.y + this._skipAuthBtnRect.h) {
          audio.play('button_click');
          this._destroyAuthBtn();  // 内部有 close 动画 + 回调清理
        }
        return;
      }

      // 通关后、结算面板尚未显示期间：屏蔽一切触控（防止误点返回等）
      if (this._victory && !this._showVictoryPanel) return;

      // 结算面板关闭动画中：屏蔽触控
      if (this._victoryClosing) return;

      // 通关界面按钮
      if (this._victory) {
        if (this._exitBtn && t.x >= this._exitBtn.x && t.x <= this._exitBtn.x + this._exitBtn.w &&
            t.y >= this._exitBtn.y && t.y <= this._exitBtn.y + this._exitBtn.h) {
          audio.play('button_click');
          var that = this;
          this._victoryClosing = true;
          this._victoryAnimator.close(function() {
            that._victoryClosing = false;
            databus.gameState = databus.returnState || 'menu';
          });
          return;
        }
        if (this._nextBtn && t.x >= this._nextBtn.x && t.x <= this._nextBtn.x + this._nextBtn.w &&
            t.y >= this._nextBtn.y && t.y <= this._nextBtn.y + this._nextBtn.h) {
          audio.play('button_click');
          var self = this;
          this._victoryClosing = true;
          this._victoryAnimator.close(function() {
            self._victoryClosing = false;
            self._goNextLevel();
          });
          return;
        }
        return; // 屏蔽棋盘操作
      }
      this.onTouchStart(t.x, t.y);
    } else if (e.type === 'touchmove') {
      if (settingsPanel.isOpen()) return;
      if (this._showAuthDialog) return;
      if (this._victory && !this._showVictoryPanel) return;
      this.onTouchMove(t.x, t.y);
    } else if (e.type === 'touchend') {
      if (settingsPanel.isOpen()) return;
      if (this._showAuthDialog) return;
      if (this._victory && !this._showVictoryPanel) return;
      this.onTouchEnd(t.x, t.y);
    }
  }

  onTouchStart(x, y) {
    var self = this;

    // 顶栏设置按钮
    if (this.backBtn && x >= this.backBtn.x && x <= this.backBtn.x + this.backBtn.w &&
        y >= this.backBtn.y && y <= this.backBtn.y + this.backBtn.h) {
      audio.play('button_click');
      this._btnPress.press('settings');
      settingsPanel.open({
        buttons: [
          { icon: '🏠', label: '', action: function() { audio.play('button_click'); settingsPanel.close(); databus.gameState = 'menu'; } },
          { label: '继续游戏', wide: true, action: function() { audio.play('button_click'); settingsPanel.close(); } },
          { icon: '🔄', label: '', action: function() { audio.play('button_click'); settingsPanel.close(); self.restartLevel(); } },
        ]
      });
      return;
    }

    // 底部按钮
    if (this.restartBtn && x >= this.restartBtn.x && x <= this.restartBtn.x + this.restartBtn.w &&
        y >= this.restartBtn.y && y <= this.restartBtn.y + this.restartBtn.h) {
      audio.play('button_click');
      this._btnPress.press('restart');
      this.restartLevel();
      return;
    }
    if (this.hintBtn && !this._hintTarget && x >= this.hintBtn.x && x <= this.hintBtn.x + this.hintBtn.w &&
        y >= this.hintBtn.y && y <= this.hintBtn.y + this.hintBtn.h) {
      audio.play('button_click');
      this._btnPress.press('hint');
      this._showHint();
      return;
    }
    // 移除按钮
    if (this._removeBtn && x >= this._removeBtn.x && x <= this._removeBtn.x + this._removeBtn.w &&
        y >= this._removeBtn.y && y <= this._removeBtn.y + this._removeBtn.h) {
      audio.play('button_click');
      this._btnPress.press('remove');
      this._removeHintedPig();
      return;
    }

    // 关主卡片左栏点击 → 显示关主昵称
    if (this._masterAvatarRect && x >= this._masterAvatarRect.x && x <= this._masterAvatarRect.x + this._masterAvatarRect.w &&
        y >= this._masterAvatarRect.y && y <= this._masterAvatarRect.y + this._masterAvatarRect.h) {
      if (this._levelMaster) {
        var showName = this._levelMaster.masterNickname;
        if (!showName) {
          var uid = this._levelMaster.masterUserId || '';
          showName = uid.length > 6 ? '…' + uid.slice(-6) : (uid || '匿名');
        }
        audio.play('button_click');
        wx.showToast({ title: '关主：' + showName, icon: 'none', duration: 1500 });
        return;
      }
    }

    // 棋盘区域：找小猪，按下即激活拖拽
    const hit = this.gp.getPigAtPoint(x, y);
    if (hit) {
      const pig = this.gp.pigs.find(p => p.id === hit.id);
      if (pig) {
        audio.play('drag_start');
        this.gp.dragState = {
          type: 'rotate',
          pigId: pig.id,
          tailIndex: pig.tailIndex,
          displayAngle: pig.angle,
          targetAngle: pig.angle,
          lastValid: { tailIndex: pig.tailIndex, length: pig.length, angle: pig.angle },
          startState: { tailIndex: pig.tailIndex, length: pig.length, angle: pig.angle },
          headHoleIdx: -1,
          lastCollidedId: null,
          lastCollideTime: 0,
          isValidNow: true
        };
      }
    }
  }

  onTouchMove(x, y) {
    if (this.gp.dragState && this.gp.dragState.type === 'rotate') {
      // 旋转持续音效（首次播放）
      if (!this._rotateHandle) {
        this._rotateHandle = audio.playLooped('rotate_loop');
      }
      this.gp.handleRotateDrag(x, y);
    }
  }

  onTouchEnd(x, y) {
    if (!this.gp.dragState) return;

    // 停止旋转循环音效
    if (this._rotateHandle) {
      audio.stop(this._rotateHandle);
      this._rotateHandle = null;
    }

    const ds = this.gp.dragState;
    const pigId = ds.pigId;
    if (ds.type === 'rotate') {
      const pig = this.gp.pigs.find(p => p.id === pigId);
      let snapResult = false;
      if (pig && ds.lastValid) {
        // 记录松手时手指的真实方向（未受拖拽追逐/落孔修正的原始角度）
        const releaseAngle = ds.targetAngle;
        // 三点共线对齐归位
        this.gp.rebuildOccupancy();
        snapResult = this.gp.snapAlignPig(ds.tailIndex, pig.length, ds.lastValid.angle, pigId);
        if (snapResult) {
          pig.length = snapResult.length;
          pig.angle = snapResult.angle;
          this.gp.updatePigOccupancy(pigId, snapResult.tailIndex, snapResult.length, snapResult.angle);
          // 手指方向 vs 落孔方向，变化 < 阈值 → 执行逃脱
          const angleDelta = Math.min(
            Math.abs(snapResult.angle - releaseAngle),
            360 - Math.abs(snapResult.angle - releaseAngle)
          );
          this._shouldPushAfterSnap = (angleDelta < SNAP_ANGLE_PUSH_THRESHOLD);
        } else {
          // 无法对齐 → 回退到 lastValid（保持无碰撞状态）
          pig.angle = ds.lastValid.angle;
          this.gp.updatePigOccupancy(pigId, ds.tailIndex, pig.length, ds.lastValid.angle);
          this._shouldPushAfterSnap = false;
        }
      }
      this.gp.dragState = null;

      // 步数判定（3 个触发点）：
      //   1. 小猪换位后逃脱  2. 小猪未换位但逃脱  3. 小猪换位但未逃脱
      // 简化为：moved || escaped → +1
      // 判定 moved 用头孔索引（startState → snapResult）—— 比 length/angle 更可靠：
      // snapAlignPig 可能因旋转中途长度调整，对同孔位返回不同 length 值，导致误判。
      if (pig && snapResult) {
        var st = ds.startState;
        var startHeadIdx = this.gp.findHeadHole(st.tailIndex, st.length, st.angle);
        var snapHeadIdx = this.gp.findHeadHole(snapResult.tailIndex, snapResult.length, snapResult.angle);
        var moved = (snapHeadIdx !== startHeadIdx);

        console.log(
          '[步数] startState={ t:' + st.tailIndex + ' l:' + st.length + ' a:' + st.angle.toFixed(1) + ' } headIdx=' + startHeadIdx +
          ' | snapResult={ t:' + snapResult.tailIndex + ' l:' + snapResult.length + ' a:' + snapResult.angle.toFixed(1) + ' } headIdx=' + snapHeadIdx +
          ' | moved=' + moved + ' push=' + this._shouldPushAfterSnap
        );
        if (moved || this._shouldPushAfterSnap) {
          this.steps++;
          databus.currentStep = this.steps;
        }
      }
      // 自动推出时 tryPushPig 内 skipStep 防重复计步
      if (pig && this._shouldPushAfterSnap) {
        this.tryPushPig(pigId, { skipStep: true });
      }
      this._shouldPushAfterSnap = false;
    }
  }

  tryPushPig(pigId, opts) {
    opts = opts || {};
    const result = this.gp.canPushPig(pigId);
    const pig = this.gp.pigs.find(p => p.id === pigId);
    if (!pig) return;

    if (result.canPush) {
      // 逃脱音效
      audio.play('escape');

      // 记录猪头屏幕坐标（供连击浮字使用）
      const pigRect = this.gp.getPigRect(pig.tailIndex, pig.length, pig.angle);
      const headX = pigRect
        ? this.gp.boardOffsetX + pigRect.cx + pigRect.hw * pigRect.cosL
        : 0;
      const headY = pigRect
        ? this.gp.topBarH + this.gp.boardOffsetY + pigRect.cy + pigRect.hw * pigRect.sinL
        : 0;

      // 推出动画
      this.gp.animations.push({
        pigId,
        dirX: result.dirX, dirY: result.dirY,
        totalDist: result.totalDist, currentDx: 0, currentDy: 0,
        startTime: Date.now(), duration: result.totalDist / ESCAPE_SPEED * 1000
      });
      // 逻辑层立即移除（结算/计分不受动画影响）
      const idx = this.gp.pigs.findIndex(p => p.id === pigId);
      this.gp.flyingPigs.push(this.gp.pigs[idx]);
      this.gp.pigs.splice(idx, 1);
      this.gp.clearPigOccupancy(pigId);
      // 如果推出的是提示目标 → 清除提示
      if (this._hintTarget && this._hintTarget.id === pigId) {
        this._clearHint();
      }
      if (!opts.skipStep) { this.steps++; databus.currentStep = this.steps; }

      // 连击系统 ——— 每次逃脱触发
      this._triggerCombo();

      // 所有猪都逃脱 → 通关
      if (this.gp.pigs.length === 0) {
        // 结算开始，面板就绪但先隐藏
        this._markCleared();
        this._victory = true;
        setTimeout(() => {
          if (this._earnedCrown) {
            this._startCrownAnimation();
          } else {
            this._afterCrownDone();
          }
        }, 1000);
      }
      // 动画结束后清理渲染层
      setTimeout(() => {
        this.gp.flyingPigs = this.gp.flyingPigs.filter(p => p.id !== pigId);
        this.gp.animations = this.gp.animations.filter(a => a.pigId !== pigId);
      }, 6500);
    } else if (result.collidedPigId !== undefined) {
      if (!opts.silentBlock) {
        this.gp.triggerCollisionEffect(result.collidedPigId);
        audio.play('collide');
      }
    }
  }

  restartLevel() {
    audio.play('reset');
    this.loadLevel(databus.currentLevel ? databus.currentLevel.data : null);
  }

  _markCleared() {
    console.log('[关主] _markCleared called, level=' + this.levelName + ' steps=' + this.steps);
    // 推进 lastLevelIndex：通关后无论点"退出"还是"下一关"，下次"开始游戏"都进下一关
    var currentIdx = databus.currentLevelIndex;
    var savedRaw = wx.getStorageSync('lastLevelIndex');
    var savedIdx = (savedRaw !== '' && savedRaw !== undefined && savedRaw !== null) ? parseInt(savedRaw, 10) : -1;
    if (currentIdx >= 0 && currentIdx >= savedIdx) {
      var nextIdx = currentIdx + 1;
      if (nextIdx < databus.projectLevels.length) {
        wx.setStorageSync('lastLevelIndex', nextIdx);
        console.log('[关主] lastLevelIndex 推进到 ' + nextIdx);
      }
    }
    // 小金猪：已获得过则跳过，不再重复检查/写存储/播动画
    if (this._hadCrownBefore) {
      // 仍设 _gotCrown=true 确保渲染显示金色（重玩场景）
      this._gotCrown = true;
      this._earnedCrown = false;
    } else if (this._crownSteps > 0 && this.steps <= this._crownSteps) {
      wx.setStorageSync('crown_' + this.levelName, true);
      this._earnedCrown = true;
      this._gotCrown = false;  // 动画期间保持灰色
      console.log('[小金猪] 获得！' + this.levelName + ' ' + this.steps + '/' + this._crownSteps + '步');
    } else {
      this._earnedCrown = false;
      this._gotCrown = false;
      console.log('[小金猪] 未获得 ' + this.levelName + ' ' + this.steps + '/' + (this._crownSteps || '?') + '步');
    }
    // 尝试夺关主（试玩模式/用过移除则跳过）
    if (!this._hasUsedRemove && databus.returnState !== 'editor') {
      this._masterClaimPending = true;
      this._tryClaimMaster();
    } else {
      console.log('[关主] 使用了移除按钮，跳过关主判定');
    }
    // 异步同步到云端（fire-and-forget，不阻塞 UI）
    this._syncToCloud();
  }

  _syncToCloud() {
    try {
      var lastLevelIndex = wx.getStorageSync('lastLevelIndex');
      var info = wx.getStorageSync('userinfo_cache') || {};
      // 收集已获得小金猪的关卡列表
      var crowns = [];
      try {
        var infoRes = wx.getStorageInfoSync();
        if (infoRes.keys) {
          for (var i = 0; i < infoRes.keys.length; i++) {
            var k = infoRes.keys[i];
            if (k.indexOf('crown_') === 0) {
              var v = wx.getStorageSync(k);
              if (v === true || v === 'true') {
                crowns.push(k.replace('crown_', ''));
              }
            }
          }
        }
      } catch (e1) {}
      cloud.savePlayerData({
        lastLevelIndex: lastLevelIndex,
        crowns: crowns,
        avatarUrl: info.avatarUrl || '',
        nickname: info.nickName || ''
      }).then(function() {
        console.log('[Cloud] 玩家数据已同步到云端');
      }).catch(function(err) {
        console.warn('[Cloud] 同步失败（非阻塞）:', err && err.message);
      });
    } catch (e2) {
      console.warn('[Cloud] _syncToCloud 异常:', e2);
    }
  }

  _goNextLevel() {
    const idx = databus.currentLevelIndex + 1;
    if (idx >= databus.projectLevels.length) {
      // 已是最后一关，回到关卡选择
      databus.gameState = databus.returnState || 'levelSelect';
      return;
    }
    const next = databus.projectLevels[idx];
    try {
      const fs = wx.getFileSystemManager();
      const raw = fs.readFileSync(`assets/levels/${next.file}`, 'utf8');
      const data = JSON.parse(raw);
      databus.currentLevel = { name: next.name, data };
      databus.currentLevelIndex = idx;
      this.levelName = next.name;
      this.loadLevel(data);
    } catch (err) {
      console.warn(`[Playing] 加载下一关 ${next.file} 失败:`, err);
    }
  }

  // ========== 关主系统 ==========

  // 加载远程头像图片（通过 downloadFile 获取本地路径，兼容性更好）
  _loadAvatarImage(url) {
    return new Promise(function(resolve, reject) {
      wx.downloadFile({
        url: url,
        success: function(res) {
          if (res.statusCode === 200) {
            var img = wx.createImage();
            img.onload = function() { resolve(img); };
            img.onerror = function() { reject(new Error('image onerror')); };
            img.src = res.tempFilePath;
          } else {
            reject(new Error('download status ' + res.statusCode));
          }
        },
        fail: function(err) { reject(err); }
      });
    });
  }

  // 获取当前用户 openid（仅首次调用）
  _fetchMyOpenId() {
    if (this._myOpenId) return;
    const cloud = require('../cloud.js');
    cloud.getOpenId().then(function(openid) {
      this._myOpenId = openid;
      console.log('[关主] myOpenId=' + openid);
    }.bind(this)).catch(function(err) {
      console.warn('[关主] getOpenId fail:', err);
    });
  }

  _fetchLevelMaster() {
    if (this._masterLoading) return;
    this._masterLoading = true;
    const cloud = require('../cloud.js');
    console.log('[关主] _fetchLevelMaster start levelName=' + JSON.stringify(this.levelName));
    cloud.getLevelInfo(this.levelName)
      .then(master => {
        console.log('[关主] _fetchLevelMaster success master=' + JSON.stringify(master));
        this._levelMaster = master;
        this._masterLoading = false;
        if (master) {
          if (!master.masterNickname) console.log('[关主] 云端记录缺少 masterNickname');
          if (!master.masterAvatarUrl) console.log('[关主] 云端记录缺少 masterAvatarUrl');
        }
        if (master && master.masterAvatarUrl) {
          this._loadAvatarImage(master.masterAvatarUrl).then(function(img) {
            console.log('[关主] avatar image loaded');
            if (this._levelMaster) this._levelMaster.avatarImg = img;
          }.bind(this)).catch(function(err) {
            console.warn('[关主] avatar image load error:', err);
          });
        }
      })
      .catch(err => {
        console.warn('[关主] _fetchLevelMaster fail:', err);
        this._levelMaster = null;
        this._masterLoading = false;
      });
  }

  /**
 * 尝试夺位成为当前关卡的关主。仅在真机环境下执行，模拟器/开发工具自动跳过。
 * 若当前步数少于关主最少步数，则异步获取用户信息后调用云函数上报夺位；
 * 持平或更多步数时不夺位。夺位成功后刷新本地关主数据并加载头像，失败时静默处理。
 * @returns {void} 异步流程，无同步返回值
 */
_tryClaimMaster() {
    // 仅真机上报，模拟器/开发工具跳过
    // if (wx.getDeviceInfo().platform === 'devtools') {
    //   console.log('[关主] 开发环境跳过夺位上报');
    //   this._masterClaimPending = false;
    //   return;
    // }
    const currentMin = this._levelMaster ? this._levelMaster.masterSteps : 9999;
    this._updateMyRecord();
    if (this.steps >= currentMin) {
      this._masterClaimPending = false;
      return; // 持平不夺
    }

    // 先异步获取用户信息，拿到结果后再决定是否弹出授权对话框（避免两路并行）
    this._getUserInfo().then(userInfo => {
      const hasAvatar = !!userInfo.avatarUrl;

      // 只有 wx.getUserInfo 返回匿名信息时才弹出授权对话框
      if (!hasAvatar) {
        this._showMasterAuthButton();
      }

      const cloud = require('../cloud.js');
      console.log('[关主] _tryClaimMaster 后台上报 avatarUrl=' + (userInfo.avatarUrl ? '有' : '空') + ' nickName=' + userInfo.nickName);
      cloud.claimLevelMaster(this.levelName, this.steps, userInfo.avatarUrl || '', userInfo.nickName || '')
        .then(res => {
          this._masterClaimPending = false;
          if (res.code === 0) {
            this._levelMaster = res.master;
            if (res.master && res.master.masterAvatarUrl) {
              this._loadAvatarImage(res.master.masterAvatarUrl).then(function(img) {
                if (this._levelMaster) this._levelMaster.avatarImg = img;
              }.bind(this)).catch(function(err) {
                console.warn('[关主] claim avatar load error:', err);
              });
            }
            if (res.claimed) {
              // 标记为新关主，结算界面显示恭喜文案
              this._isNewMaster = true;
              // 仅在小金猪动画已完成时，才标记等待头像加载（小金猪未开始时由 _afterCrownDone 统一调度）
              if (this._victory && this._crownAnimPhase === 'done' && !this._masterAnimPhase) {
                this._masterAnimPhase = 'waitingAvatar';
              }
            } else {
              // 服务器说没夺到（别人步数更少或持平不同人）→ 撤回授权按钮
              console.log('[关主] 服务器返回 claimed=false，撤回授权按钮');
              this._destroyAuthBtn();
            }
          }
        })
        .catch(err => {
          this._masterClaimPending = false;
          console.warn('[关主] claimLevelMaster 失败，撤回授权按钮:', err);
          this._destroyAuthBtn();
        });
    });
  }

  _getUserInfo() {
    if (this._userInfo) return Promise.resolve(this._userInfo);
    return new Promise(function(resolve) {
      wx.getUserInfo({
        withCredentials: false,
        success: function(res) {
          var info = res.userInfo || {};
          var nick = info.nickName || '';
          var avatar = info.avatarUrl || '';
          // 新版微信出于隐私保护不返回真实头像/昵称 → 降级用 openid 生成
          if (!nick && this._myOpenId) {
            nick = '玩家' + this._myOpenId.slice(-4);
          }
          this._userInfo = { nickName: nick, avatarUrl: avatar };
          // 持久化，避免每次新关卡都弹授权
          wx.setStorageSync('userinfo_cache', this._userInfo);
          resolve(this._userInfo);
        }.bind(this),
        fail: function() {
          var nick = '';
          if (this._myOpenId) nick = '玩家' + this._myOpenId.slice(-4);
          this._userInfo = { nickName: nick, avatarUrl: '' };
          // 降级方案也持久化，防止反复弹授权
          wx.setStorageSync('userinfo_cache', this._userInfo);
          resolve(this._userInfo);
        }.bind(this)
      });
    }.bind(this));
  }

  // 销毁授权按钮（切换关卡或退出时清理）
  _destroyAuthBtn(instant) {
    if (this._authBtn) {
      try { this._authBtn.destroy(); } catch (e) {}
      this._authBtn = null;
    }
    if (instant || this._authAnimator.isClosed()) {
      // 立即关闭（deactivate 等场景无需动画）
      this._showAuthDialog = false;
      this._skipAuthBtnRect = null;
      this._authAnimator.close();
    } else {
      // 使用关闭动画
      var that = this;
      this._authAnimator.close(function() {
        that._showAuthDialog = false;
        that._skipAuthBtnRect = null;
      });
    }
  }

  // 乐观 UI：通关后弹出授权对话框（Canvas 绘制），
  // 内嵌原生授权按钮获取真实头像昵称并重传关主信息
  _showMasterAuthButton() {
    if (this._authShown) return;
    this._authShown = true;

    // 计算对话框面板与按钮坐标（与 _renderAuthDialog 保持一致）
    var ph = 200;
    var py = (SCREEN_HEIGHT - ph) / 2 - 20;

    // 两个按钮并排居中
    var btnW = 100, btnH = 44, gap = 20;
    var totalBtnW = btnW * 2 + gap;
    var btnStartX = (SCREEN_WIDTH - totalBtnW) / 2;
    var btnY = py + 130;

    // 跳过按钮碰撞区（Canvas 点击处理）
    this._skipAuthBtnRect = { x: btnStartX + btnW + gap, y: btnY, w: btnW, h: btnH };

    // 显示 Canvas 对话框
    this._showAuthDialog = true;
    this._authAnimator.open();

    // 原生授权按钮：覆盖在 Canvas 绘制的"授权"按钮上方（透明背景）
    var that = this;
    console.log('[关主] _showMasterAuthButton 弹出授权对话框 level=' + this.levelName + ' steps=' + this.steps);
    this._authBtn = wx.createUserInfoButton({
      type: 'text',
      text: '',
      style: {
        left: btnStartX,
        top: btnY,
        width: btnW,
        height: btnH,
        lineHeight: btnH,
        backgroundColor: 'rgba(0,0,0,0.01)',
        color: 'rgba(0,0,0,0.01)',
        textAlign: 'center',
        fontSize: 1,
        borderRadius: 10,
      }
    });

    this._authBtn.onTap(function(res) {
      console.log('[关主] 授权按钮 onTap 触发，res keys:', res ? Object.keys(res).join(',') : 'null');
      var info = (res && res.userInfo) ? res.userInfo : {};
      console.log('[关主] onTap userInfo:', JSON.stringify(info).substring(0, 200));
      if (info.nickName || info.avatarUrl) {
        console.log('[关主] onTap 获取到真实头像昵称，开始重传关主');
        that._userInfo = { nickName: info.nickName || '', avatarUrl: info.avatarUrl || '' };
        wx.setStorageSync('userinfo_cache', that._userInfo);
        console.log('[关主] 已缓存用户信息 avatarUrl=' + (that._userInfo.avatarUrl ? '有' : '空') + ' nickName=' + that._userInfo.nickName);
        var cloud = require('../cloud.js');
        cloud.claimLevelMaster(that.levelName, that.steps, info.avatarUrl || '', info.nickName || '')
          .then(function(result) {
            console.log('[关主] onTap claimLevelMaster 返回 code=' + (result ? result.code : 'null') + ' claimed=' + (result ? result.claimed : 'null') + ' msg=' + (result ? result.msg : ''));
            if (result && result.code === 0) {
              that._levelMaster = result.master;
              if (result.master && result.master.masterAvatarUrl) {
                that._loadAvatarImage(result.master.masterAvatarUrl).then(function(img) {
                  if (that._levelMaster) that._levelMaster.avatarImg = img;
                }).catch(function() {});
              }
            }
          })
          .catch(function(err) {
            console.warn('[关主] onTap claimLevelMaster 失败:', err);
          });
      } else {
        console.log('[关主] onTap 未获取到真实头像昵称（用户可能拒绝授权）');
      }
      that._authBtn.destroy();
      that._authBtn = null;
      // 关闭对话框（带弹出动画）
      that._authAnimator.close(function() {
        that._showAuthDialog = false;
        that._skipAuthBtnRect = null;
      });
    });
  }

  _updateMyRecord() {
    var prev = wx.getStorageSync('record_' + this.levelName);
    if (prev == null || prev === '' || this.steps < parseInt(prev)) {
      console.log('[关主] _updateMyRecord saving: ' + this.levelName + ' steps=' + this.steps + ' prev=' + JSON.stringify(prev));
      wx.setStorageSync('record_' + this.levelName, this.steps);
      this._myRecord = this.steps;
    }
  }

  _renderMasterBadge() {
    var cardX = this._boardCardX;
    var cardY = this._boardCardY;
    var cardH = this._boardCardH;

    // 诊断：每60帧打印一次
    if (!this._badgeLogFrame) this._badgeLogFrame = 0;
    this._badgeLogFrame++;

    var badgeW = 165;
    var badgeH = 70;
    var badgeX = 5;
    var badgeY = SCREEN_HEIGHT - badgeH-5;

    // 半透明白底 + 浅粉边框 + 微弱阴影
    ctx.save();
    ctx.shadowColor = 'rgba(161, 150, 181, 0.08)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    this._roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 14);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(252, 233, 242, 1)';
    ctx.lineWidth = 1;
    this._roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 14);
    ctx.stroke();
    ctx.restore();

    // === 左栏：关主信息 ===
    var leftCx = badgeX + 30; // 左栏中心 X
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    // 标签
    var badgeMasterY = badgeY + 11;
    var isMe = this._levelMaster && this._myOpenId && this._levelMaster.masterUserId === this._myOpenId;
    ctx.fillStyle = isMe ? '#EC4899' : '#334155';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText(isMe ? '我是关主' : '关主记录', leftCx, badgeMasterY);

    if (this._levelMaster) {
      // 头像（圆形裁剪）
      var badgeHeadY = badgeMasterY + 12;
      // 关主动画期间控制头像渲染
      if (this._masterAnimPhase === 'flying') {
        // 飞行动画中：头像不在此处显示（由 _renderFlyingMaster 绘制）
      } else if (this._masterAnimPhase === 'flashing') {
        // 闪烁阶段：平滑正弦脉冲
        var flashElapsed = Date.now() - this._masterAnimStart;
        var flashAlpha = 0.6 + 0.4 * Math.sin(flashElapsed * 0.015);
        ctx.save();
        ctx.globalAlpha = flashAlpha;
        ctx.beginPath();
        ctx.arc(leftCx, badgeHeadY + 18, 18, 0, Math.PI * 2);
        ctx.clip();
        if (this._levelMaster.avatarImg) {
          ctx.drawImage(this._levelMaster.avatarImg, leftCx - 18, badgeHeadY, 36, 36);
        } else {
          ctx.fillStyle = '#FCE9F2';
          ctx.fillRect(leftCx - 18, badgeHeadY, 36, 36);
        }
        ctx.restore();
      } else {
        ctx.save();
        ctx.beginPath();
        ctx.arc(leftCx, badgeHeadY + 18, 18, 0, Math.PI * 2);
        ctx.clip();
        if (this._levelMaster.avatarImg) {
          ctx.drawImage(this._levelMaster.avatarImg, leftCx - 18, badgeHeadY, 36, 36);
        } else {
          // 头像未加载完成 → 粉色占位
          ctx.fillStyle = '#FCE9F2';
          ctx.fillRect(leftCx - 18, badgeHeadY, 36, 36);
        }
        ctx.restore();
      }
      
      // 关主步数
      var badgStepY = badgeHeadY + 35;
      var recText = '' + this._levelMaster.masterSteps + '步';

      // 画背景矩形
      var textWidth = ctx.measureText(recText).width;
      var paddingH = 6;
      var paddingV = 3;
      var radius = 4;

      // 画圆角背景
      ctx.fillStyle = '#FFE066';
      ctx.globalAlpha = 0.5;  
      _roundRect(ctx, leftCx - paddingH - textWidth/2, badgStepY - paddingV, 
                textWidth + paddingH * 2, 12 + paddingV * 2, radius);
      ctx.fill();
      ctx.globalAlpha = 1.0;  

      // 再画文字
      ctx.fillStyle = '#334155';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillText(recText, leftCx, badgStepY);

      function _roundRect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r);
        ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
      }
    } else {
      // 无管主 → 显示「无」
      ctx.fillStyle = '#94A3B8';
      ctx.font = '11px sans-serif';
      ctx.fillText('无人通关', leftCx, badgeY + 35);
    }

    // === 分隔线 ===
    var divX = badgeX + 62;
    // 记录左栏点击区域（用于点击显示关主昵称）
    this._masterAvatarRect = { x: badgeX, y: badgeY, w: divX - badgeX, h: badgeH };
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(divX, badgeY + 14);
    ctx.lineTo(divX, badgeY + badgeH - 14);
    ctx.stroke();

    // === 右栏：我的信息 ===
    var rightX = divX + 8;
    ctx.textAlign = 'left';

    // 我的记录
    ctx.fillStyle = '#334155';
    ctx.font = '12px sans-serif';
    var recText = this._myRecord != null ? ('我的:' + this._myRecord + '步') : '我的:无';
    ctx.fillText(recText, rightX, badgeY + 11);

    // 当前步数（金色强调）
    ctx.fillStyle = '#F59E0B';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('当前步数:' + this.steps + '步', rightX, badgeY + 36);

    ctx.textAlign = 'center'; // 复位
  }

  // ========== 小金猪 ==========
  _renderCrownWidget() {
    if (databus.returnState === 'editor') return; // 试玩模式不显示

    // 位置：底部与 combo 连击图底部（棋盘卡片上边缘）对齐
    var cx = this._boardCardX + this._boardCardW - 36;
    var cy = this._boardCardY - 25;
    var radius = 20;
    var lineW = 2;
    var hasThreshold = this._crownSteps > 0; // 是否配置了皇冠阈值

    // 飞行动画中：灰色猪留守原位，金色猪由 _renderCrownAnimation 单独绘制
    if (this._crownAnimPhase === 'flying') {
      drawPigIcon(ctx, cx, cy, 21, false);
      return;
    }
    // 闪烁阶段：原位猪交替灰/金（金色猪已到达）
    if (this._crownAnimPhase === 'flashing') {
      var flashElapsed = Date.now() - this._crownAnimStart;
      // 平滑正弦脉冲：在 0.2~1.0 之间柔和呼吸
      var flashAlpha = 0.6 + 0.4 * Math.sin(flashElapsed * 0.015);
      drawPigIcon(ctx, cx, cy, 21, true, flashAlpha);
      return;
    }

    // 已获得（从存储恢复或动画完成后）：直接显示金色猪，无进度环
    if (this._gotCrown) {
      drawPigIcon(ctx, cx, cy, 21, true);
      return;
    }

    // 无皇冠阈值：仅显示灰色猪图标，无进度环和步数
    if (!hasThreshold) {
      drawPigIcon(ctx, cx, cy, 21, false);
      return;
    }

    // 有阈值、游戏中未获得：显示进度环 + 灰色猪 + 剩余步数
    var remaining = this._crownSteps - this.steps;
    if (remaining < 0) remaining = 0;
    var progress = remaining / this._crownSteps;

    // 底色圆环
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = lineW;
    ctx.stroke();

    // 进度弧（从上方向顺时针消耗）
    if (progress > 0) {
      var arcColor = progress > 0.33 ? '#F59E0B' : '#EF4444';
      ctx.beginPath();
      ctx.arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
      ctx.strokeStyle = arcColor;
      ctx.lineWidth = lineW;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.lineCap = 'butt';
    }

    // 小金猪图标（游戏中始终灰色，通关后获得才变金）
    drawPigIcon(ctx, cx, cy, 21, false);

    // 剩余步数
    ctx.font = 'bold 12px sans-serif';
    ctx.fillStyle = '#94A3B8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('' + remaining + ' 步', cx, cy + radius);
  }

  // ========== 小金猪通关动画 ==========

  _startCrownAnimation() {
    this._crownAnimPhase = 'flying';
    this._crownAnimStart = Date.now();
    audio.play('rewards');
    // 飞行动画起点：棋盘中心
    this._crownFlyFromX = this._boardCardX + this._boardCardW / 2;
    this._crownFlyFromY = this._boardCardY + this._boardCardH / 2;
  }

  _renderCrownAnimation() {
    if (!this._crownAnimPhase) return;

    var elapsed = Date.now() - this._crownAnimStart;

    if (this._crownAnimPhase === 'flying') {
      this._renderFlyingPig(elapsed);
      if (elapsed >= 1500) {
        // 飞行结束 → 进入闪烁阶段
        this._crownAnimPhase = 'flashing';
        this._crownAnimStart = Date.now();
      }
      return;
    }

    if (this._crownAnimPhase === 'flashing') {
      if (elapsed >= 800) {
        // 闪烁结束 → 小金猪变金，然后检查是否还有关主动画
        this._crownAnimPhase = 'done';
        this._gotCrown = true;
        this._crownAnimStart = 0;
        this._afterCrownDone();
      }
      return;
    }
  }

  _renderFlyingPig(elapsed) {
    var t = Math.min(elapsed / 1500, 1);
    t = Easing.easeOutCubic(t);
    var startX = this._crownFlyFromX;
    var startY = this._crownFlyFromY;
    var targetX = this._boardCardX + this._boardCardW - 36;
    var targetY = this._boardCardY - 25;
    // 弧线控制点：中点上方偏移，形成向上抛出的弧线
    var cpX = (startX + targetX) / 2;
    var cpY = Math.min(startY, targetY) - 80;
    // 二次贝塞尔曲线
    var t1 = 1 - t;
    var fx = t1 * t1 * startX + 2 * t1 * t * cpX + t * t * targetX;
    var fy = t1 * t1 * startY + 2 * t1 * t * cpY + t * t * targetY;
    // 飞行中略大一点，更有冲击力
    var scale = 30 + (21 - 30) * t; // 从 30 → 21 渐缩
    drawPigIcon(ctx, fx, fy, scale, true, 1);
  }

  // ========== 关主获得动画（头像飞向左下角关主徽章）==========

  /**
   * 小金猪动画完成后调用。检查是否需要播放关主动画，
   * 若不需要则直接进入结算序列。
   */
  _afterCrownDone() {
    if (this._isNewMaster && this._levelMaster && this._levelMaster.avatarImg) {
      this._startMasterAnimation();
    } else if (this._isNewMaster) {
      // 关主已确认但头像未加载，等待
      this._masterAnimPhase = 'waitingAvatar';
    } else if (this._masterClaimPending) {
      // 关主判定请求还在进行中，等一下
      this._masterAnimPhase = 'waitingAvatar';
    } else {
      this._finishVictorySequence();
    }
  }

  _startMasterAnimation() {
    this._masterAnimPhase = 'flying';
    this._masterAnimStart = Date.now();
    audio.play('rewards');
    // 飞行动画起点：屏幕中心
    this._masterFlyFromX = SCREEN_WIDTH / 2;
    this._masterFlyFromY = SCREEN_HEIGHT / 2;
  }

  _renderMasterAnimation() {
    if (!this._masterAnimPhase || this._masterAnimPhase === 'done') return;

    // 等待头像加载完成（或等待关主判定结果）
    if (this._masterAnimPhase === 'waitingAvatar') {
      // 关主判定已完成且未夺到 → 跳过动画，直接结算
      if (!this._masterClaimPending && !this._isNewMaster) {
        this._masterAnimPhase = 'done';
        this._finishVictorySequence();
        return;
      }
      // 关主已确认且头像已加载 → 开始动画
      if (this._isNewMaster && this._levelMaster && this._levelMaster.avatarImg) {
        this._startMasterAnimation();
      }
      return;
    }

    var elapsed = Date.now() - this._masterAnimStart;

    if (this._masterAnimPhase === 'flying') {
      this._renderFlyingMaster(elapsed);
      if (elapsed >= 1500) {
        this._masterAnimPhase = 'flashing';
        this._masterAnimStart = Date.now();
      }
      return;
    }

    if (this._masterAnimPhase === 'flashing') {
      if (elapsed >= 800) {
        this._masterAnimPhase = 'done';
        this._masterAnimStart = 0;
        this._finishVictorySequence();
      }
      return;
    }
  }

  _renderFlyingMaster(elapsed) {
    var t = Math.min(elapsed / 1500, 1);
    t = Easing.easeOutCubic(t);
    var startX = this._masterFlyFromX;
    var startY = this._masterFlyFromY;
    // 目标：关主徽章中头像圆心 (badgeX+30, SCREEN_HEIGHT-34)
    var targetX = 35;
    var targetY = SCREEN_HEIGHT - 34;
    // 弧线控制点：中点上方偏移，形成向上抛出的弧线
    var cpX = (startX + targetX) / 2;
    var cpY = Math.min(startY, targetY) - 80;
    // 二次贝塞尔曲线
    var t1 = 1 - t;
    var fx = t1 * t1 * startX + 2 * t1 * t * cpX + t * t * targetX;
    var fy = t1 * t1 * startY + 2 * t1 * t * cpY + t * t * targetY;
    // 飞行中略大，渐缩到目标尺寸 36
    var scale = 60 + (36 - 60) * t;

    if (this._levelMaster && this._levelMaster.avatarImg) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(fx, fy, scale / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(this._levelMaster.avatarImg, fx - scale / 2, fy - scale / 2, scale, scale);
      ctx.restore();
    }
  }

  /**
   * 所有通关动画（小金猪+关主）播放完毕，显示结算面板。
   */
  _finishVictorySequence() {
    this._showVictoryPanel = true;
    this._victoryAnimStart = Date.now();
    this._victoryAnimator.open();
    audio.play('victory');
  }

  // ========== 渲染（Ardot 设计稿驱动，fileId: 694583967818218）==========
  render() {
    const safeTop = databus.safeTop;

    // 计算布局参数
    this._boardCardX = PADDING;
    this._boardCardY = safeTop + PADDING + TOP_BAR_H + CARD_GAP - 30;
    this._boardCardW = SCREEN_WIDTH - PADDING * 2;
    this._bottomBarY = SCREEN_HEIGHT - BOTTOM_BAR_H - PADDING;
    this._boardCardH = this._bottomBarY - CARD_GAP - this._boardCardY;

    // 1. 棋盘卡片背景
    this._drawBoardCard();

    // 2. 棋盘主体
    this.gp.topBarH = this._boardCardY + CARD_PADDING;
    this.gp.bottomStripH = BOTTOM_BAR_H + PADDING + CARD_GAP + CARD_PADDING;
    this.gp.renderBoard(ctx, { hintPigId: this._hintTarget ? this._hintTarget.id : null });

    // 3. 连击组件（棋盘卡片内左上角）
    this._renderComboWidget();

    // 3.5 关主卡片（棋盘卡片内左下角）— 试玩时隐藏
    if (databus.returnState !== 'editor') {
      this._renderMasterBadge();
    }

    // 3.8 小金猪（右上角圆形进度条）
    this._renderCrownWidget();

    // 3.9 小金猪通关动画（飞行/闪烁阶段）
    this._renderCrownAnimation();

    // 3.10 关主获得动画（头像飞行/闪烁阶段）
    this._renderMasterAnimation();

    // 4. 顶栏
    this._drawTopBar(safeTop);

    // 5. 底部栏
    this._drawBottomBar();

    // 6. 通关弹窗（结算面板已就绪，等动画播完或用小金猪才显示）
    if (this._victory && this._showVictoryPanel) {
      this.renderVictoryOverlay();
    }

    // 7. 关主授权对话框（顶层的 Canvas 弹窗）
    if (this._showAuthDialog) {
      this._renderAuthDialog();
    }

    // 8. 设置面板（最顶层）
    settingsPanel.render(ctx);
  }

  _drawBoardCard() {
    const x = this._boardCardX;
    const y = this._boardCardY;
    const w = this._boardCardW;
    const h = this._boardCardH;

    ctx.save();
    // Claymorphism 外阴影 rgba(161, 150, 181, 0.2) offset(12,12) blur 24
    ctx.shadowColor = 'rgba(161, 150, 181, 0.2)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetX = 12;
    ctx.shadowOffsetY = 12;
    // 白色卡片
    ctx.fillStyle = '#FFFFFF';
    this._roundRect(ctx, x, y, w, h, CARD_RADIUS);
    ctx.fill();
    ctx.restore();

    // 内高光 — 白色半透明描边模拟 inset shadow rgba(255,255,255,0.8) offset(-8,-8)
    ctx.save();
    ctx.beginPath();
    this._roundRectPath(ctx, x, y, w, h, CARD_RADIUS);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = 3;
    this._roundRect(ctx, x + 2, y + 2, w - 6, h - 6, CARD_RADIUS - 1);
    ctx.stroke();
    ctx.restore();
  }

  _drawTopBar(safeTop) {
    const barY = safeTop;
    const barW = this._boardCardW;

    // === 设置按钮（左上角，齿轮图标）===
    const backW = 49, backH = 47;
    const backX = PADDING;
    const backY = PADDING;
    this.backBtn = { x: backX, y: backY, w: backW, h: backH };

    // 按压微交互缩放
    var setScale = this._btnPress.getScale('settings');
    var setCX = backX + backW / 2;
    var setCY = backY + backH / 2;

    ctx.save();
    ctx.translate(setCX, setCY);
    ctx.scale(setScale, setScale);
    ctx.translate(-setCX, -setCY);

    // 白色半透明底 + 圆角 18
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    this._roundRect(ctx, backX, backY, backW, backH, 18);
    ctx.fill();
    // 齿轮图标（矢量绘制）
    settingsPanel.drawGearIcon(ctx, backX + backW / 2, backY + backH / 2, 17, DARK);
    ctx.restore(); // 按压缩放

    // === 关卡徽章（居中）— 试玩时隐藏 ===
    if (databus.returnState !== 'editor') {
    const levelText = "第 "+(parseInt(this.levelName)|| '\u7B2C 1 \u5173') +" 关";
    ctx.font = 'bold 20px sans-serif';
    const levelTW = ctx.measureText(levelText).width;
    const levelW = levelTW + 16; // 8px padding each side
    const levelH = 33;
    const levelX = PADDING + (barW - levelW) / 2;
    const levelY = barY + (TOP_BAR_H - levelH) / 2;

    ctx.fillStyle = PINK;
    this._roundRect(ctx, levelX, levelY, levelW, levelH, 12);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(levelText, levelX + levelW / 2, levelY + levelH / 2);
    }
  }

  _drawBottomBar() {
    const barY = this._bottomBarY;
    const barW = this._boardCardW;
    const btnW = 46, btnH = 36;
    const gap = 12;

    // === 重置按钮（最右）===
    const resetX = PADDING + barW - btnW;
    const btnY = barY + (BOTTOM_BAR_H - btnH) / 2;
    this.restartBtn = { x: resetX, y: btnY, w: btnW, h: btnH };

    var rstScale = this._btnPress.getScale('restart');
    var rstCX = resetX + btnW / 2;
    var rstCY = btnY + btnH / 2;
    ctx.save();
    ctx.translate(rstCX, rstCY);
    ctx.scale(rstScale, rstScale);
    ctx.translate(-rstCX, -rstCY);

    this._whiteBtn(resetX, btnY, btnW, btnH);
    ctx.fillStyle = RED;
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('\u91CD\u7F6E', resetX + btnW / 2, btnY + btnH / 2);
    ctx.restore();

    // === 提示按钮 ===
    var hintX = resetX - btnW - gap;
    this.hintBtn = { x: hintX, y: btnY, w: btnW, h: btnH };

    var hintScale = this._btnPress.getScale('hint');
    var hintCX = hintX + btnW / 2;
    var hintCY = btnY + btnH / 2;
    ctx.save();
    ctx.translate(hintCX, hintCY);
    ctx.scale(hintScale, hintScale);
    ctx.translate(-hintCX, -hintCY);

    var hintDisabled = !!this._hintTarget;
    this._whiteBtn(hintX, btnY, btnW, btnH);
    ctx.fillStyle = hintDisabled ? 'rgba(139,92,246,0.3)' : PURPLE;
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('\u63D0\u793A', hintX + btnW / 2, btnY + btnH / 2);
    ctx.restore();

    // === 移除按钮（提示激活时出现）===
    if (this._hintTarget) {
      var removeX = hintX - btnW - gap;
      this._removeBtn = { x: removeX, y: btnY, w: btnW, h: btnH };

      var rmvScale = this._btnPress.getScale('remove');
      var rmvCX = removeX + btnW / 2;
      ctx.save();
      ctx.translate(rmvCX, btnY + btnH / 2);
      ctx.scale(rmvScale, rmvScale);
      ctx.translate(-rmvCX, -(btnY + btnH / 2));

      this._whiteBtn(removeX, btnY, btnW, btnH);
      ctx.fillStyle = '#FF5252';
      ctx.font = 'bold 13px sans-serif';
      ctx.fillText('\u79FB\u9664', removeX + btnW / 2, btnY + btnH / 2);
      ctx.restore();
    } else {
      this._removeBtn = null;
    }
  }

  _whiteBtn(x, y, w, h) {
    ctx.save();
    // 按钮阴影 rgba(161,150,181,0.15) offset(4,4) blur 12
    ctx.shadowColor = 'rgba(161, 150, 181, 0.15)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetX = 4;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = '#FFFFFF';
    this._roundRect(ctx, x, y, w, h, 16);
    ctx.fill();
    ctx.restore();
  }

  // ============================================================
  // 提示系统
  // ============================================================
  _showHint() {
    if (this._hintTarget) return; // 已经有提示进行中

    // 找出未逃脱 + 有 hintId 的猪中，hintId 最小的
    var best = null;
    for (var i = 0; i < this.gp.pigs.length; i++) {
      var p = this.gp.pigs[i];
      if (p.hintId == null) continue;
      if (!best || p.hintId < best.hintId) best = p;
    }
    if (!best) {
      wx.showToast({ title: '提示已结束', icon: 'none', duration: 1500 });
      return;
    }
    audio.play('hint_reveal');
    this._hintTarget = best;
    this._startGhostTimer();
  }

  _startGhostTimer() {
    if (this._hintTimer) clearInterval(this._hintTimer);
    this._hintTimer = setInterval(this._playGhostAnimation.bind(this), 2000);
    this._playGhostAnimation(); // 立即播一次
  }

  _playGhostAnimation() {
    if (!this._hintTarget) return;
    var pig = this._hintTarget;
    // 确保猪还在（未被移除）
    if (this.gp.pigs.indexOf(pig) < 0) return;
    var ha = pig.hintAngle != null ? pig.hintAngle : pig.angle;
    var r = this.gp.getPigRect(pig.tailIndex, pig.length, ha);
    if (!r) return;

    var rad = ha * Math.PI / 180;
    var dirX = Math.cos(rad), dirY = -Math.sin(rad);
    // 距离和正常逃脱相同（100 × collisionStep），幽灵速度 = GHOST_SPEED
    var totalDist = 100 * this.gp.collisionStep;
    this.gp.ghostAnimations.push({
      pigId: pig.id,
      hintAngle: ha,
      dirX: dirX, dirY: dirY,
      totalDist: totalDist, currentDx: 0, currentDy: 0,
      startTime: Date.now(), duration: totalDist / GHOST_SPEED * 1000
    });
  }

  _removeHintedPig() {
    if (!this._hintTarget) return;
    var pig = this._hintTarget;
    // 从棋盘移除（不急步数）
    var idx = this.gp.pigs.indexOf(pig);
    if (idx >= 0) {
      this.gp.pigs.splice(idx, 1);
      this.gp.clearPigOccupancy(pig.id);
    }
    this._hasUsedRemove = true;
    this._clearHint();

    // 所有猪都消失 → 通关
    if (this.gp.pigs.length === 0) {
      this._markCleared();
      this._victory = true;
      setTimeout(function() {
        if (this._earnedCrown) {
          this._startCrownAnimation();
        } else {
          this._afterCrownDone();
        }
      }.bind(this), 1000);
    }
    wx.showToast({ title: '已移除', icon: 'none', duration: 1000 });
  }

  _clearHint() {
    if (this._hintTimer) {
      clearInterval(this._hintTimer);
      this._hintTimer = null;
    }
    this.gp.ghostAnimations = [];
    this._hintTarget = null;
  }

  _roundRect(ctx, x, y, w, h, r) {
    this._roundRectPath(ctx, x, y, w, h, r);
    ctx.closePath();
  }

  _roundRectPath(ctx, x, y, w, h, r) {
    // 防止半径超过矩形宽/高的一半，避免 arcTo 坐标异常导致图形越界
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
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

  // ========== 通关界面 ==========
  // ========== 结算面板（弹簧入场 + 元素错开动画）==========
  renderVictoryOverlay() {
    const now = Date.now();
    const elapsed = now - this._victoryAnimStart;

    // 驱动 PopupAnimator 获取 scale/alpha/maskAlpha
    var state = this._victoryAnimator.update();

    // 如果正在关闭且动画已结束
    if (this._victoryClosing && this._victoryAnimator.isClosed()) {
      this._victoryClosing = false;
    }

    var maskAlpha = state.maskAlpha;

    ctx.fillStyle = 'rgba(0, 0, 0, ' + maskAlpha.toFixed(3) + ')';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    // === 面板 spring 弹入 ===
    var panelScale = state.scale;
    var panelAlpha = state.alpha;

    if (panelAlpha < 0.01) return;

    // === 计算布局（与原来一致）===
    const hasCombo = this._maxCombo >= 2;
    const isNewMaster = this._isNewMaster;
    const hasCrown = this._earnedCrown;

    var ph = 200;
    if (hasCombo) ph += 20;
    if (isNewMaster) ph += 22;
    if (hasCrown) ph += 22;
    const pw = 260;
    const px = (SCREEN_WIDTH - pw) / 2;
    const py = (SCREEN_HEIGHT - ph) / 2 - 20;

    ctx.save();
    ctx.globalAlpha = panelAlpha;

    // 缩放变换（围绕面板中心）
    const pCenterX = px + pw / 2;
    const pCenterY = py + ph / 2;
    ctx.translate(pCenterX, pCenterY);
    ctx.scale(panelScale, panelScale);
    ctx.translate(-pCenterX, -pCenterY);

    // 面板背景
    ctx.fillStyle = 'rgba(26, 26, 46, 0.95)';
    this._roundRect(ctx, px, py, pw, ph, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 215, 0, 0.5)';
    ctx.lineWidth = 2;
    this._roundRect(ctx, px, py, pw, ph, 16);
    ctx.stroke();

    // === 元素错开渲染 ===
    const STAGGER_START = 80;   // 第一个元素开始时间 (ms)
    const STAGGER_INTERVAL = 55; // 每个元素间隔 (ms)

    // 辅助函数：计算单个元素的动画进度
    const _elAnim = (delayMs) => {
      const t = Math.max(0, Math.min(1, (elapsed - delayMs) / 280));
      const s = Easing.spring(t * 3.5, 200, 11);
      return { alpha: s, scale: 0.6 + 0.4 * s };
    };

    var staggerIdx = 0;

    // --- 标题（独立 spring，稍快）---
    const titleAnim = _elAnim(0);
    ctx.save();
    ctx.globalAlpha = titleAnim.alpha;
    const titleCX = SCREEN_WIDTH / 2;
    const titleCY = py + 44;
    ctx.translate(titleCX, titleCY);
    ctx.scale(titleAnim.scale, titleAnim.scale);
    ctx.translate(-titleCX, -titleCY);
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('通关成功！', titleCX, titleCY);
    ctx.restore();

    // --- 步数 ---
    staggerIdx++;
    const stepsAnim = _elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL);
    ctx.save();
    ctx.globalAlpha = stepsAnim.alpha;
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`共 ${this.steps} 步`, SCREEN_WIDTH / 2, py + 78);
    ctx.restore();

    // --- 最大连击 ---
    var nextY = py + 78;
    if (hasCombo) {
      staggerIdx++;
      const comboAnim = _elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL);
      ctx.save();
      ctx.globalAlpha = comboAnim.alpha;
      ctx.fillStyle = '#FF9800';
      ctx.font = 'bold 15px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`🔥 最大连击 ${this._maxCombo}`, SCREEN_WIDTH / 2, py + 112);
      ctx.restore();
      nextY = py + 112;
    }

    // --- 新关主 ---
    if (isNewMaster) {
      staggerIdx++;
      const masterAnim = _elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL);
      ctx.save();
      ctx.globalAlpha = masterAnim.alpha;
      ctx.fillStyle = '#FFD700';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('👑 恭喜你成为新的关主！', SCREEN_WIDTH / 2, nextY + 22);
      ctx.restore();
      nextY = nextY + 22;
    }

    // --- 小金猪 ---
    if (hasCrown) {
      staggerIdx++;
      const crownAnim = _elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL);
      ctx.save();
      ctx.globalAlpha = crownAnim.alpha;
      ctx.fillStyle = '#FBBF24';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🐷 获得小金猪！', SCREEN_WIDTH / 2, nextY + 22);
      ctx.restore();
      nextY = nextY + 22;
    }

    // --- 按钮（最后两个元素并排，同批次但分别缩放）---
    const btnY = nextY + 34;
    const btnW = 100, btnH = 42;
    const gap = 20;
    const totalBtnW = btnW * 2 + gap;
    const btnStartX = (SCREEN_WIDTH - totalBtnW) / 2;

    // 退出按钮
    staggerIdx++;
    const exitAnim = _elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL + 20);
    const exitX = btnStartX;
    this._exitBtn = { x: exitX, y: btnY, w: btnW, h: btnH };
    ctx.save();
    ctx.globalAlpha = exitAnim.alpha;
    const exitCX = exitX + btnW / 2;
    const exitCY = btnY + btnH / 2;
    ctx.translate(exitCX, exitCY);
    ctx.scale(exitAnim.scale, exitAnim.scale);
    ctx.translate(-exitCX, -exitCY);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    this._roundRect(ctx, exitX, btnY, btnW, btnH, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var exitLabel = databus.returnState === 'editor' ? '返回编辑' : '退出';
    ctx.fillText(exitLabel, exitCX, exitCY);
    ctx.restore();

    // 下一关按钮（比退出按钮再晚 40ms）
    if (databus.returnState !== 'editor') {
      staggerIdx++;
      const nextAnim = _elAnim(STAGGER_START + staggerIdx * STAGGER_INTERVAL + 60);
      const nextX = btnStartX + btnW + gap;
      const hasNext = databus.currentLevelIndex + 1 < databus.projectLevels.length;
      this._nextBtn = { x: nextX, y: btnY, w: btnW, h: btnH };
      ctx.save();
      ctx.globalAlpha = nextAnim.alpha;
      const nextCX = nextX + btnW / 2;
      ctx.translate(nextCX, btnY + btnH / 2);
      ctx.scale(nextAnim.scale, nextAnim.scale);
      ctx.translate(-nextCX, -(btnY + btnH / 2));
      ctx.fillStyle = hasNext ? '#4CAF50' : 'rgba(76, 175, 80, 0.3)';
      this._roundRect(ctx, nextX, btnY, btnW, btnH, 8);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(hasNext ? '下一关' : '已完成', nextCX, btnY + btnH / 2);
      ctx.restore();
    } else {
      this._nextBtn = null;
    }

    ctx.restore();
  }

  // ========== 关主授权对话框（Canvas 弹窗，匹配通关面板风格）==========
  _renderAuthDialog() {
    // 驱动 PopupAnimator
    var state = this._authAnimator.update();

    // 动画结束 → 检查是否需要清理
    if (this._authAnimator.isClosed()) return;

    var maskAlpha = state.maskAlpha;
    var scale = state.scale;
    var alpha = state.alpha;

    if (alpha < 0.01) return;

    // 半透明遮罩
    ctx.fillStyle = 'rgba(0, 0, 0, ' + maskAlpha.toFixed(3) + ')';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    var pw = 260;
    var ph = 200;
    var px = (SCREEN_WIDTH - pw) / 2;
    var py = (SCREEN_HEIGHT - ph) / 2 - 20;

    ctx.save();
    ctx.globalAlpha = alpha;

    // 缩放变换
    var pCenterX = px + pw / 2;
    var pCenterY = py + ph / 2;
    ctx.translate(pCenterX, pCenterY);
    ctx.scale(scale, scale);
    ctx.translate(-pCenterX, -pCenterY);

    // 面板背景 + 金色边框
    ctx.fillStyle = 'rgba(26, 26, 46, 0.95)';
    this._roundRect(ctx, px, py, pw, ph, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 215, 0, 0.5)';
    ctx.lineWidth = 2;
    this._roundRect(ctx, px, py, pw, ph, 16);
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 标题
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('👑 恭喜你成为关主！', SCREEN_WIDTH / 2, py + 44);

    // 说明文字
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.font = '14px sans-serif';
    ctx.fillText('授权后可显示你的头像和昵称', SCREEN_WIDTH / 2, py + 85);

    // 两个按钮并排
    var btnW = 100, btnH = 44, gap = 20;
    var totalBtnW = btnW * 2 + gap;
    var btnStartX = (SCREEN_WIDTH - totalBtnW) / 2;
    var btnY = py + 130;

    // 授权按钮（金色 — 原生 wx.createUserInfoButton 覆盖在上方）
    ctx.fillStyle = '#FFD700';
    this._roundRect(ctx, btnStartX, btnY, btnW, btnH, 10);
    ctx.fill();
    ctx.fillStyle = '#1a1a2e';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText('授权', btnStartX + btnW / 2, btnY + btnH / 2);

    // 跳过按钮（灰色）
    var skipX = btnStartX + btnW + gap;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
    this._roundRect(ctx, skipX, btnY, btnW, btnH, 10);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '14px sans-serif';
    ctx.fillText('跳过', skipX + btnW / 2, btnY + btnH / 2);

    ctx.restore();
  }

  // ========== 连击系统 ==========
  _resetCombo() {
    this._comboCount = 0;
    if (this._comboTimer) { clearTimeout(this._comboTimer); this._comboTimer = null; }
    this._maxCombo = 0;
    this._comboStartTime = 0;
    this._comboWidget = { visible: false, count: 0, bumpStart: 0 };
    // 强制复位 animator（如果有挂起的 close 回调则忽略）
    if (this._comboAnimator && this._comboAnimator.getPhase() !== 'closed') {
      this._comboAnimator.close(function() {}); // 静默关闭
    }
  }

  _triggerCombo() {
    this._comboCount++;
    if (this._comboCount > this._maxCombo) this._maxCombo = this._comboCount;
    this._comboStartTime = Date.now();

    // 重置窗口计时器
    if (this._comboTimer) clearTimeout(this._comboTimer);
    this._comboTimer = setTimeout(() => {
      this._comboCount = 0;
      this._comboWidget.count = 0;
      this._comboTimer = null;
      // 关闭动画 → 回调中隐藏
      var that = this;
      this._comboAnimator.close(function() {
        // 只有当前没有新连击才真正隐藏（防止竞态）
        if (that._comboCount === 0) {
          that._comboWidget.visible = false;
        }
      });
    }, COMBO_WINDOW);

    // 2 连及以上才展示组件 + 连击音效
    const w = this._comboWidget;
    if (this._comboCount >= 2) {
      if (!w.visible) {
        // 首次显示：弹出动画
        w.visible = true;
        w.count = this._comboCount;
        this._comboAnimator.open();
      } else {
        // 已可见：如果正在关闭动画中，取消关闭、重新弹出
        if (this._comboAnimator.getPhase() === 'closing') {
          this._comboAnimator.open();
        }
        w.count = this._comboCount;
        w.bumpStart = Date.now(); // 递增弹跳
      }
    }
  }

  _renderComboWidget() {
    const w = this._comboWidget;
    if (!w.visible) return;

    const now = Date.now();
    const anim = this._comboAnimator.update();

    // animator 已关闭则不再渲染
    if (this._comboAnimator.getPhase() === 'closed') return;

    const remaining = COMBO_WINDOW - (now - this._comboStartTime);
    const progress = Math.max(0, Math.min(1, remaining / COMBO_WINDOW));  // 1.0 → 0.0

    // 用 animator 统一驱动 scale + alpha（打开/关闭都走 spring）
    // 递增弹跳 bump：连击数+1 时短暂 1.0→1.08→1.0（150ms easeOutCubic）
    var bumpMult = 1;
    if (w.bumpStart > 0) {
      var bumpAge = now - w.bumpStart;
      if (bumpAge < 150) {
        var bt = bumpAge / 150;
        bumpMult = 1 + 0.08 * Easing.easeOutCubic(1 - Math.abs(bt * 2 - 1));
      } else {
        w.bumpStart = 0;
      }
    }
    const useScale = anim.scale * bumpMult;
    const useAlpha = anim.alpha;

    // 进度条颜色
    let barColor;
    if (progress > 0.75) {
      barColor = COMBO_COLOR_SAFE;
    } else if (progress > 0.5) {
      barColor = COMBO_COLOR_WARN;
    } else {
      barColor = COMBO_COLOR_DANGER;
    }

    // 计算位置
    const wx = 0;
    const wy = this._boardCardY - COMBO_WIDGET_H;
    const barWidth = COMBO_WIDGET_W * progress;

    ctx.save();
    ctx.globalAlpha = useAlpha;

    // 缩放变换（围绕组件中心）
    const centerX = wx + COMBO_WIDGET_W / 2;
    const centerY = wy + COMBO_WIDGET_H / 2;
    ctx.translate(centerX, centerY);
    ctx.scale(useScale, useScale);
    ctx.translate(-centerX, -centerY);

    // 1. 容器背景 — 主题粉 5%（最底层）
    ctx.fillStyle = 'rgba(236, 72, 153, 0.05)';
    ctx.beginPath();
    this._roundRectPath(ctx, wx + 0.5, wy + 0.5, COMBO_WIDGET_W, COMBO_WIDGET_H, COMBO_WIDGET_R);
    ctx.fill();

    // 2. 暗色占位槽（进度条空余部分）
    ctx.fillStyle = 'rgba(61, 61, 92, 0.12)';
    ctx.beginPath();
    this._roundRectPath(ctx, wx + 0.5, wy + 0.5, COMBO_WIDGET_W, COMBO_WIDGET_H, COMBO_WIDGET_R);
    ctx.fill();

    // 3. 进度条填充（从右向左收拢 — clip 到容器圆角内确保不越界）
    ctx.save();
    ctx.beginPath();
    this._roundRectPath(ctx, wx + 0.5, wy + 0.5, COMBO_WIDGET_W, COMBO_WIDGET_H, COMBO_WIDGET_R);
    ctx.clip();
    ctx.fillStyle = barColor;
    ctx.fillRect(wx, wy, barWidth, COMBO_WIDGET_H);
    ctx.restore();

    // 4. 文字（居中覆盖）
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('连击 X', wx + 10, wy + COMBO_WIDGET_H / 2 + 2);

    // 数字用金色
    const labelW = ctx.measureText('连击 X').width;
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText(String(w.count), wx + 10 + labelW + 2, wy + COMBO_WIDGET_H / 2 + 2);

    ctx.restore();
  }
}

module.exports = PlayingEngine;
