// 关卡选择界面引擎
// 正式关卡：读取工程目录 assets/levels/index.json
// 待发布关卡：云端 ready=1 的关卡
// 设计中的关卡：云端 ready=0 的关卡（调试用）

const databus = require('../databus.js');
const { ctx, SCREEN_WIDTH, SCREEN_HEIGHT } = require('../render.js');
const cloud = require('../cloud.js');

// 颜色
const BG = '#1a1a2e';
const CARD_FILL = '#16213e';
const CARD_BORDER = '#0f3460';
const ACCENT_GREEN = '#4CAF50';
const ACCENT_BLUE = '#2196F3';
const ACCENT_YELLOW = '#FFD700';
const ACCENT_ORANGE = '#FF9800';
const ACCENT_PINK = '#E91E63';

// 布局
const TOP_BAR_H = 52;
const SECTION_H = 28;
const CARD_W = 102;
const CARD_H = 72;
const GAP = 10;
const COLS = 3;

class LevelSelectEngine {
  constructor(input) {
    this.input = input;
    this.projectLevels = [];  // 正式关卡
    this.readyLevels = [];    // 待发布关卡（云端 ready=1）
    this.cloudLevels = [];    // 设计中的关卡（云端 ready=0）
    this.projectCards = [];   // 正式关卡卡片
    this.readyCards = [];     // 待发布关卡卡片
    this.cloudCards = [];     // 设计中关卡卡片
    this.backBtn = null;
    this.readySectionTop = 0;
    this.cloudSectionTop = 0;

    // 云端加载状态
    this._cloudLoading = false;
    this._cloudLoadingMsg = '';
  }

  activate() {
    this.loadProjectLevels();
    this.buildProjectCards();
    this.buildReadyCards();
    this.buildCloudCards();
    this.input.on('levelSelect', (e) => this.handleEvent(e));
    // 异步拉取云端关卡
    this._cloudLoading = true;
    this._cloudLoadingMsg = '同步云端关卡中...';
    this._fetchCloudLevels().finally(() => {
      this._cloudLoading = false;
    });
  }

  deactivate() {
    this.input.off('levelSelect');
    this._cloudLoading = false;
  }

  // ============================================================
  // 正式关卡：读取 assets/levels/index.json
  // ============================================================
  loadProjectLevels() {
    this.projectLevels = [];
    const fs = wx.getFileSystemManager();
    try {
      const indexRaw = fs.readFileSync('assets/levels/index.json', 'utf8');
      const rawList = JSON.parse(indexRaw);
      if (!Array.isArray(rawList)) return;

      for (const entry of rawList) {
        const f = typeof entry === 'string' ? entry : entry.file;
        if (!f || f === 'index.json' || !f.endsWith('.json')) continue;
        const name = f.replace('.json', '');
        const extra = typeof entry === 'object' ? { ...entry } : {};
        delete extra.file;
        this.projectLevels.push({ name, file: f, ...extra });
      }
    } catch (e) {
      console.warn('[LevelSelect] 读取 index.json 失败:', e);
    }
    // 同步到 databus，供 PlayingEngine "下一关" 使用
    databus.projectLevels = this.projectLevels;
  }

  // ============================================================
  // 云端关卡：按 ready 拆分为"待发布"和"设计中"
  // ============================================================
  async _fetchCloudLevels() {
    try {
      const list = await cloud.listLevels();
      this.readyLevels = [];
      this.cloudLevels = [];
      const projectNames = new Set(this.projectLevels.map(p => p.name));
      for (const item of list) {
        // 跳过与正式关卡同名的云端关卡（已发布，无需重复展示）
        if (projectNames.has(item.name)) continue;
        const lv = {
          name: item.name,
          _id: item._id,
          pigCount: item.pigCount,
          updatedAt: item.updatedAt,
          _needsDownload: true,
        };
        if (((item.data && item.data.ready) || 0) === 1) {
          this.readyLevels.push(lv);
        } else {
          this.cloudLevels.push(lv);
        }
      }
    } catch (e) {
      console.warn('[LevelSelect] 拉取云端关卡失败:', e);
      this.readyLevels = [];
      this.cloudLevels = [];
    }
    this.buildReadyCards();
    this.buildCloudCards();
  }

