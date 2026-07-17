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
const VictoryPopup = require('../ui/widgets/VictoryPopup.js');
const FailPopup = require('../ui/widgets/FailPopup.js');
const RightStepWidget = require('../ui/widgets/RightStepWidget.js');
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
const AssetPreloader = require('../ui/AssetPreloader.js');
const drawBottomBar = require('../ui/drawBottomBar.js');
const { drawPigCounter } = require('../ui/drawPigCounter.js');
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
    this._scoreBonusRemaining = 0;    // 通关后剩余步数转化的积分
    this._scoreBonusProgress = 0;     // 已灌入的积分
    this._scoreBonusSettled = false;  // 积分粒子结算完毕（防重入 _finishVictorySequence）
    this._stepFlowersSettled = true;   // 步数→飞小花完毕（与积分灌入共同决定结算面板弹出）；默认 true，仅飞小花时置 false
    this._showBoardBounds = false;    // 调试框：棋盘可用区域
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
    this._isRecording = false;
    this._recordingStart = 0;
    this._recordEntries = [];
    this._isPlayingBack = false;
    if (this._playbackTimer) { clearTimeout(this._playbackTimer); this._playbackTimer = null; }
    // 正式玩：通关后保存 hint 数据缓存
    this._gameplayHintCache = [];
    this._hintMerged = false;
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
                { iconKey: 'btn_home', action: function() { audio.play('button_click'); settingsPanel.close(); databus.gameState = databus.returnState === 'editor' ? 'editor' : 'menu'; } },
                { iconKey: 'btn_continue', action: function() { audio.play('button_click'); settingsPanel.close(); } },
                { iconKey: 'btn_again', action: function() { audio.play('button_click'); settingsPanel.close(); self.restartLevel(); } },
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
      this._uiRightStep = new RightStepWidget({ zIndex: UIManager.LAYER.INFO });
      this.ui.add(this._uiRightStep, UIManager.LAYER.INFO);

      // Layer OVERLAY — 树枝进度条（小虫沿树枝爬动表示进度）；层级高于 INFO/CONTROL，
      // 使「步数→积分」飞花能盖过右上角步数牌（飞花是 BranchProgressWidget 内部绘制内容，
      // 无法单独提层，故整体提升到非模态最高层 OVERLAY，仍低于结算面板 MODAL）。
      this._uiBranchProgress = new BranchProgressWidget({ x: 10, y: 78, zIndex: UIManager.LAYER.OVERLAY });
      this.ui.add(this._uiBranchProgress, UIManager.LAYER.OVERLAY);

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

      // Layer 4 — FailPopup（步数用尽时弹出）
      this._uiFailPopup = new FailPopup({
        zIndex: UIManager.LAYER.MODAL,
        onReplay: function () { self.restartLevel(); },
        onExit: function () { databus.gameState = databus.returnState === 'editor' ? 'editor' : 'menu'; },
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

    // TopBar 位置 + 内容（屏幕坐标系，y=0）
    this._uiTopBar.setBounds(0, 0, this._boardCardW, Theme.layout.topBarH);
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
    if (this._uiGoldWidget) this._uiGoldWidget.setData(goldDisplay);

    // 右上角剩余步数组件（还原旧版 CrownPigWidget 的步数显示）
    // 结算面板弹出或失败时隐藏；由面板自身及常规层管理可见性，不做特殊浮层处理。
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

    // VictoryPopup
    this._uiVictoryPopup.setData({
      steps: this.steps,
      returnState: databus.returnState || 'menu',
      goldAmount: this._goldAmount,
      showGold: this._goldAmount > 0,
    });
    this._uiVictoryPopup.visible = this._victory && this._showVictoryPanel;

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
      return;
    }
    // 入场动画状态必须在 loadLevel 之前设置，确保首帧渲染时 es 已存在
    this._entranceState = {
      startTime: Date.now() + 50,    // 进入关卡后延后 50ms 再启动入场（与菜单出场后的停留呼应）
      phase: 'board',        // board → pigs → ui → done
      pigFadeDelay: PlayDefine.PLAY.ENTRANCE.PIG_FADE_DELAY,     // 300ms 后开始猪渐显
      pigFadeDur: PlayDefine.PLAY.ENTRANCE.PIG_FADE_DUR,       // 猪渐显 500ms (ease-out)
      uiStart: PlayDefine.PLAY.ENTRANCE.UI_START,           // 800ms 后开始 UI 飞入
      uiDur: PlayDefine.PLAY.ENTRANCE.UI_DUR,             // UI 飞入 500ms (ease-out cubic)
      totalDuration: PlayDefine.PLAY.ENTRANCE.TOTAL,     // 总时长 1300ms（注意定义键名是 TOTAL 非 TOTAL_DURATION）
    };
    this.loadLevel(data);
    this._loading = false;
    // 断点续传 + 录制 + 预下载（与菜单 prepareLevel 路径共用，避免菜单进关漏掉续玩）
    this._afterEnterLevel();
  }

  /** 进关后续统一逻辑：断点续玩恢复 + 录制启动 + 预下载。
   *  所有「加载完关卡」的入口（startLevel 的 _loadAndStart / 菜单 prepareLevel）都应调用，
   *  否则菜单进关会漏掉 game_checkpoint 续玩恢复与录制启动（交叉淡变重构期间暴露）。 */
  _afterEnterLevel() {
    // 断点续传（单函数收敛：恢复/清理）
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

  /** 棋盘猪是否全部在棋盘上（是否有猪逃逸过） */
  _allPigsOnBoard() {
    return this._escapedCount === 0;
  }

  // ===== 录制回放（游戏动作） =====

  _trialStartRecord() {
    if (!this._allPigsOnBoard()) {
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
    wx.setStorageSync(key, JSON.stringify(this._recordEntries));
    console.log('[TrialRec] 录制结束，保存 ' + this._recordEntries.length + ' 条操作 → ' + key);
  }

  _trialStartPlayback() {
    if (this._isPlayingBack) return;
    if (!this._allPigsOnBoard()) {
      showToast('请先重置关卡', 1500);
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
      showToast('回放完成', 1500);
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

  activate() {
    // 菜单→关卡路径：prepareLevel 已在出场期间完成加载（_levelReady=true），这里只绑定输入、跳过重复加载。
    // 其它直接进关路径（冷启动 / 编辑器试玩）：_levelReady 仍为 false → 走 startLevel 兜底。
    var self = this;
    if (this._levelReady) {
      this.input.on('playing', function (e) { self.handleEvent(e); });
    } else {
      var name = databus.currentLevel ? databus.currentLevel.name : '';
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

    // 试玩模式：直接用编辑器关卡数据
    if (databus.returnState === 'editor' && databus.currentLevel && databus.currentLevel.data) {
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

  /** 关卡入场动画计时起点（交叉淡变结束、切场景那一刻调用）。不再 +500ms —— 交叉淡变已提供呼吸间隙。 */
  beginEntrance() {
    this._entranceState = {
      startTime: Date.now(),
      phase: 'board',        // board → pigs → ui → done
      pigFadeDelay: PlayDefine.PLAY.ENTRANCE.PIG_FADE_DELAY,
      pigFadeDur: PlayDefine.PLAY.ENTRANCE.PIG_FADE_DUR,
      uiStart: PlayDefine.PLAY.ENTRANCE.UI_START,
      uiDur: PlayDefine.PLAY.ENTRANCE.UI_DUR,
      totalDuration: PlayDefine.PLAY.ENTRANCE.TOTAL,
    };
  }

  deactivate() {
    this.input.off('playing');
    this._guide.reset();         // 退出关卡时强制结束引导
    this._entranceState = null;  // 清空入场动画，防止下一帧闪现旧猪
    this._levelReady = false;    // 重置并行加载标志，避免误判「已加载」跳过 startLevel（如编辑器试玩→进关）
    this._levelLoadFailed = false;
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
    this._hintRemaining = 3;      // 提示：每关 3 次
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

      // 通关后、结算面板尚未显示期间：屏蔽一切触控
      if (this._victory && !this._showVictoryPanel) return;

      // 结算面板关闭动画中：屏蔽触控
      if (this._victoryClosing) return;

      // 通关界面按钮（UIManager）
      if (this._victory) {
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

      // 失败界面按钮（与通关界面对称）
      if (this._failed) {
        if (this._uiFailPopup._replayBtn && _hitRect(t.x, t.y, this._uiFailPopup._replayBtn)) {
          audio.play('button_click');
          this.restartLevel();
          return;
        }
        if (this._uiFailPopup._exitBtn && _hitRect(t.x, t.y, this._uiFailPopup._exitBtn)) {
          audio.play('button_click');
          databus.gameState = databus.returnState === 'editor' ? 'editor' : 'menu';
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

      // 顶部返回/设置按钮
      // ⚠️ 命中区必须与 TopBar.js 绘制位置一致：TopBar 把设置按钮画在 backX=15 / backY=43（32×32，见 TopBar.js 设置按钮段）。
      // 精确 32×32 @ (15,43)，与上方徽章命中区(15,23,32×16)不重叠。
      if (_hitRect(t.x, t.y, { x: 15, y: 43, w: 32, h: 32 })) {
        this._btnPress.press('settings');
        this._btnPress.breathe('settings');
        audio.play('button_click');
        if (settingsPanel.isOpen()) {
          settingsPanel.close();
        } else {
          settingsPanel.open({
            title: '设置',
            buttons: [
              { iconKey: 'btn_home', action: function() { audio.play('button_click'); settingsPanel.close(); databus.gameState = databus.returnState === 'editor' ? 'editor' : 'menu'; } },
              { iconKey: 'btn_continue', action: function() { audio.play('button_click'); settingsPanel.close(); } },
              { iconKey: 'btn_again', action: function() { audio.play('button_click'); settingsPanel.close(); self.restartLevel(); } },
            ]
          });
        }
        return;
      }

      // 关卡内底栏双圆按钮（赛+3 / 提提示）—— 入场动画完成前 / 失败 / 通关后 不响应
      var entranceActive = this._entranceState && this._entranceState.phase !== 'done';
      if (!entranceActive && !this._failed && !this._victory) {
        var bSize = 68;
        // 左按钮：+3 步（新设计 frame left:80 bottom:42 → 左上角 (80, SCREEN_HEIGHT-121)，包围盒 78×79）
        var addX = 80;
        var addY = SCREEN_HEIGHT - 101;
        if (_hitRect(t.x, t.y, { x: addX, y: addY, w: 78, h: 79 })) {
          if (this._addStepRemaining <= 0) return;   // 次数用完，不可再点
          audio.play('button_click');
          this._btnPress.press('plus5');
          this._btnPress.breathe('plus5');
          this._addBonusSteps(3);
          // +3 道具图标飞向剩余步数面板（与金币飞行一致），到达后面板播被击中抖动
          if (this._itemFlyEffect && this._uiRightStep) {
            var sp2 = this._uiRightStep.getStepNumberPos();
            this._itemFlyEffect.trigger(addX + 34, addY + 34, sp2.x, sp2.y);
          }
          this._addStepRemaining--;
          this._saveCheckpoint();   // 道具次数已变，即时存盘（与逃猪录制即时存盘同思路；+3 虽改步数但即时更稳）
          return;
        }
        // 右按钮：提示（与左对称，frame x=SCREEN_WIDTH-158，包围盒 78×79）
        var hintX = SCREEN_WIDTH - 158;
        var hintY = SCREEN_HEIGHT - 101;
        if (_hitRect(t.x, t.y, { x: hintX, y: hintY, w: 78, h: 79 })) {
          if (this._hintRemaining <= 0) return;   // 次数用完，不可再点
          if (this._hint.isActive()) {
            showToast('请先解救这一只', 1500);
            return;
          }
          this._btnPress.press('bottomHint');
          this._btnPress.breathe('bottomHint');
          var best = this._hint.show();
          if (best) {
            audio.play('hint_reveal');
            this._hintRemaining--;
            this._saveCheckpoint();   // 提示次数已变即时存盘：提示不改步数/猪数，无定时器兜底，必须即时写
          } else {
            showToast('提示已结束', 1500);
          }
          return;
        }
      }

      // === 游戏世界（拖拽猪等）===
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

  onTouchStart(x, y) {
    this._guide.onPlayerAction();  // 棋盘操作 → 重置空闲计时
    this._recordTouch('touchstart', x, y);

    // === 按钮检测（回放中跳过） ===
    if (!this._isPlayingBack) {
    var self = this;
    // 顶栏左侧设置按钮（齿轮，Figma: left15/top16/32×32，圆形命中）
    // 注：UIManager 触控未接入运行时，原 backBtn 判断恒为 null（死代码）；此处改按齿轮圆形精准命中。
    //     rec.../hint... 状态文字仅纯绘制、无 hitTest，本就不拦截点击；设置按钮命中精准后不再与文字混淆。
    var entranceDone = !this._entranceState || this._entranceState.phase === 'done';
    if (entranceDone && !this._failed && !this._victory) {
      var setCX = 15 + 16, setCY = 16 + 16;   // 与 TopBar 绘制中心一致
      if ((x - setCX) * (x - setCX) + (y - setCY) * (y - setCY) <= 16 * 16) {
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
              { iconKey: 'btn_home', action: function() { audio.play('button_click'); settingsPanel.close(); databus.gameState = databus.returnState === 'editor' ? 'editor' : 'menu'; } },
              { iconKey: 'btn_continue', action: function() { audio.play('button_click'); settingsPanel.close(); } },
              { iconKey: 'btn_again', action: function() { audio.play('button_click'); settingsPanel.close(); self.restartLevel(); } },
            ]
          });
        }
        return;
      }
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
        showToast('提示已结束', 1500);
      }
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
    var bp = this.gp.screenToBoard(x, y);
    this._recordEntries.push({ type: type, bx: bp.x, by: bp.y, dt: Date.now() - this._recordingStart });
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
        // 统一逻辑：通关后保存提示数据（正式+试玩）
        if (!this._hintMerged && this._gameplayHintCache.length > 0) {
          this._hintMerged = true;
          console.log('[RecHint] 通关: 上传提示 (hintCache=' + this._gameplayHintCache.length + ')');
          this._mergeAndUploadHints();
        } else {
          console.log('[RecHint] 通关: 跳过提示上传 (hintMerged=' + this._hintMerged + ' hintCache=' + this._gameplayHintCache.length + ')');
        }
        // 通关：正式+试玩统一走结算流程（试玩仅金币不落库、不推进关卡索引）
        this._markCleared();
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

  /** 触发失败：弹出失败面板，屏蔽棋盘与提示操作 */
  _triggerFail() {
    this._failed = true;
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
    console.log('[Playing] _markCleared called, level=' + this.levelName + ' steps=' + this.steps);
    var isTrial = databus.returnState === 'editor';
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
    if (!isTrial) {
      var achievedScore = this._escapedCount + this._scoreBonusRemaining;
      this._saveBestScore(achievedScore);
      var star = StarScores.getStarTier(achievedScore, this._starScores);
      this._saveBestStar(star);
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

  /** 花朵/积分历史最高记录落库（仅正式模式；试玩不落库，多次通关保留最高） */
  _saveBestScore(score) {
    if (databus.returnState === 'editor') return; // 试玩不落库
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
    if (databus.returnState === 'editor') return; // 试玩不落库
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

  /** 继续按钮 — 统一返回主菜单（主菜单/关卡选择/其它入口进入均回主菜单；editor 试玩回编辑器） */
  _onContinueClick() {
    databus.gameState = databus.returnState === 'editor' ? 'editor' : 'menu';
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
    console.log('[LOG_victory] ★ 结算面板弹出！_showVictoryPanel=true, goldAmount=' + this._goldAmount + ' balance=' + GoldSystem.getGold());
    this._showVictoryPanel = true;
    this._victoryAnimStart = Date.now();
    this._victoryAnimator.open();
    audio.play('victory');
  }

  /** 绘制关卡场景背景图（可被交叉淡变复用，alpha 控制不透明度） */
  drawSceneBackground(alpha) {
    if (!this._sceneBgLoaded) return;
    var imgW = this._sceneBgImg.width;
    var imgH = this._sceneBgImg.height;
    var scale = Math.max(SCREEN_WIDTH / imgW, SCREEN_HEIGHT / imgH);
    var dw = imgW * scale;
    var dh = imgH * scale;
    var dx = (SCREEN_WIDTH - dw) / 2;
    var dy = (SCREEN_HEIGHT - dh) / 2;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(this._sceneBgImg, dx, dy, dw, dh);
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

  // 左/右 道具按钮（新设计，Ardot frame: left:80 bottom:42，框 78×79）
  // 圆形底框(68) 复用 drawRoundMenuButton（金圆+橙内圈+图标 52 居中）；
  // 叠加：广告角标（红圆+白三角）、文字框（label）
  // side:'left' → frame x=80；side:'right' → 对称：frame x=SCREEN_WIDTH-158（=SCREEN_WIDTH-80-78）
  _drawItemButton(ctx, key, side, iconKey, label) {
    var fx = (side === 'right') ? (SCREEN_WIDTH - 158) : 80;
    var fy = SCREEN_HEIGHT - 101;      // frame 左上角 y：bottom:22 + 高79 = 距底101（相对 bottom:42 设计稿再下移20px）
    var s = this._btnPress.getScale(key);
    // 以 frame 中心为锚做按下缩放
    var ax = fx + 39, ay = fy + 39.5;
    ctx.save();
    ctx.translate(ax, ay);
    ctx.scale(s, s);
    ctx.translate(-ax, -ay);

    // 内联圆角矩形
    function _rr(c, x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      c.beginPath();
      c.moveTo(x + r, y);
      c.arcTo(x + w, y, x + w, y + h, r);
      c.arcTo(x + w, y + h, x, y + h, r);
      c.arcTo(x, y + h, x, y, r);
      c.arcTo(x, y, x + w, y, r);
      c.closePath();
    }

    // 1. 圆形底框 68×68（left:0 top:0）+ 图标 52×52（left:8 top:8，恰为圆内居中）
    drawBottomBar.drawRoundMenuButton(ctx, fx, fy, 68, '', true, iconKey);

    // 2. 广告角标：红圆 28×28（left:50 top:2）+ 白色三角（Figma Polygon 3，居中红圆，播放标）
    ctx.save();
    ctx.fillStyle = '#FF6363';
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(fx + 64, fy + 16, 13.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    // 白色三角形（Figma Polygon 3，广告/视频播放标），居中于红圆 (64,16)，朝右
    ctx.beginPath();
    ctx.moveTo(fx + 72, fy + 16);   // 顶点（右）
    ctx.lineTo(fx + 60, fy + 8);    // 左上
    ctx.lineTo(fx + 60, fy + 24);   // 左下
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 3. 文字框 50×25（left:9 top:52）+ 边框 #B5712B
    ctx.save();
    ctx.fillStyle = '#FEAB56';
    ctx.strokeStyle = '#B5712B';
    ctx.lineWidth = 1;
    _rr(ctx, fx + 9, fy + 52, 50, 25, 12);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // 4. 文字：剩余次数（居中于文字框，白字 + 轻微阴影）
    var isHint = (key === 'bottomHint');
    var remaining = isHint ? this._hintRemaining : this._addStepRemaining;
    if (remaining == null) remaining = 3;   // 兜底：未初始化按上限显示（提示/+3 当前上限均为 3）
    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 1;
    ctx.font = '400 16px ' + (Theme.font && Theme.font.family ? Theme.font.family : 'sans-serif');
    ctx.fillText(remaining + '次', fx + 34, fy + 64.5);
    ctx.restore();

    ctx.restore();
  }

  // 左边「+3 步」按钮
  _drawAddStepButton(ctx, key) {
    this._drawItemButton(ctx, key, 'left', 'addstep_icon', '+3');
  }

  // 右边「提示」按钮（与左边对称，元素一致，仅图标 hint_icon + 文字 3次）
  _drawHintButton(ctx, key) {
    this._drawItemButton(ctx, key, 'right', 'hint_icon', '3次');
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
    this.drawSceneBackground(1);

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

    // 背景物件（image 718）：固定屏幕位置，绘制于棋盘之上（确保不被棋盘/孔位遮挡）
    // 新图尺寸 279×44、top:78（原 279×85、top:61，已去上下留白并下移），绘制矩形同步更新
    if (AssetPreloader.isReady('bg_deco_718')) {
      ctx.drawImage(AssetPreloader.get('bg_deco_718'), 10, 78, 279, 44);
    }

    // 树枝进度条「底层」（绿色已走过揭示 + 调试曲线）：绘制于草丛之下
    // 绿色进度条是树枝皮肤的一部分，本应被前景草丛(树叶)压住
    if (this._uiBranchProgress) this._uiBranchProgress.renderBranchLayer(ctx);

    // 草丛装饰（Figma 草丛节点）：替换原 Vector 6/7/8 三层纯色装饰
    // 坐标全部为「相对屏幕左上角」的 Figma 原值，按屏幕坐标直接绘制（left:0, top:39, 69.32×121.07）
    // 绘制于树枝底层之上：草丛(装饰树叶)盖住已走过的绿色树枝，处于最上层装饰
    if (AssetPreloader.isReady('level_brush')) {
      ctx.drawImage(AssetPreloader.get('level_brush'), 0, 39, 69.32, 121.07);
    }

    // 树枝进度条「上层」（小虫 + 花朵 + 粒子 + 施法高光）：绘制于草丛之上
    // 小虫与星级花是爬在树枝上的主体，必须压在前景草丛之上，避免被树叶遮挡
    if (this._uiBranchProgress) this._uiBranchProgress.renderUILayer(ctx);

    // 剩余未逃脱猪数量组件（可复用 drawPigCounter，父 frame 宽 55）
    // 按 SCREEN_WIDTH 动态水平居中：设备宽 ≠375 时硬编码 160 会偏左，故实时算 frameX
    // ⚠️ -9 的由来：Figma 内可见内容(pill/panel/猪头)相对 frame 左缘右偏 9px（pill left:169 vs frame left:160），
    //    仅让 frame 盒子居中会让"眼睛看到的猪头"偏右 9px。故在 frame 居中的基础上再左移 9px，
    //    使可见猪头计数器的视觉中心落于屏幕正中（而非仅 frame 盒子居中）。
    // 剩余数 = 棋盘上仍在的猪
    if (this.gp && this.gp.pigs) {
      var pigFrameX = Math.round((SCREEN_WIDTH - 55) / 2) - 9; // 55=frame宽，-9=内容视觉居中补偿
      drawPigCounter(ctx, pigFrameX, -48, { iconKey: 'pig_icon', value: this.gp.pigs.length });
    }

    // 通关后孔洞渐隐（1s 内 alpha 1→0）
    if (this._victory) {
      var elapsed = Date.now() - this._victoryTime;
      this.gp.fadeAlpha = Math.max(0, 1 - elapsed / 1000);
    }

    // ---- UI 渲染（受入场动画控制）----
    if (!entranceActive) {
      // 动画结束：正常渲染所有 UI
      // 3. 顶栏（UIManager）
      this._uiTopBar.render(ctx);
      // 3.5. 右上角剩余步数组件（还原旧版 CrownPigWidget 步数显示）
      if (this._uiRightStep) this._uiRightStep.render(ctx);
      // 4.5. 金币余额（常规层始终渲染；结算面板半透明遮罩下仍可透见，不隐藏）
      if (this._uiGoldWidget) {
        this._uiGoldWidget.render(ctx);
      }
      // 5.0. 步数→飞小花「独立最高层」：绘制于步数牌/顶栏/金币之上，
      //       确保飞花从右上角步数牌中心飞出时盖过步数牌（PlayingEngine.render 为手写按行序绘制，
      //       UIManager 的 zIndex 不生效，故飞花需单独后画）。仍在结算面板之下（动画结束后面板才弹出）。
      if (this._uiBranchProgress) this._uiBranchProgress.renderStepFlowersLayer(ctx);
      // 5. 底部栏（UIManager）
      // 5.2 关卡内底栏：level_buttom 背景 + 双圆按钮（赛+3 / !提示）
      // 底栏图片始终绘制（失败时由失败面板覆盖）；交互按钮在失败/通关后隐藏
      drawBottomBar.drawLevelBottomBar(ctx);
      if (!this._failed && !this._victory) {
        // 左按钮：+3 步（新设计，见 _drawAddStepButton）
        this._drawAddStepButton(ctx, 'plus5');
        if (this._hasHintData) {
          // 右按钮：提示（与左对称，见 _drawHintButton）
          this._drawHintButton(ctx, 'bottomHint');
        }
      }
    } else if (es.phase === 'ui') {
      // UI 飞入动画（500ms，ease-out cubic）
      var uiT = Math.min(1, (eElapsed - es.uiStart) / es.uiDur);
      var ease = _easeOutCubic(uiT);
      // 上方控件：从 y=-200 落到 y=0（同时）
      var topItems = [
        { comp: this._uiTopBar,    cond: true },
        { comp: this._uiGoldWidget, cond: this._uiGoldWidget },
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
              drawBottomBar.drawLevelBottomBar(c);
              if (!selfPE._failed && !selfPE._victory) {
                selfPE._drawAddStepButton(c, 'plus5');
                if (selfPE._hasHintData) {
                  selfPE._drawHintButton(c, 'bottomHint');
                }
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

    // 结算触发：通关后所有金币到齐（或超时兜底）—— 试玩与正式一致触发
    if (this._victory && !this._settlementTriggered) {
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
      savedAt: Date.now()
    };
  }

  /** 保存当前关卡状态到本地持久化存储（实时调用：状态一变化即写整份镜像） */
  _saveCheckpoint() {
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
