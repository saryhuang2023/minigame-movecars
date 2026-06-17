// 关卡选择界面引擎

const databus = require('../databus.js');
const { ctx, SCREEN_WIDTH, SCREEN_HEIGHT } = require('../render.js');

// 内置预设关卡（打包在代码里，写死简单配置）
const BUILTIN_LEVELS = [
  {
    name: '入门',
    label: '入门',
    data: {
      board: { cols: 5, rows: 5, hGap: 10, vGap: 10, diameter: 30 },
      pigs: [
        { id: 0, tail: 12, length: 2, angle: 0 }
      ]
    }
  },
  {
    name: '简单',
    label: '简单',
    data: {
      board: { cols: 5, rows: 5, hGap: 10, vGap: 10, diameter: 30 },
      pigs: [
        { id: 0, tail: 1, length: 2, angle: 90 },
        { id: 1, tail: 7, length: 3, angle: 0 }
      ]
    }
  },
  {
    name: '进阶',
    label: '进阶',
    data: {
      board: { cols: 5, rows: 5, hGap: 10, vGap: 10, diameter: 30 },
      pigs: [
        { id: 0, tail: 2, length: 3, angle: 45 },
        { id: 1, tail: 10, length: 2, angle: 180 },
        { id: 2, tail: 14, length: 3, angle: 270 }
      ]
    }
  }
];

// 颜色
const BG = '#1a1a2e';
const CARD_FILL = '#16213e';
const CARD_BORDER = '#0f3460';
const CARD_EMPTY = '#272742';
const ACCENT_GREEN = '#4CAF50';
const ACCENT_YELLOW = '#FFD700';
const ACCENT_ORANGE = '#FF9800';

// 布局
const TOP_BAR_H = 52;
const SECTION_H = 28;
const GRID_TOP = TOP_BAR_H + SECTION_H + 12;
const CARD_W = 102;  // (SCREEN_WIDTH - 4*gap) / 3
const CARD_H = 72;
const GAP = 10;
const COLS = 3;

class LevelSelectEngine {
  constructor(input) {
    this.input = input;
    this.builtinLevels = BUILTIN_LEVELS;
    this.userLevels = [];
    this.cards = [];  // { x, y, w, h, level, isBuiltin }
    this.backBtn = null;
  }

  activate() {
    this.loadUserLevels();
    this.buildCards();
    this.input.on('levelSelect', (e) => this.handleEvent(e));
  }

  deactivate() {
    this.input.off('levelSelect');
  }

  // 载入玩家自制关卡列表
  loadUserLevels() {
    this.userLevels = [];
    const fs = wx.getFileSystemManager();
    const dir = `${wx.env.USER_DATA_PATH}/levels`;
    try {
      fs.accessSync(dir);
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
      for (const f of files) {
        try {
          const raw = fs.readFileSync(`${dir}/${f}`, 'utf8');
          const data = JSON.parse(raw);
          const name = f.replace('.json', '');
          this.userLevels.push({ name, label: '编辑', fileName: f, data });
        } catch (e) {}
      }
    } catch (e) {}
  }

  // 构建卡片布局
  buildCards() {
    this.cards = [];
    const startX = (SCREEN_WIDTH - (CARD_W * COLS + GAP * (COLS - 1))) / 2;

    // 预设关卡区
    const presetTop = GRID_TOP;
    this.builtinLevels.forEach((lv, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      this.cards.push({
        x: startX + col * (CARD_W + GAP),
        y: presetTop + row * (CARD_H + GAP),
        w: CARD_W, h: CARD_H,
        level: lv, isBuiltin: true
      });
    });

    // 自制关卡区
    const presetRows = Math.ceil(this.builtinLevels.length / COLS);
    const customTop = presetTop + presetRows * (CARD_H + GAP) + SECTION_H + 6;
    this.userLevels.forEach((lv, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      this.cards.push({
        x: startX + col * (CARD_W + GAP),
        y: customTop + row * (CARD_H + GAP),
        w: CARD_W, h: CARD_H,
        level: lv, isBuiltin: false
      });
    });

    // 自制区空态 — 虚线占位提示
    if (this.userLevels.length === 0) {
      this.cards.push({
        x: startX, y: customTop, w: CARD_W, h: CARD_H,
        level: null, isBuiltin: false, isPlaceholder: true
      });
    }
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

    // 关卡卡片
    for (const card of this.cards) {
      if (card.isPlaceholder) continue;
      if (t.x >= card.x && t.x <= card.x + card.w &&
          t.y >= card.y && t.y <= card.y + card.h) {
        databus.currentLevel = { name: card.level.name, data: card.level.data };
        databus.returnState = 'levelSelect';
        databus.gameState = 'playing';
        return;
      }
    }
  }

