// 关卡游玩引擎 — 组合 GameplayEngine 实现正式玩法

const databus = require('../databus.js');
const cloud = require('../cloud.js');
const audio = require('../audio/AudioManager.js');
const settingsPanel = require('../ui/SettingsPanel.js');
const ButtonPress = require('../anim/ButtonPress.js');
const PopupAnimator = require('../ui/PopupAnimator.js');
const { ctx, SCREEN_WIDTH, SCREEN_HEIGHT } = require('../render.js');
const GameplayEngine = require('../core/GameplayEngine.js');

// === UI 层 ===
const Theme = require('../ui/Theme.js');
const UIManager = require('../ui/UIManager.js');
const BoardCard = require('../ui/widgets/BoardCard.js');
const TopBar = require('../ui/widgets/TopBar.js');
const BottomBar = require('../ui/widgets/BottomBar.js');
const MasterPanel = require('../ui/widgets/MasterPanel.js');
const VictoryPopup = require('../ui/widgets/VictoryPopup.js');
const AuthDialog = require('../ui/widgets/AuthDialog.js');
const ComboWidget = require('../ui/widgets/ComboWidget.js');
const ComboSystem = require('./ComboSystem.js');
const MasterSystem = require('./MasterSystem.js');
const HintSystem = require('./HintSystem.js');
const VictoryAnimation = require('./VictoryAnimation.js');
const CrownPigWidget = require('../ui/widgets/CrownPigWidget.js');
const GuideManager = require('../guide/GuideManager.js');
const GoldSystem = require('./GoldSystem.js');

// 矩形碰撞检测辅助
function _hitRect(px, py, rect) {
  if (!rect) return false;
  return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}

// 布局常量（来自 Ardot 设计稿 375×812）
const TOP_BAR_H = 48;
const BOTTOM_BAR_H = 90;
const PADDING = 16;         // 内容区外边距
const CARD_GAP = 8;         // 卡片之间的间距
const CARD_PADDING = 12;    // 棋盘卡片内边距

const ESCAPE_SPEED = 120;  // 正常逃脱速度（逻辑像素/秒）

const SNAP_ANGLE_PUSH_THRESHOLD = 45;
const COMBO_WINDOW = 3000;             // 连击窗口（毫秒）

class PlayingEngine {
  constructor(input) {
    this.input = input;
    this.gp = new GameplayEngine();
    this.levelName = '';
    this.steps = 0;
    this.backBtn = null;
    this.hintBtn = null;       // 提示按钮
    this._btnPress = new ButtonPress();
    this._victory = false;
    this._exitBtn = null;
    this._nextBtn = null;
    // 连击系统
    this._combo = new ComboSystem(COMBO_WINDOW);
    // 关主系统
    this._master = new MasterSystem(this._loadAvatarImage.bind(this));
    // 提示系统
    this._hint = new HintSystem(this.gp);
    // 引导系统
    this._guide = new GuideManager(this);
    this._guide.register(new (require('../guide/Guide1.js'))());
    this._guide.register(new (require('../guide/Guide2.js'))());
    // 通关飞行特效动画
    this._victoryAnim = new VictoryAnimation({
      onCrownDone: function () {
        this._gotCrown = true;
        this._checkMasterAfterCrown();
      }.bind(this),
      onMasterDone: function () {
        this._finishVictorySequence();
      }.bind(this),
    });
    this._masterAnimWaiting = false; // _checkMasterAfterCrown 未就绪时为 true（每帧轮询）
    this._gotCrown = false;         // 小金猪是否已显示为金色（动画完成后才置 true）
    this._earnedCrown = false;      // 本局是否达到了小金猪门槛（用于判断是否播动画）
    this._hadCrownBefore = false;   // 本局开始前是否已拥有小金猪（已获得则跳过所有皇冠逻辑）
    this._showVictoryPanel = false; // 结算面板是否可见（通关后可能先隐藏播动画）
    this._victoryAnimStart = 0;     // 结算面板入场动画起始时间
    this._victoryAnimator = PopupAnimator.createPopupAnimator();
    this._victoryClosing = false;   // 结算面板是否正在关闭动画中
    // 关主授权对话框
    this._authBtn = null;           // wx.createUserInfoButton 授权按钮
    this._authShown = false;        // 本局是否已弹出过授权按钮
    this._showAuthDialog = false;  // 是否显示授权对话框
    this._authAnimator = PopupAnimator.createPopupAnimator();
    this._skipAuthBtnRect = null;  // 跳过按钮碰撞区
    this._hasUsedRemove = false;    // 本局是否用过移除按钮
    this._removeBtn = null;         // 移除按钮碰撞区
    this._loading = false;          // 是否正在加载（云端拉取中，阻止所有操作）
    this._lastFrameTime = 0;        // 上一帧时间戳（引导系统 dt 计算用）
    this._cloudFetchedData = new Map();  // 本次会话已拉取过的云端关卡数据 { name → data }
    // 断点续玩
    this._checkpointTimer = null;   // 30秒存档定时器
    this._levelVersion = 0;         // 当前关卡版本号
    this._pendingResume = false;    // 是否待恢复存档
    this._lastSavedSteps = -1;      // 上次存档时的步数（用于脏检测）
    this._lastSavedPigCount = -1;   // 上次存档时的猪数量（用于脏检测）
    // 金币奖励
    this._pendingGoldReward = false; // 是否有待领取的金币奖励
    this._goldAmount = 0;           // 本次通关奖励金币数
  }

