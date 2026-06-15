// 关卡编辑器引擎：在 Canvas 上绘制棋盘并编辑小猪布局

const { ctx, canvas, SCREEN_WIDTH, SCREEN_HEIGHT } = require('../render.js');

// ========== 常量 ==========
const PIG_COLOR = '#FFD700';
const PIG_GOLD = '#FFB300';
const HOLE_EMPTY_COLOR = 'rgba(255,255,255,0.22)';
const HOLE_OCCUPIED_COLOR = 'rgba(255,182,193,0.55)';
const HOLE_STROKE = 'rgba(255,255,255,0.45)';
const SELECTED_STROKE = '#2196F3';
const BG_DARK = '#1a1a2e';
const BTN_BG = 'rgba(0,0,0,0.55)';
const BTN_TEXT = '#fff';

class EditorEngine {
  constructor(inputManager) {
    this.input = inputManager;

    // 棋盘参数
    this.cols = 5;
    this.rows = 5;
    this.heightRatio = 1.2;
    this.cellGapRatio = 1.5;

    // 动态计算
    this.boardW = SCREEN_WIDTH;
    this.boardH = 0;
    this.diameter = 0;
    this.hSpacing = 0;
    this.vSpacing = 0;
    this.offsetX = 0;
    this.offsetY = 0;
    this.holes = [];
    this.holeOccupied = [];

    // 小猪
    this.pigs = [];
    this.nextPigId = 0;
    this.selectedPigId = null;

    // 拖拽
    this.dragState = null;

    // 按钮区域
    this.buttons = [];
    this.toolbarH = 88;
  }

  // ========== 激活/反激活 ==========
  activate() {
    this.recomputeBoard();
    this.input.on('editor', (e) => this.handleEvent(e));
  }

  deactivate() {
    this.input.off('editor');
  }

