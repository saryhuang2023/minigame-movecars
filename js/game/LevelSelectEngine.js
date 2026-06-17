// 关卡选择界面引擎 — 只读取工程目录 levels/ 下的关卡文件

const databus = require('../databus.js');
const { ctx, SCREEN_WIDTH, SCREEN_HEIGHT } = require('../render.js');

// 颜色
const BG = '#1a1a2e';
const CARD_FILL = '#16213e';
const CARD_BORDER = '#0f3460';
const ACCENT_GREEN = '#4CAF50';
const ACCENT_YELLOW = '#FFD700';
const ACCENT_ORANGE = '#FF9800';

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
    this.levels = [];   // 所有关卡（只来自工程目录 levels/）
    this.cards = [];    // { x, y, w, h, level }
    this.backBtn = null;
  }

  activate() {
    this.loadProjectLevels();
    this.buildCards();
    this.input.on('levelSelect', (e) => this.handleEvent(e));
  }

  deactivate() {
    this.input.off('levelSelect');
  }

  /**
   * 只读 index.json 元数据构建关卡列表，不读取关卡文件（点击时才懒加载）
   *
   * index.json 结构：
   *   [ { "file": "0001.json", "type": 1, "progress": 10 } ]
   * 兼容旧格式：纯文件名数组  [ "0001.json", "0002.json" ]
   */
  loadProjectLevels() {
    this.levels = [];
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
        this.levels.push({ name, file: f, ...extra });
      }
    } catch (e) {
      console.warn('[LevelSelect] 读取 index.json 失败:', e);
    }
  }

  // 构建卡片布局
  buildCards() {
    this.cards = [];
    const gridTop = databus.safeTop + TOP_BAR_H + SECTION_H + 12;
    const startX = (SCREEN_WIDTH - (CARD_W * COLS + GAP * (COLS - 1))) / 2;

    this.levels.forEach((lv, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      this.cards.push({
        x: startX + col * (CARD_W + GAP),
        y: gridTop + row * (CARD_H + GAP),
        w: CARD_W, h: CARD_H,
        level: lv
      });
    });
  }

  // 事件处理
  handleEvent(e) {
    if (e.type !== 'touchstart' || !e.touches[0]) return;
    const t = e.touches[0];

    // 返回按钮
    if (this.backBtn && t.x >= this.backBtn.x && t.x <= this.backBtn.x + this.backBtn.w &&
        t.y >= this.backBtn.y && t.y <= this.backBtn.y + this.backBtn.h) {
      databus.gameState = 'menu';
      return;
    }

    // 关卡卡片：点击时懒加载关卡文件
    for (const card of this.cards) {
      if (t.x >= card.x && t.x <= card.x + card.w &&
          t.y >= card.y && t.y <= card.y + card.h) {
        const lv = card.level;
        try {
          const fs = wx.getFileSystemManager();
          const raw = fs.readFileSync(`assets/levels/${lv.file}`, 'utf8');
          databus.currentLevel = { name: lv.name, data: JSON.parse(raw) };
          databus.returnState = 'levelSelect';
          databus.gameState = 'playing';
        } catch (err) {
          console.warn(`[LevelSelect] 加载关卡 ${lv.file} 失败:`, err);
        }
        return;
      }
    }
  }

  // ========== 渲染 ==========
  render() {
    this.drawTopBar();
    this.drawSectionLabel();
    this.drawCards();
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

  // 统一关卡标签
  drawSectionLabel() {
    const labelX = 16;
    const gridTop = databus.safeTop + TOP_BAR_H + SECTION_H + 12;
    const labelY = gridTop - SECTION_H / 2 - 2;
    ctx.fillStyle = ACCENT_YELLOW;
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`★ 全部关卡 (${this.levels.length})`, labelX, labelY);
  }

  // 关卡卡片列表
  drawCards() {
    for (const card of this.cards) {
      this.drawCard(card);
    }
  }

  drawCard(card) {
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
    ctx.fillStyle = ACCENT_GREEN;
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(level.name, x + w / 2, y + h * 0.45);

    // 标签
    const label = (level.type !== undefined) ? `类型${level.type}` : (level.name);
    const labelW = ctx.measureText(label).width + 12;
    const labelH = 18;
    const labelX = x + (w - labelW) / 2;
    const labelY = y + h * 0.45 + 20;

    ctx.fillStyle = ACCENT_GREEN + '20';
    this._roundRect(ctx, labelX, labelY - labelH / 2, labelW, labelH, labelH / 2);
    ctx.fill();
    ctx.fillStyle = ACCENT_GREEN;
    ctx.font = '11px sans-serif';
    ctx.fillText(label, x + w / 2, labelY);
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
