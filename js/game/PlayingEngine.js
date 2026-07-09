// 关卡游玩引擎 — 组合 GameplayEngine 实现正式玩法

const databus = require('../databus.js');
const cloud = require('../cloud.js');
const audio = require('../audio/AudioManager.js');
const settingsPanel = require('../ui/SettingsPanel.js');
const ButtonPress = require('../anim/ButtonPress.js');
const PopupAnimator = require('../ui/PopupAnimator.js');
const { ctx, SCREEN_WIDTH, SCREEN_HEIGHT } = require('../render.js');
const { roundRect } = require('../render/PigRenderer.js');
const GameplayEngine = require('../core/GameplayEngine.js');

// === UI 层 ===
const Theme = require('../define/GameDefine.js').THEME;
const UIManager = require('../ui/UIManager.js');
const TopBar = require('../ui/widgets/TopBar.js');
const BottomBar = require('../ui/widgets/BottomBar.js');
const MasterPanel = require('../ui/widgets/MasterPanel.js');
const VictoryPopup = require('../ui/widgets/VictoryPopup.js');
const AuthDialog = require('../ui/widgets/AuthDialog.js');
const MasterSystem = require('./MasterSystem.js');
const LevelCache = require('../preload/LevelCache.js');
const HintSystem = require('./HintSystem.js');
const VictoryAnimation = require('./VictoryAnimation.js');
const CoinFlyEffect = require('../effects/CoinFlyEffect.js');
const CrownPigWidget = require('../ui/widgets/CrownPigWidget.js');
const GoldWidget = require('../ui/widgets/GoldWidget.js');
const GuideManager = require('../guide/GuideManager.js');
const GoldSystem = require('./GoldSystem.js');
const SkinSystem = require('./SkinSystem.js');
const StaminaSystem = require('./StaminaSystem.js');
const StaminaAdPanel = require('../ui/StaminaAdPanel.js');
const CommonButton = require('../ui/widgets/CommonButton.js');
const AssetPreloader = require('../ui/AssetPreloader.js');
const SceneDefaults = require('../define/GameDefine.js').SCENE;
var PlayDefine = require('../define/PlayingDefine.js');
var GAME_DEF = require('../define/GameDefine.js').GAME;
var BD_TOP = GAME_DEF.BOARD.TOP_BAR_H;
var BD_BOTTOM = GAME_DEF.BOARD.BOTTOM_STRIP_H_DEFAULT;

// 矩形碰撞检测辅助
function _hitRect(px, py, rect) {
  if (!rect) return false;
  return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}

// 试玩模式小按钮绘制（带按压缩放）
function _drawTrialBtn(ctx, x, y, w, h, label, color, scale) {
  scale = scale || 1;
  var cx = x + w / 2, cy = y + h / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -cy);
  ctx.fillStyle = color;
  roundRect(ctx, x, y, w, h, 6);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 11px ' + Theme.font.family + '';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cx, cy);
  ctx.restore();
}

// 布局常量（来自 Ardot 设计稿 375×812）
var ESCAPE_SPEED = PlayDefine.PLAY.ESCAPE_SPEED;  // 正常逃脱速度（逻辑像素/秒）

