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
const Theme = require('../define/GameDefine.js').THEME;
const Easing = require('./Easing.js');
const { ctx, SCREEN_WIDTH, SCREEN_HEIGHT, beginFrame, present } = require('../render.js');
const InputManager = require('./InputManager.js');
const EditorEngine = require('../editor/EditorEngine.js');
const PlayingEngine = require('../game/PlayingEngine.js');
const BugReporter = require('../debug/BugReporter.js');
const DebugPanel = require('../debug/DebugPanel.js');

// 主菜单入场时序（单一数据源）：分步入场
//  1) t=500 底部条上移+渐显；设置按钮 + 体力UI 原地渐显（不滑动）
//  2) t=800 开始按钮渐显+回弹  3) t=1260 左右按钮同批渐显+回弹
// 整段入场结束绝对时刻（ms）= 左/右按钮最晚：1260 + 440
var MENU_ENTRANCE = {
  bottomBar: { stagger: 500,  dur: 480, from: { dx: 0,   dy: 240, scale: 1,   alpha: 0 }, ease: 'cubic' },
  settings:  { stagger: 500,  dur: 460, from: { dx: 0,   dy: 0,   scale: 1,   alpha: 0 }, ease: 'cubic' },
  // 体力 UI 与设置按钮同批：原地渐显，不滑动
  stamina:   { stagger: 500,  dur: 460, from: { dx: 0,   dy: 0,   scale: 1,   alpha: 0 }, ease: 'cubic' },
  play:      { stagger: 800,  dur: 460, from: { dx: 0,   dy: 0,   scale: 0.8, alpha: 0 }, ease: 'back'  },
  dress:     { stagger: 1260, dur: 440, from: { dx: 0,   dy: 0,   scale: 0.8, alpha: 0 }, ease: 'back'  },
  challenge: { stagger: 1260, dur: 440, from: { dx: 0,   dy: 0,   scale: 0.8, alpha: 0 }, ease: 'back'  },
};
var MENU_ENTRANCE_END = 1260 + 440;

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

    // 背景图：由 LoadingManager 在 Phase1 加载后注入
    this.bgImg = null;
    this._bgLoaded = false;

    // 菜单按钮
    this.menuButtons = [];
    this._pressedBtnIdx = -1;   // 当前被按下的按钮索引（用于按压动画）
    this._pressedBtnTime = 0;   // 按钮按下时间

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
    this._staminaIcons = { filled: null, empty: null };
    this._preloadStaminaIcons();
    console.log('[GameEngine] StaminaSystem 初始化完成');

    // 预加载数据占位（LoadingManager 填充）
    this._preloadedPlayerData = null;
    this._preloadedCloudRange = null;

    console.log('[GameEngine] constructor 完成，启动加载画面...');
    this._startLoading();
  }

  /** 预加载体力图标 */
  _preloadStaminaIcons() {
    var self = this;
    var filled = wx.createImage();
    filled.onload = function () { self._staminaIcons.filled = filled; };
    filled.src = 'assets/images/energy.png';
    var empty = wx.createImage();
    empty.onload = function () { self._staminaIcons.empty = empty; };
    empty.src = 'assets/images/energy_empty.png';
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

    // 菜单输入处理始终注册（自动进关卡路径也需要，以便后续返回菜单时能响应）
    this.setupMenuInput();

    // 应用 LoadingManager 预加载的云端数据（替代原 _syncFromCloud + _syncCloudLevels）
    this._applyPreloadedPlayerData();
    this._applyPreloadedCloudLevels();

    // 同步检查：第1关未通关 → 跳过主菜单，直接进关卡
    var li = wx.getStorageSync('lastLevelIndex');
    var liNum = (li !== '' && li !== undefined && li !== null) ? parseInt(li, 10) : -1;
    if (liNum <= 0) {
      console.log('[GameEngine] 第1关未通关，跳过主菜单直接进关卡');
      this._didAutoStart = true;
      this._hasLeftMenu = true;
      this.startLastLevel();
    } else {
      databus.gameState = 'menu';
      this._hasLeftMenu = false;
      console.log('[GameEngine] 设置 gameState=menu');
      // 云端数据已就绪，检查是否需要恢复存档
      this._checkAutoStart();
    }
    console.log('[GameEngine] start() 完成');
  }

  _syncFromCloud() {
    console.log('[cloud] === _syncFromCloud 开始，准备拉取玩家数据 ===');
    var self = this;
    cloud.getPlayerData().then(function(res) {
      console.log('[cloud] cloud.getPlayerData 成功回调，res.code=' + (res && res.code) + '，有data=' + !!(res && res.data));
      if (!res || res.code !== 0 || !res.data) {
        console.log('[cloud] 无云端存档或拉取失败，沿用本地数据');
        self._checkAutoStart();
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
      // 金币：云端权威覆盖本地（不再取较大值，以服务器结算为准）
      if (typeof cloudData.gold === 'number') {
        GoldSystem.setGold(cloudData.gold);
        console.log('[cloud] 云端金币同步: ' + cloudData.gold);
      }
      // 还原已领取金币的关卡记录
      if (cloudData.goldClaimedLevels && Array.isArray(cloudData.goldClaimedLevels)) {
        GoldSystem.restoreClaimHistory(cloudData.goldClaimedLevels);
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
      console.log('[cloud] 云端数据同步完成 → 调用 _checkAutoStart');
      self._checkAutoStart();
    }).catch(function(err) {
      console.warn('[cloud] 拉取云端数据失败（非阻塞）:', err && err.message);
      console.log('[cloud] cloud.getPlayerData 失败，走 catch → 调用 _checkAutoStart');
      self._checkAutoStart();
    });
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
    var cloudData = this._preloadedPlayerData;
    if (!cloudData) {
      console.log('[GameEngine] 无预加载玩家数据，沿用本地');
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

    // 还原已领取金币的关卡记录
    if (cloudData.goldClaimedLevels && Array.isArray(cloudData.goldClaimedLevels)) {
      GoldSystem.restoreClaimHistory(cloudData.goldClaimedLevels);
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
    console.log('[GameEngine] 预加载玩家数据合并完成');
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

  // 第1关未通关 → 自动进入关卡；否则留主菜单
  // 杀进程恢复：存在有效存档 → 自动进入关卡
  _checkAutoStart() {
    // 入口日志：标记每次调用
    console.log('[LOG] ===== _checkAutoStart 被调用 =====');
    console.log('[LOG] _didAutoStart=' + this._didAutoStart + ' _hasLeftMenu=' + this._hasLeftMenu);
    if (this._didAutoStart) {
      console.log('[LOG] 已执行过，直接返回');
      return;
    }

    if (this._hasLeftMenu) {
      this._didAutoStart = true;
      return;
    }

    this._didAutoStart = true;

    var li = wx.getStorageSync('lastLevelIndex');
    console.log('[LOG] wx.getStorageSync("lastLevelIndex") 原始值:', JSON.stringify(li), '类型:', typeof li);
    var liNum = (li !== '' && li !== undefined && li !== null) ? parseInt(li, 10) : -1;
    console.log('[LOG] 解析后 liNum=' + liNum + ' (<=0?' + (liNum <= 0) + ')');

    if (liNum <= 0) {
      // 第1关未通关 → 自动进入关卡
      console.log('[LOG] ✓ 第1关未通关，自动进入关卡！');
      this.startLastLevel();
      console.log('[LOG] ===== _checkAutoStart 结束（自动进入） =====');
      return;
    }

    console.log('[LOG] _checkAutoStart 完成，停在主菜单');
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
      wx.showToast({ title: '没有关卡', icon: 'none', duration: 1500 });
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
    databus.gameState = 'playing';
    this._hasLeftMenu = true;   // 标记已离开主菜单，防止异步恢复弹窗

    // 同步 databus.projectLevels（PlayingEngine 下一关/重玩依赖）
    this._buildProjectLevels(totalLevels);
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
      // 面板打开时，所有触控事件（touchstart/move/end）由面板处理
      if (ShopPanel.isOpen()) {
        var t0 = e.touches && e.touches[0];
        ShopPanel.handleEvent({ type: e.type, x: t0 ? t0.x : 0, y: t0 ? t0.y : 0 });
        return;
      }

      if (e.type === 'touchstart' && e.touches[0]) {
        var t = e.touches[0];

        // 体力不足广告弹窗
        if (StaminaAdPanel.isOpen()) {
          StaminaAdPanel.handleTouch(t.x, t.y, e.type);
          return;
        }

        // 体力 "+" 按钮
        if (this._staminaPlusRect &&
            t.x >= this._staminaPlusRect.x && t.x <= this._staminaPlusRect.x + this._staminaPlusRect.w &&
            t.y >= this._staminaPlusRect.y && t.y <= this._staminaPlusRect.y + this._staminaPlusRect.h) {
          var self3 = this;
          StaminaAdPanel.open(
            this._stamina.getAdRemainingToday(),
            function () { self3._onStaminaAdClaim(); }
          );
          return;
        }

        // 设置面板打开时，所有触控由面板处理
        if (settingsPanel.isOpen()) {
          settingsPanel.handleTouch(t.x, t.y, e.type);
          return;
        }

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
            wx.showToast({ title: '编辑器已解锁', icon: 'none', duration: 1200 });
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

  renderMenu() {
    var C = this.COLORS;
    var safeTop = databus.safeTop;
    var cx = SCREEN_WIDTH / 2;

    // ===== 底部功能区域背景（stretched，最底层，在所有按钮之下）=====
    // 底部条入场：上移 + 渐显（t=500 起）
    var barT = this._getEntranceTransform('bottomBar');
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

    // 计算按钮按压缩放
    var pressScale = this._getBtnPressScale();
    var mainScale = this._pressedBtnIdx === 0 ? pressScale : 1;
    var secScale  = this._pressedBtnIdx === 1 ? pressScale : 1;
    var arenaScale = this._pressedBtnIdx === 2 ? pressScale : 1;
    var setScale   = this._pressedBtnIdx === 3 ? pressScale : 1;
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
    var st = this._getEntranceTransform('settings');
    ctx.save();
    ctx.translate(setBtnCX + st.dx, setBtnCY + st.dy);
    ctx.scale(setScale, setScale);
    ctx.translate(-(setBtnCX + st.dx), -(setBtnCY + st.dy));
    ctx.globalAlpha = st.alpha;
    var setAreaRaw = this._drawSettingsBtn(setBtnX + st.dx, setBtnY + st.dy, setIconSize);
    var setArea = { x: setBtnX, y: setBtnY, w: setAreaRaw.w, h: setAreaRaw.h };
    ctx.restore();

    // ===== 体力 UI（左上角：5 图标 + 倒计时），与设置按钮同批原地渐显 =====
    var staT = this._getEntranceTransform('stamina');
    ctx.save();
    ctx.globalAlpha *= staT.alpha;
    this._renderStaminaUI(ctx, setBtnY + setIconSize);
    ctx.restore();

    // ===== 主按钮：开始游戏（main_start.png 图片按钮）=====
    // Figma: 173 x 113，水平居中，bottom 距屏幕底 64px（基于 393 宽设计稿等比缩放）
    var startScale = SCREEN_WIDTH / 393;
    var startW = 173 * startScale;
    var startH = 113 * startScale;
    var startX = (SCREEN_WIDTH - startW) / 2;
    var startY = SCREEN_HEIGHT - 64 * startScale - startH;
    var startCX = startX + startW / 2;
    var startCY = startY + startH / 2;

    var playT = this._getEntranceTransform('play');
    ctx.save();
    ctx.globalAlpha = playT.alpha;
    // 围绕按钮中心：按压缩放 × 入场缩放（easeOutBack 回弹）
    ctx.translate(startCX, startCY);
    ctx.scale(mainScale * playT.scale, mainScale * playT.scale);
    ctx.translate(-startCX, -startCY);
    if (playT.dy !== 0) {
      ctx.translate(0, playT.dy);
    }

    if (AssetPreloader.isReady('main_start')) {
      ctx.drawImage(AssetPreloader.get('main_start'), startX, startY, startW, startH);
    }
    ctx.restore();

    this._playBtnRect = { x: startX, y: startY, w: startW, h: startH };

    // 体力飞行动画目标点：指向开始按钮中心（原按钮左侧体力图标已随旧按钮移除）
    this._staminaBtnIconRect = {
      x: startX, y: startY, w: startW, h: startH,
      cx: startCX, cy: startCY
    };

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
        action: function() { self._hasLeftMenu = true; databus.gameState = 'editor'; }
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
      var _dBt = this._getEntranceTransform('dress');
      var _cBt = this._getEntranceTransform('challenge');
      var _dCx = this._dressBtnRect.x + this._dressBtnRect.w / 2;
      var _dCy = this._dressBtnRect.y + this._dressBtnRect.h / 2;
      var _cCx = this._challengeBtnRect.x + this._challengeBtnRect.w / 2;
      var _cCy = this._challengeBtnRect.y + this._challengeBtnRect.h / 2;

      // 装扮（右）
      ctx.save();
      ctx.globalAlpha = _dBt.alpha;
      ctx.translate(_dCx, _dCy);
      ctx.scale(_dBt.scale, _dBt.scale);
      ctx.translate(-_dCx, -_dCy);
      drawBottomBar.drawRoundMenuButton(ctx, this._dressBtnRect.x, this._dressBtnRect.y, this._dressBtnRect.w, '衣');
      ctx.restore();

      // 挑战赛（左）
      ctx.save();
      ctx.globalAlpha = _cBt.alpha;
      ctx.translate(_cCx, _cCy);
      ctx.scale(_cBt.scale, _cBt.scale);
      ctx.translate(-_cCx, -_cCy);
      drawBottomBar.drawRoundMenuButton(ctx, this._challengeBtnRect.x, this._challengeBtnRect.y, this._challengeBtnRect.w, '赛');
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
  }

  // ========== 体力系统 UI ==========

  /** 渲染左上角体力 UI（5 图标 + 倒计时） */
  _renderStaminaUI(ctx, safeTop) {
    var ST = require('../define/GameDefine.js').GAME.STAMINA;
    var count = this._stamina.getCount();
    var x = 10, y = safeTop + 12;
    var iconSize = ST.ICON_SIZE, gap = ST.ICON_GAP;
    var flips = this._stamina.updateFlips();

    // 建立 flip 索引快速查找：{ [index]: progress }
    var flipMap = {};
    for (var fi = 0; fi < flips.length; fi++) {
      flipMap[flips[fi].index] = flips[fi].progress;
    }

    for (var i = 0; i < ST.MAX; i++) {
      var cx = x + i * (iconSize + gap) + iconSize / 2;
      var cy = y + iconSize / 2;
      var p = flipMap[i];

      if (p != null) {
        // 翻转动效
        ctx.save();
        ctx.translate(cx, cy);
        if (p < 0.5) {
          // 前半段：空图标缩小消失
          var scaleX = 1 - p * 2;
          ctx.scale(scaleX, 1);
          if (this._staminaIcons.empty) {
            ctx.drawImage(this._staminaIcons.empty, -iconSize / 2, -iconSize / 2, iconSize, iconSize);
          }
        } else {
          // 后半段：实心图标放大出现
          var scaleX2 = (p - 0.5) * 2;
          ctx.scale(scaleX2, 1);
          if (this._staminaIcons.filled) {
            ctx.drawImage(this._staminaIcons.filled, -iconSize / 2, -iconSize / 2, iconSize, iconSize);
          }
        }
        ctx.restore();
      } else {
        var img = i < count ? this._staminaIcons.filled : this._staminaIcons.empty;
        if (img) {
          ctx.drawImage(img, x + i * (iconSize + gap), y, iconSize, iconSize);
        }
      }
    }

    // 存储右下角体力图标位置（飞行动画起点：刚变成空的那个）
    var lastEmptyIdx = count;  // count 是当前体力值，index=count 是第一个空图标
    this._staminaFirstIconRect = {
      x: x + lastEmptyIdx * (iconSize + gap), y: y,
      w: iconSize, h: iconSize,
      cx: x + lastEmptyIdx * (iconSize + gap) + iconSize / 2,
      cy: y + iconSize / 2
    };

    // "+" 按钮（体力未满时显示）
    var rightX = x + ST.MAX * (iconSize + gap);
    if (count < ST.MAX) {
      var plusSize = 20;
      var plusX = rightX + 2;
      var plusY = y + (iconSize - plusSize) / 2;
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.beginPath();
      ctx.arc(plusX + plusSize / 2, plusY + plusSize / 2, plusSize / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 14px ' + Theme.font.family + '';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('+', plusX + plusSize / 2, plusY + plusSize / 2);
      ctx.restore();
      this._staminaPlusRect = { x: plusX, y: plusY, w: plusSize, h: plusSize };
    } else {
      this._staminaPlusRect = null;
    }

    // 倒计时
    var cdText = this._stamina.getCountdownText();
    if (cdText) {
      ctx.save();
      ctx.font = 'bold 12px ' + Theme.font.family + '';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(cdText, x, y + iconSize + 4);
      ctx.restore();
    }
  }

  /** 渲染体力飞行动画 */
  _renderStaminaFly(ctx) {
    var fly = this._stamina.updateFly();
    if (!fly) return;
    if (fly.done) {
      if (this._staminaPendingStart) {
        var cb = this._staminaPendingStart;
        this._staminaPendingStart = null;
        cb();
      }
      return;
    }
    if (this._staminaIcons.filled) {
      // 飞行阶段渐隐，停留阶段保持清晰
      var alpha = fly.phase === 'hold' ? 1 : (1 - fly.progress * 0.2);
      var iconSize = 24;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(this._staminaIcons.filled,
        fly.x - iconSize / 2, fly.y - iconSize / 2, iconSize, iconSize);
      ctx.restore();
    }
  }

  /** 处理开始游戏按钮点击 */
  _onClickPlayBtn() {
    // 飞行动画进行中 → 忽略
    if (this._stamina.isFlying()) return;
    var self = this;
    // 先同步体力
    this._stamina.load();

    // 有体力 → 消耗后飞行动画 → 进入关卡
    if (this._stamina.canPlay()) {
      this._stamina.consume();
      // 启动飞行动画
      var from = this._staminaFirstIconRect;
      var to = this._staminaBtnIconRect;
      if (from && to) {
        this._stamina.startFly(from.cx, from.cy, to.cx, to.cy, null);
        this._staminaPendingStart = function () { self.startLastLevel(); };
      } else {
        self.startLastLevel();
      }
      return;
    }

    // 体力不足 → 弹窗
    if (this._stamina.getAdRemainingToday() > 0) {
      var self = this;
      StaminaAdPanel.open(
        this._stamina.getAdRemainingToday(),
        function () { self._onStaminaAdClaim(); }
      );
    } else {
      StaminaAdPanel.openNoAds();
    }
  }

  _onClickChallengeBtn() {
    // TODO: 挑战赛功能尚未实现，先用 toast 占位反馈
    wx.showToast({ title: '挑战赛即将上线', icon: 'none', duration: 1200 });
  }

  /** 处理广告领取体力 */
  _onStaminaAdClaim() {
    StaminaAdPanel.close();
    this._stamina.claimAd();
  }

  // ========== 主循环 ==========
  update() {
    databus.frame++;

    // 菜单入场动画进行中 → 屏蔽输入
    if (this._menuEntrance && this._menuEntrance.phase === 'slideIn') {
      var elapsed = Date.now() - this._menuEntrance.startTime;
      if (elapsed >= this._menuEntrance.totalDuration) {
        this._menuEntrance.phase = 'done';
        this._menuEntrance = null;
      }
      return;
    }

    // 状态切换（在事件处理之前，确保引擎已激活）
    this.checkStateTransition();

    this.input.handlePendingEvents();

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
        // 从其他界面返回 → 触发主菜单入场动画（与 loading 进入一致）
        if (prev) {
          this._menuEntrance = {
            phase: 'slideIn',
            startTime: Date.now(),
            totalDuration: MENU_ENTRANCE_END,
          };
        }
        break;
      case 'editor':      this.editor.activate();  audio.playMusic('editor');   break;
      case 'playing':     this.playing.activate(); audio.playMusic('playing'); break;
    }

    this._prevState = curr;
  }

  render() {
    beginFrame();
    this.drawBackground();

    this._renderCurrentScene();

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
