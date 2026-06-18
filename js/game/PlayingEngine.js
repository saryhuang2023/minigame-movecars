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
const CARD_GAP = 20;        // 卡片之间的间距
const CARD_PADDING = 24;    // 棋盘卡片内边距
const CARD_RADIUS = 32;     // 棋盘卡片圆角

const DRAG_THRESHOLD = 20;
const SNAP_ANGLE_PUSH_THRESHOLD = 45;
const COMBO_WINDOW = 2000;
const COMBO_FLOAT_DURATION = 1200;

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
    this._comboCount = 0;
    this._comboTimer = null;
    this._maxCombo = 0;
    this._comboFloats = []; // [{count, x, y, startTime, duration}]
  }

  activate() {
    const lv = databus.currentLevel;
    this.levelName = lv ? lv.name : '';
    this.steps = 0;
    this._victory = false;
    this._resetCombo();
    // effectiveWidth = 棋盘卡片内宽（卡片总宽 - 左右内边距），让棋盘在此区域内居中缩放
    this.gp.effectiveWidth = SCREEN_WIDTH - PADDING * 2 - CARD_PADDING * 2;
    this.loadLevel(lv ? lv.data : null);
    // 记住当前关卡索引，供主界面"开始游戏"使用
    if (databus.currentLevelIndex >= 0) {
      wx.setStorageSync('lastLevelIndex', databus.currentLevelIndex);
    }
    this.input.on('playing', (e) => this.handleEvent(e));
  }

  deactivate() {
    this.input.off('playing');
    this._resetCombo();
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
      if (pig && ds.lastValid) {
        // 记录松手时手指的真实方向（未受拖拽追逐/落孔修正的原始角度）
        const releaseAngle = ds.targetAngle;
        // 三点共线对齐归位
        this.gp.rebuildOccupancy();
        const snapped = this.gp.snapAlignPig(ds.tailIndex, pig.length, ds.lastValid.angle, pigId);
        if (snapped) {
          pig.length = snapped.length;
          pig.angle = snapped.angle;
          this.gp.updatePigOccupancy(pigId, snapped.tailIndex, snapped.length, snapped.angle);
          // 手指方向 vs 落孔方向，变化 < 阈值 → 执行逃脱
          const angleDelta = Math.min(
            Math.abs(snapped.angle - releaseAngle),
            360 - Math.abs(snapped.angle - releaseAngle)
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

      // 对齐归位后，仅角度变化 < 阈值时执行逃脱
      if (pig && this._shouldPushAfterSnap) {
        this.tryPushPig(pigId, { silentBlock: true });
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
      this.steps++;

      // 连击系统 ——— 每次逃脱触发
      this._triggerCombo(headX, headY);

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
    } catch (err) {
      console.warn(`[Playing] 加载下一关 ${next.file} 失败:`, err);
    }
  }

  // ========== 渲染（Ardot 设计稿驱动，fileId: 694583967818218）==========
  render() {
    const safeTop = databus.safeTop;

    // 计算布局参数
    this._boardCardX = PADDING;
    this._boardCardY = safeTop + PADDING + TOP_BAR_H + CARD_GAP;
    this._boardCardW = SCREEN_WIDTH - PADDING * 2;
    this._bottomBarY = SCREEN_HEIGHT - BOTTOM_BAR_H - PADDING;
    this._boardCardH = this._bottomBarY - CARD_GAP - this._boardCardY;

    // 1. 棋盘卡片背景
    this._drawBoardCard();

    // 2. 棋盘主体
    this.gp.topBarH = this._boardCardY + CARD_PADDING;
    this.gp.bottomStripH = BOTTOM_BAR_H + PADDING + CARD_GAP + CARD_PADDING;
    this.gp.renderBoard(ctx, 0, 0);

    // 3. 连击浮字（棋盘之上、UI 之下）
    this._renderComboFloats();

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
    const barY = safeTop + PADDING;
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

    // === 步数文字（右侧）===
    ctx.fillStyle = MUTED;
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText('\u6B65\u6570 ' + this.steps, PADDING + barW - 60, barY + TOP_BAR_H / 2);

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

    // 弹窗面板（有连击时加高）
    const pw = 260, ph = hasCombo ? 220 : 200;
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
    const btnY = hasCombo ? py + 150 : py + 120;
    if (hasCombo) {
      ctx.fillStyle = '#FF9800';
      ctx.font = 'bold 15px sans-serif';
      ctx.fillText(`🔥 最大连击 ${this._maxCombo}`, SCREEN_WIDTH / 2, py + 112);
    }

    // 按钮
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
    this._comboFloats = [];
  }

  _triggerCombo(headX, headY) {
    this._comboCount++;
    if (this._comboCount > this._maxCombo) this._maxCombo = this._comboCount;

    // 重置窗口计时器
    if (this._comboTimer) clearTimeout(this._comboTimer);
    this._comboTimer = setTimeout(() => {
      this._comboCount = 0;
      this._comboTimer = null;
    }, COMBO_WINDOW);

    // 2 连及以上才展示浮字
    if (this._comboCount >= 2) {
      this._comboFloats.push({
        count: this._comboCount,
        x: headX,
        y: headY,
        startTime: Date.now(),
        duration: COMBO_FLOAT_DURATION
      });
    }
  }

  _renderComboFloats() {
    const now = Date.now();
    this._comboFloats = this._comboFloats.filter(f => {
      const elapsed = now - f.startTime;
      if (elapsed > f.duration) return false;

      const progress = elapsed / f.duration;

      // Scale: 0.5 → 1.2 (at 30%) → 1.0
      let scale;
      if (progress < 0.3) scale = 0.5 + (1.2 - 0.5) * (progress / 0.3);
      else scale = 1.2 - (1.2 - 1.0) * ((progress - 0.3) / 0.7);

      // Alpha: 1 → 0
      const alpha = clamp(1 - progress, 0, 1);

      // Y offset: upward 30px
      const yOffset = progress * 30;

      // Color & size based on combo count
      let color, fontSize, shadowColor;
      if (f.count >= 10) {
        color = '#EC4899'; fontSize = 36; shadowColor = 'rgba(236,72,153,0.4)';
      } else if (f.count >= 7) {
        color = '#EF4444'; fontSize = 28; shadowColor = 'rgba(239,68,68,0.4)';
      } else if (f.count >= 4) {
        color = '#F97316'; fontSize = 22; shadowColor = 'rgba(249,115,22,0.4)';
      } else {
        color = '#F59E0B'; fontSize = 18; shadowColor = 'rgba(245,158,11,0.4)';
      }

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = color;
      ctx.font = 'bold ' + Math.floor(fontSize * scale) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = shadowColor;
      ctx.shadowBlur = 8;
      ctx.fillText(f.count + ' 连击！', f.x, f.y - yOffset);
      ctx.restore();

      return true;
    });
  }
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

module.exports = PlayingEngine;
