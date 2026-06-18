// 关卡游玩引擎 — 组合 GameplayEngine 实现正式玩法

const databus = require('../databus.js');
const { ctx, SCREEN_WIDTH, SCREEN_HEIGHT } = require('../render.js');
const GameplayEngine = require('../core/GameplayEngine.js');

const BG = '#1a1a2e';
const TOP_BAR_H = 48;
const BOTTOM_H = 60;
const ACCENT_YELLOW = '#FFD700';
const DRAG_THRESHOLD = 20; // 最小移动距离（px），低于此值视为点击
const SNAP_ANGLE_PUSH_THRESHOLD = 45; // 对齐角度变化阈值：低于此值执行逃脱

class PlayingEngine {
  constructor(input) {
    this.input = input;
    this.gp = new GameplayEngine();
    this.levelName = '';
    this.steps = 0;
    this.backBtn = null;
    this.restartBtn = null;
    this._victory = false;
    this._exitBtn = null;
    this._nextBtn = null;
  }

  activate() {
    const lv = databus.currentLevel;
    this.levelName = lv ? lv.name : '';
    this.steps = 0;
    this._victory = false;
    this.gp.effectiveWidth = databus.storedScreenWidth;
    this.loadLevel(lv ? lv.data : null);
    // 记住当前关卡索引，供主界面"开始游戏"使用
    if (databus.currentLevelIndex >= 0) {
      wx.setStorageSync('lastLevelIndex', databus.currentLevelIndex);
    }
    this.input.on('playing', (e) => this.handleEvent(e));
  }

  deactivate() {
    this.input.off('playing');
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
    this.gp.topBarH = databus.safeTop + TOP_BAR_H;
    this.gp.bottomStripH = BOTTOM_H;
    this.gp.recomputeBoard();
    this.gp.recenterBoard();
    this.steps = 0;
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
        this.tryPushPig(pigId);
      }
      this._shouldPushAfterSnap = false;
    }
  }

  tryPushPig(pigId) {
    const result = this.gp.canPushPig(pigId);
    const pig = this.gp.pigs.find(p => p.id === pigId);
    if (!pig) return;

    if (result.canPush) {
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
      // 所有猪都逃脱 → 通关
      if (this.gp.pigs.length === 0) {
        setTimeout(() => { this._victory = true; }, 400);
      }
      // 动画结束后清理渲染层
      setTimeout(() => {
        this.gp.flyingPigs = this.gp.flyingPigs.filter(p => p.id !== pigId);
        this.gp.animations = this.gp.animations.filter(a => a.pigId !== pigId);
      }, 6500);
    } else if (result.collidedPigId !== undefined) {
      this.gp.triggerCollisionEffect(result.collidedPigId);
    }
  }

  restartLevel() {
    this.loadLevel(databus.currentLevel ? databus.currentLevel.data : null);
    this._victory = false;
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

  // ========== 渲染 ==========
  render() {
    // 背景由 GameEngine.drawBackground() 统一绘制
    const safeTop = databus.safeTop;

    // 棋盘主体
    this.gp.topBarH = safeTop + TOP_BAR_H;
    this.gp.renderBoard(ctx, 0, 0);

    // 顶栏
    this.drawTopBar();

    // 底部按钮
    this.drawBottomBar();

    // 通关界面（覆盖在最上层）
    if (this._victory) {
      this.renderVictoryOverlay();
    }
  }

  drawTopBar() {
    const barY = databus.safeTop;
    ctx.fillStyle = 'rgba(15, 52, 96, 0.7)';
    ctx.fillRect(0, barY, SCREEN_WIDTH, TOP_BAR_H);

    // 返回按钮
    const btnW = 48, btnH = 30;
    const btnX = 10, btnY = barY + (TOP_BAR_H - btnH) / 2;
    this.backBtn = { x: btnX, y: btnY, w: btnW, h: btnH };

    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    this._roundRect(ctx, btnX, btnY, btnW, btnH, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('←', btnX + btnW / 2, btnY + btnH / 2);

    // 关卡名
    ctx.fillStyle = ACCENT_YELLOW;
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(this.levelName, SCREEN_WIDTH / 2, barY + TOP_BAR_H / 2);

    // 步数
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`步数: ${this.steps}`, SCREEN_WIDTH - 14, barY + TOP_BAR_H / 2);
    ctx.textAlign = 'center';
  }

  drawBottomBar() {
    const barY = SCREEN_HEIGHT - BOTTOM_H;
    ctx.fillStyle = 'rgba(15, 52, 96, 0.7)';
    ctx.fillRect(0, barY, SCREEN_WIDTH, BOTTOM_H);

    const btnW = 110, btnH = 38;
    const btnY = barY + (BOTTOM_H - btnH) / 2;

    // 重来按钮（居中）
    const restartX = (SCREEN_WIDTH - btnW) / 2;
    this.restartBtn = { x: restartX, y: btnY, w: btnW, h: btnH };
    ctx.fillStyle = '#FF9800';
    this._roundRect(ctx, restartX, btnY, btnW, btnH, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('重来', restartX + btnW / 2, btnY + btnH / 2);
  }

  _roundRect(ctx, x, y, w, h, r) {
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

  // ========== 通关界面 ==========
  renderVictoryOverlay() {
    // 半透明遮罩
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    // 弹窗面板
    const pw = 260, ph = 200;
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
    ctx.fillText(`共 ${this.steps} 步`, SCREEN_WIDTH / 2, py + 80);

    // 按钮
    const btnW = 100, btnH = 42;
    const btnY = py + 120;
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
}

module.exports = PlayingEngine;