  /**
   * 进入关卡时统一重置所有运行时状态（仅依赖 this.levelName）。
   * 由 loadLevel() 内部调用，所有入口通过 startLevel → _loadAndStart → loadLevel 保证状态干净。
   */
  _resetPlayState() {
    this.steps = 0;
    databus.currentStep = 0;
    this._victory = false;
    this._showVictoryPanel = false;
    this._victoryAnimStart = 0;
    this._victoryAnimator.close();  // 立即关闭（无动画）
    this._victoryClosing = false;
    this._combo.reset();
    this._hint.clear();
    this._guide.reset();
    this._lastFrameTime = 0;       // 防止切关卡时 dt 突增
    this._hasUsedRemove = false;
    this._pendingResume = false;    // 防御：每次重置关卡状态都清理恢复标志
    // 小金猪状态
    this._hadCrownBefore = !!wx.getStorageSync('crown_' + this.levelName);
    this._gotCrown = this._hadCrownBefore;
    this._earnedCrown = false;
    // 通关动画状态
    this._victoryAnim.reset();
    this._masterAnimWaiting = false;
    // 授权/对话框状态
    this._showAuthDialog = false;
    this._authAnimator.close();  // 立即关闭（无动画）
    this._skipAuthBtnRect = null;
    this._authShown = false;
    this._destroyAuthBtn();
    // 金币奖励状态
    this._pendingGoldReward = false;
    this._goldAmount = 0;
    // 试玩逃脱序列记录（供编辑器提示数据自动生成）
    this._trialEscapeSequence = [];
    this._trialUsedRemove = false;
    // 关主状态重置 + 读取个人记录
    this._master.reset();
    this._master.init(this.levelName);
  }

  // ========== UI 层初始化（UIManager 组件注册）==========
  _setupUI() {
    var self = this;

    try {
      // 创建 UIManager
      if (this.ui) this.ui.clear();
      this.ui = new UIManager(Theme);
      this.ui.screenWidth = SCREEN_WIDTH;
      this.ui.screenHeight = SCREEN_HEIGHT;

      // Layer 0 — BoardCard（棋盘白色卡片背景）
      this._uiBoardCard = new BoardCard({ zIndex: UIManager.LAYER.BOARD_CARD });
      this.ui.add(this._uiBoardCard, UIManager.LAYER.BOARD_CARD);

      // Layer 1 — MasterPanel（关主面板，数据后填）
      this._uiMasterPanel = new MasterPanel({
        zIndex: UIManager.LAYER.INFO,
        onAvatarClick: function () {
          var master = self._master.getMaster();
          if (master && master.nickname) {
            wx.showToast({ title: master.nickname, icon: 'none', duration: 2000 });
          }
        },
      });
      this.ui.add(this._uiMasterPanel, UIManager.LAYER.INFO);

      // Layer 1 — ComboWidget（自管理 PopupAnimator）
      this._uiComboWidget = new ComboWidget({
        zIndex: UIManager.LAYER.INFO,
      });
      this._combo.setWidget(this._uiComboWidget);
      this.ui.add(this._uiComboWidget, UIManager.LAYER.INFO);

      // Layer 1 — CrownPigWidget
      this._uiCrownPig = new CrownPigWidget({
        zIndex: UIManager.LAYER.INFO,
      });
      this.ui.add(this._uiCrownPig, UIManager.LAYER.INFO);

      // Layer 2 — TopBar
      this._uiTopBar = new TopBar({
        zIndex: UIManager.LAYER.CONTROL,
        buttonPress: this._btnPress,
        mode: databus.returnState === 'editor' ? 'trial' : 'normal',
        onBack: function () {
          if (databus.returnState === 'editor') {
            databus.gameState = 'editor';
          } else if (settingsPanel.isOpen()) {
            settingsPanel.close();
          } else {
            audio.play('button_click');
            settingsPanel.open({
              buttons: [
                { icon: '🏠', label: '', action: function() { audio.play('button_click'); settingsPanel.close(); databus.gameState = 'menu'; } },
                { label: '继续游戏', wide: true, action: function() { audio.play('button_click'); settingsPanel.close(); } },
                { icon: '🔄', label: '', action: function() { audio.play('button_click'); settingsPanel.close(); self.restartLevel(); } },
              ]
            });
          }
        },
      });
      this.ui.add(this._uiTopBar, UIManager.LAYER.CONTROL);

      // Layer 2 — BottomBar
      this._uiBottomBar = new BottomBar({
        zIndex: UIManager.LAYER.CONTROL,
        cardW: SCREEN_WIDTH - PADDING * 2,
        buttonPress: this._btnPress,
        onHintClick: function () {
          var best = self._hint.show();
          if (best) {
            audio.play('hint_reveal');
          } else {
            wx.showToast({ title: '提示已结束', icon: 'none', duration: 1500 });
          }
        },
        onRemoveClick: function () { self._removeHintedPig(); },
      });
      this.ui.add(this._uiBottomBar, UIManager.LAYER.CONTROL);

      // Layer 4 — VictoryPopup
      this._uiVictoryPopup = new VictoryPopup({
        zIndex: UIManager.LAYER.MODAL,
        onContinue: function () { self._onContinueClick(); },
        onReplay: function () { self.restartLevel(); },
        onExit: function () { databus.gameState = databus.returnState || 'menu'; },
        onDoubleGold: function () { self._onDoubleGoldClick(); },
      });
      this._uiVictoryPopup.setAnimator(this._victoryAnimator);
      this.ui.add(this._uiVictoryPopup, UIManager.LAYER.MODAL);

      // Layer 4 — AuthDialog
      this._uiAuthDialog = new AuthDialog({
        zIndex: UIManager.LAYER.MODAL,
      });
      this._uiAuthDialog.setAnimator(this._authAnimator);
      this.ui.add(this._uiAuthDialog, UIManager.LAYER.MODAL);

      // Layer 4 — GoldRewardPopup（通关后金币奖励，VictoryPopup 之上）
    } catch (e) {
      // 初始化失败：清空所有引用，确保 render() 的 guard 能兜底
      console.error('[PlayingEngine] _setupUI 失败:', e);
      this.ui = null;
      this._uiBoardCard = null;
      this._uiMasterPanel = null;
      this._uiComboWidget = null;
      this._uiCrownPig = null;
      this._uiTopBar = null;
      this._uiBottomBar = null;
      this._uiVictoryPopup = null;
      this._uiAuthDialog = null;
    }
  }

