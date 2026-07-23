// 关卡游玩引擎 — 组合 GameplayEngine 实现正式玩法

const databus = require('../databus.js');
const cloud = require('../cloud.js');
const compress = require('../libs/compress.js');   // 场外求助：解压云端 BASE64(DEFLATE) 快照/录制
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
const VictoryPopup = require('../ui/widgets/VictoryPopup.js');
const FailPopup = require('../ui/widgets/FailPopup.js');
const RightStepWidget = require('../ui/widgets/RightStepWidget.js');
const ItemButton = require('../ui/widgets/ItemButton.js');
const safeLayout = require('../utils/safeLayout.js');
const LevelCache = require('../preload/LevelCache.js');
const HintSystem = require('./HintSystem.js');
const CoinFlyEffect = require('../effects/CoinFlyEffect.js');
const ItemFlyEffect = require('../effects/ItemFlyEffect.js');
const BranchProgressWidget = require('../ui/widgets/BranchProgressWidget.js');
const StarScores = require('../utils/starScores.js');
const GoldWidget = require('../ui/widgets/GoldWidget.js');
const { showToast } = require('../ui/widgets/ToastWidget.js');
const GuideManager = require('../guide/GuideManager.js');
const GoldSystem = require('./GoldSystem.js');
const SkinSystem = require('./SkinSystem.js');
const StaminaAdPanel = require('../ui/StaminaAdPanel.js');
const CommonButton = require('../ui/widgets/CommonButton.js');
const ConfirmDialog = require('../ui/ConfirmDialog.js');   // 通用确认/提示窗（场外求助「已协助过」覆盖确认）
const LoadingDialog = require('../ui/LoadingDialog.js');   // 通用加载中窗（等待服务器回包 / 拉起微信分享时屏蔽触摸）
const Easing = require('../core/Easing.js');
const AssetPreloader = require('../ui/AssetPreloader.js');
const drawBottomBar = require('../ui/drawBottomBar.js');
const { drawPigCounter } = require('../ui/drawPigCounter.js');
const { drawGreenButton } = require('../ui/widgets/greenButton.js');
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
    // 提示系统
    this._hint = new HintSystem(this.gp);
    // 引导系统
    this._guide = new GuideManager(this);
    this._guide.register(new (require('../guide/Guide1.js'))());
    this._guide.register(new (require('../guide/Guide2.js'))());
    this._showVictoryPanel = false; // 结算面板是否可见（通关后先隐藏，金币/步数动画结束后再弹出）
    this._showHelpEndPanel = false;  // 场外求助协助关结束面板（替代 VictoryPopup，仅播步数动画后弹出）
    this._helpSendBtn = null;        // 协助结算面板中间「发给好友」蓝色按钮实例缓存（复位防串台）
    this._helpEndReason = null;      // 协助关结束原因：'cleared' | 'early' | 'failed'（驱动结算文案）
    this._helpSent = false;          // 协助结算：是否已点「发给好友」（点后中钮变「返回」、隐藏两侧图标）
    this._helpSending = false;       // 协助结算：正在「发给好友」异步发送中（期间屏蔽一切触控，结束后直接回主菜单）
    this._helpEndPanelShowTime = 0;  // 协助结算面板入场动画起始时间戳（0=未显示）
    this._victoryAnimStart = 0;     // 结算面板入场动画起始时间
    this._victoryAnimator = PopupAnimator.createPopupAnimator();
    this._victoryClosing = false;   // 结算面板是否正在关闭动画中
    // 失败状态（剩余步数=0 且未通关）
    this._failed = false;
    this._failAnimator = PopupAnimator.createPopupAnimator();
    this._failClosing = false;      // 失败面板是否正在关闭动画中
    this._loading = false;          // 是否正在加载（云端拉取中，阻止所有操作）
    this._lastFrameTime = 0;        // 上一帧时间戳（引导系统 dt 计算用）
    this._cloudFetchedData = new Map();  // 本次会话已拉取过的云端关卡数据 { name → data }
    // 断点续玩（实时镜像存储：状态一变化即写整份镜像，无定时器/无脏检测）
    this._levelVersion = 0;         // 当前关卡版本号
    this._skipRestore = false;       // 重玩标记（置 true 则跳过恢复）
    // 金币奖励
    this._goldAmount = 0;           // 本次通关奖励金币数（不含步数奖励）
    this._levelAccumulatedGold = 0;  // 本关实时累积金币（猪退出+1，异步递增仅用于 UI 实时显示）
    this._totalPigsInLevel = 0;      // 本关原始猪数量（loadLevel 时快照，结算用，不受 setTimeout 时序影响）
    this._coinFlyEffect = new CoinFlyEffect();  // 金币磁吸飞行动画
    this._itemFlyEffect = new ItemFlyEffect('addstep_icon');  // +3道具图标飞向步数面板
    this._totalScore = 30;            // 测试写死：总积分（进度条分母），后续改关卡配置读取
    this._starScores = [0, 0, 0, 0];   // 星级积分门槛 [s1,s2,s3,s4]
    this._victoryStar = 0;              // 本次通关结算星级（供结算面板展示，0~4）
    this._scoreBonusRemaining = 0;    // 通关后剩余步数转化的积分
    this._scoreBonusProgress = 0;     // 已灌入的积分
    this._scoreBonusSettled = false;  // 积分粒子结算完毕（防重入 _finishVictorySequence）
    this._stepFlowersSettled = true;   // 步数→飞小花完毕（与积分灌入共同决定结算面板弹出）；默认 true，仅飞小花时置 false
    this._showBoardBounds = false;    // 调试框：棋盘可用区域
    this._goldSettled = false;        // 通关结算已入库（入账后不再累积 _levelAccumulatedGold）
    this._isFirstGoldClear = false;    // 进入关卡时计算：本关是否首通（决定飞金币 + 金币发放）
    this._startedAsFrontier = false;   // 进入关卡时计算：本关是否为最新关(frontier)；供胜利按钮三态判定
    this._victoryAction = 'menu';      // 胜利按钮动作：menu / next / editor（_syncUIData 计算）
    this._settlementTriggered = false; // 结算已触发（防重入）
    this._settlementTimer = null;      // 2.5s 兜底定时器

    // 录制回放系统（试玩模式）
    this._isRecording = false;
    this._recordingStart = 0;
    this._externalHelpBusy = false;   // 场外求助发起中防重入
    this._helpReplayRecording = null; // 场外求助：回放待播放的录制
    this._helpReplaySrc = null;    // 场外求助：回放原始录制（再看一次复用，不被 activate 清空）
    this._replayDone = false;      // 场外求助：回放是否已播放完毕（决定「再看一次」显隐）
    this._replayStartTime = 0;    // 场外求助：回放正式开始播放的时间戳（进度条倒计时起点；0=预热满格态）
    this._replayDuration = 0;     // 场外求助：回放总时长(ms)=累积夹紧间隔+1000（进度条满格初值/倒计时初值）
    this._replayEndTime = 0;      // 场外求助：回放结束时刻（驱动结束按钮「从底部滑到屏幕中央」动画）
    this._replayCounting = false;     // 场外求助：回放进入后 3 秒倒计时进行中
    this._replayCountdownEnd = 0;     // 倒计时结束时间戳（Date.now()+3000）
    this._assistCounting = false;     // 场外求助：协助进入后 3 秒准备倒计时进行中（与回放一致的「准备」节拍）
    this._assistCountdownEnd = 0;     // 协助准备倒计时结束时间戳（Date.now()+3000）
    this._assistFadeStart = 0;        // 协助倒计时结束后的渐隐起点（0=未渐隐）；圈+数字+文案一起淡出 300ms
    this._assistLastNum = 0;          // 倒计时进行中每帧冻结的末位数字（避免结束瞬间 1→0 跳变）
    this._sceneFadeStart = 0;         // 场景首次出现整体渐显起点（0=未触发；每次进关由 _afterEnterLevel 复位）
    this._pendingLevelExpand = null;  // 关卡→关卡圆形过场冻结的旧关帧，待 _loadAndStart 新关底图就位后启动
    this._sceneFadeDur = 450;         // 场景整体渐显时长(ms)
    this._playbackSynthetic = false;  // 回放合成触控标志（区别于玩家真实触控，放行棋盘操作）
    this._helpOverlayBtns = [];    // 场外求助覆盖层按钮命中区（每帧重建）
    this._helpPress = {};          // 覆盖层按钮按压态（id -> { startTime, phase }），单点触控复用
    this._recordEntries = [];      // [{ type, x, y, dt }]
    this._isPlayingBack = false;
    this._playbackDotPos = null;  // { x, y } 回放当前合成触控落点（缓动跟随点锚定处）
    this._touchRipples = [];      // 回放触摸涟漪 [{ x, y, t0 }]：落点/抬手瞬间生成，扩散淡出
    this._touchFollow = null;     // { x, y } 缓动跟随的柔光接触点（拖动期间，避免瞬移刺眼）
    this._touchFollowLast = 0;    // 最近一次 touchmove 时间戳（用于接触点淡出）
    this._playbackTimer = null;

    // 场景背景图
    this._sceneBgImg = wx.createImage();
    this._sceneBgLoaded = false;
    this._levelReady = false;        // prepareLevel 并行加载是否完成
    this._levelLoadFailed = false;   // 并行加载是否失败
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
    this._showHelpEndPanel = false;   // 协助结束面板（替代 VictoryPopup）
    this._helpEndReason = null;      // 协助关结束原因：'cleared' | 'early' | 'failed'（驱动结算文案）
    this._helpSent = false;
    this._helpSending = false;
    this._helpEndPanelShowTime = 0;
    this._victoryAnimStart = 0;
    this._victoryAnimator.close();  // 立即关闭（无动画）
    this._victoryClosing = false;
    // 失败状态重置
    this._failed = false;
    this._failAnimator.close();     // 立即关闭（无动画）
    this._failClosing = false;
    this._hint.clear();
    this._guide.reset();
    this._lastFrameTime = 0;       // 防止切关卡时 dt 突增
    if (this._scoreBonusTimer) { clearTimeout(this._scoreBonusTimer); this._scoreBonusTimer = null; } // 清理上一关残留的步数转积分定时器
    // 金币奖励状态
    this._goldAmount = 0;
    this._levelAccumulatedGold = 0;
    this._bonusSteps = 0;          // 关卡内「+3步」累计加成（每关重置）
    this._bonusStepsPending = 0;   // 已逻辑加、但尚未"飞到步数牌"的 +3（视觉待释放；每关重置）
    // 积分进度条状态（每关重置）
    this._totalScore = 30;
    this._starScores = [0, 0, 0, 0];
    this._scoreBonusRemaining = 0;
    this._scoreBonusProgress = 0;
    this._scoreBonusSettled = false;
    this._stepFlowersSettled = true;
    this._scoreBonusAnim = null;        // 时间灌入动画状态
    if (this._uiBranchProgress) this._uiBranchProgress.setScore(0, this._totalScore);
    this._hasHintData = true;      // 关卡是否有 hint 数据（无则隐藏「提」按钮，与旧逻辑一致）
    this._totalPigsInLevel = 0;
    this._coinFlyEffect = new CoinFlyEffect();  // 重置飞行中动画
    this._itemFlyEffect = new ItemFlyEffect('addstep_icon');  // 重置道具飞行动画
    this._goldSettled = false;
    // 首通判定（与 _markCleared 金币奖励逻辑同源）：本关从未获得过金币奖励才飞金币。
    // 用此标志约束「小猪逃脱飞金币」动画，避免已通关关卡重玩仍飞金币（金币不再发放）。
    var liRaw = wx.getStorageSync('lastLevelIndex');
    var savedLi = (liRaw !== '' && liRaw !== undefined && liRaw !== null) ? parseInt(liRaw, 10) : -1;
    this._isFirstGoldClear = databus.returnState !== 'editor' && databus.currentLevelIndex > savedLi;
    // 进关即记录：本关是否为「最新关」(frontier，即首通关) —— 通关时 lastLevelIndex 会被改写，
    // 无法在胜利弹窗反推，故在进关时用 savedLi 判定并缓存。供胜利按钮三态判定（继续闯关 / 返回）。
    this._startedAsFrontier = databus.returnState !== 'editor' && databus.currentLevelIndex > savedLi;
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
    this._assistBaseEscaped = 0;   // 协助关残局已逃出基数（判定「额外跑出」是否为 0）
    this._revealStart = 0;         // 进入关卡过场：目标 UI 微淡入起点（0=非过场，alpha=1）
    this._isRecording = false;
    this._recordingStart = 0;
    this._recordEntries = [];
    this._isPlayingBack = false;
    this._playbackDotPos = null;
    this._touchRipples = [];
    this._touchFollow = null;
    this._touchFollowLast = 0;
    if (this._playbackTimer) { clearTimeout(this._playbackTimer); this._playbackTimer = null; }
    // 正式玩：通关后保存 hint 数据缓存
    this._gameplayHintCache = [];
    this._hintMerged = false;
    this._helpEnded = false;   // 场外求助：协助关「提前结束 / 通关」统一结束态标志
    this._helpSettlePending = false;  // 协助关结算兜底：等待最后一只逃逸猪动画播完才落定（对齐正式关）
    this._endBtnHideTime = 0;       // 协助关「协助完成」按钮渐隐时间戳（最后一只猪开始跑时置位）
    this._showHelpEndPanel = false;
    this._helpEndReason = null;      // 协助关结束原因：'cleared' | 'early' | 'failed'（驱动结算文案）
    this._helpSent = false;
    this._helpSending = false;
    this._helpEndPanelShowTime = 0;
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

      // Layer 2 — TopBar
      this._uiTopBar = new TopBar({
        zIndex: UIManager.LAYER.CONTROL,
        buttonPress: this._btnPress,
        mode: 'normal',
        onBack: function () {
          if (settingsPanel.isOpen()) {
            settingsPanel.close();
          } else {
            audio.play('button_click');
            settingsPanel.open({
              title: '设置',
              buttons: [
                { iconKey: 'btn_home', action: function() { audio.play('button_click'); settingsPanel.close(function() { if (databus.returnState === 'editor') { databus.gameState = 'editor'; } else { databus.gameState = 'menu'; databus._returningToMenu = true; } }); } },
                { iconKey: 'btn_continue', action: function() { audio.play('button_click'); settingsPanel.close(); } },
                { iconKey: 'btn_again', action: function() { audio.play('button_click'); settingsPanel.close(function() { self.restartLevel(); }); } },
              ]
            });
          }
        },
      });
      this.ui.add(this._uiTopBar, UIManager.LAYER.CONTROL);

      // Layer 2 — GoldWidget（金币余额显示；试玩与正式一致显示，试玩仅展示不落库）
      this._uiGoldWidget = new GoldWidget({
        zIndex: UIManager.LAYER.CONTROL,
      });
      this.ui.add(this._uiGoldWidget, UIManager.LAYER.CONTROL);

      // Layer INFO — 右上角剩余步数组件（还原旧版 CrownPigWidget 的步数显示，奖杯已删除）
      // safeY: 直接判断药丸矩形是否与胶囊水平重叠 → 重叠就用胶囊底推下去，不依赖 safeLineY 逐点查表
      var selfPE = this;
      this._safeL = safeLayout.getSafeLayout();
      var safeL = this._safeL;
      var stepSafeY = safeL.safeTop;  // 兜底：平面机无胶囊时 = safeArea.top
      if (safeL.capsule) {
        var pillLeftX = SCREEN_WIDTH - 14 - 66;        // OUTER_X
        var pillRightX = pillLeftX + 66;                // OUTER_X + OUTER_W
        var capL = safeL.capsule.left, capR = safeL.capsule.right;
        if (pillRightX > capL && pillLeftX < capR) {   // 水平有交集
          stepSafeY = safeL.capsule.bottom + 4;         // 胶囊底 + 留白
        }
      }
      this._pigSafeTop = safeL.safeLineY(SCREEN_WIDTH / 2);
      // 树枝进度条整体下移：猪面板底 + BRANCH_GAP，避免遮挡
      var PANEL_GAP = 2;        // 猪面板顶与安全线间距
      var PILL_H = 50;          // 猪面板药丸高度（drawPigCounter GEOM.pill.h）
      var BRANCH_GAP = 5;       // 面板底与树枝顶之间的间隙
      var ORIG_BRANCH_Y = 78;   // 树枝原始 Y（不加偏移时）
      var panelTop = Math.max(this._pigSafeTop + PANEL_GAP, 20);
      this._branchDeltaY = Math.max(0, panelTop + PILL_H + BRANCH_GAP - ORIG_BRANCH_Y);
      this._uiRightStep = new RightStepWidget({ zIndex: UIManager.LAYER.INFO, safeY: stepSafeY });
      this.ui.add(this._uiRightStep, UIManager.LAYER.INFO);

      // Layer OVERLAY — 树枝进度条（小虫沿树枝爬动表示进度）；层级高于 INFO/CONTROL，
      // 使「步数→积分」飞花能盖过右上角步数牌（飞花是 BranchProgressWidget 内部绘制内容，
      // 无法单独提层，故整体提升到非模态最高层 OVERLAY，仍低于结算面板 MODAL）。
      // 需求①：非普通关（assist / replay）整套隐藏树枝/小虫/装饰 → 不创建该组件（null 即跳过全部 render 调用）
      if (databus.playMode !== 'normal') {
        this._uiBranchProgress = null;
      } else {
        this._uiBranchProgress = new BranchProgressWidget({ x: 10, y: 78 + this._branchDeltaY, zIndex: UIManager.LAYER.OVERLAY });
        this.ui.add(this._uiBranchProgress, UIManager.LAYER.OVERLAY);
      }

      // 底部道具按钮：步数（居中 bottom:32）+ 提示（right:38 bottom:20）+ 求助（left:38 bottom:20）
      var BTN_W = 77, BTN_H = 77;
      var bottomY20 = SCREEN_HEIGHT - 20 - BTN_H;
      this._uiAddStepBtn = new ItemButton({ x: (SCREEN_WIDTH - BTN_W) / 2, y: SCREEN_HEIGHT - 32 - BTN_H, iconKey: 'level_item_addstep', label: '步数+3', count: this._addStepRemaining, side: 'left' });
      this._uiHintBtn   = new ItemButton({ x: SCREEN_WIDTH - 38 - BTN_W, y: bottomY20, iconKey: 'level_item_hint', label: '提示', count: this._hintRemaining, side: 'right' });
      this._uiHelpBtn   = new ItemButton({ x: 38, y: bottomY20, iconKey: 'level_item_help', label: '求助', count: 0, side: 'right' });

      // Layer 4 — VictoryPopup
      this._uiVictoryPopup = new VictoryPopup({
        zIndex: UIManager.LAYER.MODAL,
        onContinue: function () { self._onContinueClick(); },
        onReplay: function () { self.restartLevel(); },
        onExit: function () { databus.gameState = databus.returnState || 'menu'; },
        onDoubleGold: function () { self._onDoubleGoldClick(); },
      });
      this._uiVictoryPopup.setAnimator(this._victoryAnimator);
      this._uiVictoryPopup.setBranchWidget(this._uiBranchProgress);
      this.ui.add(this._uiVictoryPopup, UIManager.LAYER.MODAL);

      // Layer 4 — FailPopup（步数用尽时弹出）
      this._uiFailPopup = new FailPopup({
        zIndex: UIManager.LAYER.MODAL,
        onReplay: function () { self.restartLevel(); },
        onExit: function () {
          if (databus.returnState === 'editor') { databus.gameState = 'editor'; }
          else { databus._returningToMenu = true; databus.gameState = 'menu'; }
        },
      });
      this._uiFailPopup.setAnimator(this._failAnimator);
      this.ui.add(this._uiFailPopup, UIManager.LAYER.MODAL);

    } catch (e) {
      // 初始化失败：清空所有引用，确保 render() 的 guard 能兜底
      console.error('[PlayingEngine] _setupUI 失败:', e);
      this.ui = null;
      this._uiTopBar = null;
      this._uiGoldWidget = null;
      this._uiVictoryPopup = null;
      this._uiFailPopup = null;
      this._uiRightStep = null;
      this._uiBranchProgress = null;
    }
  }

  /** 每帧更新 UI 层数据（引擎 → UI 组件单向数据流） */
  _syncUIData() {
    if (!this._uiTopBar) return;  // 哨兵检查

    // TopBar 位置：左上设置钮 + 关卡徽章 + 金币整体贴上不可用区域下沿
    var topSafeY = this._safeL ? this._safeL.safeLineY(31) : 16;  // 设置钮中心 x=15+16=31
    this._topSafeY = topSafeY;  // 缓存，给状态指示器用
    this._uiTopBar.setBounds(0, 0, this._boardCardW, Theme.layout.topBarH);
    this._uiTopBar.setBaseY(topSafeY);
    this._uiTopBar.setLevelText((parseInt(this.levelName || 1)) + '关');
    this._uiTopBar.setMode('normal');

    // GoldWidget — 显示余额（步数奖励已改为积分粒子，不再影响金币显示）
    var goldDisplay;
    if (this._goldSettled) {
      goldDisplay = GoldSystem.getGold();  // 已结算，不再叠加旧累积
    } else {
      goldDisplay = GoldSystem.getGold() + this._levelAccumulatedGold;
    }
    if (this._lastGoldLog !== goldDisplay) {
      this._lastGoldLog = goldDisplay;
      console.log('[LOG_gold] _syncUIData goldDisplay=' + goldDisplay + ' settled=' + this._goldSettled + ' getGold=' + GoldSystem.getGold() + ' accum=' + this._levelAccumulatedGold);
    }
    // GoldWidget — 显示余额 + Y轴中心对齐关卡区域（设置钮+关卡徽章）
    if (this._uiGoldWidget) {
      this._uiGoldWidget.setData(goldDisplay);
      var goldBaseY = topSafeY - 13;  // 金币内容中心(≈60.5)对齐关卡徽章中心(topSafeY+48)
      this._uiGoldWidget.setBounds(this._uiGoldWidget.x, goldBaseY, this._uiGoldWidget.w, this._uiGoldWidget.h);
    }

    // 右上角剩余步数组件（还原旧版 CrownPigWidget 的步数显示）
    // 结算面板弹出或失败时隐藏；由面板自身及常规层管理可见性，不做特殊浮层处理。

    // 底部道具按钮计数同步（首次进关从 loadLevel 的 3 开始）
    if (this._uiAddStepBtn) this._uiAddStepBtn.setData(this._addStepRemaining);
    if (this._uiHintBtn) this._uiHintBtn.setData(this._hintRemaining);
    if (this._uiHelpBtn) this._uiHelpBtn.setData(this._helpRemaining);

    if (this._uiRightStep) {
      // 步数转化积分进行中：剩余步数数字同步逐个递减（每 1 分 = 1 步已转化）
      var displaySteps = this.steps;
      if (this._scoreBonusRemaining > 0) {
        displaySteps = this.steps + this._scoreBonusProgress;
      }
      // 显示阈值 = 逻辑阈值 − 还在飞行中(未到面板)的 +3：保证数字在道具图标到达步数牌时才滚上去
      var displayThreshold = this._stepBonusThreshold + this._bonusSteps - this._bonusStepsPending;
      this._uiRightStep.setData(displayThreshold, displaySteps);
      this._uiRightStep.setHidden(this._failed); // 仅失败时隐藏；结算面板期间不隐藏（由面板遮罩覆盖，符合预期）
    }

    // VictoryPopup 绿钮三态判定（_startedAsFrontier 已在进关时记录本关是否为最新关）
    var _vCur = databus.currentLevelIndex;
    var _vLevels = databus.projectLevels || [];
    var _vTotal = _vLevels.length;
    var _vIsTrial = databus.returnState === 'editor';
    var _vIsLast = !_vIsTrial && _vCur === _vTotal - 1;  // 当前为最后一关，无下一关
    var _vLabel, _vAction;
    if (_vIsLast) {
      _vLabel = '恭喜通关'; _vAction = 'menu';
    } else if (this._startedAsFrontier) {
      // 最新关首通 → 继续闯关 → 进下一关
      _vLabel = '继续闯关'; _vAction = 'next';
    } else {
      // 重玩旧关 → 返回 → 主菜单（试玩则回编辑器）
      _vLabel = '返回'; _vAction = _vIsTrial ? 'editor' : 'menu';
    }
    this._victoryAction = _vAction;
    this._uiVictoryPopup.setData({
      steps: this.steps,
      returnState: databus.returnState || 'menu',
      goldAmount: this._goldAmount,
      showGold: this._goldAmount > 0,
      btnLabel: _vLabel,
      stars: this._victoryStar,
    });
    // 场外求助协助/回放：不显示常规 VictoryPopup（改用 _renderHelpOverlay 的专属按钮）
    this._uiVictoryPopup.visible = this._victory && this._showVictoryPanel && databus.playMode === 'normal';

    // FailPopup
    this._uiFailPopup.setData({
      returnState: databus.returnState || 'menu',
    });
    this._uiFailPopup.visible = this._failed;
  }

  /**
   * 关卡统一入口——所有路径（关卡列表进入、重玩、下一关）都走这里。
   * 模块内部负责：反初始化旧关卡 → 搭建UI → 解析关卡数据（缓存→云端→本地）→ 加载关卡。
   */
  startLevel(name, opts) {
    opts = opts || {};

    // 关卡→关卡圆形过场：在「任何 UI 重建 / 异步加载」之前，同步冻结当前(旧关)帧。
    // 必须在 startLevel 入口同步完成——此时 render 循环尚未重画新界面，离屏画布仍是旧关画面；
    // 若挪到 _loadAndStart（云端异步返回后才执行），渲染循环早已画出新关空界面，
    // 会 source==target → 圆形过场不可见（这正是「继续闯关无圆形虹膜」的根因）。
    // 仅当当前确实处于游玩态(gameState==='playing')才视为关卡→关卡，排除菜单→关卡
    // （菜单→关卡由 _beginMenuExitCircle 处理；此处若误触发会与菜单出场过场叠加）。
    this._pendingLevelExpand = null;
    if (databus.gameState === 'playing' && databus._gameEngine) {
      try {
        this._pendingLevelExpand = databus._gameEngine._captureFrame();
      } catch (e) {
        console.warn('[Playing] 冻结旧关帧失败，跳过关卡过场', e);
        this._pendingLevelExpand = null;
      }
    }

    // 0. 如果当前有关卡在运行，先反初始化
    if (this.levelName) {
      this.input.off('playing');
      this._guide.reset();
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

    // 内存关卡（试玩 / 协助 / 回放）：currentLevel.data 已就绪，直接加载，不拉云端
    if (databus.currentLevel && databus.currentLevel.data) {
      console.log('[Playing] 内存关卡（试玩/协助/回放），使用 currentLevel.data');
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

    // 4. 音效、输入（不依赖关卡数据）
    this.input.on('playing', function(e) { self.handleEvent(e); });

    // 关卡→关卡圆形过场暂不在此同步启动：此刻新关底图(_sceneBgImg)尚未加载就位
    // （继续闯关走云端异步拉取时尤其如此），若此刻启动则 target==source，过场不可见。
    // 改由 _loadAndStart 在 loadLevel 之后启动（见下方），保证 target=新关底图。
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
        // 跳过缺少步数预算字段的过期缓存（USER_DATA_PATH 缓存可能早于 stepBonusThreshold 重命名，
        // 导致 threshold=0 → 剩余步数 HUD 不显示）。内置 assets/levels 始终为权威最新 schema。
        if (i === 0 && data.stepBonusThreshold == null && data.crownSteps == null) {
          console.warn('[Playing] 本地缓存 ' + name + '.json 缺少 stepBonusThreshold，跳过改用内置配置');
          continue;
        }
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
      showToast('关卡数据加载失败', 2000);
      databus.gameState = 'menu';
      databus._returningToMenu = true;   // 返回过场建立前屏蔽主菜单背景
      return;
    }
    // 入场动画已去除：仅保留 _entranceState 占位（phase 直接置 'done'）。
    // 原代码读取 PlayDefine.PLAY.ENTRANCE.* 用作入场时序，现已无用（phase 恒为 'done'，
    // 更新逻辑不读取这些字段，见 update 中 es.phase!=='done' 闸门）。
    // 去掉对 PlayDefine.PLAY.ENTRANCE 的引用，避免重玩等场景下偶发的 undefined 崩溃。
    this._entranceState = {
      startTime: Date.now() + 50,
      phase: 'done',        // 直接终态：所有 UI / 猪 默认显示，无入场动画
    };
    this.loadLevel(data);
    // 关卡→关卡圆形过场：消费 startLevel 入口「同步」冻结的旧关帧（见 startLevel 开头）。
    // 此刻新关底图(_sceneBgImg)已就位，圆形扩散露出新关，过场可见。
    // 注意：冻结动作必须在 startLevel 入口同步完成，不能挪到此处——
    // 继续闯关走云端异步拉取时，render 循环早已画出新关空界面，那时再冻结会 source==target 导致虹膜不可见。
    if (this._pendingLevelExpand && databus._gameEngine && databus._gameEngine._beginLevelExpand) {
      databus._gameEngine._beginLevelExpand(this._pendingLevelExpand);
      this._pendingLevelExpand = null;
    }
    this._loading = false;
    // 断点续传 + 录制 + 预下载（与菜单 prepareLevel 路径共用，避免菜单进关漏掉续玩）
    this._afterEnterLevel();
  }

  /** 进关后续统一逻辑：断点续玩恢复 + 录制启动 + 预下载。
   *  所有「加载完关卡」的入口（startLevel 的 _loadAndStart / 菜单 prepareLevel）都应调用，
   *  否则菜单进关会漏掉 game_checkpoint 续玩恢复与录制启动（交叉淡变重构期间暴露）。 */
  _afterEnterLevel() {
    // [B] 场外求助协助/回放：不自动记录 hint 数据（收集 + 上传 + 指示器全阻断）。
    // 必须在回放 early-return 之前设置，否则回放路径绕过导致仍收集 hint。
    if (databus.playMode !== 'normal') {
      this._hintMerged = true;
    }
    this._assistCounting = false;   // 复位准备倒计时（下方 assist 分支按需重新置 true）
    this._sceneFadeStart = 0;       // 进关重置：下一关首次出现重新整体渐显
    this._assistFadeStart = 0;      // 复位渐隐窗口
    this._assistLastNum = 0;

    // [D] 残局恢复：协助/回放从好友残局原地还原进度（与断点续玩语义一致）。
    // 猪物理残局已由 loadLevel 从 gp.pigs 重建；此处补齐「逃逸数/剩余步数/总猪数/小虫进度」。
    // 同样需在回放 early-return 之前，使回放也以好友残局为起点（小虫从残局进度开始爬）。
    if (databus.playMode !== 'normal' && databus.currentLevel && databus.currentLevel.data) {
      var hd = databus.currentLevel.data;
      this._escapedCount = hd.escapedCount || 0;                         // 小虫(树枝)进度基准
      this._assistBaseEscaped = hd.escapedCount || 0;                    // 协助关：残局已逃出基数（判定「额外跑出」是否为 0 用）
      this._totalPigsInLevel = hd.totalPigs || this.gp.pigs.length;       // 全关猪数（提交结果用；PigCounter 读 gp.pigs.length 不受影响）
      if (this._uiBranchProgress) {
        // 用 loadLevel 已算好的分母(this._totalScore)，保证小虫位置正确
        this._uiBranchProgress.setScore(this._escapedCount, this._totalScore);
      }
      if (hd.steps != null) {                                            // 普通关 steps 与 pig 差分无关，直接镜像
        this.steps = hd.steps;
        databus.currentStep = this.steps;
      }
      this._helpEnded = false;   // 重新进入（再来一次）时复位结束态
      this._helpSettlePending = false;
      this._endBtnHideTime = 0;
      this._showHelpEndPanel = false;
      this._helpEndReason = null;
      this._helpSent = false;
      this._helpSending = false;
      this._helpEndPanelShowTime = 0;
    }

    // 回放：载入后先播 5 秒倒计时圈，倒计时结束再自动播放（不录制、不续玩、不预下载）
    if (databus.playMode === 'replay' && this._helpReplayRecording) {
      var rec = this._helpReplayRecording;
      this._helpReplayRecording = null;
      this._helpReplaySrc = rec;          // 留存原始录制，供「再看一次」复用
      this._isRecording = false;
      this._recordEntries = rec.entries;   // rec 为 {entries, version} 包裹，取内层数组（回放模式不录制，仅避免误用包裹对象）
      this._replayDone = false;
      this._replayEndTime = 0;            // 复位滑动动画时间戳
      this._replayStartTime = 0;         // 回放尚未开始（进度条处于满格预热态）
      this._replayDuration = this._computeReplayDuration(rec); // 预热阶段即算好总时长，进度条提前满格显示
      this._replayCounting = true;        // 进入 3 秒倒计时（_renderHelpOverlay 驱动圈 + 到点启动回放）
      this._replayCountdownEnd = Date.now() + 3000;
      return;
    }

    // 协助：进入后浮 5 秒准备倒计时（与回放一致的「准备」节拍；期间屏蔽玩家输入，到点释放接管）
    if (databus.playMode === 'assist') {
      this._assistCounting = true;
      this._assistCountdownEnd = Date.now() + 5000;
    }

    // 断点续传（单函数收敛：恢复/清理）
    this._updateCheckpoint();

    // 关卡预下载：仅最新关卡 & 普通关触发（协助/回放 currentLevelIndex=-1 自然跳过）
    this._tryPreloadNext();

    // 自动开启录制。
    //  - 普通关：断点续玩(escapedCount>0)跳过；
    //  - 协助关：强制录制协助者解法(force=true)，绕过「棋盘不完整」拦截，
    //    否则好友回放无数据（[D] 录制修复）。
    if (databus.playMode === 'assist') {
      console.log('[RecHint] 进入关卡(协助): level=' + this.levelName + ' 残局escapedCount=' + this._escapedCount + ' → 强制启动录制');
      this._trialStartRecord(true);
    } else if (this._escapedCount === 0) {
      console.log('[RecHint] 进入关卡: level=' + this.levelName + ' 模式=' + (databus.playMode || 'normal') + ' → 启动录制+提示收集');
      this._trialStartRecord();
    } else {
      console.log('[RecHint] 进入关卡: level=' + this.levelName + ' 模式=' + (databus.playMode || 'normal') + ' 断点续玩跳过录制(棋盘不完整)');
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

  /** 棋盘猪是否全部在棋盘上（是否有猪逃逸过） */
  _allPigsOnBoard() {
    return this._escapedCount === 0;
  }

  // ===== 录制回放（游戏动作） =====

  _trialStartRecord(force) {
    // force=true：协助关残局（escapedCount>0）也强制录制，绕过「棋盘不完整」拦截，
    // 否则好友回放无数据（见 _afterEnterLevel 协助分支 [D] 录制修复）。
    if (!force && !this._allPigsOnBoard()) {
      showToast('请先重置关卡', 1500);
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
    wx.setStorageSync(key, JSON.stringify({ v: 2, rec: this._recordEntries }));
    console.log('[TrialRec] 录制结束，保存 ' + this._recordEntries.length + ' 条操作 → ' + key);
  }

  /**
   * 启动录制回放。
   * @param {Array|string} [events] 外部注入的录制（场外求助回放）；缺省则读本地试玩录制（trial_record_<levelName>）。
   * @param {Function} [onComplete] 回放结束回调（无参则弹「回放完成」Toast）。
   */
  _computeReplayDuration(input) {
    var parsed = this._normalizeReplayInput(input);
    var rec = parsed ? parsed.entries : null;   // 统一经 _normalizeReplayInput 解包（兼容 {v,rec} / {entries,version} / 扁平数组）
    if (!rec || !rec.length) return 0;
    var MAX_GAP = PlayDefine.PLAY.REPLAY.MAX_GAP;
    var delayed = 0, lastDt = 0;
    for (var i = 0; i < rec.length; i++) {
      var gap = rec[i].dt - lastDt;
      if (gap > MAX_GAP) gap = MAX_GAP;
      lastDt = rec[i].dt;
      delayed += gap;
    }
    return delayed + 1000;
  }

  // 解析回放录制：兼容旧扁平数组(v1, 棋盘像素坐标) 与 新 {v:2, rec:[...]}(直径单位, 设备无关)。
  _normalizeReplayInput(raw) {
    if (!raw) return null;
    var obj = (typeof raw === 'string') ? JSON.parse(raw) : raw;
    if (!obj) return null;
    // 新本地/提交格式：{v:2, rec:[...]}（_submitAssist / 本地试玩存档）
    if (!Array.isArray(obj) && obj.rec && Array.isArray(obj.rec)) {
      return { entries: obj.rec, version: obj.v || 2 };
    }
    // 内存传递格式（_helpReplayRecording / _helpReplaySrc）：{entries, version}
    if (!Array.isArray(obj) && obj.entries && Array.isArray(obj.entries)) {
      return { entries: obj.entries, version: obj.version || 1 };
    }
    // 旧格式：扁平数组（棋盘像素坐标 v1）
    if (Array.isArray(obj)) {
      return { entries: obj, version: 1 };
    }
    return null;
  }

  _renderReplayProgress(ctx) {
    if (this._replayDuration <= 0) return;
    var barW = SCREEN_WIDTH * 3 / 4;            // 宽度 = 屏幕 3/4
    var barH = 18;                             // 厚度 18px（纯矩形）
    var barX = (SCREEN_WIDTH - barW) / 2;       // 水平居中
    // 垂直：底部贴在播放中「返回」按钮顶边上方 5px
    //   （返回按钮 bh2=52、底边距屏底 20 → 顶边 y = SCREEN_HEIGHT-20-52，与 _renderHelpOverlay 播放中分支一致）
    var backTop = SCREEN_HEIGHT - 20 - 52;
    var barBottom = backTop - 5;
    var barTop = barBottom - barH;
    // 渐隐：回放结束后 300ms 淡出（与结束按钮滑入同步，条在棋盘上沿/钮在中央不遮挡）
    var alpha = 1;
    if (this._replayEndTime) {
      alpha = Math.max(0, 1 - (Date.now() - this._replayEndTime) / 300);
    }
    if (alpha <= 0.01) return;
    // 剩余时间：预热阶段(_replayStartTime===0)显示满格总时长
    var remaining = this._replayDuration;
    if (this._replayStartTime) {
      remaining = this._replayDuration - (Date.now() - this._replayStartTime);
      if (remaining < 0) remaining = 0;
    }
    var ratio = remaining / this._replayDuration;   // 1→0
    // mm:ss 倒计时文字（盖在进度条中心）
    var totalSec = Math.ceil(remaining / 1000);
    var mm = String(Math.floor(totalSec / 60));
    var ss = String(totalSec % 60);
    if (mm.length < 2) mm = '0' + mm;
    if (ss.length < 2) ss = '0' + ss;
    var mmss = mm + ':' + ss;

    ctx.save();
    ctx.globalAlpha = alpha;
    // 底槽（纯矩形，20% 不透明度 = 较高通透感，能看到后面棋盘）
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(barX, barTop, barW, barH);
    // 进度（方向：右端固定贴右边界，左端随剩余减少向右移 —— 从左侧被消耗）
    var filledW = barW * ratio;
    if (filledW > 1) {
      ctx.fillStyle = '#FFD24A';        // 暖金黄：活泼农场调性，黑底上清晰
      ctx.fillRect(barX + (barW - filledW), barTop, filledW, barH);
    }
    // 不透明边框（白色实线，盖在最外圈，始终完整显示，不受进度覆盖影响）
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,1)';
    ctx.strokeRect(barX, barTop, barW, barH);
    // 倒计时文字：居条中心，盖在盖条上（白字 + 黑描边，暖黄条/黑底槽上都清晰）
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 15px ' + Theme.font.family;
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeText(mmss, SCREEN_WIDTH / 2, barTop + barH / 2);
    ctx.fillText(mmss, SCREEN_WIDTH / 2, barTop + barH / 2);
    ctx.restore();
  }

  // 回放触摸指示：落点/抬手瞬间生成「扩散+淡出」涟漪环；拖动期间一个缓动跟随的柔光接触点。
  // 替代原先常驻闪烁的 hand_guide 小手——安静、精准、不抢戏，仍能清楚表达手指触摸的位置与时机。
  _renderTouchIndicator(ctx, now) {
    var s = SCREEN_WIDTH / 393;   // 与 LevelMap 同缩放基准（设计宽度 393）

    // 1) 缓动跟随接触点（仅回放进行中、且有最近拖动时显示）
    if (this._isPlayingBack && this._playbackDotPos) {
      var tgt = this._playbackDotPos;
      if (!this._touchFollow) this._touchFollow = { x: tgt.x, y: tgt.y };
      else {
        this._touchFollow.x += (tgt.x - this._touchFollow.x) * 0.25;
        this._touchFollow.y += (tgt.y - this._touchFollow.y) * 0.25;
      }
      var sinceMove = now - this._touchFollowLast;
      var followAlpha = sinceMove < 400 ? 0.5 * (1 - sinceMove / 400) : 0;
      if (followAlpha > 0.01 && this._touchFollow) {
        ctx.save();
        ctx.globalAlpha = followAlpha;
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath();
        ctx.arc(this._touchFollow.x, this._touchFollow.y, 9 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#FFD24A';   // 暖金黄描边，呼应进度条
        ctx.lineWidth = 2 * s;
        ctx.stroke();
        ctx.restore();
      }
    }

    // 2) 涟漪：落点/抬手瞬间扩散淡出（回放结束后仍让其播完，不硬切）
    var RIPPLE_DUR = 380;
    for (var i = this._touchRipples.length - 1; i >= 0; i--) {
      var r = this._touchRipples[i];
      var age = now - r.t0;
      if (age >= RIPPLE_DUR) { this._touchRipples.splice(i, 1); continue; }
      var p = age / RIPPLE_DUR;            // 0→1
      var ease = 1 - Math.pow(1 - p, 2);   // easeOutQuad
      var radius = (8 + ease * 22) * s;    // 8→30px（上限收窄，更收敛不刺眼）
      var alpha = (1 - p) * 0.85;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = '#FFD24A';
      ctx.lineWidth = 3 * s;
      ctx.beginPath();
      ctx.arc(r.x, r.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      // 中心小实心点，强化「此处被点」的瞬间感
      ctx.globalAlpha = alpha * 0.9;
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(r.x, r.y, 4 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  _trialStartPlayback(events, onComplete) {
    if (this._isPlayingBack) return;
    // 回放模式（playMode==='replay'）的录制来自残局快照，escapedCount>0 是正常的，
    // 不代表"棋盘不完整"——跳过 _allPigsOnBoard 检查。
    if (databus.playMode !== 'replay' && !this._allPigsOnBoard()) {
      showToast('请先重置关卡', 1500);
      return;
    }
    // 回放前先停止录制，防止回放操作被录进去
    this._isRecording = false;
    var raw = events;
    if (!raw) {
      var key = 'trial_record_' + this.levelName;
      raw = wx.getStorageSync(key);
    }
    if (!raw) return;

    // 兼容旧扁平数组(v1, 棋盘像素) / 新 {v:2, rec}(直径单位)；统一取出 entries + version
    var parsed = this._normalizeReplayInput(raw);
    if (!parsed || !parsed.entries || parsed.entries.length === 0) return;
    var evts = parsed.entries;
    var replayVersion = parsed.version;

    this._isPlayingBack = true;
    // 重置触摸指示状态（落点/抬手生成涟漪、拖动柔光跟随点），避免「再看一次」残留上次
    this._playbackDotPos = null;
    this._touchRipples = [];
    this._touchFollow = null;
    this._touchFollowLast = 0;
    console.log('[TrialRec] 开始回放 ' + evts.length + ' 条触控');

    // 计算回放延迟：事件间隔超过 500ms 则压缩
    var MAX_GAP = PlayDefine.PLAY.REPLAY.MAX_GAP;
    var delayed = 0;  // 累积延迟
    var lastDt = 0;
    var self = this;
    for (var i = 0; i < evts.length; i++) {
      var gap = evts[i].dt - lastDt;
      if (gap > MAX_GAP) gap = MAX_GAP;
      lastDt = evts[i].dt;
      delayed += gap;
      (function (evt, playDt) {
        setTimeout(function () {
          if (!self._isPlayingBack) return;
          var gp = self.gp;
          var _as = gp._getAutoScale();
          var _sx, _sy;
          if (replayVersion >= 2) {
            // 新格式(v2)：bx/by 为「直径单位」(设备无关 = 棋盘数据坐标÷scaledDiameter)，
            // 先乘回当前设备的 scaledDiameter 还原成棋盘数据坐标 (h.x, h.y)，再走与 renderBoard 一致的变换。
            var hX = evt.bx * gp.scaledDiameter;
            var hY = evt.by * gp.scaledDiameter;
            if (_as < 1) {
              var _vw = gp.boardWidth;
              var _vh = (gp.rows - 1) * gp.vSpacing + gp.scaledDiameter;
              var _availH = SCREEN_HEIGHT - gp.topBarH - gp.bottomStripH;
              var _scx = SCREEN_WIDTH / 2;
              var _scy = gp.topBarH + _availH / 2;
              var _bcx = gp.boardOffsetX + _vw / 2;
              var _bcy = (gp.topBarH + gp.boardOffsetY) + _vh / 2;
              _sx = _scx + _as * (hX - _bcx);
              _sy = _scy + _as * (hY - _bcy);
            } else {
              _sx = gp.boardOffsetX + hX;
              _sy = (gp.topBarH + gp.boardOffsetY) + hY;
            }
          } else {
            // 旧格式(v1)：bx/by 为棋盘像素坐标，沿用原两段式还原（同设备仍准，跨设备沿用旧行为不回归）
            if (_as < 1) {
              var _vw2 = gp.boardWidth;
              var _vh2 = (gp.rows - 1) * gp.vSpacing + gp.scaledDiameter;
              var _availH2 = SCREEN_HEIGHT - gp.topBarH - gp.bottomStripH;
              var _scx2 = SCREEN_WIDTH / 2;
              var _scy2 = gp.topBarH + _availH2 / 2;
              _sx = _scx2 + _as * (evt.bx - _vw2 / 2);
              _sy = _scy2 + _as * (evt.by - _vh2 / 2);
            } else {
              _sx = gp.boardOffsetX + evt.bx;
              _sy = (gp.topBarH + gp.boardOffsetY) + evt.by;
            }
          }
          self._playbackDotPos = { x: _sx, y: _sy };
          // 触摸指示：落点(touchstart)/抬手(touchend) 生成扩散淡出涟漪；拖动(touchmove) 记录时间戳供柔光跟随点淡出
          if (evt.type === 'touchstart' || evt.type === 'touchend') {
            self._touchRipples.push({ x: _sx, y: _sy, t0: Date.now() });
          } else if (evt.type === 'touchmove') {
            self._touchFollowLast = Date.now();
          }
          self._playbackSynthetic = true;
          if (evt.type === 'touchstart') self.onTouchStart(_sx, _sy);
          else if (evt.type === 'touchmove') self.onTouchMove(_sx, _sy);
          else if (evt.type === 'touchend') self.onTouchEnd(_sx, _sy);
          self._playbackSynthetic = false;
        }, playDt);
      })(evts[i], delayed);
    }

    // 进度条：记录正式播放起点 + 总时长（与下方 doneTimer 的 delayed+1000 一致）
    this._replayStartTime = Date.now();
    this._replayDuration = delayed + 1000;

    // 回放结束清理 + 回调
    var doneTimer = setTimeout(function () {
      self._isPlayingBack = false;
      console.log('[TrialRec] 回放完成');
      if (typeof onComplete === 'function') onComplete();
      else showToast('回放完成', 1500);
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
      showToast('暂无回放数据', 1500);
      return;
    }
    this._trialStartPlayback();
  }

  // ===== 场外求助（Help-a-Friend）=====

  /** 确保已获得用户昵称/头像（隐私合规：首次经 createUserInfoButton 手势授权） */
  _ensureUserInfo() {
    return new Promise(function (resolve) {
      var cached = null;
      try { cached = wx.getStorageSync('userinfo_cache') || {}; } catch (e) { cached = {}; }
      if (cached.nickName && cached.avatarUrl) {
        resolve({ nickName: cached.nickName, avatarUrl: cached.avatarUrl });
        return;
      }
      // 需要授权：创建全屏透明 userInfo 按钮（手势触发），用户点一次即弹授权
      try {
        var btn = wx.createUserInfoButton({
          type: 'text',
          text: '',
          style: {
            left: 0, top: 0, width: SCREEN_WIDTH, height: SCREEN_HEIGHT,
            backgroundColor: 'rgba(0,0,0,0.01)', color: '#ffffff', fontSize: 1, lineHeight: 1, textAlign: 'center'
          }
        });
        btn.onTap(function (res) {
          btn.destroy();
          var info = (res && res.userInfo) || {};
          var nickName = info.nickName || cached.nickName || '玩家';
          var avatarUrl = info.avatarUrl || cached.avatarUrl || '';
          try {
            wx.setStorageSync('userinfo_cache', {
              nickName: nickName, avatarUrl: avatarUrl, avatarPath: cached.avatarPath || ''
            });
          } catch (e2) {}
          resolve({ nickName: nickName, avatarUrl: avatarUrl });
        });
      } catch (e) {
        resolve({ nickName: cached.nickName || '玩家', avatarUrl: cached.avatarUrl || '' });
      }
    });
  }

  /** 构造自包含棋盘快照（好友端据其原地重建棋盘，坐标天然一致） */
  _buildHelpSnapshot() {
    return {
      board: {
        rows: this.gp.rows,
        oddCols: this.gp.oddCols,
        boardWidth: this.gp.boardWidth,
        boardRate: this.gp.boardRate
      },
      pigs: this.gp.pigs.map(function (p) {
        return {
          id: p.id,
          tail: p.tailIndex,
          length: p.length,
          angle: p.angle,
          type: p.type || 'pig',
          skinId: p.skinId || 0,
          hintId: p.hintId != null ? p.hintId : null,
          hintAngle: p.hintAngle != null ? p.hintAngle : p.angle,
          collisionWidth: p.collisionWidth != null ? p.collisionWidth : null
        };
      }),
      steps: this.steps,
      bonusSteps: this._bonusSteps,
      stepBonusThreshold: this._stepBonusThreshold,   // 原关步数预算：重建协助关必须还原，否则变成 0 步残血关
      escapedCount: this._escapedCount,   // [D] 残局：已逃逸猪数（好友求助时）→ 协助关还原小虫进度
      totalPigs: this._totalPigsInLevel, // [D] 残局：本关总猪数 → 协助关还原（提交结果用）
      levelName: this.levelName
    };
  }

  /** Flow A：玩家在关卡内发起场外求助 → 存云端 + 分享卡片 */
  _startExternalHelp() {
    var self = this;
    if (this._externalHelpBusy) return;
    this._externalHelpBusy = true;
    // 立即反馈：点按钮瞬间弹出 loading（首次会叠加微信原生授权框，授权完成继续；已授权直接走云端建单）
    LoadingDialog.open({ text: '正在发起求助...' });

    this._ensureUserInfo().then(function (user) {
      var snap = self._buildHelpSnapshot();
      var snapshotMeta = {
        steps: self.steps,
        totalPigs: self._totalPigsInLevel || 0,
        escapedPigs: self._escapedCount || 0,
        levelName: self.levelName
      };
      return cloud.createHelpRequest({
        snapshot: JSON.stringify(snap),
        snapshotMeta: snapshotMeta,
        requester: { nickName: user.nickName, avatarUrl: user.avatarUrl },
        levelName: self.levelName
      }).then(function (res) {
        if (!res || res.code !== 0 || !res.helpKey) {
          showToast('发起求助失败，请重试', 2000);
          return null;
        }
        // 次数递减（每关 2 次，与 +3步/提示 一致；剩余次数已进 checkpoint 续玩接回）
        self._helpRemaining--;
        if (self._uiHelpBtn) self._uiHelpBtn.setData(self._helpRemaining);
        self._saveCheckpoint();
        try {
          wx.shareAppMessage({
            title: '帮我过这关！',
            query: 'hk=' + res.helpKey
            // imageUrl: 固定运营图待资源补充后填入（assets/share/help_share.png）
          });
          showToast('已发送给好友，等待协助', 1800);
        } catch (e) {
          showToast('分享失败，请重试', 2000);
        }
        return res;
      });
    }).catch(function (e) {
      console.warn('[Help] _startExternalHelp 失败:', e && e.message);
      showToast('发起求助失败', 2000);
    }).then(function () {
      // 终态兜底：成功 / 建单失败 / 异常 任一路径结束都关闭 loading，避免遮罩卡死触摸
      LoadingDialog.close();
      self._externalHelpBusy = false;
    });
  }

  /** 由自包含快照组装 loadLevel 所需的关卡 data */
  _buildHelpLevelData(snap) {
    if (!snap) return null;
    // 步数预算：还原原关 stepBonusThreshold + 当前 bonusSteps，使协助关与发起方一致（不丢失步数 HUD / 步数限制）
    var threshold = (snap.stepBonusThreshold != null) ? snap.stepBonusThreshold : 0;
    var bonus = (snap.bonusSteps != null) ? snap.bonusSteps : 0;
    return {
      name: snap.levelName,
      board: snap.board,
      pigs: snap.pigs,
      version: 0,
      stepBonusThreshold: threshold,
      bonusSteps: bonus,
      starScores: null,
      totalScore: 30,
      escapedCount: snap.escapedCount || 0,                                       // [D] 残局逃逸数（_afterEnterLevel 还原小虫进度）
      steps: (snap.steps != null) ? snap.steps : (threshold + bonus),            // [D] 残局：协助者已用步数 → 还原剩余预算
      totalPigs: snap.totalPigs || 0                                              // [D] 残局：本关总猪数 → 还原
    };
  }

  /** 场外求助：把还原好的内存关卡装进 currentLevel.data，走与编辑器试玩完全一致的加载通道
   *  （startLevel / prepareLevel / activate 均以 currentLevel.data 真值判定「内存关卡」）。
   *  playMode 仅作为 UI/行为判别器（底栏钮、结算跳过、录制 vs 回放），不再参与「如何加载」的控制流。
   *  _pendingHelpKey 由调用方(_enterAssistFromHelpKey 首调)负责存回，供 _submitAssist 提交使用。 */
  _installHelpLevel(levelData, mode) {
    databus.currentLevel = { name: levelData.name, data: levelData };
    databus.currentLevelIndex = -1;
    databus.playMode = mode;   // 'assist' | 'replay'
  }

  /** Flow B：好友点开分享卡片 → 拉取求助 → 重建棋盘 → 进入协助录制（按决策②直接进关） */
  _enterAssistFromHelpKey(helpKey, _attempt) {
    var self = this;
    if (!helpKey) { showToast('无效的求助链接', 1500); return; }
    if (_attempt === undefined) {
      databus.playMode = 'assist';
      databus._pendingHelpKey = helpKey;
      console.log('[Help] 加载求助关卡 hk=' + helpKey);
    }
    var attempt = _attempt || 1;
    var MAX = 3;

    LoadingDialog.open({ text: '加载中...' });   // 同步等待服务器回包：显示加载窗并屏蔽触摸
    cloud.getHelpRequest(helpKey).then(function (res) {
      if (!res) { console.warn('[Help] 空响应 hk=' + helpKey); LoadingDialog.close(); return self._showHelpBlocked('该协助异常（无响应）'); }
      var code = res.code;

      // 分支②：阻塞类（单钮「好的」→ 返回主菜单）
      if (code === 2) { console.warn('[Help] 求助不存在 hk=' + helpKey); LoadingDialog.close(); showToast('该协助已删除', 2000); return self._exit(); }
      if (code === 4 || (res.data && res.data.status === 'expired')) { console.warn('[Help] 求助已过期 hk=' + helpKey); LoadingDialog.close(); return self._showHelpBlocked('请求已过期'); }
      // 满员（且不含自己）：getHelpRequest 透出 isFull + alreadyAssisted 标志，此处判定
      if (res.data && res.data.isFull && !res.data.alreadyAssisted) { console.warn('[Help] 协助已满(非本人) hk=' + helpKey); LoadingDialog.close(); return self._showHelpBlocked('协助者已超上限3人'); }
      // 分支③：其它异常（含 -1 云端异常 / 1 参数缺失）
      if (code === -1 || code === 1) { console.warn('[Help] 协助异常 code=' + code + ' hk=' + helpKey); LoadingDialog.close(); return self._showHelpBlocked('该协助异常（' + code + '）'); }

      var data = res.data;
      if (!data || !data.snapshot) { console.warn('[Help] 求助数据异常（无 snapshot）hk=' + helpKey); LoadingDialog.close(); return self._showHelpBlocked('该协助异常（数据缺失）'); }

      // 分支①：已协助过 → 通用确认窗（确认则覆盖重进，取消则回菜单）
      if (data.alreadyAssisted === true) {
        // 动态文案：{m}的第{n}关您已协助（m=好友名≤4字超出加…，n=关卡ID）
        var _reqName = (data.requester && data.requester.nickName) ? data.requester.nickName : '好友';
        var _dispName = _reqName.length > 4 ? _reqName.slice(0, 4) + '...' : _reqName;
        var _lv = parseInt(data.levelName || '0', 10) || 0;
        var _content = _dispName + '的第' + _lv + '关您已协助，是否覆盖？';
        LoadingDialog.close();   // 先关加载窗，再弹确认窗（确认窗绘制在加载窗之上）
        ConfirmDialog.open({
          title: '协助提示',
          content: _content,
          confirmText: '确认',
          cancelText: '取消',
          confirmColor: 'blue',
          maskClosable: false,
          onConfirm: function () { self._proceedAssistLoad(helpKey, data); },
          onCancel: function () { self._exit(); },
        });
        return null;
      }

      // 正常进入协助录制
      LoadingDialog.close();
      self._proceedAssistLoad(helpKey, data);
      return null;
    }).catch(function (e) {
      // 冷启首个云调用偶发拒绝（云环境握手未完成 / 网络抖动）→ 退避重试自愈
      if (attempt < MAX) {
        console.warn('[Help] getHelpRequest 第' + attempt + '次失败，' + (MAX - attempt) + '次重试... errCode=' + (e && e.errCode) + ' msg=' + ((e && (e.errMsg || e.message)) || ''));
        setTimeout(function () { self._enterAssistFromHelpKey(helpKey, attempt + 1); }, 700 * attempt);
        return;
      }
      var ec = e && e.errCode;
      var em = (e && (e.errMsg || e.message)) || '云调用异常';
      console.error('[Help] _enterAssistFromHelpKey 最终失败 errCode=' + ec + ' msg=' + em, e);
      // errCode=-501007 / errMsg 含 "function not found" → getHelpRequest 云函数未部署
      // errMsg 含 "env status is isolated" → 云环境被隔离，需到 CloudBase 控制台恢复环境
      LoadingDialog.close();
      showToast('加载求助失败', 2500);
      self._exit();
    });
  }

  /** 场外求助：按回包成功还原并进入协助录制（抽自 _enterAssistFromHelpKey 正常分支） */
  _proceedAssistLoad(helpKey, data) {
    var self = this;
    var snap = null;
    try { snap = compress.inflateJson(data.snapshot); }
    catch (inflateErr) { console.warn('[Help] 快照解压异常', inflateErr); }
    if (!snap) { console.warn('[Help] 关卡还原失败 hk=' + helpKey); showToast('关卡还原失败', 2000); return self._exit(); }
    var levelData = self._buildHelpLevelData(snap);
    if (!levelData) { console.warn('[Help] 关卡数据缺失 hk=' + helpKey); showToast('关卡数据缺失', 2000); return self._exit(); }
    self._installHelpLevel(levelData, 'assist');   // 装进 currentLevel.data，走与试玩一致的加载通道
    // 需求③：存请求者信息（微信昵称 + 头像），供协助/回放关左上角「这是来自好友的协助」展示
    databus._helpRequester = data.requester || null;
    self._helpRequesterImg = null;   // 复位头像缓存，下一帧重新加载
    // 需求⑥修复：已在游玩态(gameState==='playing')时（如「再来一次」点击后），
    // GameEngine.checkStateTransition 会忽略重复赋值 → activate 不重跑 → 不重进关卡。
    // 故已 playing 时直接调 startLevel 复用 restartLevel 路径（绕过 gameState 观测器），否则才置 gameState 触发过场。
    if (databus.gameState === 'playing') {
      self.startLevel(databus.currentLevel.name);
    } else {
      databus.gameState = 'playing';   // → GameEngine 过渡触发 activate() → startLevel 消费 currentLevel.data
    }
  }

  /** 场外求助进入失败/阻塞：单钮「好的」弹窗（通用确认窗），确认后回主菜单 */
  _showHelpBlocked(msg) {
    var self = this;
    ConfirmDialog.open({
      title: '',
      content: msg,
      showCancel: false,
      confirmText: '好的',
      confirmColor: 'blue',
      maskClosable: false,
      onConfirm: function () { self._exit(); },
    });
  }

  /** 提取回放装载尾（两入口共用：按 idx 直接回放 / 按 assistant openId 定位 idx 回放） */
  _applyReplay(helpKey, data, idx) {
    var self = this;
    if (!data || !data.snapshot || !data.assists || !data.assists[idx] || !data.assists[idx].recording) {
      showToast('回放数据异常', 2000); return self._exit();
    }
    var snap = null;
    try { snap = compress.inflateJson(data.snapshot); }
    catch (inflateErr) { console.warn('[Help] 快照解压异常', inflateErr); }
    if (!snap) { showToast('关卡还原失败', 2000); return self._exit(); }
    var rawRec = null;
    try { rawRec = compress.inflateJson(data.assists[idx].recording); }
    catch (inflateErr) { console.warn('[Help] 回放解压异常', inflateErr); }
    if (!rawRec) { showToast('回放数据缺失', 2000); return self._exit(); }
    // 归一成 {entries, version}（新 v2 直径单位 / 旧 v1 扁平数组），供 _afterEnterLevel 与 _trialStartPlayback 复用
    var parsed = self._normalizeReplayInput(rawRec);
    if (!parsed || !parsed.entries || parsed.entries.length === 0) { showToast('回放数据异常', 2000); return self._exit(); }
    var levelData = self._buildHelpLevelData(snap);
    if (!levelData) { showToast('关卡数据缺失', 2000); return self._exit(); }
    self._helpReplayRecording = parsed;               // 留存 {entries, version}，供 _afterEnterLevel 载入后自动播放
    self._installHelpLevel(levelData, 'replay');      // 装进 currentLevel.data，走与试玩一致的加载通道
    // 回放关左上角展示「协助者」头像/昵称：本回放播放的是 assists[idx] 这位协助者的录制，
    // 故取该条协助者的 assistant 信息；旧数据缺字段时回退发布者，保证不空白。
    // （协助关 assist 仍显示发布者，由 _installHelpLevelForAssist 设置，此处逻辑与之分离）
    var _assistEntry = (data.assists && data.assists[idx]) ? data.assists[idx] : null;
    databus._helpRequester = (_assistEntry && _assistEntry.assistant)
      ? _assistEntry.assistant
      : (data.requester || null);
    self._helpRequesterImg = null;   // 复位头像缓存，下一帧重新加载（按新 avatarUrl 重新拉取）
    databus.gameState = 'playing';   // → activate() → startLevel 消费 currentLevel.data，_afterEnterLevel 启动回放
  }

  /** Flow C：查看某位协助者的回放（按数组下标，自动播放，不快进） */
  _enterReplayFromHelpKey(helpKey, idx, _attempt) {
    var self = this;
    if (!helpKey) { showToast('无效的求助链接', 1500); return; }
    if (_attempt === undefined) {
      databus.playMode = 'replay';
      databus._pendingHelpKey = helpKey;
      showToast('正在加载回放...', 1500);
    }
    var attempt = _attempt || 1;
    var MAX = 3;

    cloud.getHelpRequest(helpKey).then(function (res) {
      if (!res || res.code === 2) { showToast('求助不存在', 2000); return self._exit(); }
      if (res.code === 4 || (res.data && res.data.status === 'expired')) { showToast('求助已过期', 2000); return self._exit(); }
      self._applyReplay(helpKey, res.data, idx);
      return null;
    }).catch(function (e) {
      if (attempt < MAX) {
        console.warn('[Help] getHelpRequest(回放) 第' + attempt + '次失败，' + (MAX - attempt) + '次重试... errCode=' + (e && e.errCode) + ' msg=' + ((e && (e.errMsg || e.message)) || ''));
        setTimeout(function () { self._enterReplayFromHelpKey(helpKey, idx, attempt + 1); }, 700 * attempt);
        return;
      }
      var ec = e && e.errCode;
      var em = (e && (e.errMsg || e.message)) || '云调用异常';
      console.error('[Help] _enterReplayFromHelpKey 最终失败 errCode=' + ec + ' msg=' + em, e);
      // errCode=-501007 / errMsg 含 "function not found" → getHelpRequest 云函数未部署
      showToast('加载回放失败', 2500);
      self._exit();
    });
  }

  /** Flow C'：请求者点开协助者回传卡片（hk + aid=assistant openId）→ 直接进该协助者的回放 */
  _enterReplayFromHelpKeyByAid(helpKey, aid, _attempt) {
    var self = this;
    if (!helpKey) { showToast('无效的求助链接', 1500); return; }
    if (_attempt === undefined) {
      databus.playMode = 'replay';
      databus._pendingHelpKey = helpKey;
      databus._pendingHelpAid = aid || '';
    }
    var attempt = _attempt || 1;
    var MAX = 3;

    LoadingDialog.open({ text: '加载回放中...' });   // 同步等待服务器回包：显示加载窗并屏蔽触摸
    cloud.getHelpRequest(helpKey).then(function (res) {
      if (!res || res.code === 2) { LoadingDialog.close(); showToast('求助不存在', 2000); return self._exit(); }
      if (res.code === 4 || (res.data && res.data.status === 'expired')) { LoadingDialog.close(); showToast('求助已过期', 2000); return self._exit(); }
      var data = res.data;
      if (!data || !data.assists) { LoadingDialog.close(); showToast('回放数据异常', 2000); return self._exit(); }
      var idx = -1;
      for (var i = 0; i < data.assists.length; i++) {
        if (data.assists[i].assistantOpenId === aid) { idx = i; break; }
      }
      if (idx < 0) { LoadingDialog.close(); showToast('回放数据异常', 2000); return self._exit(); }
      LoadingDialog.close();
      self._applyReplay(helpKey, data, idx);
      return null;
    }).catch(function (e) {
      if (attempt < MAX) {
        console.warn('[Help] getHelpRequest(回放-by-aid) 第' + attempt + '次失败，' + (MAX - attempt) + '次重试... errCode=' + (e && e.errCode) + ' msg=' + ((e && (e.errMsg || e.message)) || ''));
        setTimeout(function () { self._enterReplayFromHelpKeyByAid(helpKey, aid, attempt + 1); }, 700 * attempt);
        return;
      }
      var ec = e && e.errCode;
      var em = (e && (e.errMsg || e.message)) || '云调用异常';
      console.error('[Help] _enterReplayFromHelpKeyByAid 最终失败 errCode=' + ec + ' msg=' + em, e);
      LoadingDialog.close();
      showToast('加载回放失败', 2500);
      self._exit();
    });
  }

  /** 协助关「发送给好友」：弹「正在发送中」→ 上传录制到云端 → 发送卡片(hk+aid)给好友 → 「协助已送达」+返回 */
  _submitAssist() {
    var self = this;
    if (this._helpSending) return;                       // 已在发送中，忽略重复触发
    if (!databus._pendingHelpKey) { showToast('无有效求助', 1500); return; }
    this._helpSending = true;                             // 锁定 UI：发送期间屏蔽一切触控
    LoadingDialog.open({ text: '发送中...' });             // 通用加载窗：覆盖「云端提交 + 拉起微信分享」全程并屏蔽触摸

    var result = {
      escapedPigs: this._escapedCount || 0,
      totalPigs: this._totalPigsInLevel || 0
    };
    var recording = JSON.stringify({ v: 2, rec: this._recordEntries || [] });

    this._ensureUserInfo().then(function (user) {
      return cloud.submitAssist({
        helpKey: databus._pendingHelpKey,
        recording: recording,
        result: result,
        assistant: { nickName: user.nickName, avatarUrl: user.avatarUrl }
      }).then(function (res) {
        if (!res || res.code === 3) { showToast('协助名额已满', 2000); return _finish(); }
        if (res.code === 5) { showToast('您已协助过', 2000); return _finish(); }
        if (res.code === 2) { showToast('求助不存在', 2000); return _finish(); }
        if (res.code === 4) { showToast('求助已过期', 2000); return _finish(); }
        if (res.code !== 0) { showToast('提交失败，请重试', 2000); return _finish(); }
        // 上传成功：发送微信卡片给好友（hk + 自己的 openId）；请求者打开即直接进该协助者回放
        var aid = res.openId || '';
        try {
          wx.shareAppMessage({
            title: '我帮你过了这关，快来看看吧！',
            query: 'hk=' + databus._pendingHelpKey + (aid ? ('&aid=' + aid) : '')
          });
        } catch (e) { console.warn('[Help] 发送卡片失败', e); }
        _finish();   // 成功：流程结束，直接回主菜单
      });
    }).catch(function (e) {
      console.warn('[Help] _submitAssist 失败:', e && e.message);
      showToast('提交失败', 2000);
      _finish();     // 失败：流程结束，同样直接回主菜单
    });

    // 无论成功或失败，发送流程结束后解锁并直接返回主界面（不再停留 morph 面板）
    function _finish() {
      LoadingDialog.close();   // 关闭加载窗（「云端提交 + 拉起微信分享」流程结束）
      self._helpSending = false;
      self._exit();
    }
  }

  /** 场外求助退出：复位 playMode 并回主菜单（过场前屏蔽主菜单背景） */
  _exit() {
    databus.playMode = 'normal';
    databus._pendingHelpKey = '';
    this._helpReplayRecording = null;
    this._helpReplaySrc = null;
    this._replayDone = false;
    this._replayEndTime = 0;            // 复位滑动动画时间戳
    this._replayStartTime = 0;
    this._replayDuration = 0;
    this._replayCounting = false;
    this._replayCountdownEnd = 0;
    this._assistCounting = false;
    this._assistCountdownEnd = 0;
    this._assistFadeStart = 0;
    this._assistLastNum = 0;
    this._helpSent = false;
    this._helpSending = false;
    this._helpEndPanelShowTime = 0;
    this._helpOverlayBtns = [];
    this._helpPress = {};
    // 返回过场旗：仅当确实从游玩态(关卡已加载)返回才需置 true —— 配合圆形过场清空「冻结帧」守卫。
    // 若当前已在 menu（如协助入口确认弹窗点「取消」、云加载失败等从未真正进关），绝不可置 true：
    // 否则 gameState 不变 → checkStateTransition 不触发 → _returningToMenu 永不清 →
    // 渲染卡在「冻结关卡帧」分支且 playing 无关卡可画 → 黑屏。
    databus._returningToMenu = (databus.gameState === 'playing');
    databus.gameState = 'menu';
  }

  /** 复位求助态字段（不动 gameState / 过场标志）。供任意路径回主菜单时清理残留 playMode，
   *  避免 'assist'/'replay' 残留在下一局正常关卡中跳过提示上传与通关结算。 */
  _resetHelpState() {
    databus.playMode = 'normal';
    databus._pendingHelpKey = '';
    this._helpReplayRecording = null;
    this._helpReplaySrc = null;
    this._replayDone = false;
    this._replayEndTime = 0;            // 复位滑动动画时间戳
    this._replayStartTime = 0;
    this._replayDuration = 0;
    this._replayCounting = false;
    this._replayCountdownEnd = 0;
    this._assistCounting = false;
    this._assistCountdownEnd = 0;
    this._assistFadeStart = 0;
    this._sceneFadeStart = 0;       // 复位场景渐显，保证下次进关重新淡入
    this._assistLastNum = 0;
    this._helpEnded = false;
    this._helpSettlePending = false;
    this._endBtnHideTime = 0;
    this._showHelpEndPanel = false;
    this._helpSendBtn = null;        // 清空「发给好友」按钮缓存，下一局重新 new
    this._helpEndReason = null;
    this._helpSent = false;
    this._helpSending = false;
    this._helpEndPanelShowTime = 0;
    this._helpOverlayBtns = [];
    this._helpPress = {};
  }

  /** 协助准备倒计时绘制：屏幕正中白圈 + 大号数字 + 圈上方两行引导文案。
   *  alpha 控制整体透明度，供倒计时结束时与文案一起渐隐。
   *  @param {number} alpha 0..1 */
  _drawAssistCountdown(ctx, alpha) {
    var _acx = SCREEN_WIDTH / 2, _acy = SCREEN_HEIGHT / 2;
    var _num = (this._assistLastNum != null) ? this._assistLastNum : 0;
    var _lines = ['走到这不会了', '你来试试'];   // 两行：逗号断行

    ctx.save();
    ctx.globalAlpha = alpha;

    // 引导文案（圈上方两行）：白字 + 深色描边，保证在任意背景上可读
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '19px ' + Theme.font.family;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    var _gap = 26;                                       // 两行行距
    var _blockCenter = _acy - 46 - 30;                   // 两行整体中心：圈半径 46 + 间距 30
    for (var _li = 0; _li < _lines.length; _li++) {
      var _ty = _blockCenter + (_li - (_lines.length - 1) / 2) * _gap;
      ctx.strokeText(_lines[_li], _acx, _ty);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(_lines[_li], _acx, _ty);
    }

    // 倒计时圈
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(_acx, _acy, 46, 0, Math.PI * 2); ctx.stroke();

    // 数字
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 40px ' + Theme.font.family;
    ctx.fillText(String(_num), _acx, _acy);
    ctx.restore();
  }

  /** 场外求助覆盖层：
   *  协助关(assist)：进行中居中「协助完成」；提前结束 / 通关 / 步数用完 后统一结束面板（文案按结束原因变化）+「发送给好友」+「再来一次」+（下排）「下次再说」(回主菜单)。
   *  回放(replay)：「返回」+「再看一次」（保持原逻辑）。 */
  _renderHelpOverlay(ctx) {
    this._helpOverlayBtns = [];
    var cx = SCREEN_WIDTH / 2;

    if (databus.playMode === 'assist') {
      if (this._helpEnded || this._showHelpEndPanel) {
        // ===== 协助结算面板：与「关卡内设置面板」同款弹出（遮罩 + 三宫格背景 + 顶部标题 + 底部三钮）=====
        var _pw = 289, _ph = 360;                       // 与 SettingsPanel ingame 尺寸一致
        var _px = SCREEN_WIDTH / 2 - _pw / 2;
        var _py = (SCREEN_HEIGHT - _ph) / 2 - 20;
        var _pcx = _px + _pw / 2, _pcy = _py + _ph / 2;

        // 1) 半透明遮罩（全屏，不随面板缩放）
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
        ctx.restore();

        // 入场动画（弹出）：scale 0.9→1 + alpha 0→1，约 280ms
        if (!this._helpEndPanelShowTime) this._helpEndPanelShowTime = Date.now();
        var _eat = Math.min(1, (Date.now() - this._helpEndPanelShowTime) / 280);
        var _ease = 1 - Math.pow(1 - _eat, 3);          // easeOutCubic
        var _scale = 0.9 + 0.1 * _ease;
        var _alpha = _ease;

        ctx.save();
        ctx.globalAlpha = _alpha;
        ctx.translate(_pcx, _pcy);
        ctx.scale(_scale, _scale);
        ctx.translate(-_pcx, -_pcy);

        // 2) 三宫格背景（settings_bg.png，与设置面板同图；top135 / mid拉伸 / bottom36）
        var _bg = AssetPreloader.get('settings_bg');
        if (_bg && AssetPreloader.isReady('settings_bg')) {
          var _sw = _bg.width, _sh = _bg.height;
          var _midH = _ph - 135 - 36; if (_midH < 1) _midH = 1;
          ctx.drawImage(_bg, 0, 0, _sw, 405, _px, _py, _pw, 135);
          ctx.drawImage(_bg, 0, 405, _sw, 162, _px, _py + 135, _pw, _midH);
          ctx.drawImage(_bg, 0, _sh - 108, _sw, 108, _px, _py + _ph - 36, _pw, 36);
        }

        // x = 你帮忙额外逃出的猪数 = 当前已逃出 − 残局初始已逃出（x=0 走专属文案「一只都没逃脱」；x>0 走欢喜文案）
        var _extraEsc = (this._escapedCount || 0) - (this._assistBaseEscaped || 0);
        if (_extraEsc < 0) _extraEsc = 0;

        // 3) 顶部标题（白字，与设置面板标题位置一致 p.y+65）
        ctx.save();
        ctx.fillStyle = '#FFFFFF';
        ctx.font = '20px ' + Theme.font.family;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        // 通关 或 帮忙逃出>0 → 「协助完成」；一只都没逃出(x=0) → 「协助失败」
        ctx.fillText((this._helpEndReason === 'cleared' || _extraEsc > 0) ? '协助完成' : '协助失败', _pcx, _py + 65);
        ctx.restore();

        // 4) 中部文案（深色，居中，过长自动换行）
        var _endTxt;
        if (this._helpEndReason === 'cleared') _endTxt = '恭喜你通关了，快发给好友吧';
        else if (_extraEsc === 0) _endTxt = '哎呀，一只小猪都没有逃脱，再试试看？';
        else _endTxt = '你成功帮忙逃脱了' + _extraEsc + '只小猪，快告诉你的好朋友吧。';
        ctx.save();
        ctx.fillStyle = '#5A4A6A';
        ctx.font = '18px ' + Theme.font.family;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        var _lines = [], _cur = '';
        for (var _ci = 0; _ci < _endTxt.length; _ci++) {
          var _chr = _endTxt[_ci];
          if (ctx.measureText(_cur + _chr).width > (_pw - 56) && _cur) { _lines.push(_cur); _cur = _chr; }
          else _cur += _chr;
        }
        if (_cur) _lines.push(_cur);
        if (_lines.length === 0) _lines.push(_endTxt);
        var _baseY = _py + 170 - (_lines.length - 1) * 13;
        for (var _li = 0; _li < _lines.length; _li++) ctx.fillText(_lines[_li], _pcx, _baseY + _li * 28);
        ctx.restore();

        // 5) 底部按钮（统一三钮：左 下次再说 / 中 标签钮 / 右 再来一次）
        // 通关(cleared) 或 帮忙逃出>0 → 中钮「发给好友」(submit)；一只都没逃出(x=0) → 中钮「再来一次」(again)，左右不变
        var _isSendCenter = (this._helpEndReason === 'cleared') || (_extraEsc > 0);
        var _fromBottomSide = Math.max(26, Math.floor(_ph * 0.112));
        var _sideSz = 36;
        var _sideCY = _py + _ph - _fromBottomSide - _sideSz / 2;   // 侧钮垂直中心
        var _cw = 127, _ch = 48;
        var _centerTop = _py + _ph - 36 - _ch;                     // 中钮垂直顶（与 btn_continue fromBottom:36 一致）
        var _centerX = _pcx - _cw / 2;

        if (!this._helpSending) {
          // 左：下次再说（btn_home 图标 → 返回主菜单）
          var _homeX = _px + 26, _homeY = _sideCY - _sideSz / 2;
          this._drawHelpIcon(ctx, 'btn_home', 'later', _homeX, _homeY, _sideSz);
          this._helpOverlayBtns.push({ id: 'later', x: _homeX, y: _homeY, w: _sideSz, h: _sideSz });
          // 右：再来一次（btn_again 图标 → 重拉好友关）
          var _againX = _px + _pw - 26 - _sideSz, _againY = _sideCY - _sideSz / 2;
          this._drawHelpIcon(ctx, 'btn_again', 'again', _againX, _againY, _sideSz);
          this._helpOverlayBtns.push({ id: 'again', x: _againX, y: _againY, w: _sideSz, h: _sideSz });
        }

        // 中：发给好友(submit) / 再来一次(again，x=0 时)；点击发送流程期间屏蔽所有操作直接回主菜单
        if (!this._helpSendBtn) this._helpSendBtn = new CommonButton({ x: _centerX, y: _centerTop, w: _cw, h: _ch, color: 'blue' });
        this._helpSendBtn.x = _centerX; this._helpSendBtn.y = _centerTop;
        this._helpSendBtn.w = _cw; this._helpSendBtn.h = _ch;
        this._helpSendBtn.label = _isSendCenter ? (this._helpSending ? '发送中…' : '发给好友') : '再来一次';
        this._helpSendBtn.render(ctx);
        this._helpOverlayBtns.push({ id: _isSendCenter ? 'submit' : 'again', x: _centerX, y: _centerTop, w: _cw, h: _ch });

        ctx.restore();   // 结束面板缩放变换
      } else {
        // 协助准备倒计时（进入后 3 秒，与回放一致的「准备」节拍；期间屏蔽输入）
        // 倒计时结束 → 进入渐隐窗口（圈 + 数字 +文案一起淡出 300ms），淡出期间玩家即可接管
        var _ASSIST_FADE = 300;
        if (this._assistCounting && Date.now() >= this._assistCountdownEnd) {
          this._assistCounting = false;
          this._assistFadeStart = Date.now();
        }
        if (this._assistCounting) {
          // 倒计时进行中：满 alpha（冻结末值，避免结束瞬间 1→0 的跳变）
          this._assistLastNum = Math.max(0, Math.ceil((this._assistCountdownEnd - Date.now()) / 1000));
          this._drawAssistCountdown(ctx, 1);
        } else if (this._assistFadeStart) {
          // 渐隐窗口：圈 + 数字 + 文案一起淡出
          var _fp = (Date.now() - this._assistFadeStart) / _ASSIST_FADE;
          if (_fp >= 1) this._assistFadeStart = 0;     // 渐隐完成，停止绘制
          else this._drawAssistCountdown(ctx, 1 - _fp);
        }
        // 协助进行中：「协助完成」单钮（倒计时进行中 / 渐隐中均不显示，淡出完成后出现）
        if (!this._assistCounting && !this._assistFadeStart) {
          // 居中「协助完成」单钮（屏幕底部 bottom 30，水平居中；点之进入统一结束面板）
          // 最后一只猪开始跑(canEscapeRemaining===0)时渐隐消失且不再可点
          var ew = 180, eh = 56, ex = cx - ew / 2, ey = SCREEN_HEIGHT - 30 - eh;
          var _endAlpha = this._endBtnHideTime
            ? Math.max(0, 1 - (Date.now() - this._endBtnHideTime) / 220)   // 220ms 渐隐
            : 1;
          if (_endAlpha > 0.01) {
            this._drawHelpBtn(ctx, ex, ey, ew, eh, '协助完成', 'end', _endAlpha);
            // 仅未触发渐隐时可点；一旦开始渐隐即从命中区移除，杜绝误触
            if (!this._endBtnHideTime) {
              this._helpOverlayBtns.push({ id: 'end', x: ex, y: ey, w: ew, h: eh });
            }
          }
        }
        // 「协助好友通关中」白字带描边 + rec 图标 改由 _renderStatusIndicators(assist) 画在左上角
      }
    } else if (databus.playMode === 'replay') {
      this._renderReplayProgress(ctx);    // 进度条（贴在播放中「返回」按钮上方 10px）+ mm:ss 倒计时（预热满格→耗尽式收缩→结束渐隐）
      // 回放触摸指示：落点/抬手涟漪 + 拖动柔光跟随点（替代闪现小手，安静不刺眼）
      this._renderTouchIndicator(ctx, Date.now());
      // 倒计时驱动：到点启动回放（仅一次）
      if (this._replayCounting && Date.now() >= this._replayCountdownEnd) {
        this._replayCounting = false;
        var _rpbSelf = this;
        this._trialStartPlayback(this._helpReplaySrc, function () {
          _rpbSelf._replayDone = true;   // 回放结束：覆盖层据其绘制「再看一次」+「返回」
          _rpbSelf._replayEndTime = Date.now();   // 触发结束按钮「从底部滑到屏幕中央」动画
          console.log('[Help] 回放播放完成 playMode=replay');
        });
      }
      // 倒计时圈（进入回放后 5 秒内显示于屏幕正中）
      if (this._replayCounting) {
        var _rem = Math.ceil((this._replayCountdownEnd - Date.now()) / 1000);
        if (_rem < 0) _rem = 0;
        var _ccx = SCREEN_WIDTH / 2, _ccy = SCREEN_HEIGHT / 2;
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(_ccx, _ccy, 46, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 40px ' + Theme.font.family;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String(_rem), _ccx, _ccy);
        ctx.restore();
      }
      // 返回按钮（底部水平居中，回放全程可点）
      var bw2 = 150, bh2 = 52;
      var by2 = SCREEN_HEIGHT - 20 - bh2;
      if (this._replayDone) {
        // 回放完成：先让「返回」以「汽车刹车」曲线滑到屏幕中央并停稳；停稳后「再看一次」再渐显出现
        if (!this._replayEndTime) this._replayEndTime = Date.now();
        var _gap = 16;
        var _stackH = bh2 * 2 + _gap;
        var _startTop = by2;                              // 起始：贴底部（与播放中「返回」同高）
        var _endTop = SCREEN_HEIGHT / 2 - _stackH / 2;    // 目标：整组垂直居中
        // 刹车曲线：前 55% 时间匀速巡航，之后恒定减速（easeOutQuad）咬死停住，无回弹、无过冲
        var _SLIDE = 560, _FADE = 300;                    // 滑行时长 / 再看一次渐显时长(ms)
        var _elapsed = Date.now() - this._replayEndTime;
        var _p = Math.min(1, _elapsed / _SLIDE);
        var _lead = 0.55, _A = 2;                         // 巡航时间占比 / 刹车段初始斜率(=恒定减速度)
        var _leadDist = _A * _lead / (1 - _lead + _A * _lead); // ≈0.71，使巡航→刹车速度连续
        if (_p < _lead) {
          var _ease = (_p / _lead) * _leadDist;           // 匀速巡航
        } else {
          var _q = (_p - _lead) / (1 - _lead);
          var _ease = _leadDist + (1 - _leadDist) * (1 - (1 - _q) * (1 - _q)); // 恒定减速刹车到 0
        }
        var _stackTop = _startTop + (_endTop - _startTop) * _ease;
        var _bx = cx - bw2 / 2;                           // 两钮等宽水平居中
        // 返回（上）：先滑到中央停稳，全程不透明、可点
        this._drawHelpBtn(ctx, _bx, _stackTop, bw2, bh2, '返回', 'back');
        this._helpOverlayBtns.push({ id: 'back', x: _bx, y: _stackTop, w: bw2, h: bh2 });
        // 再看一次（下）：返回停稳后才渐显；渐显期间才进入命中区（避免点到隐形钮）
        var _againAlpha = Math.max(0, Math.min(1, (_elapsed - _SLIDE) / _FADE));
        if (_againAlpha > 0.01) {
          this._drawHelpBtn(ctx, _bx, _stackTop + bh2 + _gap, bw2, bh2, '再看一次', 'again', _againAlpha);
          this._helpOverlayBtns.push({ id: 'again', x: _bx, y: _stackTop + bh2 + _gap, w: bw2, h: bh2 });
        }
      } else {
        var startX2 = cx - bw2 / 2;
        this._drawHelpBtn(ctx, startX2, by2, bw2, bh2, '返回', 'back');
        this._helpOverlayBtns.push({ id: 'back', x: startX2, y: by2, w: bw2, h: bh2 });
      }
    }
  }

  /** 覆盖层按钮按压缩放（按下 100ms 缩 0.94 / 松开 140ms 弹回，复用 CommonButton 同款 easing） */
  _helpBtnScale(id) {
    var p = this._helpPress && this._helpPress[id];
    if (!p) return 1;
    var elapsed = Date.now() - p.startTime;
    if (p.phase === 'pressing') {
      var t = Math.min(elapsed / 100, 1);
      return 1 - 0.06 * Easing.easeOutCubic(t);
    } else {
      var t2 = Math.min(elapsed / 140, 1);
      return 0.94 + 0.06 * Easing.easeOutBack(t2, 1.5);
    }
  }

  /** 覆盖层按钮：统一使用标准绿钮 button_green.png（drawGreenButton），按 id 应用按压缩放 */
  _drawHelpBtn(ctx, x, y, w, h, label, id, alpha) {
    if (alpha === undefined) alpha = 1;
    var scale = this._helpBtnScale(id);
    ctx.save();
    if (alpha !== 1) ctx.globalAlpha = alpha;
    if (scale !== 1) {
      var cx = x + w / 2, cy = y + h / 2;
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -cy);
    }
    drawGreenButton(ctx, { x: x, y: y, w: w, h: h, label: label });
    ctx.restore();
  }

  /** 覆盖层图标钮（btn_home / btn_again 等），按 id 应用按压缩放 */
  _drawHelpIcon(ctx, imgKey, id, x, y, sz) {
    var img = AssetPreloader.get(imgKey);
    if (!img || !AssetPreloader.isReady(imgKey)) return;
    var scale = this._helpBtnScale(id);
    var cx = x + sz / 2, cy = y + sz / 2;
    ctx.save();
    if (scale !== 1) {
      ctx.translate(cx, cy);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -cy);
    }
    ctx.drawImage(img, x, y, sz, sz);
    ctx.restore();
  }

  /** 覆盖层按钮点击分发 */
  _onHelpOverlayTap(id) {
    // 已点「发给好友」：面板仅剩中钮（此时为「返回」），点击即退出
    if (this._helpSent) {
      if (id === 'submit') this._exit();
      return;
    }
    if (id === 'submit') {
      this._submitAssist();
    } else if (id === 'back') {
      this._exit();
    } else if (id === 'later') {
      // 协助关「下次再说」：直接返回主菜单
      this._exit();
    } else if (id === 'end') {
      // 防御：最后一只猪已开始在跑（按钮渐隐中/已隐藏）时不接受点击
      if (this._endBtnHideTime) return;
      // 协助关「协助完成」：停录并保留录制，进入统一结束面板
      // 一头猪都没额外逃出(noescape) 与 提前结束(early) 现统一为「你帮忙逃脱了x只」面板（x=0/extra）；按钮区按 x 决定中钮是「发给好友」还是「再来一次」
      this._helpEndReason = this._helpNoExtraEscaped() ? 'noescape' : 'early';
      // 不直接 _helpEnded：等最后一只逃逸猪动画播完再落定（对齐正式关结算手感）
      this._helpSettlePending = true;
      if (this._isRecording) this._trialStopRecord(true);
    } else if (id === 'again') {
      if (databus.playMode === 'assist') {
        // 再来一次：重新挑战好友关（重新拉同一 helpKey，复盘好友残局）
        // 复位结算态，避免旧 attempt 的 _helpEnded/_showHelpEndPanel/_victory 干扰新一局渲染
        this._helpEnded = false;
        this._helpSettlePending = false;
        this._endBtnHideTime = 0;
        this._showHelpEndPanel = false;
        this._helpEndReason = null;
        this._helpSent = false;            // 重玩：清除「已发送」morph，恢复三钮
        this._helpSending = false;         // 重玩：确保发送锁已释放
        this._helpEndPanelShowTime = 0;
        this._victory = false;
        this._loading = true;            // 重拉期间显示「加载关卡中...」
        this._helpRequesterImg = null;   // 重新加载好友头像
        this._enterAssistFromHelpKey(databus._pendingHelpKey);
      } else if (this._helpReplaySrc) {
        // 回放：再看一次 —— 完整过场 + 销毁当前关卡 + 重新进入回放（含 5 秒倒计时），与「重来一次」一致
        this._replayDone = false;
        this._replayEndTime = 0;            // 复位滑动动画时间戳
        this._replayStartTime = 0;
        this._replayDuration = 0;
        this._replayCounting = false;
        this._isRecording = false;
        this._recordEntries = this._helpReplaySrc;
        this._helpReplayRecording = this._helpReplaySrc;   // 重新喂入，供 _afterEnterLevel 再次触发倒计时+回放
        this.startLevel(this.levelName);   // 复用 restartLevel 路径：捕获帧→圆形过场→销毁→重载→倒计时+回放
      }
    }
  }

  activate() {
    // 统一入口：内存关卡（试玩 / 协助 / 回放）与普通关共用 startLevel → currentLevel.data 通道，
    // 不再为协助/回放特判内存抽屉（playMode 仅作 UI 判别器，不参与加载控制流）。
    var self2 = this;
    if (this._levelReady) {
      // 菜单→关卡：prepareLevel 已在出场期间完成加载，这里只绑定输入、跳过重复加载
      this.input.on('playing', function (e) { self2.handleEvent(e); });
    } else {
      // 其它直接进关路径（冷启协助/回放、编辑器试玩、续玩）：startLevel 按 currentLevel 解析数据
      var name = databus.currentLevel ? databus.currentLevel.name : '';
      if (!name) {
        // currentLevel 未初始化（异常）→ 回菜单，杜绝 downloadLevel(null,'',true) 空名报错
        console.warn('[Playing] activate 兜底无有效关卡名，回菜单 playMode=' + databus.playMode);
        this._exit();
        return;
      }
      this.startLevel(name);
    }
  }

  /** 菜单→关卡：在出场动画期间并行预加载并构建关卡（不启动入场计时）。 */
  prepareLevel(name) {
    this._levelReady = false;
    this._levelLoadFailed = false;
    if (this.levelName) {
      this.input.off('playing');
      this._guide.reset();
    }
    this.levelName = name;
    this._setupUI();                       // 搭建 UI 框架（棋盘空白），让关卡引擎可随时渲染
    if (this._uiGoldWidget) this._uiGoldWidget._floatTexts = [];

    var self = this;
    var doLoad = function (data) {
      self.loadLevel(data);
      self._levelReady = true;
      self._afterEnterLevel();   // 断点续玩恢复 + 录制 + 预下载（与 _loadAndStart 一致，修复菜单进关漏续玩）
    };

    // 内存关卡（试玩 / 协助 / 回放）：currentLevel.data 已就绪
    if (databus.currentLevel && databus.currentLevel.data) {
      doLoad(databus.currentLevel.data);
    } else if (this._cloudFetchedData.has(name)) {
      doLoad(this._cloudFetchedData.get(name));
    } else {
      var localData = this._readLocalLevel(name);
      if (localData) {
        doLoad(localData);                 // 本地关：同步重活在「菜单下滑」期间完成
      } else {
        // 本地无 → 云端异步（与菜单下滑并行）
        var pullPromise = cloud.downloadLevel(null, name, true);
        var timeoutPromise = new Promise(function (_, reject) {
          setTimeout(function () { reject(new Error('timeout')); }, PlayDefine.PLAY.LOAD_TIMEOUT);
        });
        Promise.race([pullPromise, timeoutPromise])
          .then(function (result) {
            if (result && result.data) {
              self._cloudFetchedData.set(name, result.data);
              doLoad(result.data);
            } else {
              console.warn('[cloud] 关卡 ' + name + ' 未发布，本地也无配置');
              self._levelLoadFailed = true;
              showToast('关卡数据加载失败', 2000);
            }
          })
          .catch(function (err) {
            console.warn('[cloud] 关卡拉取失败（' + (err && err.message) + '），本地也无配置');
            self._levelLoadFailed = true;
            showToast('关卡数据加载失败', 2000);
          });
      }
    }
  }

  /** 关卡入场动画已去除：交叉淡变结束、切场景那一刻直接置终态，所有 UI 默认显示（无飞入/渐显）。 */
  beginEntrance() {
    // 入场时序字段已不再使用（phase 恒为 'done'），仅保留占位，避免引用 PlayDefine.PLAY.ENTRANCE 在重玩时偶发 undefined。
    this._entranceState = {
      startTime: Date.now(),
      phase: 'done',        // 直接终态：无飞入/渐显
    };
  }

  deactivate() {
    this.input.off('playing');
    if (this._uiBranchProgress) this._uiBranchProgress.stopStarRotate();   // 离开关卡：停掉可能仍在循环的 4★ 旋转声
    this._guide.reset();         // 退出关卡时强制结束引导
    this._entranceState = null;  // 清空入场动画，防止下一帧闪现旧猪
    this._levelReady = false;    // 重置并行加载标志，避免误判「已加载」跳过 startLevel（如编辑器试玩→进关）
    this._levelLoadFailed = false;
    // 清理录制/回放状态
    if (this._isRecording) this._trialStopRecord(false);  // 退出关卡不保存录制
    this._isPlayingBack = false;
    this._playbackDotPos = null;
    this._touchRipples = [];
    this._touchFollow = null;
    this._touchFollowLast = 0;
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
    this._stepBonusThreshold = (data && data.stepBonusThreshold != null) ? data.stepBonusThreshold : ((data && data.crownSteps) || 0);
    if (this._stepBonusThreshold <= 0) {
      console.warn('[StepHUD] 关卡 ' + (data && data.name) + ' stepBonusThreshold=' + this._stepBonusThreshold + ' → 剩余步数 HUD 隐藏（无步数预算；检查关卡 JSON 是否含 stepBonusThreshold）');
    }
    this._levelVersion = (data && data.version) || 0;
    // 星级积分门槛：优先读关卡配置，否则按默认公式（新方案：难度档+可省步数比例）填充
    var pigCountForStar = (data && data.pigs) ? data.pigs.length : 0;
    this._starScores = (data && data.starScores && data.starScores.length === 4)
      ? data.starScores.slice()
      : StarScores.computeDefaultStarScores(pigCountForStar, this._stepBonusThreshold,
          StarScores.resolveDifficulty(data, databus.currentLevelIndex));
    // 进度条分母 = 4 星门槛（小虫跑到底 = 4 星）；缺失时回退 totalScore→30
    this._totalScore = StarScores.getStar4Score(this._starScores, (data && data.totalScore != null) ? data.totalScore : 30);
    if (this._uiBranchProgress) {
      this._uiBranchProgress.setStarScores(this._starScores);
      this._uiBranchProgress.setScore(0, this._totalScore);
    }
    this.gp.pigs = (data && data.pigs ? data.pigs : []).map(p => ({
      id: p.id, tailIndex: p.tail, length: p.length, angle: p.angle,
      type: p.type || 'pig', skinId: p.skinId || 0,
      // 统一加载已有 hint（试玩/正式一致），通关后由 _mergeAndUploadHints 全量覆盖
      hintId: p.hintId != null ? p.hintId : null,
      hintAngle: p.hintAngle != null ? p.hintAngle : p.angle,
      collisionWidth: p.collisionWidth != null ? p.collisionWidth : null
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
    // 试玩模式：初始化提示编号计数器（已有 hintId 中最大 + 1）
    if (databus.returnState === 'editor') {
      var maxId = 0;
      for (var i = 0; i < this.gp.pigs.length; i++) {
        var hid = this.gp.pigs[i].hintId;
        if (hid != null && hid > maxId) maxId = hid;
      }
      this._trialHintNextId = maxId + 1;
    }
    // 关卡无 hint 数据则隐藏提示按钮（正式 + 试玩统一）
    var hasAnyHint = false;
    for (var i = 0; i < this.gp.pigs.length; i++) {
      if (this.gp.pigs[i].hintId != null) { hasAnyHint = true; break; }
    }
    this._hasHintData = hasAnyHint;         // 无 hint 关卡隐藏提示按钮

    // 道具每关限用次数（每次关卡游玩重置，不跨关）；断点续玩时由 checkpoint 原样恢复「已用过几次」
    this._addStepRemaining = 3;   // +3 步：每关 3 次
    this._helpRemaining = 2;      // 求助：每关 2 次
    this._hintRemaining = 3;      // 提示：每关 3 次
  }

  // ========== 输入 ==========
  handleEvent(e) {
    // 加载中：阻止所有用户操作（云端关卡拉取中）
    if (this._loading) return;
    // 场外求助「发给好友」发送中：屏蔽一切触控，直至流程结束（无论成功/失败均回主菜单）
    if (this._helpSending) return;
    // 入场动画期间：猪渐显完成前（board/pigs 阶段），阻止所有操作
    if (this._entranceState && this._entranceState.phase !== 'done' && this._entranceState.phase !== 'ui') {
      // 测试按钮例外：开发调试用，所有阶段均可操作
      const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
      if (t && e.type === 'touchstart') {
        if (databus.debugUnlocked) {
          if (this._testBoundBtn && _hitRect(t.x, t.y, this._testBoundBtn)) { this._showBoardBounds = !this._showBoardBounds; return; }
          if (this._testAutoBtn && _hitRect(t.x, t.y, this._testAutoBtn)) { this._startAutoReplay(); return; }
        }
      }
      return;
    }

    const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    if (!t) return;

    // 路由：协助/回放与正常模式是完全不同的两套 UI 体系，各自独立函数
    if (databus.playMode !== 'normal') {
      this._handleEventAssist(e, t);
    } else {
      this._handleEventNormal(e, t);
    }
  }

  /** 场外求助（协助 / 回放）：所有非正常模式的触控处理。
   *  UI 体系（协助结算面板、就帮到这吧、回放按钮）与正常模式完全不同，
   *  不存在 VictoryPopup / 失败面板 / 道具按钮 / 提示 / 求助 等概念。
   *  简明触控流：面板 → 游戏世界（onTouchStart/Move/End 内部委托给 _helpOverlayBtns）。 */
  _handleEventAssist(e, t) {
    if (this._assistCounting) return;   // 准备倒计时期间屏蔽玩家一切触控（与回放一致：先看清楚再接管）
    if (e.type === 'touchstart') {
      if (StaminaAdPanel.isOpen()) { StaminaAdPanel.handleTouch(t.x, t.y, e.type); return; }
      if (settingsPanel.isOpen()) { settingsPanel.handleTouch(t.x, t.y, e.type); return; }
      this.onTouchStart(t.x, t.y);
    } else if (e.type === 'touchmove') {
      if (settingsPanel.isOpen()) return;
      this.onTouchMove(t.x, t.y);
    } else if (e.type === 'touchend') {
      if (settingsPanel.isOpen()) return;
      this.onTouchEnd(t.x, t.y);
    }
  }

  /** 正常模式触控处理：VictoryPopup / 失败面板 / 道具按钮 / 提示 / 求助 / 棋盘拖拽。 */
  _handleEventNormal(e, t) {
    var self = this;
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

      // 通关后、结算面板尚未显示期间：屏蔽一切触控
      if (this._victory && !this._showVictoryPanel) return;

      // 结算面板关闭动画中：屏蔽触控
      if (this._victoryClosing) return;

      // 通关界面按钮（UIManager）
      if (this._victory) {
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

      // 失败界面按钮（与通关界面对称）
      if (this._failed) {
        if (this._uiFailPopup._replayBtn && _hitRect(t.x, t.y, this._uiFailPopup._replayBtn)) {
          audio.play('button_click');
          this.restartLevel();
          return;
        }
        if (this._uiFailPopup._exitBtn && _hitRect(t.x, t.y, this._uiFailPopup._exitBtn)) {
          audio.play('button_click');
          try { wx.removeStorageSync('game_checkpoint'); } catch (e) {}
          if (databus.returnState === 'editor') { databus.gameState = 'editor'; }
          else { databus._returningToMenu = true; databus.gameState = 'menu'; }
          return;
        }
        return; // 失败后屏蔽其他触控
      }

      // 调试按钮（框/回）
      if (this._testBoundBtn && _hitRect(t.x, t.y, this._testBoundBtn)) {
        this._showBoardBounds = !this._showBoardBounds;
        return;
      }
      if (this._testAutoBtn && _hitRect(t.x, t.y, this._testAutoBtn)) {
        this._startAutoReplay();
        return;
      }

      // 顶部返回/设置按钮（命中区 = 视觉按钮圆心 + 1.2× 半幅，跟随安全区；见 _hitSettingsBtn）
      if (this._hitSettingsBtn(t.x, t.y)) {
        this._btnPress.press('settings');
        this._btnPress.breathe('settings');
        audio.play('button_click');
        if (settingsPanel.isOpen()) {
          settingsPanel.close();
        } else {
          settingsPanel.open({
            title: '设置',
            buttons: [
              { iconKey: 'btn_home', action: function() { audio.play('button_click'); settingsPanel.close(function() { databus.gameState = databus.returnState === 'editor' ? 'editor' : 'menu'; }); } },
              { iconKey: 'btn_continue', action: function() { audio.play('button_click'); settingsPanel.close(); } },
              { iconKey: 'btn_again', action: function() { audio.play('button_click'); settingsPanel.close(function() { self.restartLevel(); }); } },
            ]
          });
        }
        return;
      }

      // 关卡内底栏道具按钮（ItemButton）— 入场动画完成前 / 失败 / 通关后 不响应
      var entranceActive = this._entranceState && this._entranceState.phase !== 'done';
      if (!entranceActive && !this._failed && !this._victory) {
        // 左按钮：+3 步（新 ItemButton）— 协助/回放场景不渲染、不命中（见 onTouchStart / render 同步门控）
        var addRect = this._uiAddStepBtn ? this._uiAddStepBtn.getHitRect() : null;
        if (addRect && _hitRect(t.x, t.y, addRect)) {
          if (this._addStepRemaining <= 0) return;
          audio.play('button_click');
          this._btnPress.press('plus5');
          this._btnPress.breathe('plus5');
          this._addBonusSteps(3);
          // +3 道具图标飞向剩余步数面板
          if (this._itemFlyEffect && this._uiRightStep) {
            var sp2 = this._uiRightStep.getStepNumberPos();
            this._itemFlyEffect.trigger(addRect.x + 38.5, addRect.y + 38.5, sp2.x, sp2.y);
          }
          this._addStepRemaining--;
          if (this._uiAddStepBtn) this._uiAddStepBtn.setData(this._addStepRemaining);
          this._saveCheckpoint();
          return;
        }
        // 提示按钮
        var hintRect = this._uiHintBtn ? this._uiHintBtn.getHitRect() : null;
        if (this._hasHintData && hintRect && _hitRect(t.x, t.y, hintRect)) {
          if (this._hintRemaining <= 0) return;
          if (this._hint.isActive()) { showToast('请先解救这一只', 1500); return; }
          audio.play('button_click');
          this._btnPress.press('bottomHint');
          this._btnPress.breathe('bottomHint');
          var best = this._hint.show();
          if (best) {
            audio.play('hint_reveal');
            this._hintRemaining--;
            if (this._uiHintBtn) this._uiHintBtn.setData(this._hintRemaining);
            this._saveCheckpoint();
          } else { showToast('提示已结束', 1500); }
          return;
        }
      }

      // === 游戏世界（拖拽猪等）===
      // 注：求助按钮的命中处理已下沉到 onTouchStart 统一路径（见 _startExternalHelp）
      this.onTouchStart(t.x, t.y);
    } else if (e.type === 'touchmove') {
      if (settingsPanel.isOpen()) return;
      if (this._failed) return;
      if (this._victory && !this._showVictoryPanel) return;
      this.onTouchMove(t.x, t.y);
    } else if (e.type === 'touchend') {
      if (settingsPanel.isOpen()) return;
      if (this._failed) return;
      if (this._victory && !this._showVictoryPanel) return;
      this.onTouchEnd(t.x, t.y);
    }
  }

  // 设置按钮命中检测：圆心 = TopBar 实际绘制中心（跟随安全区 _baseY），半径 = UI 半幅 × 1.2。
  // 触控区与视觉按钮严格圆心对齐；关卡内/主菜单统一为 1.2× UI。
  _hitSettingsBtn(px, py) {
    var by = (this._uiTopBar && this._uiTopBar._baseY != null) ? this._uiTopBar._baseY : 0;
    var half = 16 * 1.2;   // 32 UI → 1.2× 半幅 = 19.2（与主菜单 setHit 一致）
    var cx = 15 + 16;      // backX(15) + 半幅(16)，圆心 X
    var cy = by + 3 + 16;  // backY(by+3) + 半幅(16)，圆心 Y（跟随安全区）
    return Math.abs(px - cx) <= half && Math.abs(py - cy) <= half;  // 居中正方形，匹配主菜单
  }

  onTouchStart(x, y) {
    // 场外求助覆盖层按钮（协助/回放）优先级最高，拦截一切（含回放中）
    if (databus.playMode !== 'normal' && this._helpOverlayBtns && this._helpOverlayBtns.length) {
      for (var hbi = 0; hbi < this._helpOverlayBtns.length; hbi++) {
        var hb = this._helpOverlayBtns[hbi];
        if (x >= hb.x && x <= hb.x + hb.w && y >= hb.y && y <= hb.y + hb.h) {
          audio.play('button_click');
          // 按压反馈：中钮（发送给好友）走 CommonButton 自带 _pressState；其余走 _helpPress 按 id 追踪
          if (hb.id === 'submit' && this._helpSendBtn) {
            this._helpSendBtn._pressState = { startTime: Date.now(), phase: 'pressing' };
          } else {
            if (!this._helpPress) this._helpPress = {};
            this._helpPress[hb.id] = { startTime: Date.now(), phase: 'pressing' };
          }
          this._onHelpOverlayTap(hb.id);
          return;
        }
      }
    }

    // 场外求助发起中（Flow A：建单 + 分享）：屏蔽一切玩家操作，直到流程走完
    if (this._externalHelpBusy) return;

    // 回放：完全屏蔽玩家触控（仅回放自身合成触控 _playbackSynthetic 放行，避免玩家拖动小猪干扰）
    if (databus.playMode === 'replay' && !this._playbackSynthetic) return;

    // 协助关已结束（提前结束 / 通关）：仅允许覆盖层按钮，屏蔽棋盘操作，避免结束后再拖动猪
    if (databus.playMode === 'assist' && this._helpEnded) {
      return;
    }

    this._guide.onPlayerAction();  // 棋盘操作 → 重置空闲计时

    // === 按钮检测（回放中跳过） ===
    if (!this._isPlayingBack) {
    var self = this;
    // 顶栏左侧设置按钮（齿轮，32×32，圆心对齐 + 1.2× 半幅热区，跟随安全区；见 _hitSettingsBtn）
    var entranceDone = !this._entranceState || this._entranceState.phase === 'done';
    if (entranceDone && !this._failed && !this._victory) {
      if (this._hitSettingsBtn(x, y)) {
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
              { iconKey: 'btn_home', action: function() { audio.play('button_click'); settingsPanel.close(function() { databus.gameState = databus.returnState === 'editor' ? 'editor' : 'menu'; }); } },
              { iconKey: 'btn_continue', action: function() { audio.play('button_click'); settingsPanel.close(); } },
              { iconKey: 'btn_again', action: function() { audio.play('button_click'); settingsPanel.close(function() { self.restartLevel(); }); } },
            ]
          });
        }
        return;
      }
    }

    // 提示按钮（ItemButton）— 旧版兼容触控路径
    var hintRect2 = this._uiHintBtn ? this._uiHintBtn.getHitRect() : null;
    if (databus.playMode === 'normal' && this._hasHintData && hintRect2 && !this._hint.getTarget() && x >= hintRect2.x && x <= hintRect2.x + hintRect2.w &&
        y >= hintRect2.y && y <= hintRect2.y + hintRect2.h) {
      audio.play('button_click');
      this._btnPress.press('hint');
      this._btnPress.breathe('hint');
      var best = this._hint.show();
      if (best) audio.play('hint_reveal');
      else showToast('提示已结束', 1500);
      return;
    }

    // 求助按钮（ItemButton）— 场外求助入口
    var helpRect2 = this._uiHelpBtn ? this._uiHelpBtn.getHitRect() : null;
    if (databus.playMode === 'normal' && helpRect2 && x >= helpRect2.x && x <= helpRect2.x + helpRect2.w &&
        y >= helpRect2.y && y <= helpRect2.y + helpRect2.h) {
      if (this._helpRemaining <= 0) { showToast('本关求助次数已用完', 1500); return; }
      audio.play('button_click');
      this._btnPress.press('help');
      this._btnPress.breathe('help');
      this._startExternalHelp();   // 场外求助：存云端 + 分享卡片
      return;
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
    var bp = this.gp.screenToBoard(x, y);   // autoScale<1 → 棋盘数据坐标(h.x,h.y)；否则 → 原始屏幕坐标
    // 统一取到「棋盘数据坐标」(h.x, h.y)：autoScale<1 时 screenToBoard 直接返回 h.x/h.y；
    // 否则需剥离 boardOffsetX / (topBarH+boardOffsetY) 才得到 h.x/h.y。
    var _asRec = this.gp._getAutoScale();
    var hx = (_asRec < 1) ? bp.x : (bp.x - this.gp.boardOffsetX);
    var hy = (_asRec < 1) ? bp.y : (bp.y - (this.gp.topBarH + this.gp.boardOffsetY));
    // 归一到「直径单位」(÷scaledDiameter)：棋盘布局是 scaledDiameter 的均匀缩放，
    // boardWidth=min(levelBoardWidth, SCREEN_WIDTH*percent) 随屏宽缩放 → 该单位在任意设备等价，
    // 跨设备回放（好友求助）不再错位（#824 修复后续）。解码时 × 当前设备 scaledDiameter 还原。
    var _sd = this.gp.scaledDiameter;
    this._recordEntries.push({ type: type, bx: hx / _sd, by: hy / _sd, dt: Date.now() - this._recordingStart });
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
    // 释放场外求助覆盖层按钮按压态（单点触控：松开即结束按压动画）
    if (this._helpPress) {
      for (var hpk in this._helpPress) {
        if (this._helpPress[hpk]) this._helpPress[hpk] = { startTime: Date.now(), phase: 'releasing' };
      }
    }
    if (this._helpSendBtn && this._helpSendBtn._pressState) {
      this._helpSendBtn._pressState = { startTime: Date.now(), phase: 'releasing' };
    }

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
        this.tryPushPig(pigId, { skipStep: true });  // 内部会判通关（设置 _victory）
      }
      this._shouldPushAfterSnap = false;
      // 步数用尽判定（必须在 tryPushPig 之后，保证「通关优先于失败」）
      this._checkFail();
      // 实时存整份镜像（替代原 5 秒定时器脏检测）：snap/步数/逃脱移除已全部完成，单次写入即可。
      // 原 tryPushPig 内的 _saveCheckpoint() 已移除，避免「移除前(pigs=29)+移除后(pigs=28)」两次写盘。
      if (pig && snapResult) {
        this._saveCheckpoint();
      }
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

      // 简化逃脱方案（替换 sToExit 预计算 + setTimeout）：
      // 固定速度沿推离方向每帧直线推进，由 GameplayEngine 实时检测「整只猪（含屁股）完全离屏」即结束。
      // 速度恒为 ESCAPE_SPEED（不随 scale / 格子大小变化），距离不再预计算。
      const tailHole = this.gp.holes[pig.tailIndex];
      const tailSX = this.gp.boardOffsetX + tailHole.x;
      const tailSY = this.gp.topBarH + this.gp.boardOffsetY + tailHole.y;
      const now0 = Date.now();
      const anim = {
        pigId,
        dirX: result.dirX, dirY: result.dirY,
        currentDx: 0, currentDy: 0,
        speed: ESCAPE_SPEED,
        lastT: now0,
        tailSX, tailSY,
        tailIndex: pig.tailIndex, length: pig.length, angle: pig.angle,
        done: false,
      };
      const self = this;
      // 离屏回调：清理飞行猪/动画 + 从「尾巴当前所在的屏幕边缘」弹金币（中心落在边缘上）
      anim.onExit = function () {
        // 注意：猪离屏时【不再】触发面板摆动 —— 摆动已在「松手记步」那一刻由
        // RightStepWidget.setData 的「剩余步数下降」检测触发（每次逃猪恰好一次，干净单脉冲）。
        // 若在此处再 triggerHitShake，会与松手那次叠加成双脉冲（猪飞出屏幕后又荡一下，冗余）。
        // tailSX/tailSY 与 currentDx/currentDy 均为「板面坐标」，须经与 renderBoard 一致的
        // autoScale 缩放/居中变换转成「屏幕坐标」，金币才会从猪真正飞出的屏幕边缘弹出
        // （之前直接把板面坐标当屏幕坐标 clamp，第三关缩放后出生点严重偏移）。
        const sp = self.gp._boardToScreen(anim.tailSX + anim.currentDx, anim.tailSY + anim.currentDy);
        const ex = Math.max(0, Math.min(SCREEN_WIDTH, sp.x));
        const ey = Math.max(0, Math.min(SCREEN_HEIGHT, sp.y));
        if (self && self._uiGoldWidget && (databus.returnState === 'editor' || self._isFirstGoldClear)) {
          const goldCX = PlayDefine.PLAY.GOLD_FLY_TARGET.cx;
          const goldCY = PlayDefine.PLAY.GOLD_FLY_TARGET.cy;
          audio.play('coin_fly');
          self._coinFlyEffect.trigger(ex, ey, goldCX, goldCY);
        }
        self.gp.flyingPigs = self.gp.flyingPigs.filter(function (p) { return p.id !== pigId; });
        self.gp.animations = self.gp.animations.filter(function (a) { return a.pigId !== pigId; });
      };
      this.gp.animations.push(anim);
      // 逻辑层立即移除（结算/计分不受动画影响）
      const idx = this.gp.pigs.findIndex(p => p.id === pigId);
      this.gp.flyingPigs.push(this.gp.pigs[idx]);
      this.gp.pigs.splice(idx, 1);
      this.gp.clearPigOccupancy(pigId);
      this._escapedCount++;
      // 逃猪的面板摆动改由 RightStepWidget.setData 的「剩余步数下降」检测负责（松手记步时 target 下降即触发），
      // 与道具飞行到达的 triggerHitShake 可叠加；此处不再显式触发，避免与检测双脉冲叠加导致振幅翻倍。
      // 推猪进度：每跑出一头猪，分支进度积分 +1
      if (this._uiBranchProgress) this._uiBranchProgress.setScore(this._escapedCount, this._totalScore);
      // 如果推出的是提示目标 → 清除提示
      this._hint.onPigExited(pigId);
      if (!opts.skipStep) { this.steps++; databus.currentStep = this.steps; }


      // 统一逻辑：猪逃脱时缓存提示数据（通关后统一写入关卡配置）
      if (!this._hintMerged) {
        this._gameplayHintCache.push({ pigId: pigId, angle: pig.angle });
        console.log('[RecHint] 猪逃脱: pigId=' + pigId + ' hintCache=' + this._gameplayHintCache.length + ' → 收集提示');
        // 试玩模式：实时设 hintId/hintAngle 供显示（写盘延后到通关）
        if (databus.returnState === 'editor' && pig.hintId == null) {
          pig.hintId = this._trialHintNextId++;
          pig.hintAngle = pig.angle;
        }
      } else {
        console.log('[RecHint] 猪逃脱: pigId=' + pigId + ' → 跳过提示收集(_hintMerged=true)');
      }

      // 断点续玩：hint 录制状态（含本次刚入 cache 的提示）由 onTouchEnd 在 tryPushPig 返回后统一存盘，
      // 确保被杀进程后能从存档接上、回来接着录（单次写盘，消灭「崩溃丢最近一条」窗口，无需等定时器）

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
        // 统一逻辑：通关后保存提示数据（正式+试玩）。场外求助协助/回放不污染原关卡提示。
        if (databus.playMode === 'normal' && !this._hintMerged && this._gameplayHintCache.length > 0) {
          this._hintMerged = true;
          console.log('[RecHint] 通关: 上传提示 (hintCache=' + this._gameplayHintCache.length + ')');
          this._mergeAndUploadHints();
        } else {
          console.log('[RecHint] 通关: 跳过提示上传 (playMode=' + databus.playMode + ' hintMerged=' + this._hintMerged + ' hintCache=' + this._gameplayHintCache.length + ')');
        }
        // 通关：正式+试玩统一走结算流程（试玩仅金币不落库、不推进关卡索引）。
        // 场外求助协助/回放：跳过结算与进度落库，仅置胜利态供 UI 展示「发送给好友 / 再看一次」。
        if (databus.playMode === 'normal') {
          this._markCleared();
        } else if (databus.playMode === 'assist') {
          // 协助关：不立即弹面板。置"通关原因 + 待结算"，等最后一只逃逸猪动画播完
          // （onExit 将其从 flyingPigs 移除）后，由 render 每帧 _trySettleHelp 落定并弹结算面板
          // （对齐正式关手感：最后一头猪跑出屏幕才弹，而非刚点下去就弹）。
          this._helpEndReason = 'cleared';
          this._helpSettlePending = true;
          this._endBtnHideTime = Date.now();   // 最后一只猪开始跑 → 「协助完成」按钮开始渐隐且不再可点
        } else {
          console.log('[Help] 回放通关：跳过结算与提示上传（playMode=' + databus.playMode + '）');
        }
        this._victory = true;
        this._victoryTime = Date.now();
        console.log('[LOG_victory] 通关！pigs剩余=0 accumGold=' + this._levelAccumulatedGold + ' totalPigs=' + this._totalPigsInLevel);
      }
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

  /**
   * 步数用尽判定：剩余步数 = 步数预算 - 已用步数。
   * 剩余 <= 0 且尚未通关 → 触发失败。
   * 前置：必须在 tryPushPig（设置 _victory）之后调用，保证「通关优先于失败」。
   */
  _checkFail() {
    if (this._victory || this._failed) return;          // 已通关 / 已失败 → 不重复触发
    var effThreshold = this._stepBonusThreshold + this._bonusSteps;  // 含「+3步」加成
    if (effThreshold <= 0) return;                       // 无步数预算（旧关卡）不判失败
    var remaining = effThreshold - this.steps;
    if (remaining <= 0) {
      this._triggerFail();
    }
  }

  /** 协助关结算兜底：最后一只逃逸猪的动画播完（从 flyingPigs 移除）后，才落定结算面板（对齐正式关手感）。
   *  仅当 _helpSettlePending 为真时生效：early/failed/noescape 三种结束触发后置位，cleared 也在
   *  最后一猪刚被 tap（推入 flyingPigs）时置位、待其离屏后此处落定。 */
  _trySettleHelp() {
    if (!this._helpSettlePending) return;
    if (this._hasEscapingPigs()) return;   // 还有猪在逃跑，继续等
    this._helpSettlePending = false;
    if (this._helpEndReason === 'cleared') {
      this._markClearedHelp();   // 通关：清遗留定时器 + 置 _showHelpEndPanel（内容=恭喜通关）
    } else {
      this._helpEnded = true;    // early/failed/noescape：落定结束态，面板照旧渲染
    }
  }

  /** 是否仍有猪正处于逃逸动画中（gp.flyingPigs 在离屏回调 onExit 时移除，故其长度即"在逃猪数"） */
  _hasEscapingPigs() {
    return !!(this.gp && this.gp.flyingPigs && this.gp.flyingPigs.length > 0);
  }

  /** 触发失败：弹出失败面板，屏蔽棋盘与提示操作 */
  _triggerFail() {
    // 协助关：步数用完 = 本次协助到此为止。协助本身没有成功/失败，任何操作都能回放，
    // 故直接走「就帮到这吧」同款统一结算面板（记录已跑出的猪数 → 可发给好友），不弹普通失败窗。
    if (databus.playMode === 'assist') {
      // 步数用完：若一头猪都没额外跑出 → 失败态（无「发给好友」，仅 再来一次/退出协助）
      this._helpEndReason = this._helpNoExtraEscaped() ? 'noescape' : 'failed';
      // 等最后一只逃逸猪动画播完再落定（步数用完也可能有猪正在逃跑）
      this._helpSettlePending = true;
      if (this._isRecording) this._trialStopRecord(true);
      return;
    }
    this._failed = true;
    audio.play('fail');   // 通关失败音效（云端 game_loss.mp3）
    // 清除断点续玩存档——失败后不允许从失败位置恢复
    try { wx.removeStorageSync('game_checkpoint'); } catch (e) {}
    this._uiFailPopup.visible = true;
    this._uiFailPopup.setData({ returnState: databus.returnState });  // 试玩→「返回编辑」
    this._uiFailPopup.open();
    console.log('[LOG_fail] 通关失败！steps=' + this.steps + ' threshold=' + this._stepBonusThreshold);
  }

  /** 关卡内「+3步」：增加步数预算（不影响已用步数，剩余步数 +3，触发 RightStepWidget 滚动动画） */
  _addBonusSteps(n) {
    if (this._failed || this._victory) return;
    this._bonusSteps += (n || 0);
    this._bonusStepsPending += (n || 0);  // 视觉待释放：图标飞到步数牌后才让显示数字滚上去
    console.log('[LOG_bonus] +' + (n || 0) + '步 bonusSteps=' + this._bonusSteps + ' pending=' + this._bonusStepsPending + ' eff=' + (this._stepBonusThreshold + this._bonusSteps));
  }

  _markCleared() {
    var isTrial = databus.returnState === 'editor';
    console.log('[Playing] _markCleared 调用: level=' + this.levelName + ' idx=' + databus.currentLevelIndex + ' steps=' + this.steps + ' 模式=' + (isTrial ? '试玩→不落库' : '正式→会落库'));
    // 推进 lastLevelIndex（试玩模式不推进）
    if (!isTrial) {
      var currentIdx = databus.currentLevelIndex;
      var savedRaw = wx.getStorageSync('lastLevelIndex');
      var savedIdx = (savedRaw !== '' && savedRaw !== undefined && savedRaw !== null) ? parseInt(savedRaw, 10) : -1;
      if (currentIdx >= 0 && currentIdx >= savedIdx) {
        wx.setStorageSync('lastLevelIndex', currentIdx);
        console.log('[Playing] lastLevelIndex 推进到 ' + currentIdx);
      }
    }
    // 步数→积分（剩余步数飞向小虫）：试玩与正式一致播放，体现「步数预算内通关」
    //   该动画是玩法表现，与金币经济解耦（不再受 _isFirstGoldClear 门控）
    this._goldAmount = 0;
    this._scoreBonusRemaining = 0;
    var effThreshold2 = this._stepBonusThreshold + this._bonusSteps;  // 含「+3步」加成
    if (effThreshold2 > 0 && this.steps < effThreshold2) {
      var stepBonus = effThreshold2 - this.steps;
      if (stepBonus > 0) {
        this._scoreBonusRemaining = stepBonus;  // 每剩余 1 步 = 1 积分（飞小花数 = stepBonus = _scoreBonusRemaining）
      }
    }
    // 步数转积分：最后一只猪开始逃脱后 500ms 启动（不等金币飞行到位），由独立定时器触发
    var selfBonus = this;
    if (this._scoreBonusTimer) { clearTimeout(this._scoreBonusTimer); this._scoreBonusTimer = null; }
    if (this._scoreBonusRemaining > 0) {
      this._scoreBonusSettled = false;
      this._stepFlowersSettled = false;
      this._scoreBonusTimer = setTimeout(function () {
        selfBonus._scoreBonusTimer = null;
        if (!selfBonus._scoreBonusAnim) {
          console.log('[LOG_victory] 步数转积分提前启动(最后一只猪逃脱+500ms)');
          selfBonus._spawnScoreParticles(selfBonus._scoreBonusRemaining);
        }
      }, 500);
    }
    // 金币奖励：仅正式模式首次通关本关（试玩不结算金币）
    if (this._isFirstGoldClear) {
      var reward = GoldSystem.calculateReward(this._totalPigsInLevel);
      if (reward > 0) {
        this._goldAmount = reward;
      }
    }
    console.log('[LOG_victory] 奖励计算完成: goldAmount=' + this._goldAmount + ' scoreBonusRemaining=' + this._scoreBonusRemaining + ' isFirstTime=' + (!isTrial && currentIdx >= savedIdx));

    // 花朵/积分历史最高记录 + 星级：仅正式模式落库（试玩不落库），多次通关保留最高
    // 星级显示值（_victoryStar）无论试玩/正式都计算并缓存，供结算面板展示。
    var achievedScore = this._escapedCount + this._scoreBonusRemaining;
    var star = StarScores.getStarTier(achievedScore, this._starScores);
    this._victoryStar = star;
    if (!isTrial) {
      this._saveBestScore(achievedScore);
      console.log('[Star] 计算星级: level=' + this.levelName + ' achievedScore=' + achievedScore + ' star=' + star + ' → 调用 _saveBestStar');
      this._saveBestStar(star);
    } else {
      console.log('[Star] 试玩模式，跳过星级落库 star=' + star);
    }

    // 兜底定时器：试玩与正式一致启动，保证胜利序列一定能触发
    var self = this;
    console.log('[LOG_victory] 启动6s超时兜底定时器');
    this._settlementTimer = setTimeout(function () {
      if (self._victory && !self._showVictoryPanel) {
        console.log('[LOG_victory] 超时兜底触发，强弹面板！');
        self._finishVictorySequence();
      }
    }, PlayDefine.PLAY.LOAD_TIMEOUT);

    // 注：hint 合并上传已在上方通关入口统一处理（正式+试玩），此处无需重复
  }

  /**
   * 场外求助协助关通关：仅播放「步数转积分」动画（与正式关同链路），
   * 但【不】落库 / 不同步云端 / 不发金币 / 不推进关卡索引；
   * 动画就绪后置 _showHelpEndPanel（替代 VictoryPopup 弹协助结束面板）。
   */
  _markClearedHelp() {
    console.log('[Help] _markClearedHelp 调用: 协助通关直接弹结算面板（需求②：不走步数转积分动画）');
    // 清理任何遗留的兜底/动画定时器，避免旧 attempt 的定时器在结算后误触发
    if (this._scoreBonusTimer) { clearTimeout(this._scoreBonusTimer); this._scoreBonusTimer = null; }
    if (this._settlementTimer) { clearTimeout(this._settlementTimer); this._settlementTimer = null; }
    // 直接置结算面板标志，由 _renderHelpOverlay 弹出统一结束面板（发给好友/再来一次/下次再说）
    this._helpEndReason = 'cleared';
    this._showHelpEndPanel = true;
  }

  /** 协助关：本次协助是否「一头猪都没额外跑出去」（额外 = 当前累计 − 残局基数） */
  _helpNoExtraEscaped() {
    var base = (typeof this._assistBaseEscaped === 'number') ? this._assistBaseEscaped : 0;
    return (this._escapedCount - base) <= 0;
  }

  /** 花朵/积分历史最高记录落库（仅正式模式；试玩不落库，多次通关保留最高） */
  _saveBestScore(score) {
    if (databus.returnState === 'editor' || (databus.playMode && databus.playMode !== 'normal')) return; // 试玩/外部求助不落库
    var self = this;
    try {
      var path = wx.env.USER_DATA_PATH + '/levels/' + this.levelName + '.json';
      var fs = wx.getFileSystemManager();
      var data = JSON.parse(fs.readFileSync(path, 'utf8'));
      var prev = (typeof data.bestScore === 'number') ? data.bestScore : 0;
      if (score > prev) {
        data.bestScore = score;
        fs.writeFileSync(path, JSON.stringify(data, null, 2), 'utf8');
        // 同步云端（保留历史最高，随关卡一并上传）
        cloud.uploadLevel(this.levelName, data, data.version || 0, null).then(function () {
          console.log('[BestScore] 云端上传成功: ' + self.levelName);
        }).catch(function (e) {
          console.warn('[BestScore] 云端上传失败:', e && e.message);
        });
        console.log('[BestScore] 新纪录: ' + score + ' (旧=' + prev + ') level=' + this.levelName);
      } else {
        console.log('[BestScore] 未破纪录: 本次=' + score + ' 历史=' + prev + ' level=' + this.levelName);
      }
    } catch (e) {
      console.warn('[BestScore] 保存失败:', e && e.message);
    }
  }

  /** 星级历史最高记录（仅正式模式；试玩不落库，多次通关保留最高） */
  _saveBestStar(star) {
    if (databus.returnState === 'editor' || (databus.playMode && databus.playMode !== 'normal')) return; // 试玩/外部求助不落库
    if (typeof star !== 'number' || star <= 0) return;
    var levelName = this.levelName;
    try {
      var map = wx.getStorageSync('levelStars');
      if (typeof map !== 'object' || map === null) map = {};
      var prev = (typeof map[levelName] === 'number') ? map[levelName] : 0;
      if (star > prev) {
        map[levelName] = star;
        wx.setStorageSync('levelStars', map);
        console.log('[Star] 新纪录: ' + star + ' 星 (旧=' + prev + ') level=' + levelName);
        console.log('[Star] 已落库 levelStars=' + JSON.stringify(map));
      } else {
        console.log('[Star] 未破纪录: 本次=' + star + ' 历史=' + prev + ' level=' + levelName);
      }
      // 同步云端（保留历史最高；服务端按关卡 key 取 max 合并）
      cloud.savePlayerData({ stars: map }).then(function () {
        console.log('[Star] 云端上传成功: ' + levelName);
      }).catch(function (e) {
        console.warn('[Star] 云端上传失败:', e && e.message);
      });
    } catch (e) {
      console.warn('[Star] 保存失败:', e && e.message);
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
        // 试玩模式：设标志让编辑器回来时设脏（不上传云端，避免版本冲突）
        if (isTrial) {
          databus._trialModifiedLevelName = this.levelName;
        } else {
          cloud.uploadLevel(this.levelName, data, data.version || 0, null).then(function() {
            console.log('[cloud][Hint] 云端上传成功: ' + self.levelName);
          }).catch(function(e) {
            console.warn('[cloud][Hint] 云端上传失败:', e && e.message);
          });
        }
      }
    } catch (e) {
      console.warn('[Hint] 合并提示数据失败:', e && e.message);
    }
  }

  /** 所有可逃脱的猪是否都已有 hintId */
  _syncToCloud() {
    // 试玩模式：结算不落库（金币/进度不写云端）
    if (databus.returnState === 'editor') return;
    // 场外求助协助/回放：绝不等同于玩家自己的进度，禁止写云端
    if (databus.playMode && databus.playMode !== 'normal') return;
    try {
      var lastLevelIndex = wx.getStorageSync('lastLevelIndex');
      var info = wx.getStorageSync('userinfo_cache') || {};
      cloud.savePlayerData({
        lastLevelIndex: lastLevelIndex,
        gold: GoldSystem.getGold(),
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

  /** 继续按钮 — 按胜利按钮三态(_victoryAction)分流：继续闯关→下一关 / 返回·恭喜通关→主菜单 / 试玩→编辑器 */
  _onContinueClick() {
    // 按胜利按钮三态判定结果分流（_victoryAction 由 _syncUIData 计算）
    var action = this._victoryAction || 'menu';
    // 「继续闯关」且非试玩 → 进入下一关
    if (action === 'next' && databus.returnState !== 'editor') {
      var curIdx = databus.currentLevelIndex;
      var levels = databus.projectLevels || [];
      var nextIdx = curIdx + 1;
      if (nextIdx >= 0 && nextIdx < levels.length) {
        var nextName = levels[nextIdx].name;
        databus.currentLevelIndex = nextIdx;
        databus.currentLevel = { name: nextName, data: null };
        databus.returnState = 'menu';
        this._skipRestore = true;  // 新关不恢复旧存档
        this.startLevel(nextName);
        return;
      }
    }
    // 「恭喜通关」/「返回」/ 试玩 → 主菜单（试玩回编辑器）
    // 返回菜单须置 _returningToMenu，屏蔽过场空窗（对称设置面板主页钮/关卡内返回）
    if (action === 'editor') {
      databus.gameState = 'editor';
    } else {
      databus._returningToMenu = true;
      databus.gameState = 'menu';
    }
  }

  /** 从广告领取后继续（消费体力已在 claimAd 调用前完成） */
  /** 双倍金币 — 本地再补一倍（基础金币已入账），播放翻滚动画 */
  _onDoubleGoldClick() {
    var isTrial = databus.returnState === 'editor';
    console.log('[LOG_gold] 双倍金币点击: _goldAmount=' + this._goldAmount + ' 当前余额=' + GoldSystem.getGold() + ' goldWidget._gold=' + (this._uiGoldWidget && this._uiGoldWidget._gold));
    if (!this._uiVictoryPopup._goldClaimed && this._goldAmount > 0) {
      var bonus = this._goldAmount;
      if (!isTrial) GoldSystem.addGold(bonus);  // 试玩仅展示、不落库
      console.log('[LOG_gold] 双倍金币入账: +' + bonus + ' 余额=' + GoldSystem.getGold() + ' goldWidget._gold=' + (this._uiGoldWidget && this._uiGoldWidget._gold));
      audio.play('rewards');
      // 双倍入账后同步到云端
      this._syncToCloud();
      this._uiVictoryPopup.markGoldClaimed();
    }
  }

  // 加载远程头像图片（通过 downloadFile 获取本地路径，兼容性更好）
  // ========== 通关动画编排 ==========

  /**
   * 结算入库 + 启动步数奖励动画：步数奖励 → 弹窗
   * 金币已在 _goldAmount 中计算好，此处立即入账。
   */
  _settleCoinsAndStartVictory() {
    var isTrial = databus.returnState === 'editor';
    console.log('[LOG_victory] 开始结算入库: goldAmount=' + this._goldAmount + ' scoreBonusRemaining=' + this._scoreBonusRemaining + ' isTrial=' + isTrial);
    // 立即入库（试玩仅展示、不落库）
    if (this._goldAmount > 0 && !isTrial) {
      GoldSystem.addGold(this._goldAmount);
      console.log('[LOG_victory] 金币入账: +' + this._goldAmount + ' 余额=' + GoldSystem.getGold());
    }
    this._goldSettled = true;
    this._levelAccumulatedGold = 0;  // 清零累积，防止旧计数值叠加显示
    // 强制同步 GoldWidget 到入账后的基础金币终值（步数不再转金币，无逐级上滚）
    if (this._uiGoldWidget) this._uiGoldWidget.forceSet(GoldSystem.getGold());
    // 清除兜底定时器（正常路径已完成结算）
    if (this._settlementTimer) { clearTimeout(this._settlementTimer); this._settlementTimer = null; }

    // 金币已入账 → 同步到云端
    this._syncToCloud();

    var self = this;
    // 步数转积分动画已交由「最后一只猪逃脱+500ms」定时器独立启动（见 _markCleared），
    // 此处不再启动；仅负责金币入账。若步数转积分动画仍在进行，等待其结束（update 会触发 _tryFinishVictory）。
    if (self._scoreBonusAnim && self._scoreBonusAnim.active) {
      return;
    }
    self._scoreBonusSettled = true;
    self._tryFinishVictory();
  }

  /**
   * 通关后：把剩余步数按时间平滑灌入分支进度（不再飞粒子）。
   * 树枝上常驻的小花朵，小虫爬到哪朵、哪朵就在原地旋转放大（小花变大花，单朵不分离）。
   * 灌入过程在 render 的积分块里按时间推进，结束即弹结算面板。
   */
  _spawnScoreParticles(n) {
    if (this._scoreBonusRemaining <= 0) {
      this._finishVictorySequence();
      return;
    }
    // 离散转化：每 interval ms 前进一步，每步触发一朵飞花。
    // 节奏预算：总时长 = 起手延迟 LEAD + n×interval + 末朵飞行最坏 TAIL，硬上限 2s。
    // n 较小时(≤5) interval 保持 200ms 原节奏；n 较大时自动压缩，确保 2s 内完成。
    var MAX_TOTAL = 2000;   // 硬上限 2 秒
    var LEAD = 150;         // 起手延迟（等金币飞完）
    var TAIL = 600;         // 末朵飞行预留（起点偏移 0~60 + 飞行 520~700 最坏 ~700，取 600 留缓冲）
    var budget = Math.max(1, MAX_TOTAL - LEAD - TAIL); // 可压缩给 n 步的窗口 ≈ 1250ms
    var interval = Math.min(200, budget / n);          // n≤6 → 200（保持原节奏）；n 大 → 自动压缩
    this._scoreBonusAnim = {
      active: true,
      lastAdvance: 0,           // 首次 tick 时设为 now（延迟 150ms 等金币飞完后再开始）
      interval: interval,       // 动态节奏
      total: n,                 // 总步数
      progress: 0,              // 已转化步数
      delayStart: Date.now() + LEAD,
    };
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
   * 步数→飞小花 与 积分灌入 都完成后，才弹出结算面板（避免面板遮住仍在飞的小花 / 爬的虫）。
   * 4 星特效的延后由 _finishVictorySequence 内部统一处理。
   */
  _tryFinishVictory() {
    if (this._stepFlowersSettled && this._scoreBonusSettled) {
      this._finishVictorySequence();
    }
  }

  /**
   * 通关动画播放完毕，显示结算面板。
   */
  _finishVictorySequence() {
    // 4 星（彩色星）特效若在树枝上仍未播完，结算面板遮罩会把它盖住 → 延后弹出，确保玩家看清「三星变彩星」
    if (this._uiBranchProgress && this._uiBranchProgress.isFourStarAnimating()) {
      var self = this;
      var remain = this._uiBranchProgress.getFourStarRemainMs();
      console.log('[LOG_victory] 4星特效播放中，延迟 ' + remain + 'ms 再弹面板');
      setTimeout(function () { self._finishVictorySequence(); }, remain + 80);
      return;
    }
    // 蜜蜂已跨 4★ 门槛、但尚未「爬到 4★ 花位置」→ 也需延后：否则面板会盖住蜜蜂奔向 4★ 花 + 甩魔法的过程。
    if (this._uiBranchProgress && this._uiBranchProgress.isFourStarPending()) {
      var self2 = this;
      console.log('[LOG_victory] 蜜蜂尚未抵达4★位置，延迟 120ms 再检查');
      setTimeout(function () { self2._finishVictorySequence(); }, 120);
      return;
    }
    if (databus.playMode === 'assist') {
      // 协助关：不弹 VictoryPopup，改弹协助结束面板（文字 + 发送给好友 / 再来一次）
      console.log('[LOG_victory][Help] ★ 协助结束面板弹出！_showHelpEndPanel=true');
      this._showHelpEndPanel = true;
      this._victoryAnimStart = Date.now();
      audio.play('victory');
      return;
    }
    console.log('[LOG_victory] ★ 结算面板弹出！_showVictoryPanel=true, goldAmount=' + this._goldAmount + ' balance=' + GoldSystem.getGold());
    this._showVictoryPanel = true;
    this._victoryAnimStart = Date.now();
    this._victoryAnimator.open();
    audio.play('victory');
  }

  /** 画顶部不可用区域边界曲线（绿线，与主菜单一致），关卡内用于核对猪面板/步数牌是否避让到位 */
  _drawSafeAreaLine(ctx) {
    // 调试虚线框（绿线=可用区边界 / 橙虚线=微信胶囊区）：默认隐藏。
    // 真机核对安全区/胶囊遮挡时，在控制台执行 GameGlobal.DEBUG_SAFE_AREA = true 后重开页面即可恢复。
    if (!GameGlobal.DEBUG_SAFE_AREA) return;
    var safe = this._safeL;
    if (!safe) return;
    var sw = SCREEN_WIDTH, step = 6;
    ctx.save();
    ctx.beginPath();
    for (var x = 0; x <= sw; x += step) {
      var y = safe.safeLineY(x);
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(122, 196, 80, 0.7)';
    ctx.stroke();

    // 微信胶囊区（橙虚线）
    var obs = safe.getObstructions ? safe.getObstructions() : [];
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = 'rgba(255, 149, 0, 0.85)';
    for (var oi = 0; oi < obs.length; oi++) {
      var ob = obs[oi];
      if (ob.type === 'rect') ctx.strokeRect(ob.x, ob.y, ob.w, ob.h);
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  /** 绘制关卡场景背景图（全屏拉伸适配，所有图片内容可见、不裁剪） */
  drawSceneBackground(alpha) {
    if (!this._sceneBgLoaded) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(this._sceneBgImg, 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    ctx.restore();
  }

  /**
   * 绘制带按压/呼吸缩放的圆钮（关卡内 +5 / 提 复用）。
   * 围绕按钮中心应用 _btnPress.getScale(key)，与顶部 hint/设置按钮反馈一致。
   */
  _drawPressRoundButton(ctx, key, x, y, size, label, shadow) {
    var s = this._btnPress.getScale(key);
    var cx = x + size / 2;
    var cy = y + size / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(s, s);
    ctx.translate(-cx, -cy);
    drawBottomBar.drawRoundMenuButton(ctx, x, y, size, label, shadow);
    ctx.restore();
  }

  // 进入关卡过场：目标 UI 微淡入 alpha（0→1，150ms）；非过场时返回 1（无影响）
  _getRevealAlpha() {
    if (!this._revealStart) return 1;
    var t = (Date.now() - this._revealStart) / 150;
    return t >= 1 ? 1 : Math.max(0, t);
  }

  // ========== 渲染（Ardot 设计稿驱动，fileId: 694583967818218）==========
  render() {
    // 引导系统帧更新（所有状态下的引擎均需轮询）
    var now = Date.now();
    var dt = this._lastFrameTime ? (now - this._lastFrameTime) / 1000 : 0;
    this._lastFrameTime = now;
    if (dt > 0 && dt < 1) this._guide.onFrame(dt); // dt > 1s 视为异常（如切后台），跳过
    this._trySettleHelp();   // 协助关：等最后一只逃逸猪动画播完再落定结算面板

    // 兜底：若 UI 层尚未初始化（_setupUI 可能因异常未执行），静默跳过
    if (!this._uiTopBar) return;

    // ===== 场景背景图（覆盖 GameEngine 的菜单背景）=====
    this.drawSceneBackground(1);

    // 顶部安全线 + 胶囊区（真机调试用）
    this._drawSafeAreaLine(ctx);

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

    // 加载中：不显示任何 UI（设置/提示等），仅显示加载提示
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

    // 场外求助（协助/回放）准备倒计时期间：棋盘/猪/装饰/HUD/角落头像全部不出现，
    // 仅由 _renderHelpOverlay 绘制倒计时圈 + 文案（loading 结束前棋盘不可见）。倒计时结束（标志翻转）后下一帧正常渲染。
    if ((databus.playMode === 'assist' && this._assistCounting) ||
        (databus.playMode === 'replay' && this._replayCounting)) {
      this._renderHelpOverlay(ctx);
      return;
    }

    // 场景首次出现整体渐显（0→1）：每次进关 _sceneFadeStart 复位为 0，故仅在该关棋盘首次渲染的第一帧触发一次。
    // 置于倒计时闸门之后，确保协助/回放关在 5 秒倒计时结束、棋盘真正出现时才开始淡入。
    if (this._sceneFadeStart === 0) this._sceneFadeStart = now;
    var _sceneFadeAlpha = Math.min(1, (now - this._sceneFadeStart) / this._sceneFadeDur);

    // 进入关卡过场：目标 UI（棋盘/猪/顶栏等）统一 150ms 微淡入；非过场时 alpha=1 无影响
    var _revealAlpha = this._getRevealAlpha();
    ctx.save();
    ctx.globalAlpha = _revealAlpha * _sceneFadeAlpha;

    // 需求⑤：协助关进入结算态（提前结束 _helpEnded / 通关 _showHelpEndPanel）时，清干净棋盘与猪
    var assistSettled = databus.playMode === 'assist' && (this._helpEnded || this._showHelpEndPanel);
    if (assistSettled) {
      this.gp.fadeAlpha = 0;
    }

    // 1. 棋盘主体 — 每帧重算偏移，确保与配置值同步
    this.gp.topBarH = safeTop + BD_TOP;
    this.gp.bottomStripH = BD_BOTTOM;
    var availH = SCREEN_HEIGHT - this.gp.topBarH - this.gp.bottomStripH;
    var visualH = (this.gp.rows - 1) * this.gp.vSpacing + this.gp.scaledDiameter;
    this.gp.boardOffsetY = Math.max(0, Math.floor((availH - visualH) / 2));
    if (!assistSettled) {
      this.gp.renderBoard(ctx, {
        hintPigId: this._hint.getTargetId(),
        guidePigId: this._guide.getActiveGuidePigId(),
        entrancePigAlpha: pigAlpha,
      });
    }

    // 背景物件（image 718）：固定屏幕位置，绘制于棋盘之上（确保不被棋盘/孔位遮挡）
    // 新图尺寸 279×44、top:78（原 279×85、top:61，已去上下留白并下移），绘制矩形同步更新
    var branchDY = this._branchDeltaY || 0;
    if (databus.playMode === 'normal' && AssetPreloader.isReady('bg_deco_718')) {
      ctx.drawImage(AssetPreloader.get('bg_deco_718'), 10, 78 + branchDY, 279, 44);
    }

    // 树枝进度条「底层」（绿色已走过揭示 + 调试曲线）：绘制于草丛之下
    // 绿色进度条是树枝皮肤的一部分，本应被前景草丛(树叶)压住
    if (this._uiBranchProgress) this._uiBranchProgress.renderBranchLayer(ctx);

    // 草丛装饰（Figma 草丛节点）：替换原 Vector 6/7/8 三层纯色装饰
    // 草丛装饰树叶，盖住已走过的绿色树枝；随 deltaY 下移
    if (databus.playMode === 'normal' && AssetPreloader.isReady('level_brush')) {
      ctx.drawImage(AssetPreloader.get('level_brush'), 0, 39 + branchDY, 69.32, 121.07);
    }

    // 树枝进度条「上层」（小虫 + 花朵 + 粒子 + 施法高光）：绘制于草丛之上
    // 小虫与星级花是爬在树枝上的主体，必须压在前景草丛之上，避免被树叶遮挡
    if (this._uiBranchProgress) this._uiBranchProgress.renderUILayer(ctx);

    // 剩余未逃脱猪数量组件（可复用 drawPigCounter，父 frame 宽 55）
    // pigSafeTop: start() 内缓存的安全线 y，面板顶贴线下方 6px（避让刘海/摄像头/胶囊，动态适配不同机型）
    // 兜底：无法取到安全线时回退到旧硬编码等效值（面板顶≈22px）
    var pigSafeTop = (typeof this._pigSafeTop === 'number' && isFinite(this._pigSafeTop)) ? this._pigSafeTop : 22;
    if (this.gp && this.gp.pigs && !assistSettled) {
      var pigFrameX = Math.round((SCREEN_WIDTH - 55) / 2) - 9; // 55=frame宽，-9=内容视觉居中补偿
      drawPigCounter(ctx, pigFrameX, pigSafeTop, { iconKey: 'pig_icon', value: this.gp.pigs.length });
    }

    // 通关后孔洞渐隐（1s 内 alpha 1→0）
    if (this._victory && !assistSettled) {
      var elapsed = Date.now() - this._victoryTime;
      this.gp.fadeAlpha = Math.max(0, 1 - elapsed / 1000);
    }

    // ---- UI 渲染（受入场动画控制）----
    if (!entranceActive) {
      // 动画结束：正常渲染所有 UI
      // 3. 顶栏（UIManager）—— 场外求助协助/回放隐藏（关卡名 + 设置按钮）
      if (databus.playMode === 'normal') {
        this._uiTopBar.render(ctx);
      }
      // 3.5. 右上角剩余步数组件（还原旧版 CrownPigWidget 步数显示）—— 协助/回放保留
      if (this._uiRightStep && !assistSettled) this._uiRightStep.render(ctx);
      // 4.5. 金币余额 —— 场外求助协助/回放隐藏（需求 A：不展示金币数）
      if (databus.playMode === 'normal' && this._uiGoldWidget) {
        this._uiGoldWidget.render(ctx);
      }
      // 5.0. 步数→飞小花「独立最高层」：绘制于步数牌/顶栏/金币之上，
      //       确保飞花从右上角步数牌中心飞出时盖过步数牌（PlayingEngine.render 为手写按行序绘制，
      //       UIManager 的 zIndex 不生效，故飞花需单独后画）。仍在结算面板之下（动画结束后面板才弹出）。
      if (this._uiBranchProgress) this._uiBranchProgress.renderStepFlowersLayer(ctx);
      // 5. 底部栏（UIManager）
      // 5.2 关卡内底栏：level_buttom 背景 + 双圆按钮（赛+3 / !提示）
      // 底栏图片始终绘制（失败时由失败面板覆盖）；交互按钮在失败/通关后隐藏
      if (databus.playMode === 'normal') {
        drawBottomBar.drawLevelBottomBar(ctx);
      }
      if (!this._failed && !this._victory && databus.playMode === 'normal') {
        // 底部道具按钮（新 ItemButton 组件）— 协助/回放场景隐藏常规底栏道具
        var plus5PS = this._btnPress.getScale('plus5');
        var hintPS = this._btnPress.getScale('bottomHint');
        // +3 步道具告警小跳：最后5步且道具仍有剩余次数时触发；纯实时判断，与失败/通关隐藏逻辑互斥
        var addStepAlert = !!(this._uiRightStep && this._uiRightStep.isAlerting() && this._addStepRemaining > 0);
        if (this._uiAddStepBtn) this._uiAddStepBtn.render(ctx, plus5PS, addStepAlert);
        if (this._hasHintData && this._uiHintBtn) this._uiHintBtn.render(ctx, hintPS);
        if (this._uiHelpBtn) this._uiHelpBtn.render(ctx, this._btnPress.getScale('help'));
      }
    } else if (es.phase === 'ui') {
      // UI 飞入动画（500ms，ease-out cubic）
      var uiT = Math.min(1, (eElapsed - es.uiStart) / es.uiDur);
      var ease = _easeOutCubic(uiT);
      // 上方控件：从 y=-200 落到 y=0（同时）。协助/回放隐藏 TopBar + 金币（与 done 段一致）
      var topItems = [
        { comp: this._uiTopBar,    cond: databus.playMode === 'normal' },
        { comp: this._uiGoldWidget, cond: databus.playMode === 'normal' && this._uiGoldWidget },
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
      var selfPE = this;
      var bottomItems = [
        // 关卡内底栏背景 + 双圆按钮（+3/!）一并滑入，与主菜单底栏动效语言统一
        // 绘制逻辑与 done 段（5.2）完全一致，仅多出「从下方 +200 滑入」的位移包
        { comp: {
            render: function(c) {
              if (databus.playMode === 'normal') {
                drawBottomBar.drawLevelBottomBar(c);
              }
              if (!selfPE._failed && !selfPE._victory && databus.playMode === 'normal') {
                var p5ps = selfPE._btnPress.getScale('plus5');
                var hps = selfPE._btnPress.getScale('bottomHint');
                if (selfPE._uiAddStepBtn) selfPE._uiAddStepBtn.render(c, p5ps);
                if (selfPE._hasHintData && selfPE._uiHintBtn) selfPE._uiHintBtn.render(c, hps);
                if (selfPE._uiHelpBtn) selfPE._uiHelpBtn.render(c, selfPE._btnPress.getScale('help'));
              }
            }
          }, cond: true },
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
    // 自包含绘制：显式定死文字对齐，避免继承前面 widget 泄漏的 textAlign/textBaseline（否则文字会随入场动画结束从居中跳到右对齐）
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '16px sans-serif';
    var testBx = 10, testBy = 120, testBw = 30, testBh = 30;
    // "框" 按钮（棋盘可用区域）
    var boundBx = testBx, boundBy = testBy;
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
    ctx.restore();
    } else {
      this._testBoundBtn = null;
      this._testAutoBtn = null;
    }

    // 棋盘可用区域调试框
    if (this._showBoardBounds) {
      this._drawBoardBounds(ctx);
    }

    // 6. 通关弹窗（UIManager）
    if (this._victory && this._showVictoryPanel) {
      this._uiVictoryPopup.render(ctx);
    }

    // 6a. 场外求助：协助/回放专属覆盖层（协助通关的「发送给好友」/ 回放的「再看一次」+「返回」）
    if (databus.playMode !== 'normal') {
      this._renderHelpOverlay(ctx);
    }

    // 6b. 失败弹窗（步数用尽）
    if (this._failed) {
      this._uiFailPopup.render(ctx);
    }

    // 7. 设置面板（保持原有）
    settingsPanel.render(ctx);
    StaminaAdPanel.render(ctx);  

    // 9. 金币磁吸飞行动画（推猪时触发，飞向金币区）—— 最高层级，不被任何 UI 遮挡
    var coinArrived = this._coinFlyEffect.update();
    this._coinFlyEffect.render(ctx);
    // 9a. +3道具图标飞向剩余步数面板（与金币飞行同层），到达后触发面板被击中抖动
    var itemArrived = this._itemFlyEffect.update();
    this._itemFlyEffect.render(ctx);
    if (itemArrived > 0 && this._uiRightStep) {
      // 图标到达：释放对应的视觉 +3（每枚图标代表 +3 步），显示数字开始滚上去（与强档抖动同步）
      this._bonusStepsPending = Math.max(0, this._bonusStepsPending - itemArrived * 3);
      this._uiRightStep.triggerHitShake(true);   // +3 道具到达：强档受击（振幅/频率更大）
    }
    // 树枝进度条缓动更新（位置爬动 / 溢出旋转）
    if (this._uiBranchProgress) this._uiBranchProgress.update();
    // 步数→飞小花 播放完毕检测：小花飞完后放行结算面板（与积分灌入共同决定弹窗时机）
    if (this._uiBranchProgress && !this._stepFlowersSettled && !this._uiBranchProgress.isStepFlowersAnimating()) {
      this._stepFlowersSettled = true;
      this._tryFinishVictory();
    }
    // 金币到达 → 播放音效 + 触发 GoldWidget 呼吸 + "+1" 浮字
    // 仅在未结算（推猪进行中）时累加计数；结算后不再有金币飞行，此处不触发（步数不再转金币）
      if (coinArrived > 0 && this._uiGoldWidget && !this._goldSettled) {
        audio.play('coin_get');
        for (var ca = 0; ca < coinArrived; ca++) {
          this._levelAccumulatedGold++;
          // 正常推猪：金币落地即 +1，由落地回调驱动数字上滚
          this._uiGoldWidget.setData(GoldSystem.getGold() + this._levelAccumulatedGold);
          this._uiGoldWidget.addFloatText();
          this._uiGoldWidget.triggerHit();   // 金币砸中：金币控件受击挤压回弹 + 冲击环
        }
      }
    // 磁吸光晕：飞行中金币越靠近目标光晕越强
    if (this._uiGoldWidget) {
      this._uiGoldWidget.setMagnetGlow(this._coinFlyEffect.getNearestProgress());
    }

    // 9b. 积分进度灌入（剩余步数 → 按时间平滑灌入分支）：小虫爬到花即原地旋转变大
    // 不再飞粒子；树枝上常驻的小花 → 大花(原地绽放) 为同一朵，杜绝「一小一大叠在两处」。
    // 剩余步数数字同步递减由 _syncUIData 读取 _scoreBonusProgress 驱动。
    if (this._scoreBonusAnim && this._scoreBonusAnim.active) {
      var sa = this._scoreBonusAnim;
      var saNow = Date.now();
      if (saNow >= sa.delayStart) {
        // 首次 tick 初始化计时起点
        if (!sa.lastAdvance) sa.lastAdvance = saNow;
        // 每 interval ms 前进一步
        while (saNow - sa.lastAdvance >= sa.interval && sa.progress < sa.total) {
          sa.progress++;
          sa.lastAdvance += sa.interval;
          this._scoreBonusProgress = sa.progress;
          // 每步触发一朵飞花 → 飞向 4 星花；起点取「剩余步数」数字中心（RightStepWidget.getStepNumberPos）
          if (this._uiBranchProgress) {
            var sp = (this._uiRightStep && this._uiRightStep.getStepNumberPos)
              ? this._uiRightStep.getStepNumberPos()
              : { x: SCREEN_WIDTH - 47, y: 109 };
            this._uiBranchProgress.spawnStepFlowers(1, sp.x, sp.y);
            this._uiBranchProgress.setScore(
              this._escapedCount + this._scoreBonusProgress,
              this._totalScore
            );
          }
        }
        // 全部转化完毕
        if (sa.progress >= sa.total) {
          this._scoreBonusAnim.active = false;
          if (!this._scoreBonusSettled) {
            this._scoreBonusSettled = true;
            this._tryFinishVictory();
          }
        }
      }
    }

    // 结算触发：通关后所有金币到齐（或超时兜底）—— 仅普通关；协助/回放跳过（不落库、不同步云端）
    if (this._victory && !this._settlementTriggered && databus.playMode === 'normal') {
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

    ctx.restore();   // 配对 render 顶部 reveal save（非过场时 alpha=1，无副作用）
  }

  /** 录制/提示状态指示器入口：协助关额外画左上好友信息；录制/提示统一画在左下角（所有模式通用） */
  _renderStatusIndicators() {
    // 设置面板打开时不显示（避免遮挡）
    if (settingsPanel.isOpen()) return;
    // 协助/回放关：左上角显示「第X关」+ 头像/昵称/状态（回放中·请求协助），与左下角录制/提示分离
    if (databus.playMode === 'assist' || databus.playMode === 'replay') {
      this._renderAssistStatusIndicators();
    }
    // 录制/提示指示器：所有模式统一显示在左下角（left 5, bottom 5），无 hint 时 rec 靠左
    this._renderHintRecIndicators();
  }

  /** 录制/提示状态指示器（左下角：left 5, bottom 5，水平排列，所有模式通用） */
  _renderHintRecIndicators() {
    var showRec = this._isRecording;
    var showHint = !this._hintMerged;
    if (!showRec && !showHint) return;

    var marginL = 5;       // left 5
    var marginB = 5;       // bottom 5
    var itemH = 14;
    var iconR = 4;
    var gap = 10;
    var cy = SCREEN_HEIGHT - marginB - itemH / 2;   // 水平中线贴底（bottom 5 起算）

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 11px ' + Theme.font.family;

    var cursorX = marginL;

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

  /** 协助/回放关左上角状态：行1「第X关」+ 状态(回放中/请求协助)；行2 = 头像 + 昵称(≤4字) */
  _renderAssistStatusIndicators() {
    // 左侧内容：用 safeArea.top（与正常模式 TopBar 左侧设置钮基线一致），
    // 不要 databus.safeTop（其值 = 胶囊底+8，仅供全宽游戏区顶部避让右上胶囊，会让左侧 UI 下塌 ~40px）。
    var safeT = (this._safeL ? this._safeL.safeTop : (databus.safeTop || 0)) || 0;
    var x = 14;                  // 紧贴左上角（常规机型左侧无刘海，14px 安全避让）
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    // 行1：第X关（顶到可用区左上角）
    var lvlName = (databus.currentLevel && databus.currentLevel.name) ? databus.currentLevel.name : '';
    var lvlNum = parseInt(lvlName, 10);
    if (isNaN(lvlNum)) lvlNum = 1;
    var levelText = '第' + lvlNum + '关';
    ctx.font = 'bold 15px ' + Theme.font.family;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.fillStyle = '#FFFFFF';
    var line1Y = safeT + 12;
    ctx.strokeText(levelText, x, line1Y);
    ctx.fillText(levelText, x, line1Y);

    // 状态紧跟「第X关」之后（回放中 / 请求协助）
    var status = (databus.playMode === 'replay') ? '回放中' : '请求协助';
    var statusColor = (databus.playMode === 'replay') ? '#7ED0FF' : '#FFD166';
    var statusX = x + ctx.measureText(levelText).width + 8;
    ctx.strokeText(status, statusX, line1Y);
    ctx.fillStyle = statusColor;
    ctx.fillText(status, statusX, line1Y);

    // 行2：头像 + 昵称
    var avatarSize = 26;
    var rowY = line1Y + 24;            // 行1 下方换行
    var avatarX = x;
    var avatarY = rowY - avatarSize / 2;
    var req = databus._helpRequester;

    // 头像（圆形裁剪；未加载完 / 无头像画占位灰圆）
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    if (req && req.avatarUrl) {
      if (!this._helpRequesterImg) {
        var img = wx.createImage();
        img.onload = function () {};
        img.src = req.avatarUrl;
        this._helpRequesterImg = img;
      }
      var imgObj = this._helpRequesterImg;
      if (imgObj && imgObj.width) {
        ctx.drawImage(imgObj, avatarX, avatarY, avatarSize, avatarSize);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize);
      }
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize);
    }
    ctx.restore();

    // 昵称（最多 4 字，超出补 ...），绘制在头像右侧
    var nickname = (req && req.nickName) ? req.nickName : '好友';
    if (nickname.length > 4) nickname = nickname.slice(0, 4) + '...';
    ctx.font = '14px ' + Theme.font.family;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.fillStyle = '#FFFFFF';
    var nameX = avatarX + avatarSize + 6;
    ctx.strokeText(nickname, nameX, rowY);
    ctx.fillText(nickname, nameX, rowY);

    ctx.restore();
  }

  // ============================================================
  // 断点续玩（Checkpoint Resume）
  // ============================================================

  /** 构造断点续玩的「权威状态镜像」——任何变化都整份写出，无需脏检测 */
  _buildCheckpoint() {
    return {
      levelName: this.levelName,
      levelIndex: databus.currentLevelIndex,
      steps: this.steps,
      bonusSteps: this._bonusSteps,   // +3步道具累计加成（影响剩余步数 HUD，续玩需接回）
      version: this._levelVersion,
      // 棋盘：每头猪的 id + 位置/朝向（恢复时据此重建占用并剔除已逃出猪）
      pigs: this.gp.pigs.map(function(p) {
        return { id: p.id, tailIndex: p.tailIndex, length: p.length, angle: p.angle };
      }),
      // hint 录制状态：已逃猪提示缓存 + 试玩实时编号计数器 + 是否已合并（续玩原样接回）
      hintCache: this._gameplayHintCache.map(function(h) { return { pigId: h.pigId, angle: h.angle }; }),
      trialHintNextId: this._trialHintNextId,
      hintMerged: this._hintMerged,
      // 道具使用次数：+3步剩余、提示剩余（续玩原样镜像杀进程前状态）
      addStepRemaining: this._addStepRemaining,
      hintRemaining: this._hintRemaining,
      helpRemaining: this._helpRemaining,
      savedAt: Date.now()
    };
  }

  /** 保存当前关卡状态到本地持久化存储（实时调用：状态一变化即写整份镜像） */
  _saveCheckpoint() {
    // 场外求助协助/回放：绝不写玩家自己的断点存档
    if (databus.playMode && databus.playMode !== 'normal') return;
    // 仅最新未通关关卡才写盘
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
    try {
      wx.setStorageSync('game_checkpoint', this._buildCheckpoint());
      console.log('[LOG] ✓ 存档成功: ' + this.levelName + ' | step=' + this.steps + ' | pigs=' + this.gp.pigs.length + ' | v=' + this._levelVersion);
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

  /** 断点续传单函数：恢复 / 清理（不再依赖定时器） */
  _updateCheckpoint() {
    // 场外求助协助/回放：不恢复、不写盘玩家自己的断点存档
    if (databus.playMode && databus.playMode !== 'normal') return;
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
        showToast('已恢复上次游玩进度', 2000);
      } else {
        console.log('[LOG_cp] ✗ 清空存档: skipRestore=' + skipRestore + ' cpLevel=' + cp.levelName + ' curLevel=' + this.levelName + ' cpVer=' + cp.version + ' curVer=' + this._levelVersion);
        wx.removeStorageSync('game_checkpoint');
      }
    } else {
      console.log('[LOG_cp] 无存档，开始记录: level=' + this.levelName + ' v=' + this._levelVersion);
    }

    // 存档改为「状态变化时实时整份写出」，不再依赖定时器
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

    // 恢复道具使用次数：+3步剩余、提示剩余，原样镜像杀进程前状态（保证「已用过几次」续玩后一致）。
    // 存档缺失字段时兜底为 loadLevel 初值（2 / 1），与新鲜正式关行为一致。
    this._addStepRemaining = (cp.addStepRemaining != null) ? cp.addStepRemaining : this._addStepRemaining;
    this._hintRemaining = (cp.hintRemaining != null) ? cp.hintRemaining : this._hintRemaining;
    this._helpRemaining = (cp.helpRemaining != null) ? cp.helpRemaining : this._helpRemaining;
    // +3 道具实际加成步数：续玩接回，保证「剩余步数 HUD」与杀进程前一致（否则 +3 后用掉的次数恢复了，但加的步数丢了，HUD 错位）
    this._bonusSteps = (cp.bonusSteps != null) ? cp.bonusSteps : this._bonusSteps;

    // 恢复本关累积金币：断点续玩时，已逃出猪捡到的金币必须计入显示。
    // 该值不需要持久化——由存档「缺失的猪」推得：removedCount 即已逃出猪数，每头 +1 金币，
    // 与 _saveCheckpoint 恢复的棋盘状态严格一致（不会出现金币/棋盘不匹配）。
    this._levelAccumulatedGold = removedCount;
    console.log('[LOG_cp] _doResume 恢复累积金币(由 removedCount 计算)=' + this._levelAccumulatedGold + ' removedCount=' + removedCount);

    // 断点续玩且棋盘不完整：接上 hint 录制状态，回来继续录（不再丢弃）
    if (removedCount > 0) {
      this._escapedCount = removedCount;  // 标记棋盘不完整，_allPigsOnBoard() 返回 false
      // 恢复断点前已录的提示缓存 + 试玩实时编号计数器，使续玩后继续收集、通关时一并写入
      this._gameplayHintCache = (cp.hintCache && cp.hintCache.length)
        ? cp.hintCache.map(function(h) { return { pigId: h.pigId, angle: h.angle }; })
        : [];
      this._trialHintNextId = (cp.trialHintNextId != null)
        ? cp.trialHintNextId
        : this._trialHintNextId;   // 旧存档无此字段时兜底（保持 loadLevel 初值）
      // 从存档原样恢复「是否还在收集 hint」状态（hintMerged: false=收集中 / true=已合并不再收），
      // 使续玩行为精确镜像杀进程前的录制状态，与新鲜正式关严格一致；
      // 存档缺失字段时兜底为 false（继续收）。注：通关会先 _hintMerged=true 再 _mergeAndUploadHints，
      // 而 _saveCheckpoint 在逃猪时(合并前)即写盘，故任何有效存档里 hintMerged 必为 false。
      this._hintMerged = (cp.hintMerged != null) ? cp.hintMerged : false;
      console.log('[RecHint] 断点续玩: 棋盘不完整(removed=' + removedCount + ') → 接上提示录制(hintCache=' + this._gameplayHintCache.length + ', nextId=' + this._trialHintNextId + ')');
    } else {
      console.log('[RecHint] 断点续玩: 棋盘完整(removed=0) → 正常启动录制+提示收集');
    }

    // 恢复小虫进度 + 已获得花朵：直接计算结果静态展示（不跑动画）。
    // 小虫停在「已逃出猪数 / 总积分」处；对应档位的花朵静态常驻（中途恢复不会到 4 星，故不触发施法特效）。
    if (this._uiBranchProgress) {
      this._uiBranchProgress.showResultImmediate(this._escapedCount, this._totalScore);
    }

    // 恢复完成后不立即清理存档；下次进关若关卡/版本不匹配会由 _updateCheckpoint 清掉
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
