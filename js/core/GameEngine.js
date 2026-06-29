// 游戏主循环引擎

const databus = require('../databus.js');
const cloud = require('../cloud.js');
const audio = require('../audio/AudioManager.js');
const settingsPanel = require('../ui/SettingsPanel.js');
const commonIcons = require('../ui/commonIcons.js');
const checkpointDialog = require('../ui/CheckpointDialog.js');
const GoldSystem = require('../game/GoldSystem.js');
const SkinSystem = require('../game/SkinSystem.js');
const ShopPanel = require('../ui/ShopPanel.js');
const AssetPreloader = require('../ui/AssetPreloader.js');
const Theme = require('../ui/Theme.js');
const Easing = require('./Easing.js');
const TransitionManager = require('./TransitionManager.js');
const { ctx, SCREEN_WIDTH, SCREEN_HEIGHT, beginFrame, present } = require('../render.js');
const InputManager = require('./InputManager.js');
const EditorEngine = require('../editor/EditorEngine.js');
const LevelSelectEngine = require('../game/LevelSelectEngine.js');
const PlayingEngine = require('../game/PlayingEngine.js');
const BugReporter = require('../debug/BugReporter.js');
const DebugPanel = require('../debug/DebugPanel.js');
const PigRenderer = require('../render/PigRenderer.js');

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
    this.levelSelect = new LevelSelectEngine(this.input);
    console.log('[GameEngine] LevelSelectEngine 创建完成');
    this.playing = new PlayingEngine(this.input);
    console.log('[GameEngine] PlayingEngine 创建完成');

    // 背景图
    this.bgImg = wx.createImage();
    this._bgLoaded = false;
    var self = this;
    this.bgImg.onload = function () {
      self._bgLoaded = true;
    };
    this.bgImg.src = 'assets/images/main/bg.jpg';

    // 菜单按钮
    this.menuButtons = [];
    this._pressedBtnIdx = -1;   // 当前被按下的按钮索引（用于按压动画）
    this._pressedBtnTime = 0;   // 按钮按下时间

    // 左下角快速 5 连击解锁编辑器入口 + DebugPanel
    this._cornerTapCount = 0;
    this._cornerTapTimer = null;
    this._editorUnlocked = false;

    // 皮肤系统初始化（三层加载：本地打包 → 本地缓存 → 云端热更新）
    SkinSystem.loadConfig(function () {
      if (ShopPanel.isOpen()) {
        ShopPanel.refresh();
      }
    });

    // 预加载面板资源（避免首次打开面板时图片未就绪）
    AssetPreloader.register({
      settings_bg: 'assets/images/common/popup_bg.png',
      icon_music: 'assets/images/common/icon_music.png',
      icon_sound: 'assets/images/common/icon_sound.png',
      btn_home: 'assets/images/common/btn_home.png',
      btn_again: 'assets/images/common/btn_again.png',
      win_cancel: 'assets/images/common/win_cancel.png',
      // 结算面板
      victory_bg: 'assets/images/levels/victory_bg.png',
      coin: 'assets/images/common/coin.png',
      leftStep: 'assets/images/levels/leftStep_1.png',
      master_hat: 'assets/images/levels/master_hat.png',
      ad_icon: 'assets/images/levels/ad_icon.png',
    });
    AssetPreloader.preload();

    // 加载自定义字体
    var _loadFont = function() {
      if (typeof wx === 'undefined' || !wx.loadFont) return;

      var fontPath = 'assets/font/ZiYuDuDuTi.ttf';
      var family = wx.loadFont(fontPath);
      if (family) {
        Theme.font.family = family;
        console.log('[Font] 加载成功: ' + family);
      }
    };
    _loadFont();

    console.log('[GameEngine] constructor 完成，准备调用 start()');
    this.start();
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
      databus.safeTop = 56;
      console.log('[GameEngine] 安全区获取失败，使用默认值 56');
    }

    // 章节配置改为按需懒加载（LevelSelectEngine 激活时才读）
    // 避免在启动路径上同步 I/O 阻塞首帧渲染

    // 菜单输入处理始终注册（自动进关卡路径也需要，以便后续返回菜单时能响应）
    this.setupMenuInput();

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
    }
    this.loop();
    console.log('[GameEngine] 主循环已启动');

    // 异步从云端拉取玩家数据，合并到本地（换设备恢复进度）
    this._syncFromCloud();

    // 异步拉取云端关卡列表和章节配置（不阻塞启动，没拿到就用本地）
    this._syncCloudLevels();
  }

  _syncFromCloud() {
    console.log('[LOG] === _syncFromCloud 开始，准备拉取玩家数据 ===');
    var self = this;
    cloud.getPlayerData().then(function(res) {
      console.log('[LOG] cloud.getPlayerData 成功回调，res.code=' + (res && res.code) + '，有data=' + !!(res && res.data));
      if (!res || res.code !== 0 || !res.data) {
        console.log('[Cloud] 无云端存档或拉取失败，沿用本地数据');
        self._checkAutoStart();
        return;
      }
      var cloudData = res.data;
      var cloudLI = cloudData.lastLevelIndex;
      var localRaw = wx.getStorageSync('lastLevelIndex');
      var localLI = (localRaw !== '' && localRaw !== undefined && localRaw !== null)
        ? parseInt(localRaw, 10) : -1;
      if (typeof cloudLI === 'number' && cloudLI > localLI) {
        console.log('[Cloud] 云端进度更新: lastLevelIndex ' + localLI + ' → ' + cloudLI);
        wx.setStorageSync('lastLevelIndex', cloudLI);
      }
      // 合并 crowns：云端有的且本地没有则补本地
      var cloudCrowns = cloudData.crowns || [];
      var crownMerged = 0;
      for (var c = 0; c < cloudCrowns.length; c++) {
        var crownKey = 'crown_' + cloudCrowns[c];
        var localCrown = wx.getStorageSync(crownKey);
        if (localCrown === '' || localCrown === undefined || localCrown === null) {
          wx.setStorageSync(crownKey, true);
          crownMerged++;
        }
      }
      if (crownMerged > 0) {
        console.log('[Cloud] 合并 crowns: ' + crownMerged + ' 条');
      }
      // 金币：云端权威覆盖本地（不再取较大值，以服务器结算为准）
      if (typeof cloudData.gold === 'number') {
        GoldSystem.setGold(cloudData.gold);
        console.log('[LOG] 云端金币同步: ' + cloudData.gold);
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
      console.log('[LOG] 云端数据同步完成 → 调用 _checkAutoStart');
      self._checkAutoStart();
    }).catch(function(err) {
      console.warn('[Cloud] 拉取云端数据失败（非阻塞）:', err && err.message);
      console.log('[LOG] cloud.getPlayerData 失败，走 catch → 调用 _checkAutoStart');
      self._checkAutoStart();
    });
  }

  // 异步从云端拉取关卡范围和章节配置（fire-and-forget，不阻塞启动）
  _syncCloudLevels() {
    var self = this;
    console.log('[LOG] _syncCloudLevels 开始拉取云端关卡范围...');
    // 拉取云端已发布关卡范围
    cloud.listLevels().then(function(range) {
      console.log('[LOG] _syncCloudLevels cloud.listLevels() 返回: range=' + JSON.stringify(range)
        + ', typeof range.maxLevel=' + (range ? typeof range.maxLevel : 'N/A'));
      if (range && range.maxLevel > 0) {
        var prevMax = databus._cloudMaxLevel;
        databus._cloudMaxLevel = range.maxLevel;
        console.log('[LOG] _syncCloudLevels 云端关卡范围就绪: ' + range.minLevel + '~' + range.maxLevel
          + ' (之前 _cloudMaxLevel=' + prevMax + ')');
        // 云端范围比已构建的大 → 需要重建
        if (prevMax === undefined || range.maxLevel > prevMax) {
          console.log('[LOG] _syncCloudLevels 云端范围增大 (prevMax=' + prevMax + '→' + range.maxLevel + '), 当前 gameState=' + databus.gameState);
          if (databus.gameState === 'levelSelect') {
            console.log('[LOG] _syncCloudLevels 立即重建关卡选择列表');
            self.levelSelect.loadProjectLevels();
            self.levelSelect._buildChapterSections();
            self.levelSelect._setupUI();
            self.levelSelect._needsRebuild = false;
          } else {
            console.log('[LOG] _syncCloudLevels 标记脏，下次进入关卡选择时重建');
            self.levelSelect._needsRebuild = true;
          }
        }
      } else {
        console.log('[LOG] _syncCloudLevels 云端无已发布关卡或无数据 (range=' + JSON.stringify(range) + ')');
      }
    }).catch(function(err) {
      console.warn('[Cloud] listLevels 异常（非阻塞）:', err && err.message);
    });
    // 拉取云端章节配置
    cloud.downloadCloudFile('level/chapter.json').then(function(chapterData) {
      if (chapterData && Array.isArray(chapterData)) {
        databus._cloudChapters = chapterData;
        GoldSystem.setChapters(chapterData);
        console.log('[Cloud] 云端章节配置就绪: ' + chapterData.length + ' 章');
      }
    }).catch(function(err) {
      console.warn('[Cloud] chapter.json 异常（非阻塞）:', err && err.message);
    });
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

    // 保护：如果玩家已经离开过主菜单（如云端数据异步到达太晚），
    // 不弹恢复弹窗，直接清理存档
    if (this._hasLeftMenu) {
      console.log('[LOG] ✗ 玩家已离开过主菜单，跳过恢复弹窗，清理存档');
      try { wx.removeStorageSync('game_checkpoint'); } catch (e) {}
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

    // 杀进程恢复：检查是否有待恢复的存档
    var cp;
    try { cp = wx.getStorageSync('game_checkpoint'); } catch (e) { cp = null; }
    if (cp && cp.levelName) {
      console.log('[LOG] ✓ 发现存档 level=' + cp.levelName + ' step=' + cp.steps + ' pigs=' + (cp.pigs ? cp.pigs.length : 0) + '，弹确认框');
      var self = this;
      checkpointDialog.open({
        steps: cp.steps,
        levelName: cp.levelName,
        onConfirm: function() {
          console.log('[LOG] 用户确认恢复存档');
          self.startLastLevel();
        },
        onCancel: function() {
          console.log('[LOG] 用户放弃恢复，清理存档');
          try { wx.removeStorageSync('game_checkpoint'); } catch (e) {}
        }
      });
      console.log('[LOG] ===== _checkAutoStart 结束（弹确认框） =====');
      return;
    }

    console.log('[LOG] ✗ 进度=' + liNum + '，无存档，停在主菜单');
    console.log('[LOG] ===== _checkAutoStart 结束 =====');
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
   * 画设置按钮 — 与 drawIconBtn 同款圆形底，但图标用矢量齿轮
   */
  _drawSettingsBtn(x, y, iconSize) {
    var C = this.COLORS;
    var cx = x + iconSize / 2;
    var cy = y + iconSize / 2;

    // 设置图标
    ctx.drawImage(commonIcons.setting, cx - iconSize / 2, cy - iconSize / 2, iconSize, iconSize);

    return { x: x, y: y, w: iconSize, h: iconSize };
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
    if (databus.gameState === 'levelSelect') return;

    // 读取上次关卡索引
    var levelIndex = 0;
    try {
      var saved = wx.getStorageSync('lastLevelIndex');
      if (saved !== '' && saved !== undefined && saved !== null) {
        levelIndex = Math.min(parseInt(saved, 10), totalLevels - 1);
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
      if (checkpointDialog.isOpen()) {
        if (e.touches && e.touches[0]) {
          checkpointDialog.handleTouch(e.touches[0].x, e.touches[0].y, e.type);
        }
        return;
      }

      if (e.type === 'touchstart' && e.touches[0]) {
        var t = e.touches[0];

        // 设置面板打开时，所有触控由面板处理
        if (settingsPanel.isOpen()) {
          settingsPanel.handleTouch(t.x, t.y, e.type);
          return;
        }

        // 左下角 100x100 快速 5 连击 → 解锁后门按钮（编辑 + 调试）
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
            this._cornerTapCount = 0;
            clearTimeout(this._cornerTapTimer);
            wx.showToast({ title: '编辑器已解锁', icon: 'none', duration: 1200 });
          }
          return;  // 角落点击不触发按钮
        }

        // 按钮点击
        for (var i = 0; i < this.menuButtons.length; i++) {
            var btn = this.menuButtons[i];
            if (t.x >= btn.x && t.x <= btn.x + btn.w &&
                t.y >= btn.y && t.y <= btn.y + btn.h) {
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

  renderMenu() {
    var C = this.COLORS;
    var safeTop = databus.safeTop;
    var cx = SCREEN_WIDTH / 2;

    // 计算按钮按压缩放
    var pressScale = this._getBtnPressScale();
    var mainScale = this._pressedBtnIdx === 0 ? pressScale : 1;
    var secScale  = this._pressedBtnIdx === 1 ? pressScale : 1;
    var arenaScale = this._pressedBtnIdx === 2 ? pressScale : 1;
    var setScale   = this._pressedBtnIdx === 3 ? pressScale : 1;
    var editScale  = this._pressedBtnIdx === 4 ? pressScale : 1;
    var debugScale = this._pressedBtnIdx === 5 ? pressScale : 1;

    // ===== Frame A（对齐参考，不可见）=====
    var frameA_Y = safeTop;

    // ===== 设置按钮（Frame A 内，left: 16px, top: 6px）=====
    var setIconSize = 42;
    var setBtnX = 16;
    var setBtnY = frameA_Y + 6;
    var setBtnCX = setBtnX + setIconSize / 2;
    var setBtnCY = setBtnY + setIconSize / 2;
    ctx.save();
    ctx.translate(setBtnCX, setBtnCY);
    ctx.scale(setScale, setScale);
    ctx.translate(-setBtnCX, -setBtnCY);
    var setArea = this._drawSettingsBtn(setBtnX, setBtnY, setIconSize);
    ctx.restore();

    // ===== 主界面中央 idle 小猪（目标宽度 = 屏幕 2/3）=====
    var pigCX = SCREEN_WIDTH / 2;
    var pigCY = SCREEN_HEIGHT / 2;
    var pigTargetW = SCREEN_WIDTH * 2 / 3;
    PigRenderer.drawMenuIdlePig(ctx, pigCX, pigCY, pigTargetW);

    // ===== 主按钮：开始游戏（黏土拟态） =====
    var btnW = SCREEN_WIDTH - 64; // 两侧各留32px
    var btnH = 64;
    var btnX = (SCREEN_WIDTH - btnW) / 2;
    var mainBtnY = SCREEN_HEIGHT - 74 - btnH;
    var mainBtnCX = btnX + btnW / 2;
    var mainBtnCY = mainBtnY + btnH / 2;

    // 按压缩放
    ctx.save();
    ctx.translate(mainBtnCX, mainBtnCY);
    ctx.scale(mainScale, mainScale);
    ctx.translate(-mainBtnCX, -mainBtnCY);
    this.drawClayButton(btnX, mainBtnY, btnW, btnH, 32);

    // 按钮文字
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 22px ' + Theme.font.family + '';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🎮 开始游戏', cx, mainBtnY + btnH / 2);
    ctx.restore();

    // ===== 次按钮：关卡选择（开始游戏上方 100px）=====
    var secBtnH = 52;
    var secBtnY = mainBtnY - secBtnH - 50;
    var secBtnCX = btnX + btnW / 2;
    var secBtnCY = secBtnY + secBtnH / 2;

    ctx.save();
    ctx.translate(secBtnCX, secBtnCY);
    ctx.scale(secScale, secScale);
    ctx.translate(-secBtnCX, -secBtnCY);
    this.drawClaySecondary(btnX, secBtnY, btnW, secBtnH, 28);

    ctx.fillStyle = C.primary;
    ctx.font = 'bold 18px ' + Theme.font.family + '';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('📋 关卡选择', cx, secBtnY + secBtnH / 2);
    ctx.restore();

    // ===== 次按钮：装扮（关卡选择上方 20px，金色边框）=====
    var arenaBtnH = 52;
    var arenaBtnY = secBtnY - arenaBtnH - 20;
    var arenaBtnCX = btnX + btnW / 2;
    var arenaBtnCY = arenaBtnY + arenaBtnH / 2;

    ctx.save();
    ctx.translate(arenaBtnCX, arenaBtnCY);
    ctx.scale(arenaScale, arenaScale);
    ctx.translate(-arenaBtnCX, -arenaBtnCY);
    this.drawClaySecondary(btnX, arenaBtnY, btnW, arenaBtnH, 28);

    // 覆盖边框为金色（而非默认粉色）
    ctx.strokeStyle = '#FBE0B3';
    ctx.lineWidth = 3;
    this.roundRect(ctx, btnX, arenaBtnY, btnW, arenaBtnH, 28);
    ctx.stroke();

    ctx.fillStyle = '#D97706';
    ctx.font = 'bold 18px ' + Theme.font.family + '';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🎨 装扮', cx, arenaBtnY + arenaBtnH / 2);
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
      { x: btnX, y: mainBtnY, w: btnW, h: btnH, action: function() { self.startLastLevel(); } },
      { x: btnX, y: secBtnY, w: btnW, h: secBtnH, action: function() { self._hasLeftMenu = true; databus.gameState = 'levelSelect'; } },
      { x: btnX, y: arenaBtnY, w: btnW, h: arenaBtnH, action: function() { ShopPanel.open(); } },
      { x: setArea.x, y: setArea.y, w: setArea.w, h: setArea.h,
        action: function() { settingsPanel.open({ title: '设置' }); }
      }
    ];

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

    // 设置面板（最顶层）
    settingsPanel.render(ctx);

    // 商城面板（比设置面板更高一层）
    ShopPanel.render(ctx);

    // 存档恢复确认弹窗（最高层）
    checkpointDialog.render(ctx);
  }

  // ========== 主循环 ==========
  update() {
    databus.frame++;

    // 过渡动画进行中 → 屏蔽输入（让动画跑完）
    if (TransitionManager.isActive()) {
      TransitionManager.getProgress(); // 驱动状态机
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

    // 启动场景过渡动画（在引擎切换之前）
    if (prev && curr && curr !== prev) {
      TransitionManager.start(prev, curr);
    }

    // 切场景：停止所有 SFX，避免残留音效
    audio.onSceneChange();

    // 反激活旧状态
    switch (prev) {
      case 'editor':      this.editor.deactivate();        break;
      case 'levelSelect': this.levelSelect.deactivate();   break;
      case 'playing':     this.playing.deactivate();       break;
    }

    // 激活新状态（menu 的输入在 setupMenuInput 已注册）
    switch (curr) {
      case 'menu':       audio.playMusic('menu'); break;
      case 'editor':      this.editor.activate();  audio.playMusic('editor');   break;
      case 'levelSelect': this.levelSelect.activate(); audio.playMusic('levelSelect'); break;
      case 'playing':     this.playing.activate(); audio.playMusic('playing'); break;
    }

    this._prevState = curr;
  }

  render() {
    beginFrame();
    this.drawBackground();

    // 场景过渡动画
    var trans = TransitionManager.getProgress();
    if (trans && !trans.done) {
      var sw = databus.screenWidth;
      var offset = 0;

      if (trans.direction === 'forward') {
        // 新场景从右侧滑入
        offset = sw * (1 - trans.t);
      } else if (trans.direction === 'back') {
        // 新场景从左侧滑入
        offset = -sw * (1 - trans.t);
      }
      // fade: offset = 0（无滑入，直接叠在上面）

      ctx.save();
      if (trans.direction === 'fade') {
        ctx.globalAlpha = trans.t;
      } else {
        ctx.translate(offset, 0);
      }
      this._renderCurrentScene();
      ctx.restore();
    } else {
      this._renderCurrentScene();
    }

    // 开发者调试面板 — 最顶层渲染
    DebugPanel.render(databus, this);
    present();
  }

  _renderCurrentScene() {
    switch (databus.gameState) {
      case 'menu':
        this.renderMenu();
        break;
      case 'levelSelect':
        this.levelSelect.render();
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
