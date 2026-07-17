// 游戏主循环引擎

const databus = require('../databus.js');
const cloud = require('../cloud.js');
const audio = require('../audio/AudioManager.js');
const settingsPanel = require('../ui/SettingsPanel.js');
const { drawSettingsButton } = require('../ui/drawSettingsButton.js');
const drawBottomBar = require('../ui/drawBottomBar.js');
const GoldSystem = require('../game/GoldSystem.js');
const SkinSystem = require('../game/SkinSystem.js');
const StaminaSystem = require('../game/StaminaSystem.js');
const SkinLoader = require('../entity/SkinLoader.js');
const ShopPanel = require('../ui/ShopPanel.js');
const StaminaAdPanel = require('../ui/StaminaAdPanel.js');
const AssetPreloader = require('../ui/AssetPreloader.js');
const LevelMap = require('../ui/LevelMap.js');
const Theme = require('../define/GameDefine.js').THEME;
const Easing = require('./Easing.js');
const { ctx, SCREEN_WIDTH, SCREEN_HEIGHT, beginFrame, present } = require('../render.js');
const InputManager = require('./InputManager.js');
const EditorEngine = require('../editor/EditorEngine.js');
const PlayingEngine = require('../game/PlayingEngine.js');
const BugReporter = require('../debug/BugReporter.js');
const DebugPanel = require('../debug/DebugPanel.js');
const { ToastWidget, showToast } = require('../ui/widgets/ToastWidget.js');

// 主菜单入场时序（单一数据源）：分步入场
//  1) t=500 底部条上移+渐显；设置按钮 + 体力UI 原地渐显（不滑动）
//  2) t=800 开始按钮渐显+回弹  3) t=1260 左右按钮 + 体力图标同批渐显+回弹（体力图标在播放按钮之后出现）
// 整段入场结束绝对时刻（ms）= 左/右按钮最晚：1260 + 440
var MENU_ENTRANCE = {
  bottomBar: { stagger: 500,  dur: 480, from: { dx: 0,   dy: 240, scale: 1,   alpha: 0 }, ease: 'cubic' },
  settings:  { stagger: 500,  dur: 460, from: { dx: 0,   dy: 0,   scale: 1,   alpha: 0 }, ease: 'cubic' },
  // 体力 UI：逐枚「摆盘子」入场在 _renderStaminaUI 内独立计时（见 STAMINA_ENTRANCE_*），
  // 此处仅占位（alpha:1，不整块淡入），避免与逐枚 alpha 叠加成双重淡入。
  stamina:   { stagger: 1260, dur: 440, from: { dx: 0,   dy: 0,   scale: 1,   alpha: 1 }, ease: 'cubic' },
  play:      { stagger: 800,  dur: 460, from: { dx: 0,   dy: 0,   scale: 0.8, alpha: 0 }, ease: 'back'  },
  dress:     { stagger: 1260, dur: 440, from: { dx: 0,   dy: 0,   scale: 0.8, alpha: 0 }, ease: 'back'  },
  challenge: { stagger: 1260, dur: 440, from: { dx: 0,   dy: 0,   scale: 0.8, alpha: 0 }, ease: 'back'  },
};
var MENU_ENTRANCE_END = 1260 + 440;

// 出场动画：主菜单「底部区域」向下移出屏幕 + 渐隐，其余元素原地渐隐。
// 时长 = 控件从原位滑出屏幕的自然时长（全屏高度下滑 + 同时渐隐），与入场时序无关。
var MENU_EXIT_DURATION = 450;
// 出场（控件滑出）完成后：先等关卡加载就绪，再做菜单背景↔关卡背景交叉淡变。
// 交叉淡变时长 = 菜单背景渐隐(1→0) + 关卡背景渐显(0→1) 的重叠区间。
var MENU_CROSSFADE_DURATION = 450;
// 出场时真正「下拉」的元素集合（底部条 + 开始按钮 + 左下/右下双圆钮 + 体力 UI）；其余（设置）仅渐隐。
var MENU_EXIT_BOTTOM_KEYS = { bottomBar: 1, play: 1, dress: 1, challenge: 1, stamina: 1 };

// 体力图标逐枚入场（"摆盘子"：自上方依次落下、落定微回弹），与整体入场解耦、独立计时，
// 由 _staminaEntranceStart 驱动；即使 _menuEntrance 已结束，最后几枚仍能播完。
var STAMINA_ENTRANCE_BASE = 1300;   // 第一枚起始（ms，开始按钮/圆钮显示之后）
var STAMINA_ENTRANCE_STEP = 85;     // 相邻两枚间隔（ms）
var STAMINA_ENTRANCE_DUR  = 300;    // 单枚落定时长（ms）

class GameEngine {
  constructor() {
    console.log('[GameEngine] constructor 开始');

    // 抢先渲染背景渐变，消除模块加载期间的黑屏
    // 在 new 子引擎之前就画，确保用户打开即见品牌色背景
    beginFrame();
    var bgGrad = ctx.createLinearGradient(0, 0, 0, SCREEN_HEIGHT);
    bgGrad.addColorStop(0, '#F0EAFA');
    bgGrad.addColorStop(0.4, '#FDE8EF');
    bgGrad.addColorStop(1, '#FDF2F8');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    present();

    this.input = new InputManager();
    console.log('[GameEngine] InputManager 创建完成');
    this.editor = new EditorEngine(this.input);
    console.log('[GameEngine] EditorEngine 创建完成');
    this.playing = new PlayingEngine(this.input);
    console.log('[GameEngine] PlayingEngine 创建完成');

    // 全局 Toast 替代组件（不拦截触摸，直接叠在所有场景之上渲染）
    this._toast = new ToastWidget();
    ToastWidget.registerToast(this._toast);

    // 背景图：由 LoadingManager 在 Phase1 加载后注入
    this.bgImg = null;
    this._bgLoaded = false;

    // 菜单按钮
    this.menuButtons = [];
    this._pressedBtnIdx = -1;   // 当前被按下的按钮索引（用于按压动画）
    this._pressedBtnTime = 0;   // 按钮按下时间

    // 菜单可见性 + 出场动画状态
    this._menuVisible = false;  // 当前是否处于「可见的主菜单」（决定离场时是否播放反向出场动画）
    this._menuExit = null;      // 出场动画状态 { phase:'exit', startTime, target, totalDuration }

    // 关卡地图（主页）：最小可滑动集合（自动路径+占位按钮）。
    // _useLevelMap=true 在主界面之上叠加可滚动路径（clay 菜单照常渲染作底）；
    // 置 false 则不叠加、退回纯 clay 主菜单。
    this._useLevelMap = true;
    this._levelMap = new LevelMap();
    this._levelMapGesture = false;   // 当前触摸手势是否被地图接管（落在空白/路径区）

    // 关卡地图：点击关卡回调（已通关关 → 不耗体力直接进；当前关 → 走原开始流程耗体力）
    var self = this;
    this._levelMap.onSelectLevel = function (levelIndex, state) {
      if (state === 'current') {
        self._onClickPlayBtn();                 // 当前关：消耗体力（同开始按钮）
      } else {
        self.startLevelByIndex(levelIndex, false); // 已通关：不耗体力，直接进
      }
    };

    // 左下角快速 5 连击解锁编辑器入口 + DebugPanel
    this._cornerTapCount = 0;
    this._cornerTapTimer = null;
    this._editorUnlocked = false;

    // 皮肤系统：同步加载本地包（云端配置由 LoadingManager Phase3 异步拉取）
    SkinSystem.loadLocalSync();
    console.log('[GameEngine] SkinSystem 本地配置同步加载完成');

    // 体力系统
    this._stamina = new StaminaSystem();
    this._stamina.load();
    this._staminaIcons = { filled: null, empty: null };  // 体力图标：energy.png / energy_empty.png
    this._preloadStaminaIcons();
    this._staminaShake = null;     // 体力不足抖动状态
    this._staminaEmbed = null;     // 体力嵌入特效状态
    this._staminaPendingStart = false;
    this._staminaEntranceStart = 0;   // 体力图标逐枚入场计时起点（菜单入场开始时写入）
    this._impactShake = null;      // 砸中目标的全局冲击抖动
    this._slamSparks = null;       // 砸中火花粒子
    this._flyTrail = null;         // 飞行残影
    this._startScale = 1;
    console.log('[GameEngine] StaminaSystem 初始化完成');

    // 预加载数据占位（LoadingManager 填充）
    this._preloadedPlayerData = null;
    this._preloadedCloudRange = null;

    // 注册前台/后台生命周期：切到后台暂停音乐、回到前台恢复。
    // 否则真机切窗口回来 BGM 不再播放（系统只自动暂停、不自动恢复 InnerAudioContext）。
    var audioMgr = audio;
    wx.onHide(function () {
      console.log('[GameEngine] onHide — 进入后台');
      audioMgr.onHide();
    });
    wx.onShow(function () {
      console.log('[GameEngine] onShow — 回到前台');
      audioMgr.onShow();
    });

    console.log('[GameEngine] constructor 完成，启动加载画面...');
    this._startLoading();
  }

  // ===== 加载画面 =====

  /** 启动加载画面：创建 LoadingManager + LoadingRenderer，运行加载循环 */
  _startLoading() {
    var LoadingManager = require('../loading/LoadingManager.js');
    var LoadingRenderer = require('../loading/LoadingRenderer.js');

    var self = this;
    this._loadingMgr = new LoadingManager();
    this._loadingRdr = new LoadingRenderer(this._loadingMgr);

    // 皮肤配置必须在 loading 启动前同步加载（frameCount 依赖 skin.json）
    SkinLoader.loadSkinConfig(0);

    // 启动加载
    this._loadingMgr.start();
    this._loadingLoop();
  }