  // ============================================================
  // 卡片布局
  // ============================================================
  _getGridTop() {
    return databus.safeTop + TOP_BAR_H + SECTION_H + 12;
  }

  _buildCardsForLevels(levels, gridTop) {
    const startX = (SCREEN_WIDTH - (CARD_W * COLS + GAP * (COLS - 1))) / 2;
    const cards = [];
    levels.forEach((lv, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      cards.push({
        x: startX + col * (CARD_W + GAP),
        y: gridTop + row * (CARD_H + GAP),
        w: CARD_W, h: CARD_H,
        level: lv,
      });
    });
    return cards;
  }

  buildProjectCards() {
    this.readySectionTop = 0;
    this.cloudSectionTop = 0;
    const gridTop = this._getGridTop();
    this.projectCards = this._buildCardsForLevels(this.projectLevels, gridTop);
  }

  buildReadyCards() {
    // 正式关卡区域结束后
    const projectRows = Math.ceil(this.projectLevels.length / COLS) || 0;
    this.readySectionTop = this._getGridTop() + projectRows * (CARD_H + GAP) + SECTION_H + 8;
    this.readyCards = this._buildCardsForLevels(this.readyLevels, this.readySectionTop);
    // 更新云端区域 top（可能需要等 readyLevels 加载后）
    this._updateCloudSectionTop();
  }

  _updateCloudSectionTop() {
    const projectRows = Math.ceil(this.projectLevels.length / COLS) || 0;
    const readyRows = Math.ceil(this.readyLevels.length / COLS) || 0;
    this.cloudSectionTop = this._getGridTop()
      + projectRows * (CARD_H + GAP) + SECTION_H + 8   // 正式关卡区
      + (this.readyLevels.length > 0 ? readyRows * (CARD_H + GAP) + SECTION_H + 8 : 0);
  }

  buildCloudCards() {
    this._updateCloudSectionTop();
    this.cloudCards = this._buildCardsForLevels(this.cloudLevels, this.cloudSectionTop);
  }

  // ============================================================
  // 事件处理
  // ============================================================
  handleEvent(e) {
    // 云端加载中，屏蔽所有操作
    if (this._cloudLoading) return;

    if (e.type !== 'touchstart' || !e.touches[0]) return;
    const t = e.touches[0];

    // 返回按钮
    if (this.backBtn && t.x >= this.backBtn.x && t.x <= this.backBtn.x + this.backBtn.w &&
        t.y >= this.backBtn.y && t.y <= this.backBtn.y + this.backBtn.h) {
      databus.gameState = 'menu';
      return;
    }

    // 正式关卡卡片
    for (let i = 0; i < this.projectCards.length; i++) {
      const card = this.projectCards[i];
      if (this._hitCard(card, t)) {
        const lv = card.level;
        try {
          const fs = wx.getFileSystemManager();
          const raw = fs.readFileSync(`assets/levels/${lv.file}`, 'utf8');
          databus.currentLevel = { name: lv.name, data: JSON.parse(raw) };
          databus.currentLevelIndex = i;
          databus.returnState = 'levelSelect';
          databus.gameState = 'playing';
        } catch (err) {
          console.warn(`[LevelSelect] 加载关卡 ${lv.file} 失败:`, err);
        }
        return;
      }
    }

    // 待发布关卡卡片：异步下载
    for (const card of this.readyCards) {
      if (this._hitCard(card, t)) {
        this._playCloudLevel(card.level);
        return;
      }
    }

    // 设计中的关卡卡片：异步下载
    for (const card of this.cloudCards) {
      if (this._hitCard(card, t)) {
        this._playCloudLevel(card.level);
        return;
      }
    }
  }

  async _playCloudLevel(lv) {
    this._cloudLoading = true;
    this._cloudLoadingMsg = '加载关卡中...';
    try {
      const fullDoc = await cloud.downloadLevel(lv._id);
      if (fullDoc && fullDoc.data) {
        databus.currentLevel = { name: lv.name, data: fullDoc.data };
        databus.returnState = 'levelSelect';
        databus.gameState = 'playing';
      }
    } catch (err) {
      console.warn(`[LevelSelect] 下载云端关卡 ${lv.name} 失败:`, err);
    } finally {
      this._cloudLoading = false;
    }
  }

  _hitCard(card, t) {
    return t.x >= card.x && t.x <= card.x + card.w &&
           t.y >= card.y && t.y <= card.y + card.h;
  }