  // ========== 棋盘计算 ==========
  recomputeBoard() {
    const cols = this.cols, rows = this.rows;
    this.boardW = SCREEN_WIDTH;
    this.boardH = Math.round(this.boardW * this.heightRatio);
    this.hSpacing = Math.round(this.boardW / cols);
    this.vSpacing = Math.round(this.boardH / rows);
    this.diameter = Math.round(this.hSpacing / (1 + this.cellGapRatio));
    this.offsetX = 0;
    this.offsetY = this.toolbarH;

    // 生成孔位
    this.holes = [];
    const hStep = this.hSpacing, vStep = this.vSpacing;
    const mx = hStep / 2, my = vStep / 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        this.holes.push({ x: mx + c * hStep, y: my + r * vStep, type: 'grid', row: r, col: c });
      }
    }
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        this.holes.push({
          x: mx + hStep / 2 + c * hStep,
          y: my + vStep / 2 + r * vStep,
          type: 'diag', row: r, col: c
        });
      }
    }

    this.holeOccupied = new Array(this.holes.length).fill(-1);
    this.rebuildOccupancy();
  }

  rebuildOccupancy() {
    this.holeOccupied = new Array(this.holes.length).fill(-1);
    for (const pig of this.pigs) {
      const occupied = this.getPigOccupiedHoles(pig.tailIndex, pig.length, pig.angle);
      for (const hi of occupied) {
        if (hi >= 0 && hi < this.holeOccupied.length) {
          this.holeOccupied[hi] = pig.id;
        }
      }
    }
  }

  // ========== 小猪计算 ==========
  getPigCells(tailIndex, length, angle) {
    if (tailIndex < 0 || tailIndex >= this.holes.length) return [];
    const tail = this.holes[tailIndex];
    const rad = angle * Math.PI / 180;
    const dirX = Math.cos(rad), dirY = -Math.sin(rad);
    const cells = [];
    for (let i = 0; i < length; i++) {
      cells.push({ x: tail.x + i * this.diameter * dirX, y: tail.y + i * this.diameter * dirY });
    }
    return cells;
  }

  cellOverlapsHole(cellX, cellY, holeX, holeY) {
    const cellSize = this.diameter;
    const holeR = this.diameter / 2;
    const maxDist = holeR + cellSize * Math.SQRT2 / 2;
    const dx = cellX - holeX, dy = cellY - holeY;
    if (dx * dx + dy * dy > maxDist * maxDist) return false;

    const samples = 10;
    const step = cellSize / samples;
    const startX = cellX - cellSize / 2 + step / 2;
    const startY = cellY - cellSize / 2 + step / 2;
    let count = 0;
    const r2 = holeR * holeR;
    for (let i = 0; i < samples; i++) {
      for (let j = 0; j < samples; j++) {
        const ddx = startX + i * step - holeX;
        const ddy = startY + j * step - holeY;
        if (ddx * ddx + ddy * ddy <= r2) count++;
      }
    }
    return count / (samples * samples) >= Math.PI / 16;
  }

  getPigOccupiedHoles(tailIndex, length, angle) {
    const cells = this.getPigCells(tailIndex, length, angle);
    const occupied = [];
    for (let hi = 0; hi < this.holes.length; hi++) {
      for (const cell of cells) {
        if (this.cellOverlapsHole(cell.x, cell.y, this.holes[hi].x, this.holes[hi].y)) {
          occupied.push(hi);
          break;
        }
      }
    }
    return occupied;
  }

  getHoleAtPoint(x, y, margin) {
    const r = this.diameter / 2 + (margin || 0);
    for (let i = 0; i < this.holes.length; i++) {
      const hx = this.offsetX + this.holes[i].x;
      const hy = this.offsetY + this.holes[i].y;
      const dx = x - hx, dy = y - hy;
      if (dx * dx + dy * dy <= r * r) return i;
    }
    return -1;
  }

  getPigAtPoint(x, y) {
    for (const pig of this.pigs) {
      const cells = this.getPigCells(pig.tailIndex, pig.length, pig.angle);
      for (const cell of cells) {
        const cx = this.offsetX + cell.x, cy = this.offsetY + cell.y;
        const half = this.diameter / 2;
        if (x >= cx - half && x <= cx + half && y >= cy - half && y <= cy + half) {
          return pig.id;
        }
      }
    }
    return -1;
  }

  // ========== 事件处理 ==========
  handleEvent(e) {
    if (e.type === 'touchstart') {
      const t = e.touches[0];
      if (!t) return;

      // 检查 toolbar 按钮
      if (this.checkButtons(t.x, t.y)) return;

      // 检查棋盘区域
      if (t.y > this.toolbarH) {
        this.onBoardTouchStart(t.x, t.y);
      }
    } else if (e.type === 'touchmove') {
      if (this.dragState) {
        const t = e.touches[0];
        if (t) this.onDragMove(t.x, t.y);
      }
    } else if (e.type === 'touchend') {
      if (this.dragState) {
        const t = e.changedTouches[0];
        if (t) this.onDragEnd(t.x, t.y);
      }
    }
  }

  onBoardTouchStart(x, y) {
    // 检查是否点到小猪（选中/旋转）
    const pigId = this.getPigAtPoint(x, y);
    if (pigId >= 0) {
      const pig = this.pigs.find(p => p.id === pigId);
      if (pig) {
        this.selectedPigId = pigId;
        this.dragState = {
          tailIndex: pig.tailIndex,
          pigId: pigId,
          startAngle: pig.angle,
          startX: x,
          startY: y,
          type: 'rotate'
        };
        return;
      }
    }

    // 检查是否点到空孔（放置新猪）
    const holeIdx = this.getHoleAtPoint(x, y, 6);
    if (holeIdx >= 0 && this.holeOccupied[holeIdx] < 0) {
      this.dragState = {
        tailIndex: holeIdx,
        pigId: null,
        type: 'place',
        startX: x,
        startY: y,
        pendingId: null
      };
      this.selectedPigId = null;
      return;
    }

    // 点击空白
    this.selectedPigId = null;
    this.dragState = null;
  }

  onDragMove(x, y) {
    if (!this.dragState) return;

    const tail = this.holes[this.dragState.tailIndex];
    const dx = x - (this.offsetX + tail.x);
    const dy = y - (this.offsetY + tail.y);
    let angle = Math.atan2(-dy, dx) * 180 / Math.PI;
    if (angle < 0) angle += 360;
    angle = Math.round(angle);

    if (this.dragState.type === 'rotate') {
      const pig = this.pigs.find(p => p.id === this.dragState.pigId);
      if (pig) {
        pig.angle = angle;
        this.rebuildOccupancy();
      }
    } else if (this.dragState.type === 'place') {
      const dist = Math.sqrt(dx * dx + dy * dy);
      const len = Math.max(2, Math.min(20, Math.floor(dist / this.diameter) + 1));

      // 移除临时猪
      if (this.dragState.pendingId !== null) {
        this.pigs = this.pigs.filter(p => p.id !== this.dragState.pendingId);
      }

      // 创建临时猪
      const tempId = -999;
      this.pigs.push({ id: tempId, tailIndex: this.dragState.tailIndex, length: len, angle });
      this.dragState.pendingId = tempId;
      this.rebuildOccupancy();
    }
  }

  onDragEnd(x, y) {
    if (!this.dragState) return;

    if (this.dragState.type === 'rotate') {
      const pig = this.pigs.find(p => p.id === this.dragState.pigId);
      if (pig) {
        wx.showToast({ title: `角度: ${pig.angle}°`, icon: 'none', duration: 1000 });
      }
    } else if (this.dragState.type === 'place') {
      // 移除临时猪，创建正式猪
      this.pigs = this.pigs.filter(p => p.id === this.dragState.pendingId);
      const tail = this.holes[this.dragState.tailIndex];
      const dx = x - (this.offsetX + tail.x);
      const dy = y - (this.offsetY + tail.y);
      const dist = Math.sqrt(dx * dx + dy * dy);
      const len = Math.max(2, Math.min(20, Math.floor(dist / this.diameter) + 1));
      let angle = Math.atan2(-dy, dx) * 180 / Math.PI;
      if (angle < 0) angle += 360;
      angle = Math.round(angle);

      const newPig = { id: this.nextPigId++, tailIndex: this.dragState.tailIndex, length: len, angle };
      this.pigs.push(newPig);
      this.selectedPigId = newPig.id;
      this.rebuildOccupancy();
      wx.showToast({ title: `小猪 #${newPig.id} 已放置`, icon: 'none', duration: 1000 });
    }

    this.dragState = null;
  }

  // ========== 按钮系统 ==========
  checkButtons(x, y) {
    for (const btn of this.buttons) {
      if (x >= btn.x && x <= btn.x + btn.w && y >= btn.y && y <= btn.y + btn.h) {
        if (btn.onClick) btn.onClick();
        return true;
      }
    }
    return false;
  }

  buildButtons() {
    this.buttons = [];
    const h = 40, gap = 6, y = 10, startX = 6;

    // 返回按钮
    this.addBtn(startX, y, 60, h, '← 返回', () => {
      const databus = require('../databus.js');
      this.deactivate();
      databus.gameState = 'menu';
    });

    // Board controls row
    let cx = startX + 68;
    this.addBtn(cx, y, 36, h, '−列', () => { this.cols = Math.max(2, this.cols - 1); this.recomputeBoard(); });
    cx += 40;
    this.addBtn(cx, y, 28, h, '' + this.cols, null, true);
    cx += 32;
    this.addBtn(cx, y, 36, h, '+列', () => { this.cols = Math.min(20, this.cols + 1); this.recomputeBoard(); });
    cx += 44;
    this.addBtn(cx, y, 36, h, '−行', () => { this.rows = Math.max(2, this.rows - 1); this.recomputeBoard(); });
    cx += 40;
    this.addBtn(cx, y, 28, h, '' + this.rows, null, true);
    cx += 32;
    this.addBtn(cx, y, 36, h, '+行', () => { this.rows = Math.min(20, this.rows + 1); this.recomputeBoard(); });

    // Right side buttons
    this.addBtn(SCREEN_WIDTH - 60, y, 54, h, '保存', () => this.saveLevel());
    this.addBtn(SCREEN_WIDTH - 122, y, 54, h, '加载', () => this.loadLevel());
    this.addBtn(SCREEN_WIDTH - 184, y, 54, h, '删除', () => this.deleteSelectedPig());
  }

  addBtn(x, y, w, h, text, onClick, noBg) {
    this.buttons.push({
      x, y, w, h, text, onClick,
      noBg: !!noBg
    });
  }

  // ========== 保存/加载 ==========
  saveLevel() {
    const level = {
      board: { cols: this.cols, rows: this.rows, heightRatio: this.heightRatio, cellGapRatio: this.cellGapRatio },
      pigs: this.pigs.map(p => ({ id: p.id, tail: p.tailIndex, length: p.length, angle: p.angle }))
    };
    const fs = wx.getFileSystemManager();
    const dir = `${wx.env.USER_DATA_PATH}/levels`;
    try { fs.accessSync(dir); } catch (e) { fs.mkdirSync(dir); }

    const name = 'custom_level.json';
    const filePath = `${dir}/${name}`;
    fs.writeFileSync(filePath, JSON.stringify(level, null, 2), 'utf8');
    wx.showToast({ title: '已保存', icon: 'success' });
  }

  loadLevel() {
    const fs = wx.getFileSystemManager();
    const filePath = `${wx.env.USER_DATA_PATH}/levels/custom_level.json`;
    try {
      const data = fs.readFileSync(filePath, 'utf8');
      const level = JSON.parse(data);

      if (level.board) {
        this.cols = level.board.cols || 5;
        this.rows = level.board.rows || 5;
        if (level.board.heightRatio) this.heightRatio = level.board.heightRatio;
        if (level.board.cellGapRatio) this.cellGapRatio = level.board.cellGapRatio;
      }

      this.pigs = (level.pigs || []).map(p => ({
        id: p.id, tailIndex: p.tail, length: p.length, angle: p.angle
      }));
      this.nextPigId = this.pigs.length > 0 ? Math.max(...this.pigs.map(p => p.id)) + 1 : 0;
      this.selectedPigId = null;

      this.recomputeBoard();
      wx.showToast({ title: `已加载 (${this.pigs.length}只猪)`, icon: 'success' });
    } catch (e) {
      wx.showToast({ title: '无存档', icon: 'none' });
    }
  }

  deleteSelectedPig() {
    if (this.selectedPigId == null) {
      if (this.pigs.length > 0) {
        wx.showModal({
          title: '清空棋盘',
          content: `确定删除全部 ${this.pigs.length} 只小猪吗？`,
          success: (res) => {
            if (res.confirm) {
              this.pigs = [];
              this.nextPigId = 0;
              this.selectedPigId = null;
              this.rebuildOccupancy();
            }
          }
        });
      }
      return;
    }
    this.pigs = this.pigs.filter(p => p.id !== this.selectedPigId);
    this.selectedPigId = null;
    this.rebuildOccupancy();
    wx.showToast({ title: '已删除', icon: 'none' });
  }

  // ========== 渲染 ==========
  render() {
    ctx.clearRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    ctx.fillStyle = BG_DARK;
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    // 棋盘
    this.renderBoard();

    // Toolbar
    this.renderToolbar();

    // 底部提示
    this.renderHint();
  }

  renderBoard() {
    const r = this.diameter / 2;
    const ox = this.offsetX, oy = this.offsetY;

    // 绘制孔位
    for (let i = 0; i < this.holes.length; i++) {
      const h = this.holes[i];
      const occ = this.holeOccupied[i];

      ctx.beginPath();
      ctx.arc(ox + h.x, oy + h.y, r, 0, Math.PI * 2);

      if (occ >= 0) {
        ctx.fillStyle = HOLE_OCCUPIED_COLOR;
      } else {
        ctx.fillStyle = HOLE_EMPTY_COLOR;
        ctx.strokeStyle = HOLE_STROKE;
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
      ctx.fill();
    }

    // 绘制小猪
    for (const pig of this.pigs) {
      const cells = this.getPigCells(pig.tailIndex, pig.length, pig.angle);
      if (cells.length === 0) continue;

      const rad = pig.angle * Math.PI / 180;
      const dirX = Math.cos(rad), dirY = -Math.sin(rad);
      const tail = this.holes[pig.tailIndex];
      const totalLen = pig.length * this.diameter;
      const cx = ox + tail.x + (pig.length - 1) / 2 * this.diameter * dirX;
      const cy = oy + tail.y + (pig.length - 1) / 2 * this.diameter * dirY;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-rad);

      // 身体
      ctx.fillStyle = PIG_COLOR;
      this.roundRect(-totalLen / 2, -this.diameter / 2, totalLen, this.diameter, 6);
      ctx.fill();
      ctx.strokeStyle = PIG_GOLD;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // 眼睛
      const eyeX = totalLen / 2 - this.diameter * 0.35;
      const eyeY = -this.diameter * 0.15;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(eyeX, eyeY, this.diameter * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#333';
      ctx.beginPath();
      ctx.arc(eyeX + 1, eyeY, this.diameter * 0.11, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }

    // 选中高亮
    if (this.selectedPigId != null && !this.dragState) {
      const pig = this.pigs.find(p => p.id === this.selectedPigId);
      if (pig) {
        const cells = this.getPigCells(pig.tailIndex, pig.length, pig.angle);
        const rad = pig.angle * Math.PI / 180;
        const dirX = Math.cos(rad), dirY = -Math.sin(rad);
        const tail = this.holes[pig.tailIndex];
        const totalLen = pig.length * this.diameter;
        const cx = ox + tail.x + (pig.length - 1) / 2 * this.diameter * dirX;
        const cy = oy + tail.y + (pig.length - 1) / 2 * this.diameter * dirY;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(-rad);
        ctx.strokeStyle = SELECTED_STROKE;
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(-totalLen / 2 - 3, -this.diameter / 2 - 3, totalLen + 6, this.diameter + 6);
        ctx.setLineDash([]);
        ctx.restore();
      }
    }
  }

  renderToolbar() {
    this.buildButtons();
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, this.toolbarH);

    for (const btn of this.buttons) {
      if (btn.noBg) {
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(btn.text, btn.x + btn.w / 2, btn.y + btn.h / 2);
      } else {
        ctx.fillStyle = BTN_BG;
        this.roundRect(btn.x, btn.y, btn.w, btn.h, 6);
        ctx.fill();

        ctx.fillStyle = BTN_TEXT;
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(btn.text, btn.x + btn.w / 2, btn.y + btn.h / 2);
      }
    }
  }

  renderHint() {
    const y = this.offsetY + this.boardH + 20;
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';

    if (this.selectedPigId != null) {
      const pig = this.pigs.find(p => p.id === this.selectedPigId);
      if (pig) {
        ctx.fillText(`小猪 #${pig.id} | 长度:${pig.length} 角度:${pig.angle}° | 拖拽旋转 | 点「删除」移除`, SCREEN_WIDTH / 2, y);
        return;
      }
    }
    ctx.fillText('点击空圆洞放置小猪 | 拖拽设置角度 | 拖拽小猪调整方向', SCREEN_WIDTH / 2, y);
  }

  roundRect(x, y, w, h, r) {
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

module.exports = EditorEngine;