  /** 加载循环：三阶段过渡 → 主菜单
   *   Phase A: 进度条 100% 停留 500ms
   *   Phase B: 进度条 + 小猪滑出 300ms (LoadingRenderer 负责)
   *   Phase C: 主菜单元素错开滑入 400ms (renderMenu 负责)
   */
  _loadingLoop() {
    var self = this;
    var now = Date.now();

    // ---- 加载中：正常渲染 ----
    if (!this._loadingMgr.isDone()) {
      var coin = this._loadingMgr.getImage('coin');
      if (coin) this._loadingRdr.setCoinImage(coin);
      var bg = this._loadingMgr.getImage('bg');
      if (bg) this._loadingRdr.setBgImage(bg);
      this._loadingRdr.render();
      requestAnimationFrame(function () { self._loadingLoop(); });
      return;
    }

    // ---- Phase A: 100% 停留 500ms ----
    if (!this._doneAt) {
      this._doneAt = now;
    }
    if (!this._slideOutStarted && now - this._doneAt < 500) {
      // 确保进度条满格（进度可能还没到 100% 就 isDone 了）
      this._loadingRdr.render();
      requestAnimationFrame(function () { self._loadingLoop(); });
      return;
    }

    // ---- Phase B: 滑出动画 300ms ----
    if (!this._slideOutStarted) {
      this._slideOutStarted = now;
      this._loadingRdr.startSlideOut();
    }
    var slideElapsed = now - this._slideOutStarted;
    this._loadingRdr.updateSlideOut(slideElapsed);
    this._loadingRdr.render();

    if (slideElapsed < 500) {
      requestAnimationFrame(function () { self._loadingLoop(); });
      return;
    }

    // ---- Phase C: 注入数据 + 启动主循环 + 菜单滑入 + 用户信息预加载 ----
    if (!this._transitioned) {
      this._transitioned = true;

      // 注入背景图
      var bgImg = this._loadingMgr.getImage('bg');
      if (bgImg) { this.bgImg = bgImg; this._bgLoaded = true; }
      // 把草原背景交给关卡地图，使其随路径同速滚动
      if (this._useLevelMap && this._levelMap) this._levelMap.setBackground(this.bgImg);

      // 存储预加载的云端数据
      this._preloadedPlayerData = this._loadingMgr.getPlayerData();
      this._preloadedCloudRange = this._loadingMgr.getCloudLevelRange();

      // 用户信息预加载（fire-and-forget，不阻塞启动）
      this._prefetchUserInfo();

      // 初始化菜单入场动画
      this._menuEntrance = {
        phase: 'slideIn',
        startTime: now,
        totalDuration: MENU_ENTRANCE_END, // 整段入场结束（左/右按钮最晚，t=1700ms）
      };
      this._staminaEntranceStart = now;   // 体力图标逐枚入场同步启动
      this._menuEntranceDoneAt = 0;

      console.log('[GameEngine] 加载完成，启动游戏');
      this.start();
      this.loop();
    }
  }

  /** 启动主循环 */
  start() {
    console.log('[GameEngine] start() 开始');
    databus.screenWidth = SCREEN_WIDTH;
    databus.screenHeight = SCREEN_HEIGHT;
    console.log('[GameEngine] 屏幕尺寸: ' + SCREEN_WIDTH + 'x' + SCREEN_HEIGHT);

    // 安全区：避开状态栏 + 微信胶囊按钮
    try {
      var menuBtn = wx.getMenuButtonBoundingClientRect();
      databus.safeTop = menuBtn.bottom + 8;
      console.log('[GameEngine] 安全区顶部: ' + databus.safeTop);
    } catch (e) {
      databus.safeTop = 28;
      console.log('[GameEngine] 安全区获取失败，使用默认值');
    }

    // 章节配置按需懒加载，在各引擎激活时读取，避免阻塞首帧渲染

    // 菜单输入处理始终注册（返回主菜单时能响应按钮）
    this.setupMenuInput();

    // 应用 LoadingManager 预加载的云端数据（替代原 _syncFromCloud + _syncCloudLevels）
    this._applyPreloadedPlayerData();
    this._applyPreloadedCloudLevels();

    // 始终进入主菜单（已移除"第1关自动进关"特殊处理，不再做任何关卡判断）
    databus.gameState = 'menu';
    this._hasLeftMenu = false;
    this._menuVisible = true;   // 主菜单可见，离场时应播放出场动画
    console.log('[GameEngine] 设置 gameState=menu（启动即主菜单）');
    console.log('[GameEngine] start() 完成');
  }

  _syncFromCloud() {
    console.log('[cloud] === _syncFromCloud 开始，准备拉取玩家数据 ===');
    var self = this;
    cloud.getPlayerData().then(function(res) {
      console.log('[cloud] cloud.getPlayerData 成功回调，res.code=' + (res && res.code) + '，有data=' + !!(res && res.data));
      if (!res || res.code !== 0 || !res.data) {
        console.log('[cloud] 无云端存档或拉取失败，沿用本地数据');
        return;
      }
      var cloudData = res.data;
      var cloudLI = cloudData.lastLevelIndex;
      var localRaw = wx.getStorageSync('lastLevelIndex');
      var localLI = (localRaw !== '' && localRaw !== undefined && localRaw !== null)
        ? parseInt(localRaw, 10) : -1;
      if (typeof cloudLI === 'number' && cloudLI > localLI) {
        console.log('[cloud] 云端进度更新: lastLevelIndex ' + localLI + ' → ' + cloudLI);
        wx.setStorageSync('lastLevelIndex', cloudLI);
      }
      // 金币：本地与云端取最大值（以多者为准，防止任一侧数据落后）
      if (typeof cloudData.gold === 'number') {
        GoldSystem.mergeFromCloud(cloudData.gold);
        console.log('[cloud] 云端金币同步(取最大值): ' + cloudData.gold);
      }
      // 合并皮肤数据（云端优先覆盖本地）
      if (cloudData.skins) {
        SkinSystem.mergeFromCloud(cloudData.skins);
      }
      // 云端头像昵称 > 本地缓存
      if (cloudData.avatarUrl && cloudData.nickname) {
        var cached = wx.getStorageSync('userinfo_cache') || {};
        if (!cached.avatarUrl && cloudData.avatarUrl) {
          wx.setStorageSync('userinfo_cache', {
            nickName: cloudData.nickname,
            avatarUrl: cloudData.avatarUrl
          });
        }
      }
      // 星级：云端合并到本地（按关卡 key 取最高），有变化时回写云端保持权威
      if (cloudData.stars) {
        var starChanged = self._mergeLevelStarsFromCloud(cloudData.stars);
        if (starChanged) {
          cloud.savePlayerData({ stars: wx.getStorageSync('levelStars') }).catch(function (e) {
            console.warn('[cloud] 星级回写失败（非阻塞）:', e && e.message);
          });
        }
      }
      console.log('[cloud] 云端数据同步完成（启动即主菜单，不再自动进关）');
    }).catch(function(err) {
      console.warn('[cloud] 拉取云端数据失败（非阻塞）:', err && err.message);
    });
  }

  /**
   * 将云端星级合并到本地（按关卡 key 取最大值），返回是否发生了变化。
   * 星级结构：{ [levelName]: bestStar }，本地存储 key = 'levelStars'
   */
  _mergeLevelStarsFromCloud(cloudStars) {
    if (!cloudStars || typeof cloudStars !== 'object') return false;
    var local = wx.getStorageSync('levelStars');
    if (typeof local !== 'object' || local === null) local = {};
    var changed = false;
    Object.keys(cloudStars).forEach(function (key) {
      var c = cloudStars[key];
      if (typeof c === 'number' && c > (local[key] || 0)) {
        local[key] = c;
        changed = true;
      }
    });
    if (changed) {
      wx.setStorageSync('levelStars', local);
      console.log('[cloud] 云端星级合并到本地(取最高): ' + JSON.stringify(cloudStars));
    }
    return changed;
  }

  // 异步从云端拉取关卡范围和章节配置（fire-and-forget，不阻塞启动）
  _syncCloudLevels() {
    var self = this;
    console.log('[cloud] _syncCloudLevels 开始拉取云端关卡范围...');
    // 拉取云端已发布关卡范围
    cloud.listLevels().then(function(range) {
      console.log('[cloud] _syncCloudLevels cloud.listLevels() 返回: range=' + JSON.stringify(range)
        + ', typeof range.maxLevel=' + (range ? typeof range.maxLevel : 'N/A'));
      if (range && range.maxLevel > 0) {
        var prevMax = databus._cloudMaxLevel;
        databus._cloudMaxLevel = range.maxLevel;
        console.log('[cloud] _syncCloudLevels 云端关卡范围就绪: ' + range.minLevel + '~' + range.maxLevel
          + ' (之前 _cloudMaxLevel=' + prevMax + ')');
      } else {
        console.log('[cloud] _syncCloudLevels 云端无已发布关卡或无数据 (range=' + JSON.stringify(range) + ')');
      }
    }).catch(function(err) {
      console.warn('[cloud] listLevels 异常（非阻塞）:', err && err.message);
    });
  }

  // ===== 用户信息预加载（loading 阶段异步拉取，不阻塞） =====

  _prefetchUserInfo() {
    var self = this;
    // 先检查是否有缓存
    var cached = null;
    try { cached = wx.getStorageSync('userinfo_cache'); } catch (e) {}
    if (cached && cached.avatarPath) {
      console.log('[LOG_victory] 用户信息已有缓存 (avatarPath=' + cached.avatarPath + ')');
      return;
    }
    console.log('[LOG_victory] 开始异步预加载用户信息...');
    // 异步拉取
    wx.getUserInfo({
      success: function (res) {
        var info = res.userInfo || {};
        var avatarUrl = info.avatarUrl || '';
        var nickName = info.nickName || '';
        if (!avatarUrl) {
          console.log('[GameEngine] getUserInfo 无头像URL');
          return;
        }
        wx.downloadFile({
          url: avatarUrl,
          success: function (dfRes) {
            if (dfRes.statusCode === 200) {
              var cache = { avatarUrl: avatarUrl, nickName: nickName, avatarPath: dfRes.tempFilePath };
              try { wx.setStorageSync('userinfo_cache', cache); } catch (e) {}
              console.log('[LOG_victory] 用户头像已缓存: avatarUrl=' + avatarUrl + ' path=' + dfRes.tempFilePath);
            }
          },
          fail: function () {
            console.log('[GameEngine] 头像下载失败');
          }
        });
      },
      fail: function () {
        console.log('[GameEngine] getUserInfo 失败');
      }
    });
  }

  // ===== 应用预加载的云端数据（代替原异步 _syncFromCloud） =====