  /** 每帧更新 UI 层数据（引擎 → UI 组件单向数据流） */
  _syncUIData() {
    if (!this._uiBoardCard) return;  // 第一个创建的组件，作为哨兵

    // BoardCard 位置
    this._uiBoardCard.updatePosition(
      this._boardCardX, this._boardCardY,
      this._boardCardW, this._boardCardH
    );

    // TopBar 位置 + 内容
    this._uiTopBar.setBounds(0, databus.safeTop, this._boardCardW, Theme.layout.topBarH);
    this._uiTopBar.setLevelText('第 ' + (parseInt(this.levelName) || '1') + ' 关');
    this._uiTopBar.setMode(databus.returnState === 'editor' ? 'trial' : 'normal');

    // BottomBar
    this._uiBottomBar.setHintActive(this._hint.isActive());

    // MasterPanel
    this._uiMasterPanel.setHiddenByTrial(databus.returnState === 'editor');
    this._uiMasterPanel.setMyUserId(this._master.getMyOpenId());
    var master = this._master.getMaster();
    this._uiMasterPanel.setData(
      master,
      this._master.getMyRecord(),
      this.steps,
      this._master.isLoading()
    );
    var avatarImg = this._master.getAvatarImg();
    if (avatarImg) {
      this._uiMasterPanel.setAvatar(avatarImg);
    }

    // ComboWidget — 仅同步位置（计数/动画由 ComboWidget 内部管理）
    this._uiComboWidget.updatePosition(this._boardCardY);

    // CrownPigWidget
    this._uiCrownPig.setHidden(databus.returnState === 'editor');
    this._uiCrownPig.setData(this._crownSteps, this.steps, this._gotCrown);
    this._uiCrownPig.setAnimPhase(this._victoryAnim.isActive() ? 'flying' : 'idle');
    this._uiCrownPig.setCenter(this._boardCardX + this._boardCardW - 30, this._boardCardY - 25);

    // VictoryPopup
    this._uiVictoryPopup.setData({
      steps: this.steps,
      maxCombo: this._combo.getMaxCombo(),
      isNewMaster: this._master.isNewMaster(),
      hasCrown: this._earnedCrown,
      returnState: databus.returnState || 'menu',
      goldAmount: this._goldAmount,
      showGold: this._pendingGoldReward,
    });
    this._uiVictoryPopup.visible = this._victory && this._showVictoryPanel;

    // AuthDialog
    this._uiAuthDialog.visible = this._showAuthDialog;
  }

  /**
   * 关卡统一入口——所有路径（关卡列表进入、重玩、下一关）都走这里。
   * 模块内部负责：反初始化旧关卡 → 搭建UI → 解析关卡数据（缓存→云端→本地）→ 加载关卡。
   */
  startLevel(name, opts) {
    opts = opts || {};

    // 0. 如果当前有关卡在运行，先反初始化
    if (this.levelName) {
      this.input.off('playing');
      this._combo.reset();
      this._guide.reset();
      this._destroyAuthBtn(true);
    }

    // 0.5 保存恢复标志（异步加载完成后处理）
    if (opts.resume) {
      this._pendingResume = true;
    }

    // 1. 保存关卡标识
    this.levelName = name;

    // 2. 搭建 UI（棋盘空白，玩家可见框架）
    this._setupUI();

    // 3. 解析关卡数据
    this._loading = true;
    var self = this;

    // 试玩模式：直接用编辑器提供的关卡数据，不拉云端（新建关卡云端没有）
    if (databus.returnState === 'editor' && databus.currentLevel && databus.currentLevel.data) {
      console.log('[Playing] 试玩模式，使用编辑器关卡数据');
      self._loadAndStart(databus.currentLevel.data);
    } else if (self._cloudFetchedData.has(name)) {
      // 本次会话已拉取过，直接走缓存
      var cached = self._cloudFetchedData.get(name);
      console.log('[Playing] ' + name + ' 已缓存，直接加载');
      self._loadAndStart(cached);
    } else {
      // 首次加载：走云端 downloadLevel，失败则降级本地文件
      console.log('[Playing] startLevel name=' + name + ' 从云端拉取...');
      var TIMEOUT_MS = 5000;
      var pullPromise = cloud.downloadLevel(null, name, true);
      var timeoutPromise = new Promise(function(_, reject) {
        setTimeout(function() { reject(new Error('timeout')); }, TIMEOUT_MS);
      });

      Promise.race([pullPromise, timeoutPromise])
        .then(function(result) {
          if (result && result.data) {
            if (result.data.crownSteps == null && result.crownSteps != null) {
              result.data.crownSteps = result.crownSteps;
            }
            self._cloudFetchedData.set(name, result.data);
            console.log('[Cloud] 已发布关卡 ' + name + ' 拉取成功，使用云端配置');
            self._loadAndStart(result.data);
          } else {
            console.log('[Cloud] 关卡 ' + name + ' 未发布，尝试本地文件');
            self._loadAndStart(self._readLocalLevel(name));
          }
        })
        .catch(function(err) {
          console.log('[Cloud] 关卡拉取失败（' + (err && err.message) + '），尝试本地文件');
          self._loadAndStart(self._readLocalLevel(name));
        });
    }

    // 4. 音效、输入、关主系统（不依赖关卡数据）
    audio.play('level_start');
    this.input.on('playing', function(e) { self.handleEvent(e); });
    this._master.loadUserInfo();
    this._master.fetchMyOpenId();
  }

