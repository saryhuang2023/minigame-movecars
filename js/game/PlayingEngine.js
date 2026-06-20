// 关卡游玩引擎 — 组合 GameplayEngine 实现正式玩法

const databus = require('../databus.js');
const { ctx, SCREEN_WIDTH, SCREEN_HEIGHT } = require('../render.js');
const GameplayEngine = require('../core/GameplayEngine.js');

// Ardot 设计稿色彩系统 (fileId: 694583967818218)
// 背景色 #FDF2F8 由 GameEngine.COLORS.bgBottom 统一绘制渐变
const PINK = '#EC4899';     // 关卡徽章
const AMBER = '#F59E0B';    // 速通按钮
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

const DRAG_THRESHOLD = 20;
const SNAP_ANGLE_PUSH_THRESHOLD = 45;
const COMBO_WINDOW = 3000;             // 连击窗口（毫秒）
const COMBO_WIDGET_W = 138;            // 连击组件宽度
const COMBO_WIDGET_H = 40;             // 连击组件高度
const COMBO_WIDGET_R = 20;             // 连击组件圆角
const COMBO_WIDGET_OFFSET = 12;        // 距卡片内容区边缘偏移
const COMBO_ENTRANCE_DURATION = 200;   // 入场弹性动画时长（毫秒）
const COMBO_EXPIRE_FLASH = 200;        // 到期闪烁时长（毫秒）
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
    this._victory = false;
    this._exitBtn = null;
    this._nextBtn = null;
    this._quickPassBtn = null;
    // 连击系统
    this._comboCount = 0;           // 当前连击数
    this._comboTimer = null;        // 重置窗口定时器
    this._maxCombo = 0;             // 本局最大连击
    this._comboStartTime = 0;       // 当前连击窗口起始时间
    this._comboWidget = { visible: false, scale: 1, count: 0, createdAt: 0 };
    // 关主系统
    this._levelMaster = null;       // { avatarUrl, nickname, minSteps, avatarImg } | null
    this._myRecord = null;          // 个人最好成绩（步数）| null
    this._masterLoading = false;
    this._myOpenId = null;          // 当前用户 openid（首次 activate 时异步获取）
    this._userInfo = null;          // { nickName, avatarUrl } 缓存
    this._authBtn = null;           // wx.createUserInfoButton 授权按钮
    this._authShown = false;        // 本局是否已弹出过授权按钮
    this._isNewMaster = false;      // 本局是否成为新关主（用于结算界面文案）
  }

  activate() {
    const lv = databus.currentLevel;
    this.levelName = lv ? lv.name : '';
    this.steps = 0;
    databus.currentStep = 0;
    this._victory = false;
    this._resetCombo();
    // effectiveWidth = 全屏宽度，与编辑器保持一致，确保棋盘缩放不变
    this.gp.effectiveWidth = SCREEN_WIDTH;
    this.loadLevel(lv ? lv.data : null);
    // 记住当前关卡索引，供主界面"开始游戏"使用（只升不降）
    if (databus.currentLevelIndex >= 0) {
      var old = wx.getStorageSync('lastLevelIndex') || -1;
      if (databus.currentLevelIndex > old) {
        wx.setStorageSync('lastLevelIndex', databus.currentLevelIndex);
      }
    }
    this.input.on('playing', (e) => this.handleEvent(e));
    // 加载个人历史记录（同步，瞬间完成）
    var recKey = 'record_' + this.levelName;
    var rawRec = wx.getStorageSync(recKey);
    this._myRecord = (rawRec != null && rawRec !== '') ? rawRec : null;
    console.log('[关主] activate levelName=' + JSON.stringify(this.levelName) + ' recKey=' + recKey + ' rawRec=' + JSON.stringify(rawRec) + ' _myRecord=' + JSON.stringify(this._myRecord));
    // 异步拉取关主（fire-and-forget，不阻塞玩家操作）
    this._masterLoading = false;  // 重置，防止上次请求未完成导致跳过
    this._fetchMyOpenId();
    this._fetchLevelMaster();
  }

  deactivate() {
    this.input.off('playing');
    this._resetCombo();
    this._destroyAuthBtn();
    this._isNewMaster = false;
  }

  loadLevel(data) {
    if (data && data.board) {
      this.gp.cols = data.board.cols || 5;
      this.gp.rows = data.board.rows || 5;
      this.gp.hGap = data.board.hGap || 10;
      this.gp.vGap = data.board.vGap || 10;
      this.gp.diameter = data.board.diameter || 30;
    }
    this.gp.pigs = (data && data.pigs ? data.pigs : []).map(p => ({
      id: p.id, tailIndex: p.tail, length: p.length, angle: p.angle
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
    this.steps = 0;
    this._resetCombo();
  }

  // ========== 输入 ==========
  handleEvent(e) {
    const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    if (!t) return;

    if (e.type === 'touchstart') {
      // 通关界面按钮优先
      if (this._victory) {
        if (this._exitBtn && t.x >= this._exitBtn.x && t.x <= this._exitBtn.x + this._exitBtn.w &&
            t.y >= this._exitBtn.y && t.y <= this._exitBtn.y + this._exitBtn.h) {
          databus.gameState = 'menu';
          return;
        }
        if (this._nextBtn && t.x >= this._nextBtn.x && t.x <= this._nextBtn.x + this._nextBtn.w &&
            t.y >= this._nextBtn.y && t.y <= this._nextBtn.y + this._nextBtn.h) {
          this._goNextLevel();
          return;
        }
        return; // 屏蔽棋盘操作
      }
      this.onTouchStart(t.x, t.y);
    } else if (e.type === 'touchmove') {
      this.onTouchMove(t.x, t.y);
    } else if (e.type === 'touchend') {
      this.onTouchEnd(t.x, t.y);
    }
  }

  onTouchStart(x, y) {
    // 快速通过按钮（测试用）
    if (this._quickPassBtn && x >= this._quickPassBtn.x && x <= this._quickPassBtn.x + this._quickPassBtn.w &&
        y >= this._quickPassBtn.y && y <= this._quickPassBtn.y + this._quickPassBtn.h) {
      this._quickPass();
      return;
    }

    // 顶栏按钮
    if (this.backBtn && x >= this.backBtn.x && x <= this.backBtn.x + this.backBtn.w &&
        y >= this.backBtn.y && y <= this.backBtn.y + this.backBtn.h) {
      databus.gameState = databus.returnState || 'levelSelect';
      return;
    }

    // 底部按钮
    if (this.restartBtn && x >= this.restartBtn.x && x <= this.restartBtn.x + this.restartBtn.w &&
        y >= this.restartBtn.y && y <= this.restartBtn.y + this.restartBtn.h) {
      this.restartLevel();
      return;
    }
    if (this.hintBtn && x >= this.hintBtn.x && x <= this.hintBtn.x + this.hintBtn.w &&
        y >= this.hintBtn.y && y <= this.hintBtn.y + this.hintBtn.h) {
      this._showHint();
      return;
    }

    // 关主卡片左栏点击 → 显示关主昵称
    if (this._masterAvatarRect && x >= this._masterAvatarRect.x && x <= this._masterAvatarRect.x + this._masterAvatarRect.w &&
        y >= this._masterAvatarRect.y && y <= this._masterAvatarRect.y + this._masterAvatarRect.h) {
      if (this._levelMaster) {
        var showName = this._levelMaster.nickname;
        if (!showName) {
          var uid = this._levelMaster.userId || '';
          showName = uid.length > 6 ? '…' + uid.slice(-6) : (uid || '匿名');
        }
        wx.showToast({ title: '关主：' + showName, icon: 'none', duration: 1500 });
        return;
      }
    }

    // 棋盘区域：找小猪，记录触控起点（不立即创建 dragState，等移动超阈值再激活拖拽）
    const hit = this.gp.getPigAtPoint(x, y);
    if (hit) {
      const pig = this.gp.pigs.find(p => p.id === hit.id);
      if (pig) {
        this._touchState = {
          startX: x,
          startY: y,
          pigId: pig.id,
          tailIndex: pig.tailIndex,
          length: pig.length,
          angle: pig.angle
        };
      }
    }
  }

  onTouchMove(x, y) {
    // 尚未激活拖拽：检查是否超过阈值
    if (this._touchState && !this.gp.dragState) {
      const dx = x - this._touchState.startX;
      const dy = y - this._touchState.startY;
      if (dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD) {
        // 超过阈值 → 激活旋转拖拽
        this.gp.dragState = {
          type: 'rotate',
          pigId: this._touchState.pigId,
          tailIndex: this._touchState.tailIndex,
          displayAngle: this._touchState.angle,
          targetAngle: this._touchState.angle,
          lastValid: { tailIndex: this._touchState.tailIndex, length: this._touchState.length, angle: this._touchState.angle },
          headHoleIdx: -1,
          lastCollidedId: null,
          isValidNow: true
        };
      }
    }

    if (this.gp.dragState && this.gp.dragState.type === 'rotate') {
      this.gp.handleRotateDrag(x, y);
    }
  }

  onTouchEnd(x, y) {
    // 轻点（未超过拖拽阈值）→ 直接推出
    if (this._touchState && !this.gp.dragState) {
      const pigId = this._touchState.pigId;
      this._touchState = null;
      this.tryPushPig(pigId);
      return;
    }
    this._touchState = null;

    if (!this.gp.dragState) return;

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

      // snap 成功 = 猪换了位置 → 计步
      if (pig && snapResult) {
        this.steps++;
        databus.currentStep = this.steps;
      }
      // 自动推出时 tryPushPig 内 skipStep 防重复计步
      if (pig && this._shouldPushAfterSnap) {
        this.tryPushPig(pigId, { silentBlock: true, skipStep: true });
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
        startTime: Date.now(), duration: 6400
      });
      // 逻辑层立即移除（结算/计分不受动画影响）
      const idx = this.gp.pigs.findIndex(p => p.id === pigId);
      this.gp.flyingPigs.push(this.gp.pigs[idx]);
      this.gp.pigs.splice(idx, 1);
      this.gp.clearPigOccupancy(pigId);
      if (!opts.skipStep) { this.steps++; databus.currentStep = this.steps; }

      // 连击系统 ——— 每次逃脱触发
      this._triggerCombo();

      // 所有猪都逃脱 → 通关
      if (this.gp.pigs.length === 0) {
        setTimeout(() => {
          this._victory = true;
          // 记录通关关卡
          this._markCleared();
        }, 400);
      }
      // 动画结束后清理渲染层
      setTimeout(() => {
        this.gp.flyingPigs = this.gp.flyingPigs.filter(p => p.id !== pigId);
        this.gp.animations = this.gp.animations.filter(a => a.pigId !== pigId);
      }, 6500);
    } else if (result.collidedPigId !== undefined) {
      if (!opts.silentBlock) {
        this.gp.triggerCollisionEffect(result.collidedPigId);
      }
    }
  }

  restartLevel() {
    this.loadLevel(databus.currentLevel ? databus.currentLevel.data : null);
    this._victory = false;
    this._isNewMaster = false;
  }

  _quickPass() {
    // 测试用：清空所有猪，直接通关
    this._resetCombo();
    this.gp.pigs = [];
    this.gp.escapeQueue = [];
    this.gp.flyingPigs = [];
    this.gp.rebuildOccupancy();
    this._victory = true;
    // 也记录通关
    this._markCleared();
  }

  _markCleared() {
    console.log('[关主] _markCleared called, level=' + this.levelName + ' steps=' + this.steps);
    var cleared = [];
    try {
      var raw = wx.getStorageSync('clearedLevels');
      if (raw) cleared = JSON.parse(raw);
    } catch (e) { cleared = []; }
    var name = databus.currentLevel ? databus.currentLevel.name : '';
    if (name && cleared.indexOf(name) === -1) {
      cleared.push(name);
      wx.setStorageSync('clearedLevels', JSON.stringify(cleared));
    }
    // 尝试夺关主
    this._tryClaimMaster();
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
      wx.setStorageSync('lastLevelIndex', idx);
      // 直接加载到当前引擎（gameState 不变，checkStateTransition 不会重新 activate）
      this.levelName = next.name;
      this.loadLevel(data);
      this._victory = false;
      this._authShown = false;
      this._destroyAuthBtn();
      this._isNewMaster = false;
      // 关主信息切换
      this._levelMaster = null;
      this._masterLoading = false;
      this._myRecord = wx.getStorageSync('record_' + this.levelName) || null;
      this._fetchLevelMaster();
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
    cloud.getLevelMaster(this.levelName)
      .then(master => {
        console.log('[关主] _fetchLevelMaster success master=' + JSON.stringify(master));
        this._levelMaster = master;
        this._masterLoading = false;
        if (master) {
          if (!master.nickname) console.log('[关主] 云端记录缺少 nickname');
          if (!master.avatarUrl) console.log('[关主] 云端记录缺少 avatarUrl');
        }
        if (master && master.avatarUrl) {
          this._loadAvatarImage(master.avatarUrl).then(function(img) {
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
    if (wx.getDeviceInfo().platform === 'devtools') {
      console.log('[关主] 开发环境跳过夺位上报');
      return;
    }
    const currentMin = this._levelMaster ? this._levelMaster.minSteps : 9999;
    this._updateMyRecord();
    if (this.steps >= currentMin) return; // 持平不夺

    // ✅ 乐观 UI：立即弹出授权按钮，不等服务器确认
    this._showMasterAuthButton();

    // 后台异步夺位上报（静默，不阻塞玩家）
    this._getUserInfo().then(userInfo => {
      var hasRealAvatar = !!userInfo.avatarUrl;
      const cloud = require('../cloud.js');
      console.log('[关主] _tryClaimMaster 后台上报 avatarUrl=' + (userInfo.avatarUrl ? '有' : '空') + ' nickName=' + userInfo.nickName);
      cloud.claimLevelMaster(this.levelName, this.steps, userInfo.avatarUrl || '', userInfo.nickName || '')
        .then(res => {
          if (res.code === 0) {
            this._levelMaster = res.master;
            if (res.master && res.master.avatarUrl) {
              this._loadAvatarImage(res.master.avatarUrl).then(function(img) {
                if (this._levelMaster) this._levelMaster.avatarImg = img;
              }.bind(this)).catch(function(err) {
                console.warn('[关主] claim avatar load error:', err);
              });
            }
            if (res.claimed) {
              // 标记为新关主，结算界面显示恭喜文案
              this._isNewMaster = true;
              // 服务器已返回真实头像 → 无需授权按钮，销毁
              if (hasRealAvatar) {
                this._destroyAuthBtn();
              }
            } else {
              // 服务器说没夺到（别人步数更少或持平不同人）→ 撤回授权按钮
              console.log('[关主] 服务器返回 claimed=false，撤回授权按钮');
              this._destroyAuthBtn();
            }
          }
        })
        .catch(err => {
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
          resolve(this._userInfo);
        }.bind(this),
        fail: function() {
          var nick = '';
          if (this._myOpenId) nick = '玩家' + this._myOpenId.slice(-4);
          this._userInfo = { nickName: nick, avatarUrl: '' };
          resolve(this._userInfo);
        }.bind(this)
      });
    }.bind(this));
  }

  // 销毁授权按钮（切换关卡或退出时清理）
  _destroyAuthBtn() {
    if (this._authBtn) {
      try { this._authBtn.destroy(); } catch (e) {}
      this._authBtn = null;
    }
  }

  // 乐观 UI：通关后立即弹出授权按钮，不等服务器确认
  // 玩家点击后获取真实头像昵称并重传关主信息
  _showMasterAuthButton() {
    if (this._authShown) return;
    this._authShown = true;

    // 与 renderVictoryOverlay 保持一致的弹窗位置计算
    var hasCombo = this._maxCombo >= 2;
    var ph = hasCombo ? 220 : 200;
    var py = (SCREEN_HEIGHT - ph) / 2 - 20;
    var authW = 220, authH = 44;
    var authX = (SCREEN_WIDTH - authW) / 2;
    // 放在"共 X 步"和按钮之间
    var authY = py + 88;

    var that = this;
    console.log('[关主] _showMasterAuthButton 弹出授权按钮 level=' + this.levelName + ' steps=' + this.steps);
    this._authBtn = wx.createUserInfoButton({
      type: 'text',
      text: '\uD83D\uDC51 恭喜你成为关主！点击授权显示头像',
      style: {
        left: authX,
        top: authY,
        width: authW,
        height: authH,
        lineHeight: authH,
        backgroundColor: '#FFD700',
        color: '#1a1a2e',
        textAlign: 'center',
        fontSize: 15,
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
        // 重新上传关主信息（这次带真实头像昵称）
        var cloud = require('../cloud.js');
        cloud.claimLevelMaster(that.levelName, that.steps, info.avatarUrl || '', info.nickName || '')
          .then(function(result) {
            console.log('[关主] onTap claimLevelMaster 返回 code=' + (result ? result.code : 'null') + ' claimed=' + (result ? result.claimed : 'null') + ' msg=' + (result ? result.msg : ''));
            if (result && result.code === 0) {
              that._levelMaster = result.master;
              if (result.master && result.master.avatarUrl) {
                that._loadAvatarImage(result.master.avatarUrl).then(function(img) {
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

    var badgeW = 150;
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
    var isMe = this._levelMaster && this._myOpenId && this._levelMaster.userId === this._myOpenId;
    ctx.fillStyle = isMe ? '#EC4899' : '#334155';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText(isMe ? '我是关主' : '⭐关主', leftCx, badgeY + 8);

    if (this._levelMaster) {
      // 头像（圆形裁剪）
      ctx.save();
      ctx.beginPath();
      ctx.arc(leftCx, badgeY + 36, 14, 0, Math.PI * 2);
      ctx.clip();
      if (this._levelMaster.avatarImg) {
        ctx.drawImage(this._levelMaster.avatarImg, leftCx - 14, badgeY + 22, 28, 28);
      } else {
        // 头像未加载完成 → 粉色占位
        ctx.fillStyle = '#FCE9F2';
        ctx.fillRect(leftCx - 14, badgeY + 22, 28, 28);
      }
      ctx.restore();

      // 步数
      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 13px sans-serif';
      ctx.fillText(this._levelMaster.minSteps + '步', leftCx, badgeY + 55);
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
    var recText = this._myRecord != null ? ('我的记录:' + this._myRecord + '步') : '我的记录:无';
    ctx.fillText(recText, rightX, badgeY + 20);

    // 当前步数（金色强调）
    ctx.fillStyle = '#F59E0B';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('当前步数:' + this.steps + '步', rightX, badgeY + 40);

    ctx.textAlign = 'center'; // 复位
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
    this.gp.renderBoard(ctx, 0, 0);

    // 3. 连击组件（棋盘卡片内左上角）
    this._renderComboWidget();

    // 3.5 关主卡片（棋盘卡片内左下角）
    this._renderMasterBadge();

    // 4. 顶栏
    this._drawTopBar(safeTop);

    // 5. 底部栏
    this._drawBottomBar();

    // 6. 通关弹窗
    if (this._victory) {
      this.renderVictoryOverlay();
    }
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
    const barY = safeTop + PADDING - 60;
    const barW = this._boardCardW;

    // === 返回按钮（左侧）===
    const backW = 49, backH = 47;
    const backX = PADDING;
    const backY = barY + (TOP_BAR_H - backH) / 2;
    this.backBtn = { x: backX, y: backY, w: backW, h: backH };

    // 白色半透明底 + 圆角 18
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    this._roundRect(ctx, backX, backY, backW, backH, 18);
    ctx.fill();
    // 箭头（深色矢量 ←）
    ctx.fillStyle = DARK;
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('\u2190', backX + backW / 2, backY + backH / 2);

    // === 关卡徽章（居中）===
    const levelText = this.levelName || '\u7B2C 1 \u5173';
    ctx.font = 'bold 14px sans-serif';
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
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(levelText, levelX + levelW / 2, levelY + levelH / 2);

    // === 速通按钮（最右）===
    const qpW = 40, qpH = 31;
    const qpX = PADDING + barW - qpW;
    const qpY = barY + (TOP_BAR_H - qpH) / 2;
    this._quickPassBtn = { x: qpX, y: qpY, w: qpW, h: qpH };

    ctx.fillStyle = AMBER;
    this._roundRect(ctx, qpX, qpY, qpW, qpH, 12);
    ctx.fill();
    ctx.fillStyle = DARK;
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('\u901F\u901A', qpX + qpW / 2, qpY + qpH / 2);

    ctx.textAlign = 'center'; // 复位
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

    this._whiteBtn(resetX, btnY, btnW, btnH);
    ctx.fillStyle = RED;
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('\u91CD\u7F6E', resetX + btnW / 2, btnY + btnH / 2);

    // === 提示按钮 ===
    const hintX = resetX - btnW - gap;
    this.hintBtn = { x: hintX, y: btnY, w: btnW, h: btnH };

    this._whiteBtn(hintX, btnY, btnW, btnH);
    ctx.fillStyle = PURPLE;
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('\u63D0\u793A', hintX + btnW / 2, btnY + btnH / 2);
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

  _showHint() {
    // 提示功能占位 — 后续实现
    if (typeof wx !== 'undefined' && wx.showToast) {
      wx.showToast({ title: '\u63D0\u793A\u529F\u80FD\u5F00\u53D1\u4E2D', icon: 'none', duration: 1500 });
    }
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
  renderVictoryOverlay() {
    // 半透明遮罩
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    const hasCombo = this._maxCombo >= 2;
    const isNewMaster = this._isNewMaster;

    // 弹窗面板（有连击或新关主时加高）
    var ph = 200;
    if (hasCombo) ph += 20;
    if (isNewMaster) ph += 22;
    const pw = 260;
    const px = (SCREEN_WIDTH - pw) / 2;
    const py = (SCREEN_HEIGHT - ph) / 2 - 20;

    ctx.fillStyle = 'rgba(26, 26, 46, 0.95)';
    this._roundRect(ctx, px, py, pw, ph, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 215, 0, 0.5)';
    ctx.lineWidth = 2;
    this._roundRect(ctx, px, py, pw, ph, 16);
    ctx.stroke();

    // 标题
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('通关成功！', SCREEN_WIDTH / 2, py + 44);

    // 步数
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '14px sans-serif';
    ctx.fillText(`共 ${this.steps} 步`, SCREEN_WIDTH / 2, py + 78);

    // 最大连击（≥2 时展示）
    var nextY = py + 78;  // 追踪下一行 Y 坐标
    if (hasCombo) {
      ctx.fillStyle = '#FF9800';
      ctx.font = 'bold 15px sans-serif';
      ctx.fillText(`🔥 最大连击 ${this._maxCombo}`, SCREEN_WIDTH / 2, py + 112);
      nextY = py + 112;
    }

    // 新关主文案
    if (isNewMaster) {
      ctx.fillStyle = '#FFD700';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText('👑 恭喜你成为新的关主！', SCREEN_WIDTH / 2, nextY + 22);
      nextY = nextY + 22;
    }

    // 按钮（紧随最后一行内容）
    const btnY = nextY + 34;
    const btnW = 100, btnH = 42;
    const gap = 20;
    const totalBtnW = btnW * 2 + gap;
    const btnStartX = (SCREEN_WIDTH - totalBtnW) / 2;

    // 退出按钮
    const exitX = btnStartX;
    this._exitBtn = { x: exitX, y: btnY, w: btnW, h: btnH };
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    this._roundRect(ctx, exitX, btnY, btnW, btnH, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText('退出', exitX + btnW / 2, btnY + btnH / 2);

    // 下一关按钮
    const nextX = btnStartX + btnW + gap;
    const hasNext = databus.currentLevelIndex + 1 < databus.projectLevels.length;
    this._nextBtn = { x: nextX, y: btnY, w: btnW, h: btnH };
    ctx.fillStyle = hasNext ? '#4CAF50' : 'rgba(76, 175, 80, 0.3)';
    this._roundRect(ctx, nextX, btnY, btnW, btnH, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(hasNext ? '下一关' : '已完成', nextX + btnW / 2, btnY + btnH / 2);
  }

  // ========== 连击系统 ==========
  _resetCombo() {
    this._comboCount = 0;
    if (this._comboTimer) { clearTimeout(this._comboTimer); this._comboTimer = null; }
    this._maxCombo = 0;
    this._comboStartTime = 0;
    this._comboWidget = { visible: false, scale: 1, count: 0, createdAt: 0 };
  }

  _triggerCombo() {
    this._comboCount++;
    if (this._comboCount > this._maxCombo) this._maxCombo = this._comboCount;
    this._comboStartTime = Date.now();

    // 重置窗口计时器
    if (this._comboTimer) clearTimeout(this._comboTimer);
    this._comboTimer = setTimeout(() => {
      this._comboCount = 0;
      this._comboWidget.visible = false;
      this._comboTimer = null;
    }, COMBO_WINDOW);

    // 2 连及以上才展示组件
    if (this._comboCount >= 2) {
      this._comboWidget.visible = true;
      this._comboWidget.count = this._comboCount;
      this._comboWidget.scale = 0;   // 入场从 0 开始
      this._comboWidget.createdAt = Date.now();
    }
  }

  _renderComboWidget() {
    const w = this._comboWidget;
    if (!w.visible) return;

    const now = Date.now();
    const remaining = COMBO_WINDOW - (now - this._comboStartTime);
    if (remaining <= 0) return;

    const progress = remaining / COMBO_WINDOW;  // 1.0 → 0.0

    // 入场弹性动画：scale 0→1.15→1.0 持续 200ms
    const age = now - w.createdAt;
    if (age < COMBO_ENTRANCE_DURATION) {
      const t = age / COMBO_ENTRANCE_DURATION;
      // easeOutBack: overshoot then settle
      w.scale = 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
      w.scale = Math.max(0, Math.min(w.scale, 1.15));
    } else {
      w.scale = 1;
    }

    // 进度条颜色
    let barColor, textAlpha;
    if (progress > 0.5) {
      barColor = COMBO_COLOR_SAFE;
      textAlpha = 1;
    } else if (progress > 0.25) {
      barColor = COMBO_COLOR_WARN;
      textAlpha = 1;
    } else {
      barColor = COMBO_COLOR_DANGER;
      textAlpha = 0.5 + 0.5 * (progress / 0.25); // 0.25→0.0 映射 1→0.5
    }

    // 计算位置
    const wx = 0;  // 屏幕最左边贴边
    const wy = this._boardCardY;  // 上边缘贴着棋盘卡片
    const barWidth = COMBO_WIDGET_W * progress;

    ctx.save();

    // 入场缩放变换（围绕组件中心）
    const centerX = wx + COMBO_WIDGET_W / 2;
    const centerY = wy + COMBO_WIDGET_H / 2;
    ctx.translate(centerX, centerY);
    ctx.scale(w.scale, w.scale);
    ctx.translate(-centerX, -centerY);

    // 1. 容器背景 — 主题粉 5%（最底层）
    ctx.fillStyle = 'rgba(236, 72, 153, 0.05)';
    ctx.beginPath();
    this._roundRectPath(ctx, wx, wy, COMBO_WIDGET_W, COMBO_WIDGET_H, COMBO_WIDGET_R);
    ctx.fill();

    // 2. 暗色占位槽（进度条空余部分）
    ctx.fillStyle = 'rgba(61, 61, 92, 0.12)';
    ctx.beginPath();
    this._roundRectPath(ctx, wx, wy, COMBO_WIDGET_W, COMBO_WIDGET_H, COMBO_WIDGET_R);
    ctx.fill();

    // 3. 进度条填充（从右向左收拢 — clip 到容器圆角内确保不越界）
    ctx.save();
    ctx.beginPath();
    this._roundRectPath(ctx, wx, wy, COMBO_WIDGET_W, COMBO_WIDGET_H, COMBO_WIDGET_R);
    ctx.clip();
    ctx.fillStyle = barColor;
    ctx.fillRect(wx, wy, barWidth, COMBO_WIDGET_H);
    ctx.restore();

    // 4. 文字（居中覆盖）— 字号调小一号，Y 坐标下移 2px 修正视觉对齐
    ctx.globalAlpha = textAlpha;
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