  _applyPreloadedPlayerData() {
    var pkg = this._preloadedPlayerData;
    if (!pkg) {
      console.log('[GameEngine] 无预加载玩家数据，沿用本地');
      return;
    }
    var cloudData = pkg.data;
    var serverVersion = pkg.version;
    if (!cloudData) {
      // 版本一致（或新玩家无存档）：无需合并，仅同步本地版本号
      if (typeof serverVersion === 'number') {
        try { wx.setStorageSync('playerVersion', serverVersion); } catch (e) {}
      }
      console.log('[GameEngine] 云端版本一致，跳过合并（localVersion=' + serverVersion + '）');
      return;
    }
    console.log('[GameEngine] 合并预加载玩家数据...');

    // lastLevelIndex：云端 > 本地（换设备恢复进度）
    var cloudLI = cloudData.lastLevelIndex;
    var localRaw = wx.getStorageSync('lastLevelIndex');
    var localLI = (localRaw !== '' && localRaw !== undefined && localRaw !== null)
      ? parseInt(localRaw, 10) : -1;
    if (typeof cloudLI === 'number' && cloudLI > localLI) {
      console.log('[cloud][GameEngine] 云端进度更新: lastLevelIndex ' + localLI + ' → ' + cloudLI);
      wx.setStorageSync('lastLevelIndex', cloudLI);
    }

    // 金币：取云端和本地最大值（不覆盖）
    if (typeof cloudData.gold === 'number') {
      var merged = GoldSystem.mergeFromCloud(cloudData.gold);
      console.log('[cloud][GameEngine] 云端金币合并: cloud=' + cloudData.gold + ' local=' + GoldSystem.getGold() + ' → ' + merged);
    }

    // 合并皮肤数据
    if (cloudData.skins) {
      SkinSystem.mergeFromCloud(cloudData.skins);
    }

    // 云端头像昵称 > 本地缓存
    if (cloudData.avatarUrl && cloudData.nickname) {
      var cached = wx.getStorageSync('userinfo_cache') || {};
      if (!cached.avatarUrl && cloudData.avatarUrl) {
        wx.setStorageSync('userinfo_cache', {
          nickName: cloudData.nickname,
          avatarUrl: cloudData.avatarUrl
        });
      }
    }
    // 星级：云端合并到本地（按关卡 key 取最高），有变化时回写云端保持权威
    if (cloudData.stars) {
      var starChanged = this._mergeLevelStarsFromCloud(cloudData.stars);
      if (starChanged) {
        cloud.savePlayerData({ stars: wx.getStorageSync('levelStars') }).catch(function (e) {
          console.warn('[cloud] 星级回写失败（非阻塞）:', e && e.message);
        });
      }
    }
    // 合并完成后同步本地版本号，避免下次启动重复整包拉取
    if (typeof serverVersion === 'number') {
      try { wx.setStorageSync('playerVersion', serverVersion); } catch (e) {}
    }
    console.log('[GameEngine] 预加载玩家数据合并完成（已同步 localVersion=' + serverVersion + '）');
  }

  _applyPreloadedCloudLevels() {
    var range = this._preloadedCloudRange;
    if (range && range.maxLevel > 0) {
      var prevMax = databus._cloudMaxLevel;
      databus._cloudMaxLevel = range.maxLevel;
      console.log('[cloud][GameEngine] 预加载云端关卡范围: ' + range.minLevel + '~' + range.maxLevel
        + ' (之前=' + prevMax + ')');

    } else {
      console.log('[cloud][GameEngine] 无预加载云端关卡范围');
    }
  }

  // ========== 设计常量 ==========
  // 黏土拟态颜色体系 (Claymorphism — 小猪推推乐品牌色)
  get COLORS() {
    return {
      primary: '#EC4899',      // 蜜桃粉 — 主按钮
      primaryDark: '#DB2777',   // 深粉 — 按钮底部
      secondary: '#FFFFFF',     // 白色 — 次按钮底色
      accent: '#F59E0B',        // 金色 — 强调数字/通关
      bgTop: '#F0EAFA',         // 天空渐变顶 — 淡紫
      bgMid: '#FDE8EF',         // 天空渐变中 — 浅粉
      bgBottom: '#FDF2F8',      // 天空渐变底 — 米粉
      cardBg: '#FFFFFF',        // 卡片底色
      textDark: '#0F172A',      // 深色文字
      textMuted: '#94A3B8',     // 灰色文字
      borderLight: '#F9D8E6',   // 浅粉边框
      shadowPink: 'rgba(236, 72, 153, 0.35)',  // 粉色投影
      shadowPinkLight: 'rgba(236, 72, 153, 0.12)', // 浅粉投影
    };
  }

  // ========== Canvas 绘图工具 ==========