  // ============================================================
  // 渲染
  // ============================================================
  render() {
    this.drawTopBar();
    this.drawSectionLabels();
    this.drawCards(this.projectCards, ACCENT_GREEN);
    this.drawCards(this.readyCards, ACCENT_ORANGE);
    this.drawCards(this.cloudCards, ACCENT_BLUE);

    if (this._cloudLoading) this.renderCloudLoading();
  }

  // 顶栏
  drawTopBar() {
    const barY = databus.safeTop;
    ctx.fillStyle = 'rgba(15, 52, 96, 0.6)';
    ctx.fillRect(0, barY, SCREEN_WIDTH, TOP_BAR_H);

    const btnW = 56, btnH = 32;
    const btnX = 12, btnY = barY + (TOP_BAR_H - btnH) / 2;
    this.backBtn = { x: btnX, y: btnY, w: btnW, h: btnH };

    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    this._roundRect(ctx, btnX, btnY, btnW, btnH, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('< 返回', btnX + btnW / 2, btnY + btnH / 2);

    ctx.fillStyle = ACCENT_YELLOW;
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('选择关卡', SCREEN_WIDTH / 2, barY + TOP_BAR_H / 2);
  }

  // 三个区域标签
  drawSectionLabels() {
    const labelX = 16;

    // 正式关卡
    ctx.fillStyle = ACCENT_YELLOW;
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`★ 正式关卡 (${this.projectLevels.length})`, labelX, this._getGridTop() - SECTION_H / 2 - 2);

    // 待发布关卡
    if (this.readyLevels.length > 0) {
      const readyLabelY = this.readySectionTop - SECTION_H / 2 - 2;
      ctx.fillStyle = ACCENT_ORANGE;
      ctx.fillText(`★ 待发布关卡 (${this.readyLevels.length})`, labelX, readyLabelY);
    }

    // 设计中的关卡
    if (this.cloudLevels.length > 0) {
      const cloudLabelY = this.cloudSectionTop - SECTION_H / 2 - 2;
      ctx.fillStyle = ACCENT_BLUE;
      ctx.fillText(`★ 设计中的关卡 (${this.cloudLevels.length})`, labelX, cloudLabelY);
    }
  }

  // 关卡卡片列表
  drawCards(cards, accentColor) {
    for (const card of cards) {
      this.drawCard(card, accentColor);
    }
  }

  drawCard(card, accentColor) {
    const { x, y, w, h, level } = card;

    // 背景
    ctx.fillStyle = CARD_FILL;
    this._roundRect(ctx, x, y, w, h, 8);
    ctx.fill();

    // 边框
    ctx.strokeStyle = CARD_BORDER;
    ctx.lineWidth = 1;
    this._roundRect(ctx, x, y, w, h, 8);
    ctx.stroke();

    // 编号大字
    ctx.fillStyle = accentColor;
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(level.name, x + w / 2, y + h * 0.45);

    // 标签
    const label = (level.type !== undefined) ? `类型${level.type}` : (level.pigCount !== undefined ? `${level.pigCount}只猪` : level.name);
    ctx.font = '11px sans-serif';
    const labelW = ctx.measureText(label).width + 12;
    const labelH = 18;
    const labelX = x + (w - labelW) / 2;
    const labelY = y + h * 0.45 + 20;

    ctx.fillStyle = accentColor + '20';
    this._roundRect(ctx, labelX, labelY - labelH / 2, labelW, labelH, labelH / 2);
    ctx.fill();
    ctx.fillStyle = accentColor;
    ctx.fillText(label, x + w / 2, labelY);
  }

  renderCloudLoading() {
    // 半透明遮罩
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    const bw = 240, bh = 80;
    const bx = (SCREEN_WIDTH - bw) / 2;
    const by = (SCREEN_HEIGHT - bh) / 2;

    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    this._roundRect(ctx, bx, by, bw, bh, 12);
    ctx.fill();

    ctx.fillStyle = '#333';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this._cloudLoadingMsg, bx + bw / 2, by + 33);

    ctx.fillStyle = '#999';
    ctx.font = '12px sans-serif';
    ctx.fillText('请稍后', bx + bw / 2, by + 56);
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
}

module.exports = LevelSelectEngine;