var SNAP_ANGLE_PUSH_THRESHOLD = PlayDefine.PLAY.SNAP_ANGLE_PUSH_THRESHOLD;

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
    this._victoryTime = 0;
    this._exitBtn = null;
    this._nextBtn = null;
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
        console.log('[LOG_victory] 奖杯done → _crownAnimFinished=true');
        this._crownAnimFinished = true;
        this._tryFinishParallel();
      }.bind(this),
      onMasterDone: function () {
        console.log('[LOG_victory] 关主done → _masterAnimFinished=true');
        this._masterAnimFinished = true;
        this._tryFinishParallel();
      }.bind(this),
    });
    this._gotCrown = false;         // 奖杯是否已显示为激活状态（动画完成后才置 true）
    this._earnedCrown = false;      // 本局是否达到了奖杯门槛（用于判断是否播动画）
    this._hadCrownBefore = false;   // 本局开始前是否已拥有奖杯（已获得则跳过所有奖杯逻辑）
    this._crownAnimFinished = false;  // 并行追踪：奖杯动画是否完成
    this._masterAnimFinished = false; // 并行追踪：关主动画是否完成（无动画=true）
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
    // _hasUsedRemove 已移除：移除不再取消资格，改为消耗 5 步数
    this._removeBtn = null;         // 移除按钮碰撞区
    this._loading = false;          // 是否正在加载（云端拉取中，阻止所有操作）
    this._lastFrameTime = 0;        // 上一帧时间戳（引导系统 dt 计算用）
    this._cloudFetchedData = new Map();  // 本次会话已拉取过的云端关卡数据 { name → data }
    // 断点续玩
    this._checkpointTimer = null;   // 5秒存档定时器
    this._levelVersion = 0;         // 当前关卡版本号
    this._skipRestore = false;       // 重玩标记（置 true 则跳过恢复）
    this._lastSavedSteps = -1;      // 上次存档时的步数（用于脏检测）
    this._lastSavedPigCount = -1;   // 上次存档时的猪数量（用于脏检测）
    // 金币奖励
    this._goldAmount = 0;           // 本次通关奖励金币数（不含步数奖励）
    this._stepBonusRemaining = 0;    // 步数奖励金币数（奖杯剩余步数）
    this._levelAccumulatedGold = 0;  // 本关实时累积金币（猪退出+1，异步递增仅用于 UI 实时显示）
    this._totalPigsInLevel = 0;      // 本关原始猪数量（loadLevel 时快照，结算用，不受 setTimeout 时序影响）
    this._coinFlyEffect = new CoinFlyEffect();  // 金币磁吸飞行动画
    this._showBoardBounds = false;    // 调试框：棋盘可用区域
    this._showHintCommon = true;     // 提示按钮可见（通关后隐藏）
    this._goldSettled = false;        // 通关结算已入库（入账后不再累积 _levelAccumulatedGold）
    this._isFirstGoldClear = false;    // 进入关卡时计算：本关是否首通（决定飞金币 + 金币发放）
    this._settlementTriggered = false; // 结算已触发（防重入）
    this._settlementTimer = null;      // 2.5s 兜底定时器

    // 录制回放系统（试玩模式）
    this._isRecording = false;
    this._recordingStart = 0;
    this._recordEntries = [];      // [{ type, x, y, dt }]
    this._isPlayingBack = false;
    this._playbackDotPos = null;  // { x, y } 回放触控位置指示
    this._playbackTimer = null;

    // 场景背景图
    this._sceneBgImg = wx.createImage();
    this._sceneBgLoaded = false;
    var self = this;
    this._sceneBgImg.onload = function () {
      self._sceneBgLoaded = true;
    };
    this._sceneBgImg.src = SceneDefaults.background;
  }

  /**
   * 进入关卡时统一重置所有运行时状态（依赖 this.levelName + databus.currentLevelIndex）。
   * 由 loadLevel() 内部调用，所有入口通过 startLevel → _loadAndStart → loadLevel 保证状态干净。
   */
  _resetPlayState() {
    this.steps = 0;
    databus.currentStep = 0;
    this._victory = false;
    this._victoryTime = 0;
    this.gp.fadeAlpha = 1;  // 重置孔洞透明度
    this._showVictoryPanel = false;
    this._victoryAnimStart = 0;
    this._victoryAnimator.close();  // 立即关闭（无动画）
    this._victoryClosing = false;
    this._hint.clear();
    this._guide.reset();
    this._lastFrameTime = 0;       // 防止切关卡时 dt 突增
    // 奖杯状态
    this._hadCrownBefore = !!wx.getStorageSync('crown_' + databus.currentLevelIndex);
    this._gotCrown = this._hadCrownBefore;
    this._earnedCrown = false;
    // 通关动画状态
    this._victoryAnim.reset();
    this._crownAnimFinished = false;
    this._masterAnimFinished = false;
    // 授权/对话框状态
    this._showAuthDialog = false;
    this._authAnimator.close();  // 立即关闭（无动画）
    this._skipAuthBtnRect = null;
    this._authShown = false;
    this._destroyAuthBtn();
    // 金币奖励状态
    this._goldAmount = 0;
    this._stepBonusRemaining = 0;
    this._levelAccumulatedGold = 0;
    this._totalPigsInLevel = 0;
    this._coinFlyEffect = new CoinFlyEffect();  // 重置飞行中动画
    this._goldSettled = false;
    // 首通判定（与 _markCleared 金币奖励逻辑同源）：本关从未获得过金币奖励才飞金币。
    // 用此标志约束「小猪逃脱飞金币」动画，避免已通关关卡重玩仍飞金币（金币不再发放）。
    var liRaw = wx.getStorageSync('lastLevelIndex');
    var savedLi = (liRaw !== '' && liRaw !== undefined && liRaw !== null) ? parseInt(liRaw, 10) : -1;
    this._isFirstGoldClear = databus.returnState !== 'editor' && databus.currentLevelIndex > savedLi;
    this._settlementTriggered = false;
    this._lastGoldLog = -1;  // 诊断日志去重用
    // 清除兜底定时器
    if (this._settlementTimer) { clearTimeout(this._settlementTimer); this._settlementTimer = null; }
    // 提示收集状态（每局重置）
    this._gameplayHintCache = [];
    this._hintMerged = false;
    // 试玩模式：实时提示记录计数器
    this._trialHintNextId = 0;
    this._escapedCount = 0;        // 逃逸猪数（只增不减，判断录制/回放前置条件）
    this._hintedTrialCount = 0;   // 试玩模式已标记 hint 的猪数（不随逃逸减少）
    this._trialNextBtn = null;
    this._trialPlayBtn = null;
    this._trialResetBtn = null;
    this._isRecording = false;
    this._recordingStart = 0;
    this._recordEntries = [];
    this._isPlayingBack = false;
    if (this._playbackTimer) { clearTimeout(this._playbackTimer); this._playbackTimer = null; }
    // 正式玩：通关后保存 hint 数据缓存
    this._gameplayHintCache = [];
    this._hintMerged = false;
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

      // Layer 1 — 奖杯组件
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
              title: '设置',
              buttons: [
                { iconKey: 'btn_home', action: function() { audio.play('button_click'); settingsPanel.close(); databus.gameState = 'menu'; } },
                { iconKey: 'btn_continue', action: function() { audio.play('button_click'); settingsPanel.close(); } },
                { iconKey: 'btn_again', action: function() { audio.play('button_click'); settingsPanel.close(); self.restartLevel(); } },
              ]
            });
          }
        },
      });
      this.ui.add(this._uiTopBar, UIManager.LAYER.CONTROL);

      // Layer 2 — GoldWidget（金币余额显示，试玩模式隐藏）
      if (databus.returnState !== 'editor') {
      this._uiGoldWidget = new GoldWidget({
        zIndex: UIManager.LAYER.CONTROL,
      });
      this.ui.add(this._uiGoldWidget, UIManager.LAYER.CONTROL);
      } else {
        this._uiGoldWidget = null;
      }

      // Layer 2 — BottomBar
      this._uiBottomBar = new BottomBar({
        zIndex: UIManager.LAYER.CONTROL,
        cardW: SCREEN_WIDTH - Theme.spacing.padding * 2,
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

      // 提示按钮（CommonButton gold，右下角）
      this._hintCommonBtn = new CommonButton({
        label: '提示!',
        color: 'gold',
        iconKey: 'ad_icon',
      });
      this._hintCommonBtn.visible = true;

      // 隐藏旧 BottomBar 提示/移除按钮（已替换为 CommonButton）
      this._uiBottomBar.setHintHidden(true);

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

      // Layer 4 — AuthDialog
    } catch (e) {
      // 初始化失败：清空所有引用，确保 render() 的 guard 能兜底
      console.error('[PlayingEngine] _setupUI 失败:', e);
      this.ui = null;
      this._uiMasterPanel = null;
      this._uiCrownPig = null;
      this._uiTopBar = null;
      this._uiGoldWidget = null;
      this._uiBottomBar = null;
      this._uiVictoryPopup = null;
      this._uiAuthDialog = null;
    }
  }

  /** 每帧更新 UI 层数据（引擎 → UI 组件单向数据流） */
  _syncUIData() {
    if (!this._uiTopBar) return;  // 哨兵检查

    // TopBar 位置 + 内容（屏幕坐标系，y=0）
    this._uiTopBar.setBounds(0, 0, this._boardCardW, Theme.layout.topBarH);
    this._uiTopBar.setLevelText(parseInt(this.levelName || 1) + '关');
    this._uiTopBar.setMode(databus.returnState === 'editor' ? 'trial' : 'normal');

    // GoldWidget — 显示余额（步数奖励动画期间递减展示）
    var goldDisplay;
    if (this._goldSettled && this._stepBonusRemaining > 0) {
      goldDisplay = GoldSystem.getGold() - this._stepBonusRemaining;
    } else if (this._goldSettled) {
      goldDisplay = GoldSystem.getGold();  // 已结算，不再叠加旧累积
    } else {
      goldDisplay = GoldSystem.getGold() + this._levelAccumulatedGold;
    }
    if (this._lastGoldLog !== goldDisplay) {
      this._lastGoldLog = goldDisplay;
      console.log('[LOG_gold] _syncUIData goldDisplay=' + goldDisplay + ' settled=' + this._goldSettled + ' stepRemaining=' + this._stepBonusRemaining + ' getGold=' + GoldSystem.getGold() + ' accum=' + this._levelAccumulatedGold);
    }
    if (this._uiGoldWidget) this._uiGoldWidget.setData(goldDisplay);

    // BottomBar — 试玩模式隐藏移除按钮（始终保持提示按钮状态）
    var hintShowing = this._hint.isActive();
    if (databus.returnState === 'editor') {
      this._uiBottomBar.setHintActive(false);
    } else {
      this._uiBottomBar.setHintActive(hintShowing);
    }
    this._uiBottomBar.setHintShowing(hintShowing);
    this._uiBottomBar.setCurrentSteps(this.steps);

    // 提示按钮位置（右下角 Figma 规格）
    if (this._hintCommonBtn) {
      this._hintCommonBtn.x = SCREEN_WIDTH - 15 - 144;
      this._hintCommonBtn.y = SCREEN_HEIGHT - 34.5 - 61;
      this._hintCommonBtn.label = this._uiBottomBar._hintActive ? '移除!' : '提示!';
      this._hintCommonBtn.color = this._uiBottomBar._hintActive ? 'red' : 'gold';
      this._hintCommonBtn.visible = this._showHintCommon;
    }

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

    // 奖杯组件
    this._uiCrownPig.setHidden(databus.returnState === 'editor');
    this._uiCrownPig.setData(this._crownSteps, this.steps, this._gotCrown);

    // VictoryPopup
    var master = this._master.getMaster();
    this._uiVictoryPopup.setData({
      steps: this.steps,
      returnState: databus.returnState || 'menu',
      goldAmount: this._goldAmount,
      showGold: this._goldAmount > 0,
      masterSteps: master ? master.masterSteps : null,
      masterNickname: master ? master.masterNickname : null,
      isLastLevel: this._isLastLevelOfGame() || databus.returnState === 'levelSelect',
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
      this._guide.reset();
      this._destroyAuthBtn(true);
    }

    // 1. 保存关卡标识
    this.levelName = name;

    // 2. 搭建 UI（棋盘空白，玩家可见框架）
    this._setupUI();

    // 2.5 重置金币浮动文字
    if (this._uiGoldWidget) {
      this._uiGoldWidget._floatTexts = [];
    }

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
      // 本地优先：先检查 assets/levels/ 是否存在，云端仅做增量补充
      var localData = self._readLocalLevel(name);
      if (localData) {
        console.log('[Playing] ' + name + ' 使用本地关卡配置');
        self._loadAndStart(localData);
      } else {
        // 本地无 → 尝试云端
        console.log('[cloud][Playing] startLevel name=' + name + ' 本地无配置，尝试云端...');
        var TIMEOUT_MS = PlayDefine.PLAY.LOAD_TIMEOUT;
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
              console.log('[cloud] 关卡 ' + name + ' 云端配置就绪');
              self._loadAndStart(result.data);
            } else {
              console.warn('[cloud] 关卡 ' + name + ' 未发布，本地也无配置');
              self._loadAndStart(null);
            }
          })
          .catch(function(err) {
            console.warn('[cloud] 关卡拉取失败（' + (err && err.message) + '），本地也无配置');
            self._loadAndStart(null);
          });
      }
    }

    // 4. 音效、输入、关主系统（不依赖关卡数据）
    this.input.on('playing', function(e) { self.handleEvent(e); });
    this._master.loadUserInfo();
    this._master.fetchMyOpenId();
  }

  /** 读取本地关卡文件，失败返回 null */
  _readLocalLevel(name) {
    var fs = wx.getFileSystemManager();
    // 优先 USER_DATA_PATH（预下载/编辑器缓存），fallback assets/levels（内置）
    var paths = [
      wx.env.USER_DATA_PATH + '/levels/' + name + '.json',
      'assets/levels/' + name + '.json'
    ];
    for (var i = 0; i < paths.length; i++) {
      try {
        var raw = fs.readFileSync(paths[i], 'utf8');
        var data = JSON.parse(raw);
        console.log('[Playing] 本地关卡 ' + name + '.json 读取成功 (' + (i === 0 ? '缓存' : '内置') + ')');
        return data;
      } catch(e) { /* try next */ }
    }
    console.warn('[Playing] 本地无 ' + name + '.json');
    return null;
  }

  /** loadLevel + 恢复 _loading。data 为 null 时销毁关卡并返回主菜单 */
  _loadAndStart(data) {
    if (!data) {
      console.warn('[cloud][Playing] 关卡数据加载失败（云端+本地均无），返回主菜单');
      this._loading = false;
      wx.showToast({ title: '关卡数据加载失败', icon: 'none', duration: 2000 });
      databus.gameState = 'menu';
      return;
    }
    // 入场动画状态必须在 loadLevel 之前设置，确保首帧渲染时 es 已存在
    this._entranceState = {
      startTime: Date.now(),
      phase: 'board',        // board → pigs → ui → done
      pigFadeDelay: PlayDefine.PLAY.ENTRANCE.PIG_FADE_DELAY,     // 300ms 后开始猪渐显
      pigFadeDur: PlayDefine.PLAY.ENTRANCE.PIG_FADE_DUR,       // 猪渐显 500ms (ease-out)
      uiStart: PlayDefine.PLAY.ENTRANCE.UI_START,           // 800ms 后开始 UI 飞入
      uiDur: PlayDefine.PLAY.ENTRANCE.UI_DUR,             // UI 飞入 500ms (ease-out cubic)
      totalDuration: PlayDefine.PLAY.ENTRANCE.TOTAL_DURATION,     // 总时长 1300ms
    };
    this.loadLevel(data);
    this._loading = false;
    // 重置脏检测基准（确保首轮一定写入）
    this._lastSavedSteps = -1;
    this._lastSavedPigCount = -1;
    // 断点续传（单函数收敛：恢复/清理/启动定时器）
    this._updateCheckpoint();

    // 关卡预下载：仅最新关卡触发（非试玩模式）
    this._tryPreloadNext();

    // 自动开启录制（断点续玩且棋盘不完整时跳过）
    var isResume = this._escapedCount > 0;
    if (this._escapedCount === 0) {
      console.log('[RecHint] 进入关卡: level=' + this.levelName + ' 模式=' + (databus.returnState === 'editor' ? '试玩' : '正式') + ' 断点续玩=' + isResume + ' → 启动录制+提示收集');
      this._trialStartRecord();
    } else {
      console.log('[RecHint] 进入关卡: level=' + this.levelName + ' 模式=' + (databus.returnState === 'editor' ? '试玩' : '正式') + ' 断点续玩=' + isResume + ' escapedCount=' + this._escapedCount + ' → 跳过录制+提示收集(棋盘不完整)');
    }
  }

  /** 如果是"最新关卡"，触发预下载后续5关 */
  _tryPreloadNext() {
    if (databus.returnState === 'editor') return; // 试玩不参与
    var li = wx.getStorageSync('lastLevelIndex');
    var lastIdx = (li !== '' && li !== undefined && li !== null) ? parseInt(li, 10) : 0;

    // 不是最新关卡，跳过
    if (databus.currentLevelIndex < 0 || databus.currentLevelIndex !== lastIdx) return;

    LevelCache.preloadNext(lastIdx + 1);
  }

  /** 试玩模式：加载下一关 */
  _trialGoNext() {
    var list = databus.trialLevelList;
    var idx = databus.trialCurrentIdx;
    if (!list || idx < 0 || idx + 1 >= list.length) {
      wx.showToast({ title: '已是最后一关', icon: 'none', duration: 1500 });
      return;
    }

    var nextEntry = list[idx + 1];
    // 加载关卡数据（优先 USER_DATA_PATH，fallback assets/levels）
    var data = this._readLocalLevel(nextEntry.name);
    if (!data) {
      wx.showToast({ title: '下一关数据加载失败', icon: 'none', duration: 1500 });
      return;
    }

    // 更新 databus（编辑器下次 activate 时读取）
    databus.currentLevel = { name: nextEntry.name, data: data };
    databus.trialCurrentIdx = idx + 1;
    databus._trialReturnLevelIdx = idx + 1;

    // 重启 PlayingEngine
    this.startLevel(nextEntry.name, { resume: false });
  }

  /** 试玩模式是否已是最后一关 */
  _isTrialLastLevel() {
    var list = databus.trialLevelList;
    var idx = databus.trialCurrentIdx;
    return !list || idx < 0 || idx + 1 >= list.length;
  }

  /** 棋盘猪是否全部在棋盘上（是否有猪逃逸过） */
  _allPigsOnBoard() {
    return this._escapedCount === 0;
  }

  // ===== 录制回放（游戏动作） =====

  _recordAction(action) {
    if (this._isRecording) this._recordEntries.push(action);
  }

  _trialStartRecord() {
    if (!this._allPigsOnBoard()) {
      wx.showToast({ title: '请先重置关卡', icon: 'none', duration: 1500 });
      return;
    }
    this._isRecording = true;
    this._recordingStart = Date.now();
    this._recordEntries = [];
    console.log('[TrialRec] 开始录制');
  }

  // save=false: 仅停止录制不保存；save=true: 保存录制到本地存储
  _trialStopRecord(save) {
    this._isRecording = false;
    if (!save) {
      console.log('[TrialRec] 录制取消，不保存');
      return;
    }
    if (this._recordEntries.length === 0) {
      console.log('[TrialRec] 无操作，不保存');
      return;
    }
    var key = 'trial_record_' + this.levelName;
    wx.setStorageSync(key, JSON.stringify(this._recordEntries));
    console.log('[TrialRec] 录制结束，保存 ' + this._recordEntries.length + ' 条操作 → ' + key);
  }

  _trialStartPlayback() {
    if (this._isPlayingBack) return;
    if (!this._allPigsOnBoard()) {
      wx.showToast({ title: '请先重置关卡', icon: 'none', duration: 1500 });
      return;
    }
    // 回放前先停止录制，防止回放操作被录进去
    this._isRecording = false;
    var key = 'trial_record_' + this.levelName;
    var raw = wx.getStorageSync(key);
    if (!raw) return;

    var events = JSON.parse(raw);
    if (!events || events.length === 0) return;

    this._isPlayingBack = true;
    console.log('[TrialRec] 开始回放 ' + events.length + ' 条触控');

    // 计算回放延迟：事件间隔超过 500ms 则压缩
    var MAX_GAP = PlayDefine.PLAY.REPLAY.MAX_GAP;
    var delayed = 0;  // 累积延迟
    var lastDt = 0;
    var self = this;
    for (var i = 0; i < events.length; i++) {
      var gap = events[i].dt - lastDt;
      if (gap > MAX_GAP) gap = MAX_GAP;
      lastDt = events[i].dt;
      delayed += gap;
      (function (evt, playDt) {
        setTimeout(function () {
          if (!self._isPlayingBack) return;
          var xf = self.gp._xform;
          var sx, sy;
          if (xf) {
            sx = xf.screenCX + (evt.bx - xf.boardCX) * xf.scale;
            sy = xf.screenCY + (evt.by - xf.boardCY) * xf.scale;
          } else {
            sx = evt.bx;
            sy = evt.by;
          }
          self._playbackDotPos = { x: sx, y: sy };
          if (evt.type === 'touchstart') self.onTouchStart(sx, sy);
          else if (evt.type === 'touchmove') self.onTouchMove(sx, sy);
          else if (evt.type === 'touchend') self.onTouchEnd(sx, sy);
        }, playDt);
      })(events[i], delayed);
    }

    // 回放结束清理 + Toast
    var doneTimer = setTimeout(function () {
      self._isPlayingBack = false;
      console.log('[TrialRec] 回放完成');
      wx.showToast({ title: '回放完成', icon: 'success', duration: 1500 });
    }, delayed + 1000);
    this._playbackTimer = doneTimer;
  }

  /** 检查是否有可回放的录制数据 */
  _hasReplayData() {
    try {
      var raw = wx.getStorageSync('trial_record_' + this.levelName);
      return raw && raw.length > 0;
    } catch (e) { return false; }
  }

  /** 启动回放（debug "自" 按钮） */
  _startAutoReplay() {
    if (this._isPlayingBack) return;
    if (!this._hasReplayData()) {
      wx.showToast({ title: '暂无回放数据', icon: 'none', duration: 1500 });
      return;
    }
    this._trialStartPlayback();
  }

  /** 强制移除无法推出的猪（回放用） */
  _forceRemovePig(pigId) {
    var idx = this.gp.pigs.findIndex(function (p) { return p.id === pigId; });
    if (idx < 0) return false;
    this.gp.pigs.splice(idx, 1);
    this.gp.clearPigOccupancy(pigId);
    return true;
  }

  /** 正式模式是否已是最后一关 */
  _isLastLevelOfGame() {
    if (databus.returnState === 'editor') return false;
    var list = databus.projectLevels;
    var idx = databus.currentLevelIndex;
    return !list || idx < 0 || idx + 1 >= list.length;
  }

  activate() {
    var name = databus.currentLevel ? databus.currentLevel.name : '';
    this.startLevel(name);
  }

  deactivate() {
    this.input.off('playing');
    this._guide.reset();         // 退出关卡时强制结束引导
    this._destroyAuthBtn(true);  // 立即关闭，无动画
    this._entranceState = null;  // 清空入场动画，防止下一帧闪现旧猪
    this._stopCheckpointTimer();
    // 清理录制/回放状态
    if (this._isRecording) this._trialStopRecord(false);  // 退出关卡不保存录制
    this._isPlayingBack = false;
    if (this._playbackTimer) { clearTimeout(this._playbackTimer); this._playbackTimer = null; }
  }

  loadLevel(data) {
    console.log('[Playing] loadLevel pigCount=' + (data && data.pigs ? data.pigs.length : 0) + ' pigIds=' + (data && data.pigs ? data.pigs.map(function(p){return p.id}).join(',') : 'none'));
    // 加载新关卡时统一重置所有运行时状态（所有入口无需单独调用）
    this._resetPlayState();
    if (data && data.board) {
      this.gp.rows = data.board.rows || data.board.cols || 5;
      this.gp.oddCols = data.board.oddCols || data.board.oddRows || 3;
      this.gp.boardWidth = data.board.boardWidth || 375;
      this.gp.boardRate = data.board.boardRate || 2.74;
    }
    this._crownSteps = (data && data.crownSteps) || 0;
    this._levelVersion = (data && data.version) || 0;
    this.gp.pigs = (data && data.pigs ? data.pigs : []).map(p => ({
      id: p.id, tailIndex: p.tail, length: p.length, angle: p.angle,
      type: p.type || 'pig', skinId: p.skinId || 0,
      // 统一加载已有 hint（试玩/正式一致），通关后由 _mergeAndUploadHints 全量覆盖
      hintId: p.hintId != null ? p.hintId : null,
      hintAngle: p.hintAngle != null ? p.hintAngle : p.angle
    }));
    var ENT = require('../define/GameDefine.js').ENTITY;
    this._totalPigsInLevel = this.gp.pigs.filter(function(p) {
      return ENT.props(p).canEscape;
    }).length;
    this.gp.dragState = null;
    this.gp.flashingPigs = {};
    this.gp.animations = [];
    this.gp.ghostAnimations = [];
    this.gp.flyingPigs = [];
    this.gp.topBarH = databus.safeTop + BD_TOP;
    this.gp.bottomStripH = BD_BOTTOM;
    this.gp.applyBoardWidthConstraint(SCREEN_WIDTH);
    this.gp.recomputeBoard();
    this.gp.recenterBoard();
    this.gp.snapAllPigsAngles();
    // 异步拉取关主信息
    this._master.fetchMaster();
    // 试玩模式：初始化提示编号计数器（已有 hintId 中最大 + 1）
    if (databus.returnState === 'editor') {
      var maxId = 0;
      for (var i = 0; i < this.gp.pigs.length; i++) {
        var hid = this.gp.pigs[i].hintId;
        if (hid != null && hid > maxId) maxId = hid;
      }
      this._trialHintNextId = maxId + 1;
    }
    // 试玩模式：初始已标记 hint 的猪数
    if (databus.returnState === 'editor') {
      this._hintedTrialCount = 0;
      for (var i = 0; i < this.gp.pigs.length; i++) {
        if (this.gp.pigs[i].hintId != null) this._hintedTrialCount++;
      }
    }
    // 关卡无 hint 数据则隐藏提示按钮（正式 + 试玩统一）
    if (this._uiBottomBar) {
      var hasAnyHint = false;
      for (var i = 0; i < this.gp.pigs.length; i++) {
        if (this.gp.pigs[i].hintId != null) { hasAnyHint = true; break; }
      }
      if (!hasAnyHint) {
        this._uiBottomBar.setHintHidden(true);
        this._showHintCommon = false;
      } else {
        this._showHintCommon = true;
      }
    }
  }

  // ========== 输入 ==========
  handleEvent(e) {
    // 加载中：阻止所有用户操作（云端关卡拉取中）
    if (this._loading) return;
    // 入场动画期间：猪渐显完成前（board/pigs 阶段），阻止所有操作
    if (this._entranceState && this._entranceState.phase !== 'done' && this._entranceState.phase !== 'ui') {
      // 测试按钮例外：开发调试用，所有阶段均可操作
      const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
      if (t && e.type === 'touchstart') {
        if (databus.debugUnlocked) {
          if (this._testBtn && _hitRect(t.x, t.y, this._testBtn)) { this._testPlayAll(); return; }
          if (this._testBoundBtn && _hitRect(t.x, t.y, this._testBoundBtn)) { this._showBoardBounds = !this._showBoardBounds; return; }
          if (this._testAutoBtn && _hitRect(t.x, t.y, this._testAutoBtn)) { this._startAutoReplay(); return; }
        }
      }
      return;
    }

    var self = this;
    const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    if (!t) return;

    if (e.type === 'touchstart') {
      // === UIManager 优先路由 ===
      // 体力广告弹窗
      if (StaminaAdPanel.isOpen()) {
        StaminaAdPanel.handleTouch(t.x, t.y, e.type);
        return;
      }

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

      // 右上角奖杯（覆盖奖杯+步数整个区域，试玩模式跳过）
      if (databus.returnState !== 'editor' && _hitRect(t.x, t.y, { x: SCREEN_WIDTH - 78, y: 65, w: 73, h: 80 })) {
        this._uiCrownPig.triggerBreathe();
        return;
      }

      // 步数飞币测试按钮
      if (this._testBtn && _hitRect(t.x, t.y, this._testBtn)) {
        this._testPlayAll();
        return;
      }
      if (this._testBoundBtn && _hitRect(t.x, t.y, this._testBoundBtn)) {
        this._showBoardBounds = !this._showBoardBounds;
        return;
      }
      if (this._testAutoBtn && _hitRect(t.x, t.y, this._testAutoBtn)) {
        this._startAutoReplay();
        return;
      }

      // 左上角金币（覆盖金币+文字整个区域，试玩无）
      if (this._uiGoldWidget && _hitRect(t.x, t.y, { x: 10, y: 78, w: 100, h: 50 })) {
        this._uiGoldWidget.triggerBreathe();
        return;
      }

      // 试玩"下一关"按钮
      if (databus.returnState === 'editor' && this._trialNextBtn && _hitRect(t.x, t.y, this._trialNextBtn)) {
        this._stopPlaybackIfNeeded();
        this._btnPress.press('trialNext');
        this._btnPress.breathe('trialNext');
        audio.play('button_click');
        this._trialGoNext();
        return;
      }

      // 试玩"重置"按钮
      if (databus.returnState === 'editor' && this._trialResetBtn && _hitRect(t.x, t.y, this._trialResetBtn)) {
        this._stopPlaybackIfNeeded();
        this._btnPress.press('trialReset');
        this._btnPress.breathe('trialReset');
        audio.play('button_click');
        var data = this._readLocalLevel(this.levelName);
        if (data) databus.currentLevel.data = data;
        this.restartLevel();
        return;
      }

      // 试玩"回放"按钮
      if (databus.returnState === 'editor' && this._trialPlayBtn && _hitRect(t.x, t.y, this._trialPlayBtn)) {
        if (this._isPlayingBack) {
          // 播放中 → 停止回放
          this._isPlayingBack = false;
          if (this._playbackTimer) { clearTimeout(this._playbackTimer); this._playbackTimer = null; }
          wx.showToast({ title: '回放已停止', icon: 'none', duration: 1500 });
          return;
        }
        var hasRec = !!wx.getStorageSync('trial_record_' + this.levelName);
        if (!hasRec) return;
        this._btnPress.press('trialPlay');
        this._btnPress.breathe('trialPlay');
        audio.play('button_click');
        // 录制中则停止录制（不保存），再走回放
        if (this._isRecording) {
          this._trialStopRecord(false);
        }
        this._trialStartPlayback();
        return;
      }

      // 顶部关卡徽章（仅呼吸反馈，不触发功能，trial 模式下无徽章但 hit rect 可能误触）
      var badgeX = (SCREEN_WIDTH - 80) / 2;
      if (databus.returnState !== 'editor' && _hitRect(t.x, t.y, { x: badgeX, y: 86, w: 80, h: 32 })) {
        this._uiTopBar.triggerBreathe();
        return;
      }

      // 顶部返回/设置按钮
      if (_hitRect(t.x, t.y, { x: Theme.spacing.padding, y: 26, w: 49, h: 47 })) {
        this._btnPress.press('settings');
        this._btnPress.breathe('settings');
        audio.play('button_click');
        if (databus.returnState === 'editor') {
          databus.gameState = 'editor';
        } else if (settingsPanel.isOpen()) {
          settingsPanel.close();
        } else {
          settingsPanel.open({
            title: '设置',
            buttons: [
              { iconKey: 'btn_home', action: function() { audio.play('button_click'); settingsPanel.close(); databus.gameState = 'menu'; } },
              { iconKey: 'btn_continue', action: function() { audio.play('button_click'); settingsPanel.close(); } },
              { iconKey: 'btn_again', action: function() { audio.play('button_click'); settingsPanel.close(); self.restartLevel(); } },
            ]
          });
        }
        return;
      }

      // 提示/移除按钮（CommonButton，右下角）
      if (this._hintCommonBtn && this._hintCommonBtn.visible &&
          this._hintCommonBtn.hitTest(t.x, t.y)) {
        this._hintCommonBtn.handleTouch(t.x, t.y, 'touchstart');
        if (this._uiBottomBar._hintActive) {
          this._removeHintedPig();
        } else {
          var best = this._hint.show();
          if (best) {
            audio.play('hint_reveal');
          } else {
            wx.showToast({ title: '提示已结束', icon: 'none', duration: 1500 });
          }
        }
        return;
      }

      // 底部提示按钮（UIManager）
      var hitType = this._uiBottomBar.getHitType(t.x, t.y);
      if (hitType === 'hint') {
        audio.play('button_click');
        this._btnPress.press('hint');
        this._btnPress.breathe('hint');
        this._btnPress.breathe('remove');
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
        this._btnPress.breathe('remove');
        this._btnPress.breathe('hint');
        this._removeHintedPig();
        return;
      }

      // 关主面板（整体可点，呼吸反馈；头像区域额外显示关主昵称）
      if (_hitRect(t.x, t.y, { x: this._uiMasterPanel.x, y: this._uiMasterPanel.y, w: this._uiMasterPanel.w, h: this._uiMasterPanel.h })) {
        this._uiMasterPanel.triggerBreathe();
        if (this._uiMasterPanel._avatarRect && _hitRect(t.x, t.y, this._uiMasterPanel._avatarRect)) {
          var master = this._master.getMaster();
          if (master && master.masterNickname) {
            wx.showToast({ title: master.masterNickname, icon: 'none', duration: 2000 });
          }
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
    this._recordTouch('touchstart', x, y);

    // === 按钮检测（回放中跳过） ===
    if (!this._isPlayingBack) {
    var self = this;
    // 顶栏按钮（试玩模式返回编辑器，其他打开设置面板）
    if (this.backBtn && x >= this.backBtn.x && x <= this.backBtn.x + this.backBtn.w &&
        y >= this.backBtn.y && y <= this.backBtn.y + this.backBtn.h) {
      audio.play('button_click');
      if (databus.returnState === 'editor') {
        // 试玩返回：将 hintId/hintAngle 写回关卡数据
        if (databus.currentLevel && databus.currentLevel.data && databus.currentLevel.data.pigs) {
          var origPigs = databus.currentLevel.data.pigs;
          for (var ti = 0; ti < origPigs.length; ti++) {
            var ep = this.gp.pigs.find(function(p) { return p.id === origPigs[ti].id; });
            if (ep) {
              origPigs[ti].hintId = (ep.hintId != null) ? ep.hintId : undefined;
              origPigs[ti].hintAngle = (ep.hintAngle != null) ? ep.hintAngle : undefined;
            }
          }
        }
        this._btnPress.press('settings');
        this._btnPress.breathe('settings');
        databus.gameState = 'editor';
      } else {
        this._btnPress.press('settings');
        this._btnPress.breathe('settings');
        settingsPanel.open({
          title: '设置',
          buttons: [
            { iconKey: 'btn_home', action: function() { audio.play('button_click'); settingsPanel.close(); databus.gameState = 'menu'; } },
            { iconKey: 'btn_continue', action: function() { audio.play('button_click'); settingsPanel.close(); } },
            { iconKey: 'btn_again', action: function() { audio.play('button_click'); settingsPanel.close(); self.restartLevel(); } },
          ]
        });
      }
      return;
    }

    if (this.hintBtn && !this._hint.getTarget() && x >= this.hintBtn.x && x <= this.hintBtn.x + this.hintBtn.w &&
        y >= this.hintBtn.y && y <= this.hintBtn.y + this.hintBtn.h) {
      audio.play('button_click');
      this._btnPress.press('hint');
      this._btnPress.breathe('hint');
      this._btnPress.breathe('remove');
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
      this._btnPress.breathe('remove');
      this._btnPress.breathe('hint');
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
    }  // !this._isPlayingBack

    // 棋盘区域：找小猪，按下即激活拖拽
    var boardPos = this.gp.screenToBoard(x, y);
    const hit = this.gp.getPigAtPoint(boardPos.x, boardPos.y);
    if (hit) {
      const pig = this.gp.pigs.find(p => p.id === hit.id);
      // rock 不可拖拽，不可旋转/逃脱，但点击播放受击动画（染色）
      if (pig && pig.type === 'rock') {
        audio.play('collide');
        this.gp.triggerCollisionEffect(hit.id);
      } else if (pig) {
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
    // 录制：棋盘操作（只录板子上的触摸）
    this._recordTouch('touchstart', x, y);
  }

  _recordTouch(type, x, y) {
    if (!this._isRecording || this._isPlayingBack) return;
    var bp = this.gp.screenToBoard(x, y);
    this._recordEntries.push({ type: type, bx: bp.x, by: bp.y, dt: Date.now() - this._recordingStart });
  }

  _stopPlaybackIfNeeded() {
    if (this._isPlayingBack) {
      this._isPlayingBack = false;
      if (this._playbackTimer) { clearTimeout(this._playbackTimer); this._playbackTimer = null; }
    }
  }

  onTouchMove(x, y) {
    this._guide.onPlayerAction();  // 棋盘拖拽 → 重置空闲计时
    this._recordTouch('touchmove', x, y);

    if (this.gp.dragState && this.gp.dragState.type === 'rotate') {
      // 旋转持续音效（首次播放）
      if (!this._rotateHandle) {
        this._rotateHandle = audio.playLooped('rotate_loop');
      }
      var boardPos = this.gp.screenToBoard(x, y);
      this.gp.handleRotateDrag(boardPos.x, boardPos.y);
    }
  }

  onTouchEnd(x, y) {
    this._guide.onPlayerAction();  // 松手操作 → 重置空闲计时
    this._recordTouch('touchend', x, y);

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
    if (!pig) return false;

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
      this._escapedCount++;
      // 如果推出的是提示目标 → 清除提示
      this._hint.onPigExited(pigId);
      if (!opts.skipStep) { this.steps++; databus.currentStep = this.steps; }

      // 金币磁吸飞行：仅「首通本关」才飞金币（与金币发放逻辑一致），重玩已通关关卡不再飞金币
      if (databus.returnState !== 'editor' && this._uiGoldWidget && this._isFirstGoldClear) {
        var tailHole = this.gp.holes[pig.tailIndex];
        if (tailHole) {
          var tailSX = this.gp.boardOffsetX + tailHole.x;
          var tailSY = this.gp.topBarH + this.gp.boardOffsetY + tailHole.y;
          var pushDirX = result.dirX;
          var pushDirY = result.dirY;

          // 沿推离方向，找到尾孔到屏幕边界的交点（金币从边缘弹出）
          var edgeX = tailSX, edgeY = tailSY, tMin = Infinity, t;

          // 右边界
          if (pushDirX > 0.001) {
            t = (SCREEN_WIDTH - tailSX) / pushDirX;
            if (t > 0 && t < tMin) { tMin = t; edgeX = SCREEN_WIDTH; edgeY = tailSY + t * pushDirY; }
          }
          // 左边界
          if (pushDirX < -0.001) {
            t = -tailSX / pushDirX;
            if (t > 0 && t < tMin) { tMin = t; edgeX = 0; edgeY = tailSY + t * pushDirY; }
          }
          // 下边界
          if (pushDirY > 0.001) {
            t = (SCREEN_HEIGHT - tailSY) / pushDirY;
            if (t > 0 && t < tMin) { tMin = t; edgeY = SCREEN_HEIGHT; edgeX = tailSX + t * pushDirX; }
          }
          // 上边界
          if (pushDirY < -0.001) {
            t = -tailSY / pushDirY;
            if (t > 0 && t < tMin) { tMin = t; edgeY = 0; edgeX = tailSX + t * pushDirX; }
          }

          // 金币区硬币中心（GoldWidget 在 (0,0)，COIN_X=16 COIN_SIZE=32）
          var goldCX = PlayDefine.PLAY.GOLD_FLY_TARGET.cx;  // = 32
          var goldCY = PlayDefine.PLAY.GOLD_FLY_TARGET.cy;  // = 106

          // 猪飞出动画用 easeOutCubic：猪在动画前半段就覆盖了大部分距离
          // 计算猪尾部到达屏幕边缘的实际时间（而非动画总时长）
          var distToEdge = tMin;  // 像素距离（dirX/dirY 是单位向量）
          var totalDist = result.totalDist;
          var ratio = Math.max(0, Math.min(1, distToEdge / totalDist));
          // easeOutCubic: eased = 1 - (1-p)^3，反解 p 得猪到边缘的进度
          var p = 1 - Math.pow(1 - ratio, 1 / 3);
          var pigFlyDuration = totalDist / ESCAPE_SPEED * 1000;  // 动画总时长
          var delay = p * pigFlyDuration + 40;  // +40ms 微缓冲确保猪已出屏
          var self = this;
          setTimeout(function () {
            audio.play('coin_fly');
            self._coinFlyEffect.trigger(edgeX, edgeY, goldCX, goldCY);
            // 不在此处 _levelAccumulatedGold++，等 CoinFlyEffect.update() 返回 arrived 时再 +1
          }, delay);
        }
      }

      // 统一逻辑：猪逃脱时缓存提示数据（通关后统一写入关卡配置）
      if (!this._hintMerged) {
        this._gameplayHintCache.push({ pigId: pigId, angle: pig.angle });
        console.log('[RecHint] 猪逃脱: pigId=' + pigId + ' hintCache=' + this._gameplayHintCache.length + ' → 收集提示');
        // 试玩模式：实时设 hintId/hintAngle 供显示（写盘延后到通关）
        if (databus.returnState === 'editor' && pig.hintId == null) {
          pig.hintId = this._trialHintNextId++;
          pig.hintAngle = pig.angle;
          this._hintedTrialCount++;
        }
      } else {
        console.log('[RecHint] 猪逃脱: pigId=' + pigId + ' → 跳过提示收集(_hintMerged=true)');
      }

      // 所有可逃脱精灵都逃脱 → 通关（rock 等障碍物不算）
      var canEscapeRemaining = this.gp.pigs.filter(function(p) { return p.type !== 'rock'; }).length;
      if (canEscapeRemaining === 0) {
        // 统一逻辑：通关后保存录制
        if (this._isRecording) {
          console.log('[RecHint] 通关: 保存录像 (isRecording=true)');
          this._trialStopRecord(true);
        } else {
          console.log('[RecHint] 通关: 跳过录像保存 (isRecording=false)');
        }
        // 统一逻辑：通关后保存提示数据（正式+试玩）
        if (!this._hintMerged && this._gameplayHintCache.length > 0) {
          this._hintMerged = true;
          console.log('[RecHint] 通关: 上传提示 (hintCache=' + this._gameplayHintCache.length + ')');
          this._mergeAndUploadHints();
        } else {
          console.log('[RecHint] 通关: 跳过提示上传 (hintMerged=' + this._hintMerged + ' hintCache=' + this._gameplayHintCache.length + ')');
        }
        if (databus.returnState !== 'editor') {
          // 正式模式：走结算流程
          this._markCleared();
          this._victory = true;
          this._victoryTime = Date.now();
          this._uiBottomBar.setHintHidden(true);  // 通关后隐藏提示按钮
          this._showHintCommon = false;
          console.log('[LOG_victory] 通关！pigs剩余=0 accumGold=' + this._levelAccumulatedGold + ' totalPigs=' + this._totalPigsInLevel);
        }
        // 试玩模式：不弹结算面板，数据已保存，停留在关卡界面
      }
      // 猪飞出屏幕后清理（动画结束时猪已离开屏幕，无需继续渲染）
      var animDuration = result.totalDist / ESCAPE_SPEED * 1000;
      setTimeout(() => {
        this.gp.flyingPigs = this.gp.flyingPigs.filter(p => p.id !== pigId);
        this.gp.animations = this.gp.animations.filter(a => a.pigId !== pigId);
      }, animDuration + 200);
      return true;
    } else if (result.collidedPigId !== undefined) {
      if (!opts.silentBlock) {
        this.gp.triggerCollisionEffect(result.collidedPigId);
      }
    }
    return false;
  }

  restartLevel() {
    audio.play('reset');
    this._skipRestore = true;
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
        wx.setStorageSync('lastLevelIndex', currentIdx);
        console.log('[关主] lastLevelIndex 推进到 ' + currentIdx);
      }
    }
    // 奖杯：试玩模式不写存储；已获得过则跳过，不再重复检查/写存储/播动画
    if (isTrial) {
      this._earnedCrown = false;
      this._gotCrown = false;
    } else if (this._hadCrownBefore) {
      // 仍设 _gotCrown=true 确保渲染显示金色（重玩场景）
      this._gotCrown = true;
      this._earnedCrown = false;
    } else if (this._crownSteps > 0 && this.steps <= this._crownSteps) {
      wx.setStorageSync('crown_' + databus.currentLevelIndex, true);
      this._earnedCrown = true;
      this._gotCrown = false;  // 动画期间保持灰色
      console.log('[奖杯] 获得！' + this.levelName + ' ' + this.steps + '/' + this._crownSteps + '步');
    } else {
      this._earnedCrown = false;
      this._gotCrown = false;
      console.log('[奖杯] 未获得 ' + this.levelName + ' ' + this.steps + '/' + (this._crownSteps || '?') + '步');
    }
    // 金币奖励：试玩模式不触发；首次通关本关 → 计算奖励金额
    //   首通判定与「飞金币」动画同源（this._isFirstGoldClear，进入关卡时计算）
    this._goldAmount = 0;
    this._stepBonusRemaining = 0;
    if (this._isFirstGoldClear) {
      var reward = GoldSystem.calculateReward(this._totalPigsInLevel);
      if (this._earnedCrown) {
        var stepBonus = Math.max(0, this._crownSteps - this.steps);
        if (stepBonus > 0) {
          this._stepBonusRemaining = stepBonus;
          reward += stepBonus;
        }
      }
      if (reward > 0) {
        this._goldAmount = reward;
      }
    }
    console.log('[LOG_victory] 奖励计算完成: goldAmount=' + this._goldAmount + ' stepBonusRemaining=' + this._stepBonusRemaining + ' earnedCrown=' + this._earnedCrown + ' isFirstTime=' + (!isTrial && currentIdx >= savedIdx));
    // 尝试夺关主（试玩模式则跳过）
    if (databus.returnState !== 'editor') {
      this._master.tryClaim({
        steps: this.steps,
        hasUsedRemove: false,
        isTrialMode: databus.returnState === 'editor',
        onShowAuthDialog: this._showMasterAuthButton.bind(this),
        onNewMaster: (function () {
          // 关主已确认，由 _checkAndStartMaster 处理动画
        }).bind(this),
        onClaimNotGranted: this._destroyAuthBtn.bind(this),
      });
    } else {
      console.log('[关主] 试玩模式，跳过关主判定');
    }
    // 异步同步到云端（fire-and-forget，不阻塞 UI）
    // 注：移至 _settleCoinsAndStartVictory 中金币入账后执行，此处删

    // 兜底定时器：试玩模式跳过（不弹结算面板）
    if (databus.returnState !== 'editor') {
    var self = this;
    console.log('[LOG_victory] 启动6s超时兜底定时器');
    this._settlementTimer = setTimeout(function () {
      if (self._victory && !self._showVictoryPanel) {
        console.log('[LOG_victory] 超时兜底触发，强弹面板！');
        self._finishVictorySequence();
      }
    }, PlayDefine.PLAY.LOAD_TIMEOUT);
    }

    // 正式玩法：通关后合并 hint 数据到关卡配置并上传云端
    if (databus.returnState !== 'editor' && !this._hintMerged && this._gameplayHintCache.length > 0) {
      this._hintMerged = true;
      this._mergeAndUploadHints();
    }
  }

  /** 通关后合并 hint 缓存到关卡 JSON 并上传云端（正式+试玩统一逻辑） */
  _mergeAndUploadHints() {
    var self = this;
    var cache = this._gameplayHintCache;
    if (cache.length === 0) return;
    var isTrial = databus.returnState === 'editor';
    try {
      var data;
      if (isTrial && databus.currentLevel && databus.currentLevel.data) {
        // 试玩模式：数据在内存中，直接操作
        data = databus.currentLevel.data;
      } else {
        // 正式模式：从本地文件读取
        var path = wx.env.USER_DATA_PATH + '/levels/' + this.levelName + '.json';
        var fs = wx.getFileSystemManager();
        data = JSON.parse(fs.readFileSync(path, 'utf8'));
      }
      var pigs = data.pigs;
      if (pigs) {
        for (var i = 0; i < cache.length; i++) {
          var p = pigs.find(function(pp) { return pp.id === cache[i].pigId; });
          if (p) {
            p.hintId = i + 1;
            p.hintAngle = cache[i].angle;
          }
        }
        // 写回本地文件
        var writePath = wx.env.USER_DATA_PATH + '/levels/' + this.levelName + '.json';
        wx.getFileSystemManager().writeFileSync(writePath, JSON.stringify(data, null, 2), 'utf8');
        console.log('[Hint] 关卡已写入 ' + cache.length + ' 条提示: ' + this.levelName);
        // 上传云端（已发布关卡也直接覆盖）
        cloud.uploadLevel(this.levelName, data, data.version || 0, null).then(function() {
          console.log('[cloud][Hint] 云端上传成功: ' + self.levelName);
        }).catch(function(e) {
          console.warn('[cloud][Hint] 云端上传失败:', e && e.message);
        });
      }
    } catch (e) {
      console.warn('[Hint] 合并提示数据失败:', e && e.message);
    }
  }

  /** 所有可逃脱的猪是否都已有 hintId */
  _allPigsHaveHints() {
    for (var i = 0; i < this.gp.pigs.length; i++) {
      var p = this.gp.pigs[i];
      if (p.type !== 'rock' && p.hintId == null) return false;
    }
    return true;
  }

  _syncToCloud() {
    try {
      var lastLevelIndex = wx.getStorageSync('lastLevelIndex');
      var info = wx.getStorageSync('userinfo_cache') || {};
      // 收集已获得奖杯的关卡 ID 列表
      var crowns = [];
      try {
        var infoRes = wx.getStorageInfoSync();
        if (infoRes.keys) {
          for (var i = 0; i < infoRes.keys.length; i++) {
            var k = infoRes.keys[i];
            if (k.indexOf('crown_') === 0) {
              var v = wx.getStorageSync(k);
              if (v === true || v === 'true') {
                crowns.push(parseInt(k.replace('crown_', ''), 10));
              }
            }
          }
        }
      } catch (e1) {}
      cloud.savePlayerData({
        lastLevelIndex: lastLevelIndex,
        crowns: crowns,
        gold: GoldSystem.getGold(),
        goldClaimedLevels: GoldSystem.collectClaimHistory(),
        skins: SkinSystem.getCloudState(),
        avatarUrl: info.avatarUrl || '',
        nickname: info.nickName || ''
      }).then(function() {
        console.log('[cloud] 玩家数据已同步到云端');
      }).catch(function(err) {
        console.warn('[cloud] 同步失败（非阻塞）:', err && err.message);
      });
    } catch (e2) {
      console.warn('[cloud] _syncToCloud 异常:', e2);
    }
  }

  /** 继续按钮 — 体力检查后进入下一关 */
  _onContinueClick() {
    // 从关卡选择进入 → 返回选择面板
    if (databus.returnState === 'levelSelect') {
      databus.gameState = 'levelSelect';
      return;
    }
    if (this._isLastLevelOfGame()) {
      console.log('[LOG_victory] 已是最后一关，返回主菜单');
      databus.gameState = 'menu';
      return;
    }
    // 体力检查
    var stamina = new StaminaSystem();
    stamina.load();
    if (!stamina.canPlay()) {
      if (stamina.getAdRemainingToday() > 0) {
        var self = this;
        StaminaAdPanel.open(
          stamina.getAdRemainingToday(),
          function () {
            stamina.claimAd();
          }
        );
      } else {
        StaminaAdPanel.openNoAds();
      }
      return;
    }
    stamina.consume();
    console.log('[LOG_victory] 用户点击继续 → 进入下一关 (current balance=' + GoldSystem.getGold() + ')');
    this._goNextLevel();
  }

  /** 从广告领取后继续（消费体力已在 claimAd 调用前完成） */
  _goNextLevelAfterStamina() {
    var stamina = new StaminaSystem();
    stamina.consume();
    this._goNextLevel();
  }

  /** 双倍金币 — 本地再补一倍（基础金币已入账），播放翻滚动画 */
  _onDoubleGoldClick() {
    console.log('[LOG_gold] 双倍金币点击: _goldAmount=' + this._goldAmount + ' 当前余额=' + GoldSystem.getGold() + ' goldWidget._gold=' + (this._uiGoldWidget && this._uiGoldWidget._gold));
    if (!this._uiVictoryPopup._goldClaimed && this._goldAmount > 0) {
      var bonus = this._goldAmount;
      GoldSystem.addGold(bonus);
      console.log('[LOG_gold] 双倍金币入账: +' + bonus + ' 余额=' + GoldSystem.getGold() + ' goldWidget._gold=' + (this._uiGoldWidget && this._uiGoldWidget._gold));
      audio.play('rewards');
      // 双倍入账后同步到云端
      this._syncToCloud();
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
        console.log('[cloud][关主] onTap 获取到真实头像昵称，开始重传关主');
        that._master.retryClaimWithRealInfo(that.steps, info.nickName || '', info.avatarUrl || '')
          .then(function (result) {
            console.log('[cloud][关主] onTap claimLevelMaster 返回 code=' + (result ? result.code : 'null') + ' claimed=' + (result ? result.claimed : 'null'));
          })
          .catch(function (err) {
            console.warn('[cloud][关主] onTap claimLevelMaster 失败:', err);
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
   * 检查关主状态 + 缓存头像 → 启动关主飞行 / 直接标记完成。
   */
  _checkAndStartMaster() {
    if (!this._master.isNewMaster()) {
      console.log('[LOG_victory] 非新关主（或判定未完成）→ 直接标记关主完成');
      this._masterAnimFinished = true;
      this._tryFinishParallel();
      return;
    }
    // 新关主：从缓存加载头像
    var cache = wx.getStorageSync('userinfo_cache');
    var self = this;
    var tryPath = cache && cache.avatarPath ? cache.avatarPath : null;
    var fallbackUrl = cache && cache.avatarUrl ? cache.avatarUrl : null;

    function onLoadFail() {
      // avatarPath 失败 → 尝试从 avatarUrl 重新下载
      if (fallbackUrl) {
        console.log('[LOG_victory] 头像缓存失效，从URL重新下载: ' + fallbackUrl);
        wx.downloadFile({
          url: fallbackUrl,
          success: function (res) {
            if (res.statusCode === 200) {
              var saved = cache || {};
              saved.avatarPath = res.tempFilePath;
              wx.setStorageSync('userinfo_cache', saved);
              var img = wx.createImage();
              img.onload = function () { self._victoryAnim.startMaster(img); };
              img.onerror = onLoadFailDone;
              img.src = res.tempFilePath;
            } else { onLoadFailDone(); }
          },
          fail: onLoadFailDone,
        });
      } else { onLoadFailDone(); }
    }

    function onLoadFailDone() {
      console.log('[LOG_victory] 关主头像加载失败 → 标记完成');
      self._masterAnimFinished = true;
      self._tryFinishParallel();
    }

    if (tryPath) {
      console.log('[LOG_victory] 新关主！启动头像飞行（并行, 缓存路径=' + tryPath + '）');
      var img = wx.createImage();
      img.onload = function () {
        console.log('[LOG_victory] 关主头像加载成功，启动飞行');
        self._victoryAnim.startMaster(img);
      };
      img.onerror = onLoadFail;
      img.src = tryPath;
    } else {
      onLoadFail();
    }
  }

  /**
   * 关主判定轮询（已废弃：不再等待服务器回包，此处保留空壳兼容 render 调用）
   */
  _checkMasterAnimWaiting() {}

  /**
   * 结算入库 + 启动并行动画：步数奖励 → 奖杯+关主(同时) → 弹窗
   * 金币已在 _goldAmount 中计算好，此处立即入账。
   */
  _settleCoinsAndStartVictory() {
    console.log('[LOG_victory] 开始结算入库: goldAmount=' + this._goldAmount + ' stepBonusRemaining=' + this._stepBonusRemaining + ' earnedCrown=' + this._earnedCrown);
    // 立即入库
    if (this._goldAmount > 0) {
      GoldSystem.addGold(this._goldAmount);
      console.log('[LOG_victory] 金币入账: +' + this._goldAmount + ' 余额=' + GoldSystem.getGold());
    }
    this._goldSettled = true;
    this._levelAccumulatedGold = 0;  // 清零累积，防止旧计数值叠加显示
    // 强制同步 GoldWidget 内部值（避免翻滚从旧残留值起跳）
    if (this._uiGoldWidget) this._uiGoldWidget.forceSet(GoldSystem.getGold());
    // 清除兜底定时器（正常路径已完成结算）
    if (this._settlementTimer) { clearTimeout(this._settlementTimer); this._settlementTimer = null; }

    // 金币已入账 → 同步到云端
    this._syncToCloud();

    var self = this;
    // 步数奖励 → 结束后并行启动奖杯+关主
    if (self._stepBonusRemaining > 0) {
      console.log('[LOG_victory] → 启动步数ticker(' + self._stepBonusRemaining + '步)');
      self._startStepBonusTicker(self._stepBonusRemaining);
      return;
    }
    // 无步数奖励：直接并行启动奖杯 + 关主
    self._startParallelCrownAndMaster();
  }

  /**
   * 并行启动奖杯和关主动画（两者同时飞）。
   * 任一完成标记 finish flag，两个都完成 → _finishVictorySequence。
   */
  _startParallelCrownAndMaster() {
    // 启动奖杯（如果有）
    if (this._earnedCrown) {
      console.log('[LOG_victory] → 启动奖杯飞行（并行）');
      this._victoryAnim.startCrown();
    } else {
      this._crownAnimFinished = true;  // 无奖杯，直接标记完成
    }
    // 启动关主（如果有缓存头像）
    this._checkAndStartMaster();
  }

  /**
   * 每帧检查：奖杯和关主都完成 → 弹窗
   */
  _tryFinishParallel() {
    if (this._crownAnimFinished && this._masterAnimFinished) {
      console.log('[LOG_victory] ★ 并行动画全部完成，弹出结算面板');
      this._finishVictorySequence();
    }
  }

  /**
   * 测试按钮：播放奖杯+关主中央亮相动画（纯视觉）
   */
  _testAwardEffect() {
    // 强制重置并重新启动（杀旧动画）
    this._victoryAnim.reset();
    this._crownAnimFinished = false;
    this._masterAnimFinished = false;
    // 启动奖杯
    this._victoryAnim.startCrown();
    this._crownAnimFinished = false;
    // 关主头像：优先缓存，无则从 URL 下载
    var cache = wx.getStorageSync('userinfo_cache');
    var self = this;
    var tryPath = cache && cache.avatarPath ? cache.avatarPath : null;
    var fallbackUrl = cache && cache.avatarUrl ? cache.avatarUrl : null;

    function loadMasterFromPath(path) {
      var img = wx.createImage();
      img.onload = function () { self._victoryAnim.startMaster(img); };
      img.onerror = function () { self._masterAnimFinished = true; };
      img.src = path;
    }

    if (tryPath) {
      loadMasterFromPath(tryPath);
    } else if (fallbackUrl) {
      wx.downloadFile({
        url: fallbackUrl,
        success: function (res) {
          if (res.statusCode === 200) {
            var saved = cache || {};
            saved.avatarPath = res.tempFilePath;
            wx.setStorageSync('userinfo_cache', saved);
            loadMasterFromPath(res.tempFilePath);
          } else { self._masterAnimFinished = true; }
        },
        fail: function () { self._masterAnimFinished = true; },
      });
    } else {
      this._masterAnimFinished = true;
    }
  }

  /**
   * 测试按钮"画"：同时播金币炸开 + 奖杯 + 关主飞行动画
   */
  _testPlayAll() {
    this._testBurstEffect();
    this._testAwardEffect();
  }

  /**
   * 测试按钮：触发 4 枚步数金币的炸开飞行动画（纯视觉，不关联任何游戏逻辑）
   */
  _testBurstEffect() {
    audio.play('coin_fly');
    // 临时标记，阻止 coinArrived 修改游戏状态
    this._testAnimActive = true;
    var self = this;
    var fromX = SCREEN_WIDTH - 98;
    var fromY = 106;
    var toX = 32;
    var toY = 106;
    for (var i = 0; i < 4; i++) {
      setTimeout(function () {
        self._coinFlyEffect.trigger(fromX, fromY, toX, toY, true);
      }, i * 80);
    }
    setTimeout(function () {
      self._testAnimActive = false;
    }, 1200);
  }

  /** 棋盘可用区域调试框 */
  _drawBoardBounds(ctx) {
    var gp = this.gp;
    var availH = SCREEN_HEIGHT - gp.topBarH - gp.bottomStripH;
    var offY = gp.topBarH + gp.boardOffsetY;
    var firstHoleY = offY + gp.scaledHalfDiameter;
    var lastHoleY = offY + gp.scaledHalfDiameter + (gp.rows - 1) * gp.vSpacing;
    var topGap = firstHoleY - gp.topBarH;
    var botGap = (gp.topBarH + availH) - lastHoleY;

    ctx.save();

    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#FF0000';
    ctx.fillRect(0, 0, SCREEN_WIDTH, gp.topBarH);
    ctx.fillStyle = '#FF0000';
    ctx.fillRect(0, SCREEN_HEIGHT - gp.bottomStripH, SCREEN_WIDTH, gp.bottomStripH);

    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = '#00FF00';
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(gp.boardOffsetX, gp.topBarH, gp.boardWidth, availH);
    ctx.setLineDash([]);

    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#FFFF00';
    var lx = gp.boardOffsetX + gp.boardWidth + 6;
    ctx.textBaseline = 'middle';
    ctx.fillText('tGap=' + Math.round(topGap) + ' bGap=' + Math.round(botGap), lx, gp.topBarH + availH / 2);
    ctx.fillText('rows=' + gp.rows + ' cols=' + gp.oddCols + ' VH=' + Math.round((gp.rows - 1) * gp.vSpacing + gp.scaledDiameter), lx, gp.topBarH + availH / 2 + 14);

    ctx.restore();
  }

  /**
   * 步数金币飞行 ticker：1秒内均匀递减，每 tick 驱动：
   *   数字 -1 → 进度条 -1格 → 触发一枚金币磁吸飞行
   * ticker 完成 → startCrown() 奖杯动画
   */
  _startStepBonusTicker(remaining) {
    // 启动 CrownPigWidget 步数奖励动画（纯视觉效果）
    if (this._uiCrownPig) {
      this._uiCrownPig.startStepBonusAnim(remaining);
    }
    var self = this;
    var totalTicks = remaining;
    var interval = Math.floor(1000 / totalTicks);
    var ticked = 0;
    // 步数底框中心 → 金币图标中心（右→左）
    var fromX = SCREEN_WIDTH - 98;  // CrownPigWidget crown centerX
    var fromY = 106;                // CrownPigWidget crown centerY
    var toX = 32;                   // GoldWidget coin centerX
    var toY = 106;                  // GoldWidget coin centerY

    var ticker = setInterval(function () {
      ticked++;
      var newRemaining = remaining - ticked;

      // 更新展示公式用变量（同步：GoldSystem.getGold() - _stepBonusRemaining）
      self._stepBonusRemaining = Math.max(0, newRemaining);

      // 触发金币磁吸飞行（步数奖励=炸开模式）
      audio.play('coin_fly');
      self._coinFlyEffect.trigger(fromX, fromY, toX, toY, true);
      if (self._uiGoldWidget) self._uiGoldWidget.triggerBurstBreathe();

      // 更新 CrownPigWidget 进度条和文字
      if (self._uiCrownPig) {
        self._uiCrownPig.setStepBonusRemaining(newRemaining);
      }

      if (ticked >= totalTicks) {
        clearInterval(ticker);
        console.log('[LOG_victory] 步数ticker完成 → 等待金币飞入...');
        self._gotCrown = true;
        if (self._uiCrownPig) {
          self._uiCrownPig.endStepBonusAnim();
        }
        // 等所有步数金币飞入后再启动奖杯+关主动画（coin fly 600ms + buffer）
        setTimeout(function () {
          self._startParallelCrownAndMaster();
        }, 700);
      }
    }, interval);
  }

  /**
   * 所有通关动画（奖杯+关主）播放完毕，显示结算面板。
   */
  _finishVictorySequence() {
    console.log('[LOG_victory] ★ 结算面板弹出！_showVictoryPanel=true, goldAmount=' + this._goldAmount + ' balance=' + GoldSystem.getGold());
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
    if (!this._uiTopBar) return;

    // ===== 场景背景图（覆盖 GameEngine 的菜单背景）=====
    if (this._sceneBgLoaded) {
      var imgW = this._sceneBgImg.width;
      var imgH = this._sceneBgImg.height;
      var scale = Math.max(SCREEN_WIDTH / imgW, SCREEN_HEIGHT / imgH);
      var dw = imgW * scale;
      var dh = imgH * scale;
      var dx = (SCREEN_WIDTH - dw) / 2;
      var dy = (SCREEN_HEIGHT - dh) / 2;
      ctx.drawImage(this._sceneBgImg, dx, dy, dw, dh);
    }

    const safeTop = databus.safeTop;

    // 计算布局参数 — boardCard 跟随棋盘位置
    var boardScreenY = this.gp.topBarH + this.gp.boardOffsetY;
    this._boardCardX = Theme.spacing.padding;
    this._boardCardY = Math.min(
      safeTop + Theme.spacing.padding + Theme.layout.topBarH + Theme.spacing.cardGap - 30,
      boardScreenY - Theme.spacing.cardPadding
    );
    this._boardCardW = SCREEN_WIDTH - Theme.spacing.padding * 2;
    this._bottomBarY = SCREEN_HEIGHT - Theme.layout.bottomBarH - Theme.spacing.padding;
    this._boardCardH = this._bottomBarY - Theme.spacing.cardGap - this._boardCardY;

    // 同步引擎数据 → UI 组件
    this._syncUIData();

    // ---- 入场动画三阶段：棋盘 → 猪渐显 → UI飞入 ----
    var es = this._entranceState;
    if (es && es.phase !== 'done') {
      var now = Date.now();
      // 阶段切换（else if 链，每帧最多跳一次）
      if (es.phase === 'board' && now - es.startTime >= es.pigFadeDelay) {
        es.phase = 'pigs';
      } else if (es.phase === 'pigs' && now - es.startTime >= es.uiStart) {
        es.phase = 'ui';
      } else if (es.phase === 'ui' && now - es.startTime >= es.totalDuration) {
        es.phase = 'done';
      }
    }
    var entranceActive = es && es.phase !== 'done';
    var eElapsed = entranceActive ? (Date.now() - es.startTime) : 0;

    // 辅助曲线
    function _easeOut(t) {
      t = Math.max(0, Math.min(1, t));
      return t * (2 - t);  // quadratic ease-out
    }
    function _easeOutCubic(t) {
      t = Math.max(0, Math.min(1, t));
      return 1 - Math.pow(1 - t, 3);
    }

    // 猪 alpha（无入场状态或 board 阶段恒为 0；pigs 阶段 0→1；ui/done 恒为 1）
    var pigAlpha = 1;
    if (!es || es.phase === 'board') {
      pigAlpha = 0;
    } else if (es.phase === 'pigs') {
      var t = Math.min(1, (eElapsed - es.pigFadeDelay) / es.pigFadeDur);
      pigAlpha = _easeOut(t);
    }

    // 加载中：不显示任何 UI（设置/关主/提示/奖杯等），仅显示加载提示
    if (this._loading) {
      // 加载提示
      ctx.save();
      ctx.fillStyle = Theme.colors.textSecondary || '#999';
      ctx.font = '14px ' + Theme.font.family + '';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('加载关卡中...', SCREEN_WIDTH / 2, this._boardCardY + this._boardCardH / 2);
      ctx.restore();
      return;
    }

    // 1. 棋盘主体 — 每帧重算偏移，确保与配置值同步
    this.gp.topBarH = safeTop + BD_TOP;
    this.gp.bottomStripH = BD_BOTTOM;
    var availH = SCREEN_HEIGHT - this.gp.topBarH - this.gp.bottomStripH;
    var visualH = (this.gp.rows - 1) * this.gp.vSpacing + this.gp.scaledDiameter;
    this.gp.boardOffsetY = Math.max(0, Math.floor((availH - visualH) / 2));
    this.gp.renderBoard(ctx, {
      hintPigId: this._hint.getTargetId(),
      guidePigId: this._guide.getActiveGuidePigId(),
      entrancePigAlpha: pigAlpha,
    });

    // 2. 通关飞行特效动画（VictoryAnimation）
    //    更新状态（不在这里 render，render 在 UI 分支里、面板之后调）
    this._checkMasterAnimWaiting();
    this._victoryAnim.setLayout(this._boardCardX, this._boardCardY, this._boardCardW, SCREEN_WIDTH, SCREEN_HEIGHT);
    this._victoryAnim.update();
    // 通关后孔洞渐隐（1s 内 alpha 1→0）
    if (this._victory) {
      var elapsed = Date.now() - this._victoryTime;
      this.gp.fadeAlpha = Math.max(0, 1 - elapsed / 1000);
    }

    // ---- UI 渲染（受入场动画控制）----
    if (!entranceActive) {
      // 动画结束：正常渲染所有 UI
      // 3. 关主卡片（先渲染，作为底层）
      this._uiMasterPanel.render(ctx);
      // 3.8 奖杯（UIManager）
      this._uiCrownPig.render(ctx);
      // 4. 顶栏（UIManager）
      this._uiTopBar.render(ctx);
      // 4.5. 金币余额（非通关时正常渲染；通关结算时浮于遮罩之上，保持延续性）
      if (!this._showVictoryPanel && this._uiGoldWidget) {
        this._uiGoldWidget.render(ctx);
      }
      // 试玩模式：关卡标题 + 顶栏按钮
      if (databus.returnState === 'editor') {
        // 关卡标题（居中）
        var levelN = (databus.trialCurrentIdx >= 0) ? (databus.trialCurrentIdx + 1) : '?';
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        var titleW = 80, titleH = 24;
        var titleX = (SCREEN_WIDTH - titleW) / 2;
        var titleY = safeTop + 4;
        roundRect(ctx, titleX, titleY, titleW, titleH, 6);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 13px ' + Theme.font.family + '';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('第 ' + levelN + ' 关', titleX + titleW / 2, titleY + titleH / 2);
        ctx.restore();

        var infoY = safeTop + 34, infoH = 24;
        var btnH = infoH;

        // 布局：固定从右边界排列，下一关隐藏时空位保留
        var playW = 48, nextW = 60, resetW = 48;
        var btnGap = 6;
        var nextX = SCREEN_WIDTH - Theme.spacing.padding - nextW;
        var playX = nextX - btnGap - playW;
        var resetX = playX - btnGap - resetW;

        // --- 提示进度 ---
        ctx.save();
        var infoW = resetX - 12 - btnGap;  // 左边界到重置按钮之间
        if (infoW < 70) infoW = 70;
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(12, infoY, infoW, infoH);
        ctx.fillStyle = '#FFD700';
        ctx.font = 'bold 12px ' + Theme.font.family + '';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('提示进度：' + this._hintedTrialCount + '/' + this._totalPigsInLevel, 12 + infoW / 2, infoY + infoH / 2);
        ctx.restore();

        // --- 重置按钮 ---
        this._trialResetBtn = { x: resetX, y: infoY, w: resetW, h: btnH };
        _drawTrialBtn(ctx, resetX, infoY, resetW, btnH, '重置', '#607D8B',
          this._btnPress.getScale('trialReset'));

        // --- 回放按钮 ---
        var hasRecord = !!wx.getStorageSync('trial_record_' + this.levelName);
        var playLabel = this._isPlayingBack ? '回放中' : (hasRecord ? '回放' : '暂无回放');
        var playColor = hasRecord ? '#FF9800' : '#999';
        this._trialPlayBtn = { x: playX, y: infoY, w: playW, h: btnH };
        var playScale = this._btnPress.getScale('trialPlay');
        if (hasRecord) {
          _drawTrialBtn(ctx, playX, infoY, playW, btnH, playLabel, playColor, playScale);
        } else {
          ctx.save();
          var pcx = playX + playW / 2, pcy = infoY + btnH / 2;
          ctx.translate(pcx, pcy); ctx.scale(playScale, playScale); ctx.translate(-pcx, -pcy);
          ctx.fillStyle = '#555';
          roundRect(ctx, playX, infoY, playW, btnH, 6);
          ctx.fill();
          ctx.fillStyle = '#999';
          ctx.font = 'bold 10px ' + Theme.font.family + '';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(playLabel, pcx, pcy);
          ctx.restore();
        }

        // --- 下一关 ---
        if (!this._isTrialLastLevel()) {
          this._trialNextBtn = { x: nextX, y: infoY, w: nextW, h: btnH };
          _drawTrialBtn(ctx, nextX, infoY, nextW, btnH, '下一关', '#FF9800',
            this._btnPress.getScale('trialNext'));
        } else {
          this._trialNextBtn = null;
        }

        // 回放触控位置指示圆点
        if (this._isPlayingBack && this._playbackDotPos) {
          ctx.save();
          ctx.fillStyle = 'rgba(255, 87, 34, 0.7)';
          ctx.beginPath();
          ctx.arc(this._playbackDotPos.x, this._playbackDotPos.y, 6, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.restore();
        }
      }
      // 5. 底部栏（UIManager）
      this._uiBottomBar.render(ctx);
    } else if (es.phase === 'ui') {
      // UI 飞入动画（500ms，ease-out cubic）
      var uiT = Math.min(1, (eElapsed - es.uiStart) / es.uiDur);
      var ease = _easeOutCubic(uiT);
      // 上方控件：从 y=-200 落到 y=0（同时）
      var topItems = [
        { comp: this._uiTopBar,    cond: true },
        { comp: this._uiGoldWidget, cond: !this._showVictoryPanel && this._uiGoldWidget },
        { comp: this._uiCrownPig,   cond: true },
      ];
      for (var i = 0; i < topItems.length; i++) {
        var item = topItems[i];
        if (!item.comp || item.cond === false) continue;
        var dy = -200 * (1 - ease);
        var alpha = uiT < 0.03 ? 0 : 1;
        ctx.save();
        ctx.translate(0, dy);
        ctx.globalAlpha = alpha;
        item.comp.render(ctx);
        ctx.restore();
      }
      // 下方控件：从 y=+200 落到 y=0（同时）
      var bottomItems = [
        { comp: this._uiMasterPanel, cond: true },
        { comp: this._uiBottomBar,  cond: true },
      ];
      for (var i = 0; i < bottomItems.length; i++) {
        var item = bottomItems[i];
        if (!item.comp || item.cond === false) continue;
        var dy = 200 * (1 - ease);
        var alpha = uiT < 0.03 ? 0 : 1;
        ctx.save();
        ctx.translate(0, dy);
        ctx.globalAlpha = alpha;
        item.comp.render(ctx);
        ctx.restore();
      }
    } else {
      // board 或 pigs 阶段：不渲染任何 UI 控件
    }

    // 5.5 测试按钮 — 编辑器后门解锁后出现
    if (databus.debugUnlocked) {
    var testBx = 10, testBy = 120, testBw = 30, testBh = 30;
    // "画" 按钮
    ctx.fillStyle = 'rgba(33,150,243,0.6)';
    ctx.beginPath();
    ctx.arc(testBx + testBw / 2, testBy + testBh / 2, testBw / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px ' + Theme.font.family + '';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('画', testBx + testBw / 2, testBy + testBh / 2);
    this._testBtn = { x: testBx, y: testBy, w: testBw, h: testBh };

    // "框" 按钮（棋盘可用区域）
    var boundBx = testBx + testBw + 8, boundBy = testBy;
    ctx.fillStyle = 'rgba(33,150,243,0.6)';
    ctx.beginPath();
    ctx.arc(boundBx + testBw / 2, boundBy + testBh / 2, testBw / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText('框', boundBx + testBw / 2, boundBy + testBh / 2);
    this._testBoundBtn = { x: boundBx, y: boundBy, w: testBw, h: testBh };

    // "回" 按钮（回放，有数据时才显示）
    var hasReplay = this._hasReplayData();
    if (hasReplay) {
    var autoBx = boundBx + testBw + 8, autoBy = testBy;
    ctx.fillStyle = 'rgba(33,150,243,0.6)';
    ctx.beginPath();
    ctx.arc(autoBx + testBw / 2, autoBy + testBh / 2, testBw / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText('回', autoBx + testBw / 2, autoBy + testBh / 2);
    this._testAutoBtn = { x: autoBx, y: autoBy, w: testBw, h: testBh };
    } else {
      this._testAutoBtn = null;
    }
    } else {
      this._testBtn = null;
      this._testBoundBtn = null;
      this._testAutoBtn = null;
    }

    // 棋盘可用区域调试框
    if (this._showBoardBounds) {
      this._drawBoardBounds(ctx);
    }

    // 提示/移除按钮（CommonButton，右下角，入场后可见）
    if (this._hintCommonBtn && this._hintCommonBtn.visible) {
      this._hintCommonBtn.render(ctx);
    }

    // 6. 通关弹窗（UIManager）
    if (this._victory && this._showVictoryPanel) {
      this._uiVictoryPopup.render(ctx);
      // 方案D：金币区浮于遮罩之上，全程可见，保持结算延续性
      if (this._uiGoldWidget) this._uiGoldWidget.render(ctx);
    }

    // 7. 关主授权对话框（UIManager）
    if (this._showAuthDialog) {
      this._uiAuthDialog.render(ctx);
    }

    // 8. 设置面板（保持原有）
    settingsPanel.render(ctx);
    StaminaAdPanel.render(ctx);  

    // 9. 金币磁吸飞行动画（推猪时触发，飞向金币区）—— 最高层级，不被任何 UI 遮挡
    var coinArrived = this._coinFlyEffect.update();
    this._coinFlyEffect.render(ctx);
    // 奖杯/关主飞行动画（最高图层，覆盖所有 UI）
    this._victoryAnim.render(ctx);
    // 金币到达 → 播放音效 + 触发 GoldWidget 呼吸 + "+1" 浮字
    if (coinArrived > 0 && this._uiGoldWidget && !this._testAnimActive) {
      // 结算已入库 → 不再累加计数（保留视觉效果）
      if (!this._goldSettled) {
        audio.play('coin_get');
      }
      for (var ca = 0; ca < coinArrived; ca++) {
        if (!this._goldSettled) {
          this._levelAccumulatedGold++;
        }
        this._uiGoldWidget.setData(GoldSystem.getGold() + this._levelAccumulatedGold);
        this._uiGoldWidget.triggerBreathe();
        this._uiGoldWidget.addFloatText();
      }
    }
    // 磁吸光晕：飞行中金币越靠近目标光晕越强
    if (this._uiGoldWidget) {
      this._uiGoldWidget.setMagnetGlow(this._coinFlyEffect.getNearestProgress());
    }
    // 结算触发：通关后所有金币到齐（或超时兜底）
    if (this._victory && !this._settlementTriggered && databus.returnState !== 'editor') {
      var coinsDone = this._levelAccumulatedGold >= this._totalPigsInLevel;
      var timeoutCheck = !this._coinFlyEffect.isActive() && Date.now() - this._victoryTime > 1500;
      if (coinsDone || timeoutCheck) {
        console.log('[LOG_victory] 结算触发！reason=' + (coinsDone ? 'coinsDone(accumGold=' + this._levelAccumulatedGold + '/' + this._totalPigsInLevel + ')' : 'timeout(elapsed=' + (Date.now() - this._victoryTime) + 'ms)'));
        this._settlementTriggered = true;
        this._settleCoinsAndStartVictory();
      }
    }

    // ===== 录制/提示状态指示器（左上角） =====
    this._renderStatusIndicators();
  }

  /** 左上角录制/提示状态指示器（水平排列） */
  _renderStatusIndicators() {
    var showRec = this._isRecording;
    var showHint = !this._hintMerged;
    if (!showRec && !showHint) return;
    // 设置面板打开时不显示（避免遮挡）
    if (settingsPanel.isOpen()) return;

    var indX = 5;
    var indY = 5;
    var iconR = 4;
    var itemH = 14;
    var cy = indY + itemH / 2;
    var gap = 10;

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 11px ' + Theme.font.family;

    var cursorX = indX;

    if (showRec) {
      // 录制图标：红色圆点 + 脉冲
      var pulse = 0.55 + 0.45 * Math.sin(Date.now() / 280);
      ctx.fillStyle = 'rgba(229,57,53,' + pulse.toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(cursorX + iconR, cy, iconR, 0, Math.PI * 2);
      ctx.fill();
      // 红色描边圈
      ctx.strokeStyle = '#E53935';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cursorX + iconR, cy, iconR + 1.5, 0, Math.PI * 2);
      ctx.stroke();
      // 文字
      ctx.fillStyle = '#E53935';
      ctx.fillText('rec...', cursorX + iconR * 2 + 4, cy);
      cursorX += iconR * 2 + 4 + ctx.measureText('rec...').width + gap;
    }

    if (showHint) {
      // 提示图标：琥珀色灯泡形（小圆 + 底部短柄）
      ctx.fillStyle = '#FFC107';
      ctx.beginPath();
      ctx.arc(cursorX + iconR, cy - 1, iconR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillRect(cursorX + iconR - 2, cy + iconR - 1, 4, 2.5);
      // 文字
      ctx.fillStyle = '#FFC107';
      ctx.fillText('hint...', cursorX + iconR * 2 + 4, cy);
    }

    ctx.restore();
  }

  // ============================================================
  // 提示系统（逻辑已迁移至 HintSystem.js）
  // PlayingEngine 仅保留 _removeHintedPig（涉及 board 操作 + victory 触发）
  // ============================================================
  _removeHintedPig() {
    wx.showToast({ title: '广告位招租', icon: 'none', duration: 1500 });
  }

  // ============================================================
  // 断点续玩（Checkpoint Resume）
  // ============================================================

  /** 保存当前关卡状态到本地持久化存储 */
  _saveCheckpoint() {
    // 仅最新关卡才写盘（定时器残留兜底）
    if (!this._isLatestUnexploredLevel()) return;
    if (!this.levelName) {
      console.log('[LOG_cp] 跳过保存: levelName 为空');
      return;
    }
    if (this.steps === 0) {
      console.log('[LOG_cp] 跳过保存: 步数为0，无操作无需保存');
      return;
    }
    if (databus.returnState === 'editor') {
      console.log('[LOG_cp] 跳过保存: 试玩模式');
      return;
    }
    if (this._victory) {
      console.log('[LOG_cp] 跳过保存: 已通关 (_victory=true)');
      return;
    }
    if (!this.gp.pigs.some(function(p) { return p.type !== 'rock'; })) {
      console.log('[LOG_cp] 跳过保存: 猪已全消');
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

  /** 判断当前关卡是否为最新未通关关卡 */
  _isLatestUnexploredLevel() {
    var idx = databus.currentLevelIndex;
    if (idx < 0) return false;
    var li = wx.getStorageSync('lastLevelIndex');
    var lastIdx;
    if (li === '' || li === undefined || li === null) {
      lastIdx = -1;
    } else {
      lastIdx = parseInt(li, 10);
    }
    // 必须紧接最后通关关卡（lastIdx + 1）
    return idx === lastIdx + 1;
  }

  /** 断点续传单函数：恢复 / 清理 / 启动定时器 */
  _updateCheckpoint() {
    var skipRestore = this._skipRestore;
    this._skipRestore = false;

    if (!this._isLatestUnexploredLevel()) {
      console.log('[LOG_cp] 非最新关卡，跳过 checkpoint');
      return;
    }

    var cp;
    try { cp = wx.getStorageSync('game_checkpoint'); } catch (e) { cp = null; }

    if (cp) {
      var match = cp.levelName === this.levelName
               && cp.version === this._levelVersion
               && !skipRestore;
      if (match) {
        console.log('[LOG_cp] ✓ 恢复存档: level=' + cp.levelName + ' steps=' + cp.steps + ' v=' + cp.version);
        this._doResume();
        wx.showToast({ title: '已恢复上次游玩进度', icon: 'none', duration: 2000 });
      } else {
        console.log('[LOG_cp] ✗ 清空存档: skipRestore=' + skipRestore + ' cpLevel=' + cp.levelName + ' curLevel=' + this.levelName + ' cpVer=' + cp.version + ' curVer=' + this._levelVersion);
        wx.removeStorageSync('game_checkpoint');
      }
    } else {
      console.log('[LOG_cp] 无存档，开始记录: level=' + this.levelName + ' v=' + this._levelVersion);
    }

    this._startCheckpointTimer();
  }

  /** 停止存档定时器 */
  _stopCheckpointTimer() {
    if (this._checkpointTimer) {
      clearInterval(this._checkpointTimer);
      console.log('[LOG_cp] 清除定时器');
      this._checkpointTimer = null;
    }
  }

  /** 启动 5 秒存档定时器（脏检测：只有步数或猪数量变化才真正写盘） */
  _startCheckpointTimer() {
    if (this._checkpointTimer) {
      console.log('[LOG_cp] 清除旧定时器，重新启动');
      clearInterval(this._checkpointTimer);
    }
    console.log('[LOG_cp] 启动 5 秒存档定时器 (level=' + this.levelName + ', version=' + this._levelVersion + ')');
    var self = this;
    this._checkpointTimer = setInterval(function() {
      // 脏检测：步数和猪数量都没变就不写盘
      if (self.steps === self._lastSavedSteps && self.gp.pigs.length === self._lastSavedPigCount) {
        return;
      }
      console.log('[LOG_cp] === 定时器触发，检测到变化，准备存档 ===');
      self._saveCheckpoint();
    }, PlayDefine.PLAY.CHECKPOINT_INTERVAL);
  }

  /** 从存档恢复关卡状态（在 loadLevel 之后调用） */
  _doResume() {
    var cp;
    try {
      cp = wx.getStorageSync('game_checkpoint');
    } catch (e) { cp = null; }
    console.log('[LOG_cp] _doResume: cp=' + !!cp + ' level=' + (cp && cp.levelName) + ' steps=' + (cp && cp.steps) + ' version=' + (cp && cp.version) + ' currentVersion=' + this._levelVersion);
    if (!cp) return;

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

    // 断点续玩且棋盘不完整：跳过录制和提示收集
    if (removedCount > 0) {
      this._escapedCount = removedCount;  // 标记棋盘不完整，_allPigsOnBoard() 返回 false
      this._hintMerged = true;            // 跳过提示收集，避免残缺 hint 覆盖旧数据
      console.log('[RecHint] 断点续玩: 棋盘不完整(removed=' + removedCount + ') → 跳过录制+提示收集');
    } else {
      console.log('[RecHint] 断点续玩: 棋盘完整(removed=0) → 正常启动录制+提示收集');
    }

    // 恢复完成后不清理存档 — 由 30 秒定时器自然覆盖
    console.log('[LOG] 存档已恢复 steps=' + this.steps + ' pigs=' + this.gp.pigs.length);
  }
}

// 阿拉伯数字转中文数字（1~999）
function _toChineseNum(n) {
  if (n <= 0) return '零';
  if (n > 999) return String(n);
  var digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (n < 10) return digits[n];
  if (n < 20) return '十' + (n === 10 ? '' : digits[n - 10]);
  if (n < 100) {
    var tens = Math.floor(n / 10);
    var ones = n % 10;
    return digits[tens] + '十' + (ones === 0 ? '' : digits[ones]);
  }
  // 100-999
  var hundreds = Math.floor(n / 100);
  var rest = n % 100;
  var restStr = '';
  if (rest === 0) {
    restStr = '';
  } else if (rest < 10) {
    restStr = '零' + digits[rest];
  } else {
    restStr = _toChineseNum(rest);
  }
  return digits[hundreds] + '百' + restStr;
}

module.exports = PlayingEngine;