  /**
   * 画黏土拟态主按钮（Claymorphism CTA）
   * 双层阴影：外扩散投影 + 内高光，营造 3D 立体手感
   */
  drawClayButton(x, y, w, h, r) {
    var C = this.COLORS;

    // 第1层：外扩散投影（tinted outer shadow）
    ctx.save();
    ctx.shadowColor = C.shadowPink;
    ctx.shadowBlur = 20;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 8;
    this.roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = C.primary;
    ctx.fill();
    ctx.restore();

    // 第2层：深压感阴影（近身紧贴投影）
    ctx.save();
    ctx.shadowColor = 'rgba(236, 72, 153, 0.18)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 4;
    this.roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = C.primary;
    ctx.fill();
    ctx.restore();

    // 第3层：主体填充 + 内高光
    // 底部稍深，模拟体积
    var bottomGrad = ctx.createLinearGradient(0, y + h * 0.3, 0, y + h);
    bottomGrad.addColorStop(0, 'rgba(219, 39, 119, 0)');   // 透明
    bottomGrad.addColorStop(1, 'rgba(219, 39, 119, 0.4)');  // 深粉40%

    this.roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = C.primary;
    ctx.fill();

    this.roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = bottomGrad;
    ctx.fill();

    // 内高光（顶部白色描边，模拟3D凸起）
    ctx.save();
    this.roundRect(ctx, x, y, w, h, r);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 2;
    this.roundRect(ctx, x + 2, y + 2, w - 4, h - 4, r - 1);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * 画黏土拟态次按钮（白底 + 粉色边框 + 柔投影）
   */
  drawClaySecondary(x, y, w, h, r) {
    var C = this.COLORS;

    // 柔投影
    ctx.save();
    ctx.shadowColor = C.shadowPinkLight;
    ctx.shadowBlur = 12;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 4;
    this.roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = C.secondary;
    ctx.fill();
    ctx.restore();

    // 主体白色填充
    this.roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = C.secondary;
    ctx.fill();

    // 内高光
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 1;
    this.roundRect(ctx, x + 2, y + 2, w - 4, h - 4, r - 1);
    ctx.stroke();

    // 外边框（粉色3px厚描边 — 黏土拟态特征）
    this.roundRect(ctx, x, y, w, h, r);
    ctx.strokeStyle = C.borderLight;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  /**
   * 画统计数字卡片
   */
  drawScoreCard(x, y, w, h, r) {
    var C = this.COLORS;

    // 柔投影
    ctx.save();
    ctx.shadowColor = 'rgba(236, 72, 153, 0.08)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 3;
    this.roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = C.cardBg;
    ctx.fill();
    ctx.restore();

    // 白色卡片主体
    this.roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = C.cardBg;
    ctx.fill();

    // 微内高光
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1;
    this.roundRect(ctx, x + 2, y + 2, w - 4, h - 4, r - 1);
    ctx.stroke();
  }

  /**
   * 画底部图标按钮（图标 + 文字标签）
   */
  drawIconBtn(x, y, iconSize, emoji, label) {
    var C = this.COLORS;

    // 图标圆形背景
    var cx = x + iconSize / 2;
    var cy = y + iconSize / 2;

    ctx.save();
    ctx.shadowColor = 'rgba(236, 72, 153, 0.08)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, iconSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = C.cardBg;
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(cx, cy, iconSize / 2, 0, Math.PI * 2);
    ctx.fillStyle = C.cardBg;
    ctx.fill();

    // Emoji
    ctx.fillStyle = '#333';
    ctx.font = Math.round(iconSize * 0.45) + 'px ' + Theme.font.family;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, cx, cy);

    // 标签文字
    if (label) {
      ctx.fillStyle = C.textMuted;
      ctx.font = 'bold 11px ' + Theme.font.family + '';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(label, cx, cy + iconSize / 2 + 6);
    }

    // 返回整个按钮的碰撞区域
    return { x: x, y: y, w: iconSize, h: iconSize + 22 };
  }

  /**
   * 画设置按钮 — 纯代码绘制（圆形底 + 矢量齿轮），委托 drawSettingsButton
   */
  _drawSettingsBtn(x, y, iconSize) {
    return drawSettingsButton(ctx, x, y, iconSize);
  }

  /**
   * 画猪鼻子 Logo
   */
  drawPigNoseLogo(cx, cy, size) {
    var C = this.COLORS;

    // Logo 圆角方形背景（渐变色）
    var r = size * 0.28;
    ctx.save();
    ctx.shadowColor = 'rgba(236, 72, 153, 0.2)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 6;
    var grad = ctx.createLinearGradient(cx, cy - size / 2, cx, cy + size / 2);
    grad.addColorStop(0, '#FFC3D8');
    grad.addColorStop(1, '#EC4899');
    this.roundRect(ctx, cx - size / 2, cy - size / 2, size, size, r);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();

    // 立体感：底部加深 + 顶部高光
    var bottomGrad = ctx.createLinearGradient(0, cy - size * 0.1, 0, cy + size / 2);
    bottomGrad.addColorStop(0, 'rgba(219, 39, 119, 0)');
    bottomGrad.addColorStop(1, 'rgba(219, 39, 119, 0.35)');
    this.roundRect(ctx, cx - size / 2, cy - size / 2, size, size, r);
    ctx.fillStyle = bottomGrad;
    ctx.fill();

    // 顶部高光
    ctx.save();
    this.roundRect(ctx, cx - size / 2, cy - size / 2, size, size, r);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 2;
    this.roundRect(ctx, cx - size / 2 + 2, cy - size / 2 + 2, size - 4, size - 4, r - 1);
    ctx.stroke();
    ctx.restore();

    // 猪鼻子本体（椭圆）
    var noseW = size * 0.55;
    var noseH = size * 0.35;
    ctx.fillStyle = '#F472B6';
    ctx.beginPath();
    ctx.ellipse(cx, cy, noseW / 2, noseH / 2, 0, 0, Math.PI * 2);
    ctx.fill();

    // 鼻孔（两个深粉色圆）
    var nostrilR = size * 0.065;
    var nostrilGap = size * 0.13;
    ctx.fillStyle = '#BE185D';
    ctx.beginPath();
    ctx.arc(cx - nostrilGap, cy, nostrilR, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + nostrilGap, cy, nostrilR, 0, Math.PI * 2);
    ctx.fill();

    // 鼻孔高光点
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.beginPath();
    ctx.arc(cx - nostrilGap - 1, cy - 2, nostrilR * 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + nostrilGap - 1, cy - 2, nostrilR * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }

  // ========== 菜单 ==========

  /**
   * "开始游戏"：直接读取上次游玩的关卡并开始
   */
  startLastLevel() {
    var totalLevels = this._getTotalLevelCount();
    if (totalLevels === 0) {
      showToast('没有关卡', 1500);
      return;
    }

    // 读取上次关卡索引，开始下一关（lastLevelIndex 是已完成关卡）
    var levelIndex = 0;
    try {
      var saved = wx.getStorageSync('lastLevelIndex');
      if (saved !== '' && saved !== undefined && saved !== null) {
        levelIndex = Math.min(parseInt(saved, 10) + 1, totalLevels - 1);
        levelIndex = Math.max(levelIndex, 0);
      }
    } catch (e) {
      levelIndex = 0;
    }

    var lv = this._getLevelEntry(levelIndex);
    databus.currentLevel = { name: lv.name, data: null };
    databus.currentLevelIndex = levelIndex;
    databus.returnState = 'menu';
    this._leaveMenu('playing');   // 菜单可见则播出场动画，否则直接进关

    // 同步 databus.projectLevels（PlayingEngine 下一关/重玩依赖）
    this._buildProjectLevels(totalLevels);
  }

  /**
   * 按索引直接进关（地图点击已通关关卡用）。
   * consumeStamina 预留参数；目前旧关不消耗体力，故调用方传 false。
   * 流程与 startLastLevel 一致：写 currentLevel → 出场动画（并行加载关卡）→ playing。
   */
  startLevelByIndex(levelIndex, consumeStamina) {
    if (this._stamina.isFlying() || this._staminaEmbed) return;
    var total = this._getTotalLevelCount();
    if (levelIndex < 0 || levelIndex >= total) return;

    var lv = this._getLevelEntry(levelIndex);
    databus.currentLevel = { name: lv.name, data: null };
    databus.currentLevelIndex = levelIndex;
    databus.returnState = 'menu';
    this._leaveMenu('playing');              // 菜单可见则播出场动画，否则直接进关
    this._buildProjectLevels(total);         // 同步 databus.projectLevels（下一关/重玩依赖）
  }

  /** 读取本地+云端合并后的总关卡数 */
  _getTotalLevelCount() {
    var localMax = 0;
    try {
      var fs = wx.getFileSystemManager();
      var indexRaw = fs.readFileSync('assets/levels/index.json', 'utf8');
      var indexData = JSON.parse(indexRaw);
      if (typeof indexData.maxLevel === 'number') localMax = indexData.maxLevel;
      else if (Array.isArray(indexData)) localMax = indexData.length;
    } catch (e) {
      console.warn('[GameEngine] 读取 index.json 失败:', e);
    }
    var cloudMax = databus._cloudMaxLevel || 0;
    return Math.max(localMax, cloudMax);
  }

  /** 根据总关卡数构建 projectLevels 数组 */
  _buildProjectLevels(totalLevels) {
    databus.projectLevels = [];
    for (var i = 0; i < totalLevels; i++) {
      var name = String(i + 1).padStart(4, '0');
      databus.projectLevels.push({ name: name, file: name + '.json' });
    }
  }

  /** 根据 0-based 索引生成关卡入口 */
  _getLevelEntry(levelIndex) {
    var name = String(levelIndex + 1).padStart(4, '0');
    return { name: name, file: name + '.json' };
  }

  setupMenuInput() {
    var self = this;
    this.input.on('menu', (e) => {
      // ===== 模态面板优先（BUG 修复）=====
      // 任一面板打开时，整屏触控交给面板处理，地图手势【不可】拦截——
      // 否则面板居中显示在「非控件区」时，_menuTouchHitControl 命中失败 → 触摸被误判为地图滚动手势，
      // 导致设置面板上的按钮全部点不到。故所有面板检查必须位于关卡地图手势闸门之前。
      if (ShopPanel.isOpen()) {
        var t0 = e.touches && e.touches[0];
        ShopPanel.handleEvent({ type: e.type, x: t0 ? t0.x : 0, y: t0 ? t0.y : 0 });
        return;
      }
      if (StaminaAdPanel.isOpen()) {
        var t1 = e.touches && e.touches[0];
        if (t1) StaminaAdPanel.handleTouch(t1.x, t1.y, e.type);
        return;
      }
      if (settingsPanel.isOpen()) {
        var t2 = e.touches && e.touches[0];
        if (t2) settingsPanel.handleTouch(t2.x, t2.y, e.type);
        return;
      }

      // 关卡地图模式（仅在所有面板均关闭时生效）：控件区域交给 clay 菜单（保留原功能），
      // 空白/路径区域交给地图滚动（拖拽 + 惯性）。
      if (this._useLevelMap && this._levelMap) {
        if (e.type === 'touchstart' && e.touches && e.touches[0]) {
          var tt = e.touches[0];
          this._levelMapGesture = !this._menuTouchHitControl(tt.x, tt.y);
        }
        if (this._levelMapGesture) {
          this._levelMap.handleEvent(e);
          return;
        }
        // 落在控件上 → 继续走下方 clay 菜单原有逻辑
      }

      if (e.type === 'touchstart' && e.touches[0]) {
        var t = e.touches[0];

        // 左下角 100x100 快速 5 连击 → 解锁后门按钮（编辑 + 调试）
        // 若点击落在底部圆形功能按钮上，则交给按钮逻辑，不触发角落彩蛋
        var onRoundBtn = (this._dressBtnRect && t.x >= this._dressBtnRect.x && t.x <= this._dressBtnRect.x + this._dressBtnRect.w &&
                          t.y >= this._dressBtnRect.y && t.y <= this._dressBtnRect.y + this._dressBtnRect.h) ||
                         (this._challengeBtnRect && t.x >= this._challengeBtnRect.x && t.x <= this._challengeBtnRect.x + this._challengeBtnRect.w &&
                          t.y >= this._challengeBtnRect.y && t.y <= this._challengeBtnRect.y + this._challengeBtnRect.h);
        if (!onRoundBtn) {
        var cornerW = 100;
        var cornerH = 100;
        var cornerX = 0;
        var cornerY = SCREEN_HEIGHT - cornerH;
        if (t.x >= cornerX && t.x <= cornerX + cornerW &&
            t.y >= cornerY && t.y <= cornerY + cornerH) {
          this._cornerTapCount++;
          if (this._cornerTapTimer) clearTimeout(this._cornerTapTimer);
          this._cornerTapTimer = setTimeout(function () {
            self._cornerTapCount = 0;
          }, 1500);  // 1.5 秒内连击，否则重置
          if (this._cornerTapCount >= 5 && !this._editorUnlocked) {
            this._editorUnlocked = true;
            databus.debugUnlocked = true;
            this._cornerTapCount = 0;
            clearTimeout(this._cornerTapTimer);
            showToast('编辑器已解锁', 1200);
          }
          return;  // 角落点击不触发按钮
        }
        }

        // 按钮点击
        for (var i = 0; i < this.menuButtons.length; i++) {
            var btn = this.menuButtons[i];
            if (t.x >= btn.x && t.x <= btn.x + btn.w &&
                t.y >= btn.y && t.y <= btn.y + btn.h) {
              // 元素入场动画未完成前，忽略点击（不发声、不按压、不触发）
              if (btn.key && !this._isEntranceDone(btn.key)) {
                return;
              }
              audio.play('button_click');
              // 按钮按压动画
              this._pressedBtnIdx = i;
              this._pressedBtnTime = Date.now();
              if (btn.action) btn.action();
              return;
            }
          }
      }

      // 手抬起
      if (e.type === 'touchend') {
        // 取消按钮按压
      } else if (e.type === 'touchmove') {
        // 移动中
      }
    });
  }

  /**
   * 判断某次触摸是否落在主界面控件上（按钮 / 左下角彩蛋区）。
   * 关卡地图模式下用于区分「滚动手势」与「点击控件」：落在控件上交给 clay 菜单，
   * 落在空白/路径上交给地图滚动。控件矩形取自每帧重建的 this.menuButtons。
   */
  _menuTouchHitControl(x, y) {
    var btns = this.menuButtons;
    if (btns) {
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return true;
      }
    }
    // 左下角彩蛋区（保留原功能，不能让地图滚动吃掉）
    if (x >= 0 && x <= 100 && y >= SCREEN_HEIGHT - 100 && y <= SCREEN_HEIGHT) return true;
    return false;
  }

  /**
   * 指定菜单元素入场动画是否已完成
   * 未完成前该按钮不可点击；数据源 MENU_ENTRANCE[key].stagger + dur
   */
  _isEntranceDone(key) {
    if (!this._menuEntrance || this._menuEntrance.phase !== 'slideIn') return true;
    var cfg = MENU_ENTRANCE[key];
    if (!cfg) return true;
    var elapsed = Date.now() - this._menuEntrance.startTime;
    return elapsed >= cfg.stagger + cfg.dur;
  }

  /**
   * 主菜单入场动画：根据元素 key 返回 {dx, dy, scale, alpha}
   * stagger 错开入场，ease-out cubic（play 用 easeOutBack）
   */
  _getEntranceTransform(key) {
    if (!this._menuEntrance || this._menuEntrance.phase !== 'slideIn') {
      return { dx: 0, dy: 0, scale: 1, alpha: 1 };
    }

    var cfg = MENU_ENTRANCE[key];
    if (!cfg) {
      return { dx: 0, dy: 0, scale: 1, alpha: 1 };
    }
    var from = cfg.from;
    var stagger = cfg.stagger;
    var dur = cfg.dur;
    var elapsed = Date.now() - this._menuEntrance.startTime;

    if (elapsed < stagger) {
      return { dx: from.dx, dy: from.dy, scale: from.scale, alpha: from.alpha };
    }

    var t = (elapsed - stagger) / dur;
    t = Math.max(0, Math.min(1, t));
    var ease = cfg.ease === 'back' ? Easing.easeOutBack(t, 1.7) : Easing.easeOutCubic(t);

    return {
      dx: from.dx * (1 - ease),
      dy: from.dy * (1 - ease),
      scale: from.scale + (1 - from.scale) * ease,
      alpha: from.alpha + (1 - from.alpha) * ease,
    };
  }

  /**
   * 菜单元素变换统一入口：出场动画进行中（任一阶段）返回整体下移渐隐变换，否则返回入场变换。
   * renderMenu 6 处调用均走这里，无需各自判断状态。
   */
  _getMenuTransform(key) {
    if (this._menuExit) {
      return this._getExitTransform(key);
    }
    return this._getEntranceTransform(key);
  }

  /**
   * 主菜单出场动画：底部区域（底部条 + 开始按钮 + 左下/右下双圆钮，视觉上连成一片）
   * 整体向下移出屏幕 + 渐隐；其余元素（设置/体力）原地渐隐、不下移。
   * 按 key 区分：仅 BOTTOM_KEYS 下滑，其余 dy=0 仅 alpha 渐隐。
   * 返回 { dx, dy, scale, alpha }。
   */
  _getExitTransform(key) {
    var elapsed = Date.now() - this._menuExit.startTime;
    var p = Math.min(1, elapsed / MENU_EXIT_DURATION);
    var dy = MENU_EXIT_BOTTOM_KEYS[key] ? SCREEN_HEIGHT * p : 0;
    return {
      dx: 0,
      dy: dy,
      scale: 1,
      alpha: 1 - p,
    };
  }

  /**
   * 触发主菜单出场动画（整体下移+渐隐），结束后由 update() 提交状态切换。
   * @param {string} target 目标状态 'playing' | 'editor'
   */
  _startMenuExit(target) {
    this._pressedBtnIdx = -1;   // 清按压态，出场过渡干净
    this._menuExit = {
      phase: 'slide',                 // slide → wait → crossfade → commit
      startTime: Date.now(),
      target: target,
      totalDuration: MENU_EXIT_DURATION,
      crossStart: 0,
      crossDuration: MENU_CROSSFADE_DURATION,
    };
    // 出场开始即并行加载关卡内容（重活在「菜单下滑」期间完成，避免切场景那一帧卡顿）
    if (target === 'playing') {
      this.playing.prepareLevel(databus.currentLevel ? databus.currentLevel.name : '');
    }
  }

  /** 提交菜单出场：切状态 +（playing）启动关卡入场；不空一帧。 */
  _commitMenuExit(targetState) {
    this._menuExit = null;
    this._menuVisible = false;
    this._hasLeftMenu = true;
    databus.gameState = targetState;
    if (targetState === 'playing') {
      this.playing.beginEntrance();   // 关卡背景已在交叉淡变中显示，现在启动棋盘/猪/UI 入场
    }
    this.checkStateTransition();      // 激活 playing/editor
  }

  /**
   * 离开主菜单：菜单可见时播放出场动画；否则直接切换（如启动即自动进关，菜单从未显示）。
   * @param {string} target 目标状态 'playing' | 'editor'
   */
  _leaveMenu(target) {
    if (this._menuVisible && databus.gameState === 'menu' && !this._menuExit) {
      this._startMenuExit(target);
    } else {
      this._hasLeftMenu = true;
      databus.gameState = target;
    }
  }

  renderMenu() {
    var C = this.COLORS;
    var safeTop = databus.safeTop;
    var cx = SCREEN_WIDTH / 2;

    // 砸中目标的全局冲击抖动：整段菜单（含按钮/体力 UI/面板）一起抖，强化"砸"的爽感
    ctx.save();
    var _impact = this._getImpactShake();
    if (_impact) ctx.translate(_impact.x, _impact.y);

    // ===== 底部功能区域背景（stretched，最底层，在所有按钮之下）=====
    // 底部条入场：上移 + 渐显（t=500 起）
    var barT = this._getMenuTransform('bottomBar');
    ctx.save();
    ctx.globalAlpha = barT.alpha;
    if (barT.dy !== 0) ctx.translate(0, barT.dy);
    var bottomBar = drawBottomBar.drawMenuBottomBar(ctx);
    ctx.restore();
    var _dressRect = null, _challengeRect = null;
    if (bottomBar) {
      var _btSize = 58 * bottomBar.scale;
      var _dPos = drawBottomBar.figmaToScreen(bottomBar, 303, 721);
      var _cPos = drawBottomBar.figmaToScreen(bottomBar, 32, 721);
      _dressRect = { x: _dPos.x, y: _dPos.y, w: _btSize, h: _btSize };
      _challengeRect = { x: _cPos.x, y: _cPos.y, w: _btSize, h: _btSize };
      this._dressBtnRect = _dressRect;
      this._challengeBtnRect = _challengeRect;
    }

    // 计算按钮按压缩放（menuButtons 顺序：0=play 1=settings 2=dress 3=challenge 4=editor 5=debug）
    var pressScale = this._getBtnPressScale();
    var mainScale = this._pressedBtnIdx === 0 ? pressScale : 1;
    var setScale   = this._pressedBtnIdx === 1 ? pressScale : 1;
    var dressPress = this._pressedBtnIdx === 2 ? pressScale : 1;
    var challengePress = this._pressedBtnIdx === 3 ? pressScale : 1;
    var editScale  = this._pressedBtnIdx === 4 ? pressScale : 1;
    var debugScale = this._pressedBtnIdx === 5 ? pressScale : 1;

    // ===== Frame A（对齐参考，不可见）=====
    var frameA_Y = safeTop - 48;

    // ===== 设置按钮（Frame A 内，left: 16px, top: 6px）=====
    var setIconSize = 42;
    var setBtnX = 10;
    var setBtnY = frameA_Y + 6;
    var setBtnCX = setBtnX + setIconSize / 2;
    var setBtnCY = setBtnY + setIconSize / 2;

    // 入场动画
    var st = this._getMenuTransform('settings');
    ctx.save();
    ctx.translate(setBtnCX + st.dx, setBtnCY + st.dy);
    ctx.scale(setScale, setScale);
    ctx.translate(-(setBtnCX + st.dx), -(setBtnCY + st.dy));
    ctx.globalAlpha = st.alpha;
    var setAreaRaw = this._drawSettingsBtn(setBtnX + st.dx, setBtnY + st.dy, setIconSize);
    var setArea = { x: setBtnX, y: setBtnY, w: setAreaRaw.w, h: setAreaRaw.h };
    ctx.restore();

    // （体力 UI 改到底部居中，绘制见开始按钮之后）

    // ===== 主按钮：开始游戏（main_start.png 图片按钮）=====
    // Figma Group 3467419: 180 x 86，水平居中（left: calc(50% - 180/2 - 0.5)），bottom 距屏幕底 65px（基于 393 宽设计稿等比缩放）
    var startScale = SCREEN_WIDTH / 393;
    this._startScale = startScale;
    var startW = 180 * startScale;
    var startH = 86 * startScale;
    var startX = (SCREEN_WIDTH - startW) / 2 - 0.5 * startScale;
    var startY = SCREEN_HEIGHT - 65 * startScale - startH;
    var startCX = startX + startW / 2;
    var startCY = startY + startH / 2;

    var playT = this._getMenuTransform('play');
    var shakeDx = this._getStaminaShakeDx();
    ctx.save();
    ctx.globalAlpha = playT.alpha;
    // 围绕按钮中心：按压缩放 × 入场缩放（easeOutBack 回弹）
    ctx.translate(startCX, startCY);
    ctx.scale(mainScale * playT.scale, mainScale * playT.scale);
    ctx.translate(-startCX, -startCY);
    if (playT.dy !== 0) {
      ctx.translate(0, playT.dy);
    }
    if (shakeDx !== 0) {
      ctx.translate(shakeDx, 0);   // 体力不足：按钮滋滋抖
    }

    if (AssetPreloader.isReady('main_start')) {
      ctx.drawImage(AssetPreloader.get('main_start'), startX, startY, startW, startH);
    }
    // 开始按钮上的无体力标志位：跟随开始按钮一起入场/出场（alpha 渐显 + 缩放回弹 + 下移 + 抖）
    this._drawStaminaFlag(ctx, startScale);
    ctx.restore();

    this._playBtnRect = { x: startX, y: startY, w: startW, h: startH };

    // ===== 体力 UI（底部居中 5 图标 + 开始按钮上的无体力标志位）=====
    var staT = this._getMenuTransform('stamina');
    ctx.save();
    ctx.globalAlpha *= staT.alpha;
    if (staT.dy !== 0) ctx.translate(0, staT.dy);   // 离场时随底部整体下滑（与开始按钮同批）
    // 底部 5 个体力图标（绘制在按钮之上，避免被按钮图遮挡）
    this._renderStaminaUI(ctx, shakeDx);
    ctx.restore();

    // ===== 后门按钮（右下角，5 连击解锁后显示）=====
    var editArea = null;
    var debugArea = null;
    if (this._editorUnlocked) {
      var dbgBtnW = 76;
      var dbgBtnH = 34;
      var dbgGap = 8;
      var dbgPadding = 12;
      // 编辑在左，调试在右
      var debugBtnX = SCREEN_WIDTH - dbgPadding - dbgBtnW;
      var debugBtnY = SCREEN_HEIGHT - dbgPadding - dbgBtnH;
      var editBtnX = debugBtnX - dbgGap - dbgBtnW;
      var editBtnY = debugBtnY;

      // 编辑按钮（粉色文字，secondary 风格）
      ctx.save();
      ctx.translate(editBtnX + dbgBtnW / 2, editBtnY + dbgBtnH / 2);
      ctx.scale(editScale, editScale);
      ctx.translate(-(editBtnX + dbgBtnW / 2), -(editBtnY + dbgBtnH / 2));
      this.drawClaySecondary(editBtnX, editBtnY, dbgBtnW, dbgBtnH, 10);
      ctx.fillStyle = C.primary;
      ctx.font = 'bold 12px ' + Theme.font.family;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✏️ 编辑', editBtnX + dbgBtnW / 2, editBtnY + dbgBtnH / 2);
      ctx.restore();

      // 调试按钮（灰色文字，secondary 风格）
      ctx.save();
      ctx.translate(debugBtnX + dbgBtnW / 2, debugBtnY + dbgBtnH / 2);
      ctx.scale(debugScale, debugScale);
      ctx.translate(-(debugBtnX + dbgBtnW / 2), -(debugBtnY + dbgBtnH / 2));
      this.drawClaySecondary(debugBtnX, debugBtnY, dbgBtnW, dbgBtnH, 10);
      ctx.fillStyle = '#6B7280';
      ctx.font = 'bold 12px ' + Theme.font.family;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🔧 调试', debugBtnX + dbgBtnW / 2, debugBtnY + dbgBtnH / 2);
      ctx.restore();

      editArea = { x: editBtnX, y: editBtnY, w: dbgBtnW, h: dbgBtnH };
      debugArea = { x: debugBtnX, y: debugBtnY, w: dbgBtnW, h: dbgBtnH };
    }

    // ===== 注册按钮碰撞区域 =====
    var self = this;
    this.menuButtons = [
      { key: 'play', x: startX, y: startY, w: startW, h: startH, action: function() { self._onClickPlayBtn(); } },
      { key: 'settings', x: setArea.x, y: setArea.y, w: setArea.w, h: setArea.h,
        action: function() { settingsPanel.open({ title: '设置' }); }
      }
    ];

    // 底部圆形功能按钮（装扮 / 挑战赛）
    if (_dressRect) {
      this.menuButtons.push({
        key: 'dress',
        x: _dressRect.x, y: _dressRect.y, w: _dressRect.w, h: _dressRect.h,
        action: function() { ShopPanel.open(); }
      });
    }
    if (_challengeRect) {
      this.menuButtons.push({
        key: 'challenge',
        x: _challengeRect.x, y: _challengeRect.y, w: _challengeRect.w, h: _challengeRect.h,
        action: function() { self._onClickChallengeBtn(); }
      });
    }

    // 后门按钮（右下角，5 连击解锁后附加）
    if (editArea) {
      this.menuButtons.push({
        x: editArea.x, y: editArea.y, w: editArea.w, h: editArea.h,
        action: function() { self._leaveMenu('editor'); }
      });
    }
    if (debugArea) {
      this.menuButtons.push({
        x: debugArea.x, y: debugArea.y, w: debugArea.w, h: debugArea.h,
        action: function() { DebugPanel.toggle(); }
      });
    }

    // ===== 底部圆形功能按钮（装扮 / 挑战赛）绘制，位于各面板之下 =====
    // 入场：与开始按钮相同的「缩放回弹 + 渐显」，t=1260 同批出场
    if (bottomBar) {
      var _dBt = this._getMenuTransform('dress');
      var _cBt = this._getMenuTransform('challenge');
      var _dCx = this._dressBtnRect.x + this._dressBtnRect.w / 2;
      var _dCy = this._dressBtnRect.y + this._dressBtnRect.h / 2;
      var _cCx = this._challengeBtnRect.x + this._challengeBtnRect.w / 2;
      var _cCy = this._challengeBtnRect.y + this._challengeBtnRect.h / 2;

      // 阴影：左右两个按钮完全显示并稳定后，再延迟出现，避免与缩放回弹不同步 / 提前显示
      var _sideShadow = this._menuEntranceDoneAt && (Date.now() - this._menuEntranceDoneAt >= 120);

      // 装扮（右）
      ctx.save();
      ctx.globalAlpha = _dBt.alpha;
      ctx.translate(_dBt.dx, _dBt.dy);   // 出场时随底部整体下移（入场 dx/dy=0 无影响）
      ctx.translate(_dCx, _dCy);
      ctx.scale(_dBt.scale * dressPress, _dBt.scale * dressPress);
      ctx.translate(-_dCx, -_dCy);
      drawBottomBar.drawRoundMenuButton(ctx, this._dressBtnRect.x, this._dressBtnRect.y, this._dressBtnRect.w, '衣', _sideShadow, 'main_avatar_icon');
      ctx.restore();

      // 挑战赛（左）
      ctx.save();
      ctx.globalAlpha = _cBt.alpha;
      ctx.translate(_cBt.dx, _cBt.dy);   // 出场时随底部整体下移（入场 dx/dy=0 无影响）
      ctx.translate(_cCx, _cCy);
      ctx.scale(_cBt.scale * challengePress, _cBt.scale * challengePress);
      ctx.translate(-_cCx, -_cCy);
      drawBottomBar.drawRoundMenuButton(ctx, this._challengeBtnRect.x, this._challengeBtnRect.y, this._challengeBtnRect.w, '赛', _sideShadow, 'main_battle_icon');
      ctx.restore();
    }

    // 设置面板（最顶层）
    settingsPanel.render(ctx);

    // 商城面板（比设置面板更高一层）
    ShopPanel.render(ctx);

    // 体力飞行动画
    this._renderStaminaFly(ctx);

    // 体力不足广告弹窗
    StaminaAdPanel.render(ctx);

    ctx.restore();   // 关闭砸中冲击抖动的外层 save
  }

  // ========== 体力系统 UI ==========

  /** 计算体力 UI 布局（底部居中 5 图标 + 开始按钮无体力标志位），返回屏幕坐标 */
  _computeStaminaLayout() {
    var ST = require('../define/GameDefine.js').GAME.STAMINA;
    var scale = SCREEN_WIDTH / 393;
    var n = ST.MAX;
    var icon = 20 * scale;
    var gap = 4 * scale;
    var fw = n * icon + (n - 1) * gap;                 // 116 * scale
    var fl = (SCREEN_WIDTH - fw) / 2 + 1.5 * scale;     // left: calc(50% - 116/2 + 1.5)
    var fy = SCREEN_HEIGHT - 56 * scale - 20 * scale;   // bottom:56, height:20
    var iconRects = [];
    for (var i = 0; i < n; i++) {
      var ix = fl + i * (icon + gap);
      iconRects.push({ x: ix, y: fy, w: icon, h: 20 * scale, cx: ix + icon / 2, cy: fy + 10 * scale });
    }
    // 开始按钮（与 renderMenu 同一套计算）
    var startW = 180 * scale, startH = 86 * scale;
    var startX = (SCREEN_WIDTH - startW) / 2 - 0.5 * scale;
    var startY = SCREEN_HEIGHT - 65 * scale - startH;
    // 无体力标志位：开始按钮内，相对按钮 left:32（设计稿 393 宽，按 scale 缩放）、上下居中
    var flagW = 20 * scale, flagH = 20 * scale;
    var flagX = startX + 32 * scale;
    var flagY = startY + (startH - flagH) / 2;
    var flagRect = { x: flagX, y: flagY, w: flagW, h: flagH, cx: flagX + flagW / 2, cy: flagY + flagH / 2 };
    return { iconRects: iconRects, flagRect: flagRect, scale: scale, icon: icon };
  }

  /** 预加载体力图标（energy.png 有体力 / energy_empty.png 无体力） */
  _preloadStaminaIcons() {
    var self = this;
    var filled = wx.createImage();
    filled.onload = function () { self._staminaIcons.filled = filled; };
    filled.src = 'assets/images/energy.png';
    var empty = wx.createImage();
    empty.onload = function () { self._staminaIcons.empty = empty; };
    empty.src = 'assets/images/energy_empty.png';
  }

  /** 绘制单个体力图标（energy.png 有体力 / energy_empty.png 无体力；图片未就绪时回退纯色圆角方块） */
  _drawStaminaIcon(ctx, rect, filled, glow) {
    var x = rect.x, y = rect.y, w = rect.w, h = rect.h;
    var img = filled ? this._staminaIcons.filled : this._staminaIcons.empty;
    ctx.save();
    if (glow) {
      ctx.shadowColor = 'rgba(255,210,120,0.95)';
      ctx.shadowBlur = 16;
    }
    if (img) {
      ctx.drawImage(img, x, y, w, h);
    } else {
      // 兜底：图片尚未加载完成
      var r = Math.min(w * 0.3, Math.floor(w / 2), Math.floor(h / 2));
      ctx.fillStyle = filled ? '#FFEE00' : '#C16444';
      this.roundRect(ctx, x, y, w, h, r);
      ctx.fill();
    }
    ctx.restore();
  }

  /** 绘制开始按钮上的无体力标志位（始终红褐，作为体力插槽） */
  _drawStaminaFlag(ctx, scale) {
    var layout = this._computeStaminaLayout();
    this._drawStaminaIcon(ctx, layout.flagRect, false, false);
  }

  /** 体力不足抖动的水平偏移（阻尼正弦，滋滋抖几下） */
  _getStaminaShakeDx() {
    if (!this._staminaShake) return 0;
    var p = (Date.now() - this._staminaShake.startTime) / this._staminaShake.duration;
    if (p >= 1) return 0;
    var amp = 5 * (this._startScale || 1) * (1 - p);
    return Math.sin(p * Math.PI * 7) * amp;
  }

  /** 渲染底部居中体力 UI（5 图标，纯色圆角方块；体力不足时空格发光抖动） */
  _renderStaminaUI(ctx, shakeDx) {
    var ST = require('../define/GameDefine.js').GAME.STAMINA;
    var count = this._stamina.getCount();
    var layout = this._computeStaminaLayout();
    var iconRects = layout.iconRects;
    var flips = this._stamina.updateFlips();
    var flipMap = {};
    for (var fi = 0; fi < flips.length; fi++) flipMap[flips[fi].index] = flips[fi].progress;
    var shaking = !!this._staminaShake;
    var se = Date.now() - (this._staminaEntranceStart || 0);   // 逐枚入场基准时间

    for (var i = 0; i < ST.MAX; i++) {
      var rect = iconRects[i];
      var filled = i < count;
      var p = flipMap[i];
      var ent = this._getStaminaIconEntrance(i, se);   // { visible, dx, dy, scale, alpha }
      if (!ent.visible) continue;
      ctx.save();
      ctx.globalAlpha *= ent.alpha;
      // 围绕图标中心：落定位移 + 缩放回弹（"摆盘子"）
      ctx.translate(rect.cx + (shakeDx || 0) + ent.dx, rect.cy + ent.dy);
      ctx.scale(ent.scale, ent.scale);
      ctx.translate(-rect.cx, -rect.cy);
      if (p != null) {
        // 翻转动效：前半空图标缩小消失，后半黄图标放大出现
        if (p < 0.5) {
          ctx.scale(1 - p * 2, 1);
          this._drawStaminaIcon(ctx, { x: -rect.w / 2, y: -rect.h / 2, w: rect.w, h: rect.h }, false, false);
        } else {
          ctx.scale((p - 0.5) * 2, 1);
          this._drawStaminaIcon(ctx, { x: -rect.w / 2, y: -rect.h / 2, w: rect.w, h: rect.h }, true, false);
        }
      } else {
        var glow = shaking && !filled;   // 体力不足：空格子发光抖动
        this._drawStaminaIcon(ctx, rect, filled, glow);
      }
      ctx.restore();
    }
  }

  /**
   * 体力图标逐枚入场变换（"摆盘子"轨迹）：自上方落下、落定微回弹，按索引错开。
   * 返回 { visible, dx, dy, scale, alpha }；entrance 完成后返回 identity（visible:true, 全 1）。
   * 与 _menuEntrance 生命周期解耦——即使整体入场已结束，最后几枚仍能播完。
   */
  _getStaminaIconEntrance(i, se) {
    var local = se - STAMINA_ENTRANCE_BASE - i * STAMINA_ENTRANCE_STEP;
    if (local <= 0) return { visible: false };
    var t = Math.min(1, local / STAMINA_ENTRANCE_DUR);
    var ease = Easing.easeOutBack(t, 1.5);                 // 落定回弹
    var dy = -42 * (1 - ease);                            // 从上方落下 → 0（带微回弹）
    var scale = 0.65 + 0.35 * Easing.easeOutBack(t, 1.3); // 由小放大 + 落定过冲
    var alpha = Math.min(1, t / 0.4);
    return { visible: true, dx: 0, dy: dy, scale: scale, alpha: alpha };
  }

  /** 渲染体力飞行动画 + 嵌入特效 */
  _renderStaminaFly(ctx) {
    var ST = require('../define/GameDefine.js').GAME.STAMINA;
    var scale = this._startScale || 1;

    // 1) 飞向「无体力开始按钮标志位」的黄图标（带速度拉伸 + 拖尾，平滑吸附）
    var fly = this._stamina.updateFly();
    if (fly && !fly.done) {
      this._drawStaminaFlyIcon(ctx, fly, ST.ICON_SIZE * scale);
    }

    // 2) 飞行结束（平滑抵达）→ 触发嵌入 + 全局冲击抖动 + 火花（目标「被撞击」反馈）
    if (fly && fly.done) {
      if (this._staminaPendingStart) {
        this._staminaPendingStart = false;
    this._staminaEmbed = { startTime: Date.now(), duration: 420 };
    this._impactShake = { startTime: Date.now(), duration: 240 };
        this._spawnSlamSparks(scale);
      }
      this._flyTrail = null;   // 砸中即清空残影
    }

    // 3) 嵌入特效：冲击波 + 火花 + 槽位受击挤压回弹 → 正式进关
    if (this._staminaEmbed) {
      var e = (Date.now() - this._staminaEmbed.startTime) / this._staminaEmbed.duration;
      if (e >= 1) {
        this._staminaEmbed = null;
        this._slamSparks = null;
        this.startLastLevel();
        return;
      }
      this._drawStaminaEmbed(ctx, e, scale);
    }
  }

  /** 飞行中的黄图标：沿速度方向拉伸 + 径向光晕 + 整段拖尾（与金币/道具飞行同语言） */
  _drawStaminaFlyIcon(ctx, fly, size) {
    var img = this._staminaIcons.filled;
    var speed = Math.sqrt(fly.vx * fly.vx + fly.vy * fly.vy);
    // 拉量与 coin/item 同语言：squash 比例 0.45（克制但明显），上限与"放缓一档"节奏协调
    var stretch = Math.min(0.55, speed * 0.04);
    var angle = Math.atan2(fly.vy, fly.vx);
    var r = Math.min(size * 0.3, size / 2, size / 2);

    // 拖尾：整段飞行都留残影，5 帧、更高透明度、并沿运动方向拉伸，强化"嗖"的速度感
    if (fly.phase === 'fly') {
      if (!this._flyTrail) this._flyTrail = [];
      this._flyTrail.push({ x: fly.x, y: fly.y, stretch: stretch, angle: angle });
      if (this._flyTrail.length > 5) this._flyTrail.shift();
      for (var i = 0; i < this._flyTrail.length - 1; i++) {
        var g = this._flyTrail[i];
        var ta = 0.28 * (i + 1) / this._flyTrail.length;
        ctx.save();
        ctx.globalAlpha = ta;
        ctx.translate(g.x, g.y);
        ctx.rotate(g.angle);
        ctx.scale(1 + g.stretch, 1 - g.stretch * 0.45);
        if (img) ctx.drawImage(img, -size / 2, -size / 2, size, size);
        else { ctx.fillStyle = '#FFEE00'; this.roundRect(ctx, -size / 2, -size / 2, size, size, r); ctx.fill(); }
        ctx.restore();
      }
    } else {
      this._flyTrail = null;
    }

    // 飞行中径向光晕（速度越快越亮，呼应金币/道具的"蓄能冲刺"观感；中段最亮）
    var glowAlpha = Math.min(0.6, 0.18 + speed * 0.022);
    var glowR = size * (0.9 + 0.5 * Math.min(1, speed / 25));
    ctx.save();
    ctx.globalAlpha = glowAlpha;
    var grad = ctx.createRadialGradient(fly.x, fly.y, size * 0.2, fly.x, fly.y, glowR);
    grad.addColorStop(0, 'rgba(255, 240, 120, 0.95)');
    grad.addColorStop(0.5, 'rgba(255, 220, 0, 0.4)');
    grad.addColorStop(1, 'rgba(255, 200, 0, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(fly.x, fly.y, glowR, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // 主图标：沿速度方向拉伸 + 光晕投影
    ctx.save();
    ctx.shadowColor = 'rgba(255,238,0,0.9)';
    ctx.shadowBlur = 12;
    ctx.translate(fly.x, fly.y);
    ctx.rotate(angle);
    ctx.scale(1 + stretch, 1 - stretch * 0.45);   // 沿运动方向拉长，垂直方向略压
    if (img) {
      ctx.drawImage(img, -size / 2, -size / 2, size, size);
    } else {
      ctx.fillStyle = '#FFEE00';
      this.roundRect(ctx, -size / 2, -size / 2, size, size, r);
      ctx.fill();
    }
    ctx.restore();
  }

  /** 砸中瞬间的火花粒子（一次性生成，向外飞散淡出） */
  _spawnSlamSparks(scale) {
    var n = 7, arr = [];
    for (var i = 0; i < n; i++) {
      var ang = (Math.PI * 2) * (i / n) + Math.random() * 0.5;
      arr.push({ ang: ang, spd: 0.8 + Math.random() * 0.7 });
    }
    this._slamSparks = arr;
  }

  /** 嵌入特效：冲击波环 + 火花 + 黄图标从 1.4 迅速收敛 + 槽位受击挤压回弹 */
  _drawStaminaEmbed(ctx, p, scale) {
    var layout = this._computeStaminaLayout();
    var f = layout.flagRect;
    var cx = f.cx, cy = f.cy;
    var sizeBase = 20 * scale;
    var img = this._staminaIcons.filled;

    // 1) 冲击波环：快速扩散 + 淡出（stroke 更有"冲击"感）
    var ringP = Math.min(1, p / 0.7);
    var ringR = sizeBase * 0.4 + Easing.easeOutCubic(ringP) * sizeBase * 2.1;
    ctx.save();
    ctx.globalAlpha = (1 - ringP) * 0.9;
    ctx.lineWidth = (3 * scale) * (1 - ringP) + 1;
    ctx.strokeStyle = '#FFF6B0';
    ctx.beginPath();
    ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // 2) 火花飞散
    if (this._slamSparks) {
      var reach = sizeBase * 2.3;
      for (var i = 0; i < this._slamSparks.length; i++) {
        var s = this._slamSparks[i];
        var d = Easing.easeOutCubic(p) * reach * s.spd;
        var x = cx + Math.cos(s.ang) * d;
        var y = cy + Math.sin(s.ang) * d;
        ctx.save();
        ctx.globalAlpha = (1 - p) * 0.9;
        ctx.fillStyle = '#FFF3B0';
        ctx.beginPath();
        ctx.arc(x, y, 2.4 * scale * (1 - p) + 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // 3) 槽位被砸的"挤压回弹"：先轻下陷，再回弹过冲（幅度比之前柔和）
    var slotS;
    if (p < 0.25) slotS = 1 - (p / 0.25) * 0.18;             // 受击下陷（更浅）
    else slotS = 0.82 + Easing.easeOutBack((p - 0.25) / 0.75) * 0.18;  // 回弹到 1.0

    // 4) 嵌入的黄图标：从 1.4 迅速收敛到 1.0
    var iconP = Math.min(1, p / 0.5);
    var s = 1.4 - 0.4 * Easing.easeOutCubic(iconP);
    var r = Math.min(sizeBase * 0.3, sizeBase / 2, sizeBase / 2);
    ctx.save();
    ctx.shadowColor = 'rgba(255,238,0,0.95)';
    ctx.shadowBlur = 16;
    ctx.translate(cx, cy);
    ctx.scale(s * slotS, s * slotS);
    if (img) {
      ctx.drawImage(img, -sizeBase / 2, -sizeBase / 2, sizeBase, sizeBase);
    } else {
      ctx.fillStyle = '#FFEE00';
      this.roundRect(ctx, -sizeBase / 2, -sizeBase / 2, sizeBase, sizeBase, r);
      ctx.fill();
    }
    ctx.restore();
  }

  /** 砸中目标的全局冲击抖动偏移（菜单整段一起抖） */
  _getImpactShake() {
    if (!this._impactShake) return null;
    var now = Date.now();
    var e = (now - this._impactShake.startTime) / this._impactShake.duration;
    if (e >= 1) { this._impactShake = null; return null; }
    var scale = this._startScale || 1;
    var amp = (1 - e) * 3.5 * scale;           // 减弱幅度，缓冲衰减
    var ox = Math.sin(e * Math.PI * 5.5) * amp;
    var oy = Math.cos(e * Math.PI * 4.5) * amp * 0.7;
    return { x: ox, y: oy };
  }

  /** 处理开始游戏按钮点击 */
  _onClickPlayBtn() {
    // 飞行动画 / 嵌入特效进行中 → 忽略
    if (this._stamina.isFlying() || this._staminaEmbed) return;
    var self = this;
    // 先同步体力
    this._stamina.load();

    // 有体力 → 消耗 1 个 → 黄图标飞向「无体力开始按钮标志位」→ 嵌入 → 进关
    if (this._stamina.canPlay()) {
      var oldCount = this._stamina.getCount();
      this._stamina.consume();
      var newCount = this._stamina.getCount();          // = oldCount - 1
      var layout = this._computeStaminaLayout();
      var fromIcon = layout.iconRects[newCount];         // 刚变空的那个槽
      var flag = layout.flagRect;
      if (fromIcon && flag) {
        this._stamina.startFly(fromIcon.cx, fromIcon.cy, flag.cx, flag.cy, null);
        this._staminaPendingStart = true;               // fly 结束后触发嵌入→进关
      } else {
        self.startLastLevel();
      }
      return;
    }

    // 体力不足 → 按钮滋滋抖 + 空格发光抖，随后弹广告窗补救
    this._staminaShake = { startTime: Date.now(), duration: 420 };
    var hasAds = this._stamina.getAdRemainingToday() > 0;
    setTimeout(function () {
      if (hasAds) {
        StaminaAdPanel.open(self._stamina.getAdRemainingToday(),
          function () { self._onStaminaAdClaim(); });
      } else {
        StaminaAdPanel.openNoAds();
      }
    }, 300);
  }

  _onClickChallengeBtn() {
    // TODO: 挑战赛功能尚未实现，先用 toast 占位反馈
    showToast('挑战赛即将上线', 1200);
  }

  /** 处理广告领取体力 */
  _onStaminaAdClaim() {
    StaminaAdPanel.close();
    this._stamina.claimAd();
  }

  // ========== 主循环 ==========
  update() {
    databus.frame++;

    // 体力不足抖动结束 → 清状态
    if (this._staminaShake &&
        Date.now() - this._staminaShake.startTime >= this._staminaShake.duration) {
      this._staminaShake = null;
    }

    // 菜单入场动画进行中 → 屏蔽输入
    if (this._menuEntrance && this._menuEntrance.phase === 'slideIn') {
      var elapsed = Date.now() - this._menuEntrance.startTime;
      if (elapsed >= this._menuEntrance.totalDuration) {
        this._menuEntrance.phase = 'done';
        this._menuEntrance = null;
        this._menuEntranceDoneAt = Date.now();
      }
      return;
    }

    // 菜单出场动画进行中 → 屏蔽输入
    if (this._menuExit) {
      var m = this._menuExit;
      var now = Date.now();
      if (m.phase === 'slide') {
        // 控件下滑 + 渐隐（期间并行加载关卡内容）
        if (now - m.startTime >= m.totalDuration) {
          if (m.target === 'editor') {
            this._commitMenuExit('editor');   // 编辑器无交叉淡变，直接切
          } else {
            m.phase = 'wait';                 // 等关卡加载就绪
          }
        }
      } else if (m.phase === 'wait') {
        // 控件已滑出，仅菜单背景可见；等关卡就绪后做交叉淡变
        if (this.playing._levelLoadFailed) {
          // 加载失败 → 退回主菜单（toast 已在 prepareLevel 内弹出）
          this._menuExit = null;
          this._menuVisible = true;
          this._hasLeftMenu = false;
        } else if (this.playing._levelReady) {
          m.phase = 'crossfade';
          m.crossStart = now;
        }
        // 否则继续等（关卡还在加载）
      } else if (m.phase === 'crossfade') {
        // 菜单背景渐隐 + 关卡背景渐显；结束后切场景并启动关卡入场
        if (now - m.crossStart >= m.crossDuration) {
          this._commitMenuExit('playing');
        }
      }
      return;
    }

    // 状态切换（在事件处理之前，确保引擎已激活）
    this.checkStateTransition();

    this.input.handlePendingEvents();

    // 事件处理可能在本帧内改变 gameState（如关卡内"返回主菜单"），
    // 若等到下一帧才 checkStateTransition 会导致一帧内 _menuEntrance 仍为 null、
    // 主菜单按钮以全透明度渲染一帧（闪一下）。故事件后再查一次，确保同帧初始化入场动画。
    this.checkStateTransition();

    // 关卡地图（主页）滚动 + 惯性更新（置于事件处理之后，与游玩更新并列）
    if (databus.gameState === 'menu' && this._useLevelMap && this._levelMap) {
      this._levelMap.update();
    }

    // 游玩状态更新动画
    if (databus.gameState === 'playing') {
      this.playing.gp.update();
    }
    if (databus.gameState === 'editor') {
      this.editor.gp.update();
    }
  }

  // 跟踪上一个状态，自动管理 activate/deactivate
  checkStateTransition() {
    const curr = databus.gameState;
    if (curr === this._prevState) return;

    const prev = this._prevState;
    console.log('[LOG] checkStateTransition: ' + prev + ' → ' + curr + ' (当前 _cloudMaxLevel=' + databus._cloudMaxLevel + ')');

    // 切场景：停止所有 SFX，避免残留音效
    audio.onSceneChange();

    // 反激活旧状态
    switch (prev) {
      case 'editor':      this.editor.deactivate();        break;
      case 'playing':     this.playing.deactivate();       break;
    }

    // 激活新状态（menu 的输入在 setupMenuInput 已注册）
    switch (curr) {
      case 'menu':
        audio.playMusic('menu');
        this._menuVisible = true;   // 回到主菜单：可见，未来离场播出场动画
        // 从其他界面返回 → 触发主菜单入场动画（与 loading 进入一致）
        if (prev) {
          this._menuEntrance = {
            phase: 'slideIn',
            startTime: Date.now(),
            totalDuration: MENU_ENTRANCE_END,
          };
          this._staminaEntranceStart = Date.now();   // 返回主菜单：体力图标重新逐枚入场
          this._menuEntranceDoneAt = 0;
        }
        break;
      case 'editor':      this.editor.activate();  audio.playMusic('editor');   break;
      case 'playing':     this.playing.activate(); audio.playMusic('playing'); break;
    }

    this._prevState = curr;
  }

  render() {
    beginFrame();

    if (this._menuExit && this._menuExit.phase === 'crossfade') {
      // 交叉淡变：菜单背景渐隐(1→0) + 关卡场景背景渐显(0→1)
      var cp = Math.min(1, (Date.now() - this._menuExit.crossStart) / this._menuExit.crossDuration);
      ctx.save();
      ctx.globalAlpha = 1 - cp;
      this.drawBackground();
      ctx.restore();
      this._renderCurrentScene();              // 菜单控件（已滑出，透明）照常绘制
      this.playing.drawSceneBackground(cp);    // 关卡背景叠在最上层渐显
    } else {
      // 关卡地图模式：草原背景随路径一起滚动，再叠加路径 + 关卡按钮，最后画主界面控件
      if (this._useLevelMap && this._levelMap) {
        this._levelMap.renderBackground();
        this._levelMap.renderPath();
        this._levelMap.renderButtons();
      } else {
        this.drawBackground();
      }
      this._renderCurrentScene();
    }

    // 全局 Toast 替代组件 — 叠在所有游戏场景之上
    if (this._toast) this._toast.render(ctx);

    // 开发者调试面板 — 最顶层渲染
    DebugPanel.render(databus, this);
    present();
  }

  _renderCurrentScene() {
    switch (databus.gameState) {
      case 'menu':
        this.renderMenu();
        break;
      case 'playing':
        this.playing.render();
        break;
      case 'editor':
        this.editor.render();
        break;
    }
  }

  drawBackground() {
    // 背景图片优先，未加载则渐变兜底
    if (this._bgLoaded) {
      var imgW = this.bgImg.width;
      var imgH = this.bgImg.height;
      var scale = Math.max(SCREEN_WIDTH / imgW, SCREEN_HEIGHT / imgH);
      var dw = imgW * scale;
      var dh = imgH * scale;
      var dx = (SCREEN_WIDTH - dw) / 2;
      var dy = (SCREEN_HEIGHT - dh) / 2;
      ctx.drawImage(this.bgImg, dx, dy, dw, dh);
    } else {
      var C = this.COLORS;
      var grad = ctx.createLinearGradient(0, 0, 0, SCREEN_HEIGHT);
      grad.addColorStop(0, C.bgTop);
      grad.addColorStop(0.4, C.bgMid);
      grad.addColorStop(1, C.bgBottom);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    }
  }

  loop() {
    // === FPS 追踪 ===
    var now = Date.now();
    var timestamps = databus.frameTimestamps;
    timestamps.push(now);
    // 只保留最近 90 帧（按 30fps 基准约 3 秒）
    while (timestamps.length > 90) timestamps.shift();
    if (timestamps.length >= 2) {
      var duration = timestamps[timestamps.length - 1] - timestamps[0];
      databus.currentFPS = duration > 0 ? Math.round((timestamps.length - 1) / (duration / 1000)) : 60;
    }
    // 卡顿检测
    BugReporter.checkLag(now);

    this.update();
    this.render();
    requestAnimationFrame(this.loop.bind(this));
  }

  /**
   * 计算按钮按压回弹缩放值
   * 按下时 scale 1→0.95（80ms），松手后 0.95→1.0（120ms easeOutBack）
   */
  _getBtnPressScale() {
    if (this._pressedBtnIdx < 0) return 1;
    var elapsed = Date.now() - this._pressedBtnTime;
    var pressDuration = 100;
    var releaseDuration = 140;

    if (elapsed < pressDuration) {
      // 按压阶段
      return 1 - 0.05 * Easing.easeOutCubic(Math.min(elapsed / pressDuration, 1));
    } else {
      // 回弹阶段
      var t = Math.min((elapsed - pressDuration) / releaseDuration, 1);
      if (t >= 1) {
        this._pressedBtnIdx = -1;
        return 1;
      }
      return 0.95 + 0.05 * Easing.easeOutBack(t, 1.5);
    }
  }

  roundRect(ctx, x, y, w, h, r) {
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
    ctx.closePath();
  }
}

module.exports = GameEngine;
