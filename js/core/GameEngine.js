// 游戏主循环引擎

const databus = require('../databus.js');
const cloud = require('../cloud.js');
const audio = require('../audio/AudioManager.js');
const settingsPanel = require('../ui/SettingsPanel.js');
const Easing = require('./Easing.js');
const TransitionManager = require('./TransitionManager.js');
const { ctx, SCREEN_WIDTH, SCREEN_HEIGHT, beginFrame, present } = require('../render.js');
const InputManager = require('./InputManager.js');
const EditorEngine = require('../editor/EditorEngine.js');
const LevelSelectEngine = require('../game/LevelSelectEngine.js');
const PlayingEngine = require('../game/PlayingEngine.js');
const BugReporter = require('../debug/BugReporter.js');
const DebugPanel = require('../debug/DebugPanel.js');
const { drawComposedPig, getComposedPigSize } = require('../render/PigRenderer.js');

class GameEngine {
  constructor() {
    console.log('[GameEngine] constructor 开始');
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
    this.bgImg.src = 'assets/images/bg.jpeg';

    // 菜单按钮
    this.menuButtons = [];
    this._titleTapCount = 0; // 标题连击计数，满 5 次显示编辑器入口
    this._titleLongPressTimer = null;  // 标题长按计时器（模拟器弹 debug 面板用）
    this._pressedBtnIdx = -1;   // 当前被按下的按钮索引（用于按压动画）
    this._pressedBtnTime = 0;   // 按钮按下时间

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

    // 加载章节配置
    try {
      var chapterRaw = wx.getFileSystemManager().readFileSync('assets/levels/chapter.json', 'utf8');
      databus.chapters = JSON.parse(chapterRaw);
      console.log('[GameEngine] 章节配置加载成功: ' + databus.chapters.length + '章');
    } catch (e) {
      console.warn('[GameEngine] 加载 chapter.json 失败:', e);
      databus.chapters = [];
    }

    databus.gameState = 'menu';
    console.log('[GameEngine] 设置 gameState=menu');
    this.setupMenuInput();
    console.log('[GameEngine] 菜单输入注册完成');
    this.loop();
    console.log('[GameEngine] 主循环已启动');

    // 异步从云端拉取玩家数据，合并到本地（换设备恢复进度）
    this._syncFromCloud();
  }

  _syncFromCloud() {
    var self = this;
    cloud.getPlayerData().then(function(res) {
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
      self._checkAutoStart();
    }).catch(function(err) {
      console.warn('[Cloud] 拉取云端数据失败（非阻塞）:', err && err.message);
      self._checkAutoStart();
    });
  }