  /** 读取本地关卡文件，失败返回 null */
  _readLocalLevel(name) {
    try {
      var fs = wx.getFileSystemManager();
      var raw = fs.readFileSync('assets/levels/' + name + '.json', 'utf8');
      var data = JSON.parse(raw);
      console.log('[Playing] 本地关卡 ' + name + '.json 读取成功');
      return data;
    } catch(e) {
      console.warn('[Playing] 本地无 ' + name + '.json');
      return null;
    }
  }

  /** loadLevel + 恢复 _loading。data 为 null 时销毁关卡并返回主菜单 */
  _loadAndStart(data) {
    if (!data) {
      console.warn('[Playing] 关卡数据加载失败（云端+本地均无），返回主菜单');
      this._loading = false;
      wx.showToast({ title: '关卡数据加载失败', icon: 'none', duration: 2000 });
      databus.gameState = 'menu';
      return;
    }
    this.loadLevel(data);
    this._loading = false;
    // 重置脏检测基准（确保首轮一定写入）
    this._lastSavedSteps = -1;
    this._lastSavedPigCount = -1;
    // 恢复存档（如果有）
    if (this._pendingResume) {
      this._pendingResume = false;
      this._doResume();
    } else {
      // 非恢复进入：清理旧存档（避免残留上一关数据）
      this._clearCheckpoint();
    }
    // 启动 10 秒存档定时器（放在清存档之后，避免被 _clearCheckpoint 误杀）
    this._startCheckpointTimer();
  }

  activate() {
    var name = databus.currentLevel ? databus.currentLevel.name : '';

    // 试玩模式：跳过存档自检 + 清理旧存档，强制使用编辑器数据
    if (databus.returnState === 'editor') {
      console.log('[LOG] activate 试玩模式，跳过存档自检，清理旧存档');
      this._clearCheckpoint();
      this.startLevel(name, { resume: false });
      return;
    }

    // 自检：外部未设 _checkpointResume 时，主动读取存档（杀进程重启场景）
    if (!databus._checkpointResume) {
      var cp;
      try { cp = wx.getStorageSync('game_checkpoint'); } catch (e) { cp = null; }
      if (cp && cp.levelName === name) {
        console.log('[LOG] activate自检: 发现存档 level=' + name + ' step=' + cp.steps + '，设置恢复标记');
        databus._checkpointResume = true;
      }
    }
    var resume = !!databus._checkpointResume;
    if (resume) databus._checkpointResume = false;
    this.startLevel(name, { resume: resume });
  }

  deactivate() {
    this.input.off('playing');
    this._combo.reset();
    this._guide.reset();         // 退出关卡时强制结束引导
    this._destroyAuthBtn(true);  // 立即关闭，无动画
    this._clearCheckpoint();     // 任何退出关卡路径都清理存档
  }

  loadLevel(data) {
    console.log('[Playing] loadLevel pigCount=' + (data && data.pigs ? data.pigs.length : 0) + ' pigIds=' + (data && data.pigs ? data.pigs.map(function(p){return p.id}).join(',') : 'none'));
    // 加载新关卡时统一重置所有运行时状态（所有入口无需单独调用）
    this._resetPlayState();
    if (data && data.board) {
      this.gp.rows = data.board.rows || data.board.cols || 5;
      this.gp.oddCols = data.board.oddCols || data.board.oddRows || 3;
      this.gp.boardWidth = data.board.boardWidth || 375;
      this.gp.boardRate = data.board.boardRate || 2.9;
    }
    this._crownSteps = (data && data.crownSteps) || 0;
    this._levelVersion = (data && data.version) || 0;
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
    this._master.fetchMaster();
  }

