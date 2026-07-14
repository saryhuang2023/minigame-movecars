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
const VictoryPopup = require('../ui/widgets/VictoryPopup.js');
const FailPopup = require('../ui/widgets/FailPopup.js');
const RightStepWidget = require('../ui/widgets/RightStepWidget.js');
const LevelCache = require('../preload/LevelCache.js');
const HintSystem = require('./HintSystem.js');
const CoinFlyEffect = require('../effects/CoinFlyEffect.js');
const GoldWidget = require('../ui/widgets/GoldWidget.js');
const GuideManager = require('../guide/GuideManager.js');
const GoldSystem = require('./GoldSystem.js');
const SkinSystem = require('./SkinSystem.js');
const StaminaAdPanel = require('../ui/StaminaAdPanel.js');
const CommonButton = require('../ui/widgets/CommonButton.js');
const AssetPreloader = require('../ui/AssetPreloader.js');
const { drawFlower } = require('../ui/drawFlower.js');
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
    // 断点续玩
    this._checkpointTimer = null;   // 5秒存档定时器
    this._levelVersion = 0;         // 当前关卡版本号
    this._skipRestore = false;       // 重玩标记（置 true 则跳过恢复）
    this._lastSavedSteps = -1;      // 上次存档时的步数（用于脏检测）
    this._lastSavedPigCount = -1;   // 上次存档时的猪数量（用于脏检测）
    // 金币奖励
    this._goldAmount = 0;           // 本次通关奖励金币数（不含步数奖励）
    this._stepBonusRemaining = 0;    // 剩余步数转化的奖励金币数
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
    // 失败状态重置
    this._failed = false;
    this._failAnimator.close();     // 立即关闭（无动画）
    this._failClosing = false;
    this._hint.clear();
    this._guide.reset();
    this._lastFrameTime = 0;       // 防止切关卡时 dt 突增
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

      // Layer INFO — 右上角剩余步数组件（还原旧版 CrownPigWidget 的步数显示，奖杯已删除）
      this._uiRightStep = new RightStepWidget({ zIndex: UIManager.LAYER.INFO });
      this.ui.add(this._uiRightStep, UIManager.LAYER.INFO);

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
      this._uiBottomBar = null;
      this._uiVictoryPopup = null;
      this._uiFailPopup = null;
      this._uiRightStep = null;
    }
  }

  /** 每帧更新 UI 层数据（引擎 → UI 组件单向数据流） */
  _syncUIData() {
    if (!this._uiTopBar) return;  // 哨兵检查

    // TopBar 位置 + 内容（屏幕坐标系，y=0）
    this._uiTopBar.setBounds(0, 0, this._boardCardW, Theme.layout.topBarH);
    this._uiTopBar.setLevelText('第' + (parseInt(this.levelName || 1)) + '关');
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

    // BottomBar — 提示按钮状态（移除功能已删除，提示按钮常显）
    var hintShowing = this._hint.isActive();
    this._uiBottomBar.setHintShowing(hintShowing);
    this._uiBottomBar.setCurrentSteps(this.steps);

    // 提示按钮位置（右下角 Figma 规格）
    if (this._hintCommonBtn) {
      this._hintCommonBtn.x = SCREEN_WIDTH - 15 - 144;
      this._hintCommonBtn.y = SCREEN_HEIGHT - 34.5 - 61;
      this._hintCommonBtn.label = '提示!';
      this._hintCommonBtn.color = 'gold';
      this._hintCommonBtn.visible = this._showHintCommon && !this._failed;
    }

    // 右上角剩余步数组件（还原旧版 CrownPigWidget 的步数显示；试玩/结算面板弹出/失败时隐藏）
    // 注意：隐藏时机用 _showVictoryPanel（结算面板弹出）而非 _victory（一通关就置真）。
    // 否则通关瞬间步数框即消失，但步数转金币动画（_startStepBonusTicker + 金币飞入）要等
    // _showVictoryPanel=true 才结束，会出现「框没了、动画还在播」的割裂感。
    if (this._uiRightStep) {
      this._uiRightStep.setData(this._stepBonusThreshold, this.steps);
      this._uiRightStep.setHidden(
        databus.returnState === 'editor' || this._showVictoryPanel || this._failed
      );
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
      totalDuration: PlayDefine.PLAY.ENTRANCE.TOTAL,     // 总时长 1300ms（注意定义键名是 TOTAL 非 TOTAL_DURATION）
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

  activate() {
    var name = databus.currentLevel ? databus.currentLevel.name : '';
    this.startLevel(name);
  }

  deactivate() {
    this.input.off('playing');
    this._guide.reset();         // 退出关卡时强制结束引导
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
    this._stepBonusThreshold = (data && data.stepBonusThreshold != null) ? data.stepBonusThreshold : ((data && data.crownSteps) || 0);
    if (this._stepBonusThreshold <= 0) {
      console.warn('[StepHUD] 关卡 ' + (data && data.name) + ' stepBonusThreshold=' + this._stepBonusThreshold + ' → 剩余步数 HUD 隐藏（无步数预算；检查关卡 JSON 是否含 stepBonusThreshold）');
    }
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

      // 左上角金币（覆盖金币+文字整个区域，试玩无）— 命中区对齐新位置(底框23-101 / 图标16-48 / y122-154)
      if (this._uiGoldWidget && _hitRect(t.x, t.y, { x: 10, y: 118, w: 100, h: 42 })) {
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
      var badgeX = 16;
      if (databus.returnState !== 'editor' && _hitRect(t.x, t.y, { x: badgeX, y: 48, w: 62, h: 20 })) {
        this._uiTopBar.triggerBreathe();
        return;
      }

      // 顶部返回/设置按钮
      // ⚠️ 命中区必须与 TopBar.js 绘制位置一致：TopBar 把设置按钮画在 backX=16 / backY=78（32×32，见 TopBar.js:76-82），
      // 故命中区 y 取 78（原 y:26 是一处遗留错位，导致绘制在 y≈78~110 而命中最远只到 73，点击完全接不上）。
      if (_hitRect(t.x, t.y, { x: Theme.spacing.padding, y: 78, w: 49, h: 47 })) {
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

      // 提示按钮（CommonButton，右下角；移除功能已删除，仅提示）
      if (this._hintCommonBtn && this._hintCommonBtn.visible &&
          this._hintCommonBtn.hitTest(t.x, t.y)) {
        this._hintCommonBtn.handleTouch(t.x, t.y, 'touchstart');
        var best = this._hint.show();
        if (best) {
          audio.play('hint_reveal');
        } else {
          wx.showToast({ title: '提示已结束', icon: 'none', duration: 1500 });
        }
        return;
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
        this.tryPushPig(pigId, { skipStep: true });  // 内部会判通关（设置 _victory）
      }
      this._shouldPushAfterSnap = false;
      // 步数用尽判定（必须在 tryPushPig 之后，保证「通关优先于失败」）
      this._checkFail();
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
          var goldCY = PlayDefine.PLAY.GOLD_FLY_TARGET.cy;  // = 138

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

  /**
   * 步数用尽判定：剩余步数 = 步数预算 - 已用步数。
   * 剩余 <= 0 且尚未通关 → 触发失败。
   * 前置：必须在 tryPushPig（设置 _victory）之后调用，保证「通关优先于失败」。
   */
  _checkFail() {
    if (this._victory || this._failed) return;          // 已通关 / 已失败 → 不重复触发
    if (databus.returnState === 'editor') return;       // 试玩模式不判失败
    if (this._stepBonusThreshold <= 0) return;          // 无步数预算（旧关卡）不判失败
    var remaining = this._stepBonusThreshold - this.steps;
    if (remaining <= 0) {
      this._triggerFail();
    }
  }

  /** 触发失败：弹出失败面板，屏蔽棋盘与提示操作 */
  _triggerFail() {
    this._failed = true;
    this._showHintCommon = false;
    this._uiBottomBar.setHintHidden(true);
    this._uiFailPopup.visible = true;
    this._uiFailPopup.open();
    console.log('[LOG_fail] 通关失败！steps=' + this.steps + ' threshold=' + this._stepBonusThreshold);
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
    // 金币奖励：试玩模式不触发；首次通关本关 → 计算奖励金额
    //   首通判定与「飞金币」动画同源（this._isFirstGoldClear，进入关卡时计算）
    this._goldAmount = 0;
    this._stepBonusRemaining = 0;
    if (this._isFirstGoldClear) {
      var reward = GoldSystem.calculateReward(this._totalPigsInLevel);
      // 步数奖励：在阈值内通关，剩余步数转化为额外金币
      if (this._stepBonusThreshold > 0 && this.steps < this._stepBonusThreshold) {
        var stepBonus = this._stepBonusThreshold - this.steps;
        if (stepBonus > 0) {
          this._stepBonusRemaining = stepBonus;
          reward += stepBonus;
        }
      }
      if (reward > 0) {
        this._goldAmount = reward;
      }
    }
    console.log('[LOG_victory] 奖励计算完成: goldAmount=' + this._goldAmount + ' stepBonusRemaining=' + this._stepBonusRemaining + ' isFirstTime=' + (!isTrial && currentIdx >= savedIdx));

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
  _syncToCloud() {
    try {
      var lastLevelIndex = wx.getStorageSync('lastLevelIndex');
      var info = wx.getStorageSync('userinfo_cache') || {};
      cloud.savePlayerData({
        lastLevelIndex: lastLevelIndex,
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

  /** 继续按钮 — 统一返回主菜单（主菜单/关卡选择/其它入口进入均回主菜单；editor 试玩回编辑器） */
  _onContinueClick() {
    databus.gameState = databus.returnState === 'editor' ? 'editor' : 'menu';
  }

  /** 从广告领取后继续（消费体力已在 claimAd 调用前完成） */
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

  // 加载远程头像图片（通过 downloadFile 获取本地路径，兼容性更好）
  // ========== 通关动画编排 ==========

  /**
   * 结算入库 + 启动步数奖励动画：步数奖励 → 弹窗
   * 金币已在 _goldAmount 中计算好，此处立即入账。
   */
  _settleCoinsAndStartVictory() {
    console.log('[LOG_victory] 开始结算入库: goldAmount=' + this._goldAmount + ' stepBonusRemaining=' + this._stepBonusRemaining);
    // 立即入库
    if (this._goldAmount > 0) {
      GoldSystem.addGold(this._goldAmount);
      console.log('[LOG_victory] 金币入账: +' + this._goldAmount + ' 余额=' + GoldSystem.getGold());
    }
    this._goldSettled = true;
    this._levelAccumulatedGold = 0;  // 清零累积，防止旧计数值叠加显示
    // 强制同步 GoldWidget 内部值到「基础金币」(排除步数奖励)，让步数奖励在 ticker 中逐 tick 滚上去。
    // 若 forceSet 到终值(GoldSystem.getGold())，数字会先 snap 到终值，再被 _syncUIData 的
    // getGold-_stepBonusRemaining 拉回基础值，看着像「没滚、飞币是装饰」。改为基础值后随 tick 干净上滚。
    if (this._uiGoldWidget) this._uiGoldWidget.forceSet(GoldSystem.getGold() - this._stepBonusRemaining);
    // 清除兜底定时器（正常路径已完成结算）
    if (this._settlementTimer) { clearTimeout(this._settlementTimer); this._settlementTimer = null; }

    // 金币已入账 → 同步到云端
    this._syncToCloud();

    var self = this;
    // 步数奖励 → 结束后弹出结算面板
    if (self._stepBonusRemaining > 0) {
      console.log('[LOG_victory] → 启动步数ticker(' + self._stepBonusRemaining + '步)');
      self._startStepBonusTicker(self._stepBonusRemaining);
      return;
    }
    self._finishVictorySequence();
  }

  /**
   * 测试按钮"画"：同时播金币炸开飞行动画
   */
  _testPlayAll() {
    this._testBurstEffect();
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
   * ticker 完成 → 结算金币入账（步数奖励）
   */
  _startStepBonusTicker(remaining) {
    var self = this;
    var totalTicks = remaining;
    var interval = Math.floor(1000 / totalTicks);
    var ticked = 0;
    // 步数底框中心 → 金币图标中心（右→左）
    var fromX = SCREEN_WIDTH - 98;
    var fromY = 106;
    var toX = 32;
    var toY = 106;

    var ticker = setInterval(function () {
      ticked++;
      // 仅发射金币 + 计次；数字递增在「金币落地回调」里做，确保与金币落点严格同步
      audio.play('coin_fly');
      self._coinFlyEffect.trigger(fromX, fromY, toX, toY, true);

      if (ticked >= totalTicks) {
        clearInterval(ticker);
        console.log('[LOG_victory] 步数ticker发射完毕 → 等待金币落定...');
        // 等所有步数金币落定且数字翻滚到终值后再弹面板
        // （首币落地≈发射后600ms，末币落地后数字还需约800ms翻滚到终值 → 总延时≈发射后1400ms）
        setTimeout(function () {
          self._finishVictorySequence();
        }, 1400);
      }
    }, interval);
  }

  /**
   * 通关动画播放完毕，显示结算面板。
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
    if (AssetPreloader.isReady('bg_deco_718')) {
      ctx.drawImage(AssetPreloader.get('bg_deco_718'), 10, 61, 279, 85);
    }

    // 装饰花朵（可复用 drawFlower）：绘制于棋盘之上
    // Figma 三处：14×14@(98,101) / 14×14@(162,91) / 13×13@(242,100)
    drawFlower(ctx, 98, 101, 14);
    drawFlower(ctx, 162, 91, 14);
    drawFlower(ctx, 242, 100, 13);

    // 草丛装饰（Figma 草丛节点）：替换原 Vector 6/7/8 三层纯色装饰
    // 坐标全部为「相对屏幕左上角」的 Figma 原值，按屏幕坐标直接绘制（left:0, top:39, 69.32×121.07）
    // 绘制于棋盘之上（确保不被棋盘/孔位遮挡）
    if (AssetPreloader.isReady('level_brush')) {
      ctx.drawImage(AssetPreloader.get('level_brush'), 0, 39, 69.32, 121.07);
    }

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
    // 金币到达 → 播放音效 + 触发 GoldWidget 呼吸 + "+1" 浮字
    if (coinArrived > 0 && this._uiGoldWidget && !this._testAnimActive) {
      // 结算已入库 → 不再累加计数（保留视觉效果）
      if (!this._goldSettled) {
        audio.play('coin_get');
      }
      for (var ca = 0; ca < coinArrived; ca++) {
        if (!this._goldSettled) {
          this._levelAccumulatedGold++;
          // 正常推猪：金币落地即 +1，由落地回调驱动数字上滚
          this._uiGoldWidget.setData(GoldSystem.getGold() + this._levelAccumulatedGold);
        } else {
          // 步数奖励阶段(_goldSettled=true)：每枚步数金币落地 → 剩余步数 -1，
          // _syncUIData 据此把数字上滚，与金币落点严格同步（而非发射即计数）。
          this._stepBonusRemaining = Math.max(0, this._stepBonusRemaining - 1);
        }
        // 结算后绝不在落地回调里 setData(getGold) 把数字 snap 回终值（否则上滚被腰斩）；
        // 数字只由 _syncUIData 的 getGold-_stepBonusRemaining 公式驱动。
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

    // 恢复本关累积金币：断点续玩时，已逃出猪捡到的金币必须计入显示。
    // 该值不需要持久化——由存档「缺失的猪」推得：removedCount 即已逃出猪数，每头 +1 金币，
    // 与 _saveCheckpoint 恢复的棋盘状态严格一致（不会出现金币/棋盘不匹配）。
    this._levelAccumulatedGold = removedCount;
    console.log('[LOG_cp] _doResume 恢复累积金币(由 removedCount 计算)=' + this._levelAccumulatedGold + ' removedCount=' + removedCount);

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