  // 新玩家自动开始游戏：进度未到第5关时，进入主菜单后立刻自动进入关卡
  _checkAutoStart() {
    if (this._didAutoStart) return;
    this._didAutoStart = true;
    var li = wx.getStorageSync('lastLevelIndex');
    var liNum = (li !== '' && li !== undefined && li !== null) ? parseInt(li, 10) : -1;
    if (liNum < 5) {
      console.log('[AutoStart] 新玩家进度=' + liNum + '，自动开始游戏');
      this.startLastLevel();
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
    ctx.font = Math.round(iconSize * 0.45) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, cx, cy);

    // 标签文字
    if (label) {
      ctx.fillStyle = C.textMuted;
      ctx.font = 'bold 11px sans-serif';
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

    // 圆形底（同 drawIconBtn）
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

    // 矢量齿轮图标
    settingsPanel.drawGearIcon(ctx, cx, cy, iconSize * 0.4, C.primary);

    // 标签文字
    ctx.fillStyle = C.textMuted;
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('设置', cx, cy + iconSize / 2 + 6);

    return { x: x, y: y, w: iconSize, h: iconSize + 22 };
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
    var fs = wx.getFileSystemManager();
    var levelIndex = 0;
    var projectLevels = [];

    // 读取关卡索引文件
    try {
      var indexRaw = fs.readFileSync('assets/levels/index.json', 'utf8');
      var indexData = JSON.parse(indexRaw);
      // 兼容两种格式：纯数组 或 { files: [...] }
      var files = Array.isArray(indexData) ? indexData : (indexData.files || []);
      projectLevels = [];
      for (var i = 0; i < files.length; i++) {
        var f = files[i];
        var file = typeof f === 'string' ? f : f.file;
        if (!file || file === 'index.json' || !file.endsWith('.json')) continue;
        var name = file.replace('.json', '');
        var extra = typeof f === 'object' ? Object.assign({}, f) : {};
        delete extra.file;
        projectLevels.push(Object.assign({ name: name, file: file }, extra));
      }
    } catch (e) {
      console.warn('[GameEngine] 读取 index.json 失败:', e);
      // 降级：跳转关卡选择
      databus.gameState = 'levelSelect';
      return;
    }

    if (projectLevels.length === 0) {
      wx.showToast({ title: '没有关卡', icon: 'none', duration: 1500 });
      return;
    }

    // 读取上次关卡索引
    try {
      var saved = wx.getStorageSync('lastLevelIndex');
      if (saved !== '' && saved !== undefined && saved !== null) {
        levelIndex = Math.min(parseInt(saved, 10), projectLevels.length - 1);
        levelIndex = Math.max(levelIndex, 0);
      }
    } catch (e) {
      levelIndex = 0;
    }

    var lv = projectLevels[levelIndex];
    try {
      var raw = fs.readFileSync('assets/levels/' + lv.file, 'utf8');
      var data = JSON.parse(raw);
      databus.currentLevel = { name: lv.name, data: data };
      databus.currentLevelIndex = levelIndex;
      databus.projectLevels = projectLevels;
      databus.returnState = 'menu';
      databus.gameState = 'playing';
    } catch (err) {
      console.warn('[GameEngine] 加载关卡 ' + lv.file + ' 失败:', err);
      wx.showToast({ title: '加载关卡失败', icon: 'none', duration: 1500 });
    }
  }

  setupMenuInput() {
    var self = this;
    // 标题区域命中检测（复用）
    function _inTitleArea(t) {
      var tx = self._titleHitX, ty = self._titleHitY;
      var tw = self._titleHitW || 120, th = self._titleHitH || 120;
      return tx !== undefined && t.x >= tx && t.x <= tx + tw && t.y >= ty && t.y <= ty + th;
    }

    this.input.on('menu', (e) => {
      if (e.type === 'touchstart' && e.touches[0]) {
        var t = e.touches[0];

        // 设置面板打开时，所有触控由面板处理
        if (settingsPanel.isOpen()) {
          settingsPanel.handleTouch(t.x, t.y, e.type);
          return;
        }

        var inTitle = _inTitleArea(t);

        // 标题连击检测（5 次解锁编辑器入口 — 点击猪鼻Logo区域）
        if (inTitle && this._titleTapCount < 5) {
          this._titleTapCount++;
          if (this._titleTapCount >= 5) {
            wx.showToast({ title: '编辑器已解锁', icon: 'none', duration: 1200 });
          }
        }

        // 标题长按 2 秒 → 弹出调试面板（模拟器友好：不需要三指）
        if (inTitle) {
          this._cancelTitleLongPress();
          this._titleLongPressTimer = setTimeout(function () {
            self._titleLongPressTimer = null;
            DebugPanel.toggle();
          }, 2000);
        }

        // 按钮点击（标题区域不触发按钮）
        if (!inTitle) {
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
      }

      // 手抬起 → 取消长按；移动仅当手指离开标题区域时才取消（真机电容屏有微抖动，不打断区域内长按）
      if (e.type === 'touchend') {
        this._cancelTitleLongPress();
      } else if (e.type === 'touchmove' && e.touches[0]) {
        if (!_inTitleArea(e.touches[0])) {
          this._cancelTitleLongPress();
        }
      }
    });
  }

  _cancelTitleLongPress() {
    if (this._titleLongPressTimer) {
      clearTimeout(this._titleLongPressTimer);
      this._titleLongPressTimer = null;
    }
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
    var shareScale = this._pressedBtnIdx === 3 ? pressScale : 1;
    var setScale   = this._pressedBtnIdx === 4 ? pressScale : 1;
    var editScale  = this._pressedBtnIdx === 5 ? pressScale : 1;

    // ===== 天空渐变背景 =====
    var bgGrad = ctx.createLinearGradient(0, 0, 0, SCREEN_HEIGHT);
    bgGrad.addColorStop(0, C.bgTop);
    bgGrad.addColorStop(0.4, C.bgMid);
    bgGrad.addColorStop(1, C.bgBottom);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    // ===== 猪鼻子 Logo =====
    var logoSize = 72;
    var logoY = safeTop + 70;
    this.drawPigNoseLogo(cx, logoY, logoSize);

    // 记录标题碰撞区域（用于5连击解锁编辑器）
    this._titleHitX = cx - logoSize / 2;
    this._titleHitY = logoY - logoSize / 2;
    this._titleHitW = logoSize;
    this._titleHitH = logoSize;

    // ===== 游戏标题 + 副标题 =====
    var titleY = logoY + logoSize / 2 + 28;
    ctx.fillStyle = C.textDark;
    ctx.font = 'bold 34px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('猪了个猪呀', cx, titleY);

    ctx.fillStyle = C.textMuted;
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('推一推，消除烦恼', cx, titleY + 22);

    // ===== 主按钮：开始游戏（黏土拟态） =====
    var btnW = SCREEN_WIDTH - 64; // 两侧各留32px
    var btnH = 64;
    var btnX = (SCREEN_WIDTH - btnW) / 2;
    var mainBtnY = titleY + 80;
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
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🎮 开始游戏', cx, mainBtnY + btnH / 2);
    ctx.restore();

    // ===== 次按钮：关卡选择 =====
    var secBtnH = 52;
    var secBtnY = mainBtnY + btnH + 12;
    var secBtnCX = btnX + btnW / 2;
    var secBtnCY = secBtnY + secBtnH / 2;

    ctx.save();
    ctx.translate(secBtnCX, secBtnCY);
    ctx.scale(secScale, secScale);
    ctx.translate(-secBtnCX, -secBtnCY);
    this.drawClaySecondary(btnX, secBtnY, btnW, secBtnH, 28);

    ctx.fillStyle = C.primary;
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('📋 关卡选择', cx, secBtnY + secBtnH / 2);
    ctx.restore();

    // ===== 次按钮：竞技大厅（金色边框） =====
    var arenaBtnH = 52;
    var arenaBtnY = secBtnY + secBtnH + 12;
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
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🏆 竞技大厅', cx, arenaBtnY + arenaBtnH / 2);
    ctx.restore();

    // ===== 统计卡片 =====
    var cardY = arenaBtnY + arenaBtnH + 20;
    var cardH = 70;
    this.drawScoreCard(btnX, cardY, btnW, cardH, 22);

    // 左边：最高分
    var leftCX = btnX + btnW * 0.28;
    ctx.fillStyle = C.textMuted;
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🏆 最高分', leftCX, cardY + 21);
    ctx.fillStyle = C.textDark;
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText('128', leftCX, cardY + 49);

    // 分隔线
    var dividerX = btnX + btnW * 0.5;
    ctx.strokeStyle = C.borderLight;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(dividerX, cardY + 14);
    ctx.lineTo(dividerX, cardY + cardH - 14);
    ctx.stroke();

    // 右边：已通关
    var clearedCount = wx.getStorageSync('lastLevelIndex') || 0;
    var rightCX = btnX + btnW * 0.72;
    ctx.fillStyle = C.textMuted;
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🎯 已通关', rightCX, cardY + 21);
    ctx.fillStyle = C.accent;
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText(`${clearedCount} 关`, rightCX, cardY + 49);

    // ===== 底部图标行：分享 + 设置 + 编辑（隐藏入口） =====
    var iconSize = 48;
    var bottomY = SCREEN_HEIGHT - iconSize - 56;

    var shareCX = cx - iconSize - 24 + iconSize / 2;
    var shareCY = bottomY + iconSize / 2;
    ctx.save();
    ctx.translate(shareCX, shareCY);
    ctx.scale(shareScale, shareScale);
    ctx.translate(-shareCX, -shareCY);
    var shareArea = this.drawIconBtn(cx - iconSize - 24, bottomY, iconSize, '📤', '分享');
    ctx.restore();

    // 设置 — 使用矢量齿轮图标
    var setX = cx + 24;
    var setCX = setX + iconSize / 2;
    var setCY = bottomY + iconSize / 2;
    ctx.save();
    ctx.translate(setCX, setCY);
    ctx.scale(setScale, setScale);
    ctx.translate(-setCX, -setCY);
    var setArea = this._drawSettingsBtn(setX, bottomY, iconSize);
    ctx.restore();

    // 编辑器入口 — 屏幕右下角，连击标题 5 次后显示
    var editArea = null;
    if (this._titleTapCount >= 5) {
      var editBtnX = SCREEN_WIDTH - iconSize - 20;
      var editBtnCX = editBtnX + iconSize / 2;
      ctx.save();
      ctx.translate(editBtnCX, shareCY);
      ctx.scale(editScale, editScale);
      ctx.translate(-editBtnCX, -shareCY);
      editArea = this.drawIconBtn(editBtnX, bottomY, iconSize, '🔧', '编辑');
      ctx.restore();
    }

    // ===== 注册按钮碰撞区域 =====
    var self = this;
    this.menuButtons = [
      { x: btnX, y: mainBtnY, w: btnW, h: btnH, action: function() { self.startLastLevel(); } },
      { x: btnX, y: secBtnY, w: btnW, h: secBtnH, action: function() { databus.gameState = 'levelSelect'; } },
      { x: btnX, y: arenaBtnY, w: btnW, h: arenaBtnH, action: function() { /* 竞技大厅 — 暂未开放 */ } },
      { x: shareArea.x, y: shareArea.y, w: shareArea.w, h: shareArea.h,
        action: function() { wx.shareAppMessage({ title: '猪了个猪呀，快来一起推猪猪！' }); }
      },
      { x: setArea.x, y: setArea.y, w: setArea.w, h: setArea.h,
        action: function() { settingsPanel.open(); }
      }
    ];

    // 编辑器按钮碰撞区域
    if (editArea) {
      this.menuButtons.push({
        x: editArea.x, y: editArea.y, w: editArea.w, h: editArea.h,
        action: function() { databus.gameState = 'editor'; }
      });
    }

    // 设置面板（最顶层）
    settingsPanel.render(ctx);
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
      case 'menu':
        // 未解锁时重置连击计数（已解锁则保持，入口不再隐藏）
        if (this._titleTapCount < 5) this._titleTapCount = 0;
        audio.playMusic('menu');
        break;
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
    var C = this.COLORS;
    var grad = ctx.createLinearGradient(0, 0, 0, SCREEN_HEIGHT);
    grad.addColorStop(0, C.bgTop);
    grad.addColorStop(0.4, C.bgMid);
    grad.addColorStop(1, C.bgBottom);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
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