  // ========== 输入 ==========
  handleEvent(e) {
    // 加载中：阻止所有用户操作（云端关卡拉取中）
    if (this._loading) return;

    var self = this;
    const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    if (!t) return;

    if (e.type === 'touchstart') {
      // === UIManager 优先路由 ===
      // 设置面板打开时，所有触控由面板处理
      if (settingsPanel.isOpen()) {
        settingsPanel.handleTouch(t.x, t.y, e.type);
        return;
      }

      // 关主授权对话框
      if (this._showAuthDialog) {
        if (this._uiAuthDialog.skipBtnRect &&
            t.x >= this._uiAuthDialog.skipBtnRect.x && t.x <= this._uiAuthDialog.skipBtnRect.x + this._uiAuthDialog.skipBtnRect.w &&
            t.y >= this._uiAuthDialog.skipBtnRect.y && t.y <= this._uiAuthDialog.skipBtnRect.y + this._uiAuthDialog.skipBtnRect.h) {
          audio.play('button_click');
          this._destroyAuthBtn();
        }
        return;
      }

      // 通关后、结算面板尚未显示期间：屏蔽一切触控
      if (this._victory && !this._showVictoryPanel) return;

      // 结算面板关闭动画中：屏蔽触控
      if (this._victoryClosing) return;

      // 通关界面按钮（UIManager）
      if (this._victory) {
        if (this._uiVictoryPopup._exitBtn && _hitRect(t.x, t.y, this._uiVictoryPopup._exitBtn)) {
          audio.play('button_click');
          var that = this;
          this._victoryClosing = true;
          this._victoryAnimator.close(function() {
            that._victoryClosing = false;
            databus.gameState = databus.returnState === 'editor' ? 'editor' : 'menu';
          });
          return;
        }
        if (this._uiVictoryPopup._restartBtn && _hitRect(t.x, t.y, this._uiVictoryPopup._restartBtn)) {
          audio.play('button_click');
          this.restartLevel();
          return;
        }
        if (this._uiVictoryPopup._doubleGoldBtn && !this._uiVictoryPopup._goldClaimed && _hitRect(t.x, t.y, this._uiVictoryPopup._doubleGoldBtn)) {
          audio.play('button_click');
          this._onDoubleGoldClick();
          return;
        }
        if (this._uiVictoryPopup._nextBtn && _hitRect(t.x, t.y, this._uiVictoryPopup._nextBtn)) {
          audio.play('button_click');
          var that2 = this;
          this._victoryClosing = true;
          this._victoryAnimator.close(function() {
            that2._victoryClosing = false;
            that2._uiVictoryPopup.onContinue();
          });
          return;
        }
        return; // 通关后屏蔽其他触控
      }

      // 顶部返回/设置按钮
      if (_hitRect(t.x, t.y, { x: PADDING, y: PADDING, w: 49, h: 47 })) {
        this._btnPress.press('settings');
        audio.play('button_click');
        if (databus.returnState === 'editor') {
          databus.gameState = 'editor';
        } else if (settingsPanel.isOpen()) {
          settingsPanel.close();
        } else {
          settingsPanel.open({
            buttons: [
              { icon: '🏠', label: '', action: function() { audio.play('button_click'); settingsPanel.close(); databus.gameState = 'menu'; } },
              { label: '继续游戏', wide: true, action: function() { audio.play('button_click'); settingsPanel.close(); } },
              { icon: '🔄', label: '', action: function() { audio.play('button_click'); settingsPanel.close(); self.restartLevel(); } },
            ]
          });
        }
        return;
      }

      // 底部提示按钮（UIManager）
      var hitType = this._uiBottomBar.getHitType(t.x, t.y);
      if (hitType === 'hint') {
        this._btnPress.press('hint');
        var best = this._hint.show();
        if (best) {
          audio.play('hint_reveal');
        } else {
          wx.showToast({ title: '提示已结束', icon: 'none', duration: 1500 });
        }
        return;
      }
      if (hitType === 'remove') {
        this._btnPress.press('remove');
        this._removeHintedPig();
        return;
      }

      // 关主头像（UIManager）
      if (this._uiMasterPanel._avatarRect && _hitRect(t.x, t.y, this._uiMasterPanel._avatarRect)) {
        var master = this._master.getMaster();
        if (master && master.masterNickname) {
          wx.showToast({ title: master.masterNickname, icon: 'none', duration: 2000 });
        }
        return;  // 消费事件，不穿透到棋盘
      }

      // === 游戏世界（拖拽猪等）===
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
    this._guide.onPlayerAction();  // 棋盘操作 → 重置空闲计时

    var self = this;

    // 顶栏按钮（试玩模式返回编辑器，其他打开设置面板）
    if (this.backBtn && x >= this.backBtn.x && x <= this.backBtn.x + this.backBtn.w &&
        y >= this.backBtn.y && y <= this.backBtn.y + this.backBtn.h) {
      audio.play('button_click');
      if (databus.returnState === 'editor') {
        this._btnPress.press('settings');
        databus.gameState = 'editor';
      } else {
        this._btnPress.press('settings');
        settingsPanel.open({
          buttons: [
            { icon: '🏠', label: '', action: function() { audio.play('button_click'); settingsPanel.close(); databus.gameState = 'menu'; } },
            { label: '继续游戏', wide: true, action: function() { audio.play('button_click'); settingsPanel.close(); } },
            { icon: '🔄', label: '', action: function() { audio.play('button_click'); settingsPanel.close(); self.restartLevel(); } },
          ]
        });
      }
      return;
    }

    if (this.hintBtn && !this._hint.getTarget() && x >= this.hintBtn.x && x <= this.hintBtn.x + this.hintBtn.w &&
        y >= this.hintBtn.y && y <= this.hintBtn.y + this.hintBtn.h) {
      audio.play('button_click');
      this._btnPress.press('hint');
      var best = this._hint.show();
      if (best) {
        audio.play('hint_reveal');
      } else {
        wx.showToast({ title: '提示已结束', icon: 'none', duration: 1500 });
      }
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
      var master = this._master.getMaster();
      if (master) {
        var showName = master.masterNickname;
        if (!showName) {
          var uid = master.masterUserId || '';
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
          startState: { tailIndex: pig.tailIndex, length: pig.length, angle: pig.angle, headHole: this.gp.findHeadHole(pig.tailIndex, pig.length, pig.angle) },
          headHoleIdx: -1,
          lastCollidedId: null,
          lastCollideTime: 0,
          isValidNow: true
        };
      }
    }
  }

  onTouchMove(x, y) {
    this._guide.onPlayerAction();  // 棋盘拖拽 → 重置空闲计时

    if (this.gp.dragState && this.gp.dragState.type === 'rotate') {
      // 旋转持续音效（首次播放）
      if (!this._rotateHandle) {
        this._rotateHandle = audio.playLooped('rotate_loop');
      }
      this.gp.handleRotateDrag(x, y);
    }
  }

  onTouchEnd(x, y) {
    this._guide.onPlayerAction();  // 松手操作 → 重置空闲计时

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

      // 步数判定：仅看头孔是否变化 + 小猪是否推出（不重复计数）
      if (pig && snapResult) {
        var st = ds.startState;
        var endHeadHole = this.gp.findHeadHole(snapResult.tailIndex, snapResult.length, snapResult.angle);
        var headHoleChanged = (endHeadHole !== st.headHole);
        if (headHoleChanged) {
          this.steps++;
          databus.currentStep = this.steps;
        }
        // 无论头孔是否变化，只要小猪推出去了就 +1（不重复计数）
        var willEscape = this._shouldPushAfterSnap && this.gp.canPushPig(pigId).canPush;
        if (willEscape && !headHoleChanged) {
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
      this._hint.onPigExited(pigId);
      if (!opts.skipStep) { this.steps++; databus.currentStep = this.steps; }

      // 连击系统 ——— 每次逃脱触发
      this._combo.trigger();

      // 试玩模式：记录逃脱序列（供编辑器提示数据自动生成）
      if (databus.returnState === 'editor') {
        this._trialEscapeSequence.push({ pigId: pigId, angle: pig.angle });
      }

      // 所有猪都逃脱 → 通关
      if (this.gp.pigs.length === 0) {
        this._markCleared();
        this._victory = true;
        // 试玩模式：跳过结算动画和面板，弹出系统提示框
        if (databus.returnState === 'editor') {
          // 传递逃脱序列数据（供编辑器提示数据自动生成）
          databus._trialEscapeSequence = this._trialUsedRemove ? null : this._trialEscapeSequence.slice();
          wx.showModal({
            title: '试玩结束',
            content: '已将所有小猪推出棋盘',
            showCancel: false,
            confirmText: '返回编辑',
            success: function (res) {
              if (res.confirm) {
                databus.gameState = 'editor';
              }
            }
          });
        } else {
          setTimeout(() => {
            if (this._earnedCrown) {
              this._victoryAnim.startCrown(this._boardCardX + this._boardCardW / 2, this._boardCardY + this._boardCardH / 2);
            } else {
              this._checkMasterAfterCrown();
            }
          }, 1000);
        }
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
    this.startLevel(this.levelName);
  }

  _markCleared() {
    console.log('[关主] _markCleared called, level=' + this.levelName + ' steps=' + this.steps);
    var isTrial = databus.returnState === 'editor';
    // 推进 lastLevelIndex（试玩模式不推进）
    if (!isTrial) {
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
    }
    // 清理存档：通关后杀进程恢复会出现"关卡已完成但仍有存档"的矛盾，这里清除掉
    try { wx.removeStorageSync('game_checkpoint'); } catch (e) {}
    // 小金猪：试玩模式不写存储；已获得过则跳过，不再重复检查/写存储/播动画
    if (isTrial) {
      this._earnedCrown = false;
      this._gotCrown = false;
    } else if (this._hadCrownBefore) {
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
    // 金币奖励：试玩模式不触发；首次通关本关 → 计算奖励金额（独立于小金猪系统）
    this._pendingGoldReward = false;
    this._goldAmount = 0;
    if (!isTrial && GoldSystem.isFirstGoldClear(this.levelName)) {
      var idx = databus.currentLevelIndex;
      var reward = GoldSystem.calculateReward(idx);
      if (reward > 0) {
        this._goldAmount = reward;
        this._pendingGoldReward = true;
        console.log('[LOG] 首次通关金币奖励: level=' + this.levelName + ' amount=' + reward);
      }
    }
    // 尝试夺关主（试玩模式/用过移除则跳过）
    if (!this._hasUsedRemove && databus.returnState !== 'editor') {
      this._master.tryClaim({
        steps: this.steps,
        hasUsedRemove: this._hasUsedRemove,
        isTrialMode: databus.returnState === 'editor',
        onShowAuthDialog: this._showMasterAuthButton.bind(this),
        onNewMaster: (function () {
          if (this._victory && this._victoryAnim.isCrownDone() && !this._masterAnimWaiting) {
            this._masterAnimWaiting = true;
          }
        }).bind(this),
        onClaimNotGranted: this._destroyAuthBtn.bind(this),
      });
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
        gold: GoldSystem.getGold(),
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

  /** 继续按钮 — 有金币且未被双倍领取过 → 发放单倍金币；然后进入下一关 */
  _onContinueClick() {
    if (this._pendingGoldReward && !this._uiVictoryPopup._goldClaimed) {
      console.log('[LOG] 领取金币: +' + this._goldAmount);
      GoldSystem.addGold(this._goldAmount);
      GoldSystem.markGoldClaimed(this.levelName);
      this._pendingGoldReward = false;
    }
    this._goNextLevel();
  }

  /** 双倍金币 — 加金币→标记已领→按钮灰化，不关闭弹窗 */
  _onDoubleGoldClick() {
    var amount = this._goldAmount;
    console.log('[LOG] 双倍金币: +' + amount * 2);
    GoldSystem.addGold(amount * 2);
    GoldSystem.markGoldClaimed(this.levelName);
    audio.play('rewards');
    // 引擎侧也翻倍，否则 _syncUIData 每帧会用旧值覆盖 VictoryPopup 的翻倍值
    this._goldAmount = amount * 2;
    // 不清除 _pendingGoldReward（会触发 _syncUIData 设 showGold=false 导致面板金币消失）
    // 通知 UI 按钮灰化 + 金额翻倍显示
    if (this._uiVictoryPopup) {
      this._uiVictoryPopup.markGoldClaimed();
    }
  }

  _goNextLevel() {
    const idx = databus.currentLevelIndex + 1;
    if (idx >= databus.projectLevels.length) {
      // 已是最后一关，退回主界面
      databus.gameState = databus.returnState === 'editor' ? 'editor' : 'menu';
      return;
    }
    const next = databus.projectLevels[idx];
    databus.currentLevelIndex = idx;
    databus.currentLevel = { name: next.name, data: null };
    this.startLevel(next.name);
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

  // 销毁授权按钮
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
        that._master.retryClaimWithRealInfo(that.steps, info.nickName || '', info.avatarUrl || '')
          .then(function (result) {
            console.log('[关主] onTap claimLevelMaster 返回 code=' + (result ? result.code : 'null') + ' claimed=' + (result ? result.claimed : 'null'));
          })
          .catch(function (err) {
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

  // ========== 通关动画编排 ==========

  /**
   * 小金猪动画完成后调用（onCrownDone 回调 → _gotCrown=true → 本方法）。
   * 检查关主状态，决定启动关主飞行 / 等待 / 直接结算。
   */
  _checkMasterAfterCrown() {
    var master = this._master.getMaster();
    if (this._master.isNewMaster() && master && master.avatarImg) {
      this._victoryAnim.startMaster(SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2, master.avatarImg);
    } else if (this._master.isNewMaster() || this._master.isClaimPending()) {
      // 关主确认但头像未加载，或判定请求仍在进行 → 进入等待
      this._masterAnimWaiting = true;
    } else {
      this._finishVictorySequence();
    }
  }

  /**
   * 每帧轮询：关主动画等待中 → 检查头像/判定是否就绪。
   * 在 render() 循环中调用。
   */
  _checkMasterAnimWaiting() {
    if (!this._masterAnimWaiting) return;
    var claimDone = !this._master.isClaimPending();
    var master = this._master.getMaster();
    if (this._master.isNewMaster() && master && master.avatarImg) {
      this._masterAnimWaiting = false;
      this._victoryAnim.startMaster(SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2, master.avatarImg);
    } else if (claimDone && !this._master.isNewMaster()) {
      this._masterAnimWaiting = false;
      this._finishVictorySequence();
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
    // 引导系统帧更新（所有状态下的引擎均需轮询）
    var now = Date.now();
    var dt = this._lastFrameTime ? (now - this._lastFrameTime) / 1000 : 0;
    this._lastFrameTime = now;
    if (dt > 0 && dt < 1) this._guide.onFrame(dt); // dt > 1s 视为异常（如切后台），跳过

    // 兜底：若 UI 层尚未初始化（_setupUI 可能因异常未执行），静默跳过
    if (!this._uiBoardCard) return;

    const safeTop = databus.safeTop;

    // 计算布局参数
    this._boardCardX = PADDING;
    this._boardCardY = safeTop + PADDING + TOP_BAR_H + CARD_GAP - 30;
    this._boardCardW = SCREEN_WIDTH - PADDING * 2;
    this._bottomBarY = SCREEN_HEIGHT - BOTTOM_BAR_H - PADDING;
    this._boardCardH = this._bottomBarY - CARD_GAP - this._boardCardY;

    // 同步引擎数据 → UI 组件
    this._syncUIData();

    // 加载中：仅渲染 UI 框架，棋盘保持空白
    if (this._loading) {
      this._uiBoardCard.render(ctx);
      this._uiTopBar.setBounds(0, databus.safeTop, this._boardCardW, Theme.layout.topBarH);
      this._uiTopBar.setLevelText('第 ' + (parseInt(this.levelName) || '1') + ' 关');
      this._uiTopBar.setMode(databus.returnState === 'editor' ? 'trial' : 'normal');
      this._uiTopBar.render(ctx);
      this._uiBottomBar.render(ctx);

      // 加载提示
      ctx.save();
      ctx.fillStyle = Theme.colors.textSecondary || '#999';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('加载关卡中...', SCREEN_WIDTH / 2, this._boardCardY + this._boardCardH / 2);
      ctx.restore();
      return;
    }

    // 1. 棋盘卡片背景（UIManager）
    this._uiBoardCard.render(ctx);

    // 2. 棋盘主体
    this.gp.topBarH = this._boardCardY + CARD_PADDING;
    this.gp.bottomStripH = BOTTOM_BAR_H + PADDING + CARD_GAP + CARD_PADDING;
    this.gp.renderBoard(ctx, { hintPigId: this._hint.getTargetId() });

    // 3. 连击组件（UIManager）
    this._uiComboWidget.render(ctx);

    // 3.5 关主卡片（UIManager）
    this._uiMasterPanel.render(ctx);

    // 3.8 小金猪（UIManager）
    this._uiCrownPig.render(ctx);

    // 3.9 通关飞行特效动画（VictoryAnimation 独立渲染组件）
    this._checkMasterAnimWaiting();
    this._victoryAnim.setLayout(this._boardCardX, this._boardCardY, this._boardCardW, SCREEN_HEIGHT);
    this._victoryAnim.update();
    this._victoryAnim.render(ctx);

    // 4. 顶栏（UIManager）
    this._uiTopBar.render(ctx);

    // 5. 底部栏（UIManager）
    this._uiBottomBar.render(ctx);

    // 6. 通关弹窗（UIManager）
    if (this._victory && this._showVictoryPanel) {
      this._uiVictoryPopup.render(ctx);
    }

    // 7. 关主授权对话框（UIManager）
    if (this._showAuthDialog) {
      this._uiAuthDialog.render(ctx);
    }

    // 8. 设置面板（保持原有）
    settingsPanel.render(ctx);
  }

  // ============================================================
  // 提示系统（逻辑已迁移至 HintSystem.js）
  // PlayingEngine 仅保留 _removeHintedPig（涉及 board 操作 + victory 触发）
  // ============================================================
  _removeHintedPig() {
    var pig = this._hint.getTarget();
    if (!pig) return;
    // 从棋盘移除（不记步数）
    var idx = this.gp.pigs.indexOf(pig);
    if (idx >= 0) {
      this.gp.pigs.splice(idx, 1);
      this.gp.clearPigOccupancy(pig.id);
    }
    this._hasUsedRemove = true;
    this._trialUsedRemove = true;   // 试玩中用了移除 → 不保存提示数据
    this._hint.clear();

    // 所有猪都消失 → 通关
    if (this.gp.pigs.length === 0) {
      this._markCleared();
      this._victory = true;
      if (databus.returnState === 'editor') {
        // 使用了移除 → 不保存提示数据
        databus._trialEscapeSequence = null;
        wx.showModal({
          title: '试玩结束',
          content: '已将所有小猪移除棋盘',
          showCancel: false,
          confirmText: '返回编辑',
          success: function (res) {
            if (res.confirm) { databus.gameState = 'editor'; }
          }
        });
      } else {
        setTimeout(function () {
          if (this._earnedCrown) {
            this._victoryAnim.startCrown(this._boardCardX + this._boardCardW / 2, this._boardCardY + this._boardCardH / 2);
          } else {
            this._checkMasterAfterCrown();
          }
        }.bind(this), 1000);
      }
    }
    wx.showToast({ title: '已移除', icon: 'none', duration: 1000 });
  }

  // ============================================================
  // 断点续玩（Checkpoint Resume）
  // ============================================================

  /** 保存当前关卡状态到本地持久化存储 */
  _saveCheckpoint() {
    if (!this.levelName) {
      console.log('[LOG] 跳过保存: levelName 为空');
      return;
    }
    if (this.steps === 0) {
      console.log('[LOG] 跳过保存: 步数为0，无操作无需保存');
      return;
    }
    if (databus.returnState === 'editor') {
      console.log('[LOG] 跳过保存: 试玩模式');
      return;
    }
    if (this._victory) {
      console.log('[LOG] 跳过保存: 已通关 (_victory=true)');
      return;
    }
    if (this.gp.pigs.length === 0) {
      console.log('[LOG] 跳过保存: 猪已全消');
      return;
    }
    var data = {
      levelName: this.levelName,
      levelIndex: databus.currentLevelIndex,
      steps: this.steps,
      version: this._levelVersion,
      pigs: this.gp.pigs.map(function(p) {
        return { id: p.id, tailIndex: p.tailIndex, length: p.length, angle: p.angle };
      }),
      savedAt: Date.now()
    };
    try {
      wx.setStorageSync('game_checkpoint', data);
      this._lastSavedSteps = this.steps;
      this._lastSavedPigCount = data.pigs.length;
      console.log('[LOG] ✓ 存档成功: ' + this.levelName + ' | step=' + this.steps + ' | pigs=' + data.pigs.length + ' | v=' + this._levelVersion);
    } catch (e) {
      console.warn('[LOG] 保存失败:', e);
    }
  }

  /** 清理存档（deactivate 统一入口） */
  _clearCheckpoint() {
    console.log('[LOG] 清理存档 (timer=' + !!this._checkpointTimer + ')');
    try {
      wx.removeStorageSync('game_checkpoint');
    } catch (e) {}
    if (this._checkpointTimer) {
      clearInterval(this._checkpointTimer);
      this._checkpointTimer = null;
    }
  }

  /** 启动 10 秒存档定时器（脏检测：只有步数或猪数量变化才真正写盘） */
  _startCheckpointTimer() {
    if (this._checkpointTimer) {
      console.log('[LOG] 清除旧定时器，重新启动');
      clearInterval(this._checkpointTimer);
    }
    console.log('[LOG] 启动 10 秒存档定时器 (level=' + this.levelName + ', version=' + this._levelVersion + ')');
    var self = this;
    this._checkpointTimer = setInterval(function() {
      // 脏检测：步数和猪数量都没变就不写盘
      if (self.steps === self._lastSavedSteps && self.gp.pigs.length === self._lastSavedPigCount) {
        return;
      }
      console.log('[LOG] === 定时器触发，检测到变化，准备存档 ===');
      self._saveCheckpoint();
    }, 10000);
  }

  /** 从存档恢复关卡状态（在 loadLevel 之后调用） */
  _doResume() {
    var cp;
    try {
      cp = wx.getStorageSync('game_checkpoint');
    } catch (e) { cp = null; }
    if (!cp) return;

    // 版本校验：关卡配置已更新则重新开始
    if (cp.version !== this._levelVersion) {
      console.log('[LOG] 版本不一致 存档v' + cp.version + ' 当前v' + this._levelVersion + '，重新开始');
      this._clearCheckpoint();
      wx.showToast({ title: '关卡配置已更新，请重新开始', icon: 'none', duration: 2500 });
      this.restartLevel();
      return;
    }

    // 恢复步数
    this.steps = cp.steps || 0;
    databus.currentStep = this.steps;

    // 恢复猪的位置
    var cpPigMap = {};
    for (var i = 0; i < (cp.pigs || []).length; i++) {
      cpPigMap[cp.pigs[i].id] = cp.pigs[i];
    }

    // 剔除已推出的猪（存档中不存在 = 被杀进程前已推出）
    var removedCount = 0;
    this.gp.pigs = this.gp.pigs.filter(function(pig) {
      if (cpPigMap.hasOwnProperty(pig.id)) return true;
      removedCount++;
      return false;
    });

    for (var j = 0; j < this.gp.pigs.length; j++) {
      var pig = this.gp.pigs[j];
      var cpPig = cpPigMap[pig.id];
      // 此时 cpPig 一定存在（已过滤），但保留防御
      if (cpPig) {
        pig.tailIndex = cpPig.tailIndex;
        pig.length = cpPig.length;
        pig.angle = cpPig.angle;
      }
    }

    console.log('[LOG] 恢复猪: 更新=' + this.gp.pigs.length + ' 剔除=' + removedCount);
    this.gp.rebuildOccupancy();

    // 恢复完成后不清理存档 — 由 30 秒定时器自然覆盖
    console.log('[LOG] 存档已恢复 steps=' + this.steps + ' pigs=' + this.gp.pigs.length);
  }
}

module.exports = PlayingEngine;