  // ========== 渲染 ==========
  render() {
    ctx.clearRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    this.drawTopBar();
    this.drawSectionLabels();
    this.drawCards();
  }

  // 顶栏："选择关卡" + 返回按钮
  drawTopBar() {
    // 背景
    ctx.fillStyle = 'rgba(15, 52, 96, 0.6)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, TOP_BAR_H);

    // 返回按钮
    const btnW = 56, btnH = 32;
    const btnX = 12, btnY = (TOP_BAR_H - btnH) / 2;
    this.backBtn = { x: btnX, y: btnY, w: btnW, h: btnH };

    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    this._roundRect(ctx, btnX, btnY, btnW, btnH, 6);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('< 返回', btnX + btnW / 2, btnY + btnH / 2);

    // 标题
    ctx.fillStyle = ACCENT_YELLOW;
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('选择关卡', SCREEN_WIDTH / 2, TOP_BAR_H / 2);
  }

  // 分区标签："预设关卡" / "自制关卡"
  drawSectionLabels() {
    const labelX = 16;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '13px sans-serif';

    // 预设
    ctx.fillStyle = ACCENT_YELLOW;
    const presetLabelY = GRID_TOP - SECTION_H / 2 - 2;
    ctx.fillText('★ 预设关卡', labelX, presetLabelY);

    // 自制
    const presetRows = Math.ceil(this.builtinLevels.length / COLS);
    const customTop = GRID_TOP + presetRows * (CARD_H + GAP);
    const customLabelY = customTop + SECTION_H / 2 - 4;
    ctx.fillStyle = ACCENT_ORANGE;
    ctx.fillText('✦ 自制关卡', labelX, customLabelY);
  }

  // 关卡卡片列表
  drawCards() {
    for (const card of this.cards) {
      this.drawCard(card);
    }
  }

  drawCard(card) {
    const { x, y, w, h, level, isBuiltin, isPlaceholder } = card;

    if (isPlaceholder) {
      // 空态：虚线框 + 提示文字
      ctx.strokeStyle = 'rgba(255,152,0,0.3)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      this._roundRect(ctx, x, y, w, h, 8);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,152,0,0.4)';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('编辑器创建', x + w / 2, y + h / 2);
      return;
    }

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
    ctx.fillStyle = isBuiltin ? ACCENT_GREEN : ACCENT_ORANGE;
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(level.name, x + w / 2, y + h * 0.45);

    // 标签
    const label = isBuiltin ? level.label : (level.label || '编辑');
    const labelColor = isBuiltin ? ACCENT_GREEN : ACCENT_ORANGE;
    const labelW = ctx.measureText(label).width + 12;
    const labelH = 18;
    const labelX = x + (w - labelW) / 2;
    const labelY = y + h * 0.45 + 20;

    ctx.fillStyle = labelColor + '20';
    this._roundRect(ctx, labelX, labelY - labelH / 2, labelW, labelH, labelH / 2);
    ctx.fill();
    ctx.fillStyle = labelColor;
    ctx.font = '11px sans-serif';
    ctx.fillText(label, x + w / 2, labelY);

    // 小猪数量（右下角小字）
    const pigCount = level.data && level.data.pigs ? level.data.pigs.length : 0;
    if (pigCount > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`${pigCount}只猪`, x + w - 8, y + h - 10);
      ctx.textAlign = 'center';
    }
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
