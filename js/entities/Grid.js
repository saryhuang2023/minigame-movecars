// 细粒度网格系统：碰撞检测 + 坐标转换

const { SCREEN_WIDTH, SCREEN_HEIGHT } = require('../render.js');

// 细粒度网格单元大小（像素），后期可根据车型动态调整
const GRID_CELL_SIZE = 20;

// 网格区域边距
const GRID_MARGIN_TOP = 160;    // 顶部留给接待区和 HUD
const GRID_MARGIN_BOTTOM = 90;  // 底部留给按钮
const GRID_MARGIN_SIDE = 20;

class Grid {
  constructor(levelConfig) {
    this.logicalRows = levelConfig.gridRows;
    this.logicalCols = levelConfig.gridCols;
    this.cellSize = levelConfig.cellSize || GRID_CELL_SIZE;

    // 计算网格区域像素范围
    const areaWidth = SCREEN_WIDTH - GRID_MARGIN_SIDE * 2;
    const areaHeight = SCREEN_HEIGHT - GRID_MARGIN_TOP - GRID_MARGIN_BOTTOM;

    // 逻辑网格显示的格子大小（用于视觉参考线）
    this.displayCellSize = Math.min(
      areaWidth / this.logicalCols,
      areaHeight / this.logicalRows,
      80
    );

    // 网格区域偏移
    const gridPixelW = this.displayCellSize * this.logicalCols;
    const gridPixelH = this.displayCellSize * this.logicalRows;
    this.offsetX = (SCREEN_WIDTH - gridPixelW) / 2;
    this.offsetY = GRID_MARGIN_TOP + (areaHeight - gridPixelH) / 2;

    // 碰撞网格（细粒度）：用二维数组标记占用
    // 覆盖整个游戏区域
    this.fineRows = Math.ceil(SCREEN_HEIGHT / this.cellSize);
    this.fineCols = Math.ceil(SCREEN_WIDTH / this.cellSize);
    this.cells = this.createEmptyGrid();
  }

  createEmptyGrid() {
    const grid = [];
    for (let r = 0; r < this.fineRows; r++) {
      grid[r] = new Array(this.fineCols).fill(null);
    }
    return grid;
  }

  /** 清空碰撞网格 */
  clearOccupancy() {
    for (let r = 0; r < this.fineRows; r++) {
      for (let c = 0; c < this.fineCols; c++) {
        this.cells[r][c] = null;
      }
    }
  }

  /** 根据汽车列表更新碰撞网格 */
  updateOccupancy(cars) {
    this.clearOccupancy();
    for (const car of cars) {
      if (car.status === 'departed') continue;
      this.markCar(car);
    }
  }

  /** 标记一辆车占用的网格 */
  markCar(car) {
    const cells = this.getCellsCoveredByRect(car.x, car.y, car.width, car.height);
    for (const cell of cells) {
      if (this.isValidCell(cell.r, cell.c)) {
        this.cells[cell.r][cell.c] = car;
      }
    }
  }

  /** 清除一辆车的占用标记 */
  unmarkCar(car) {
    const cells = this.getCellsCoveredByRect(car.x, car.y, car.width, car.height);
    for (const cell of cells) {
      if (this.isValidCell(cell.r, cell.c) && this.cells[cell.r][cell.c] === car) {
        this.cells[cell.r][cell.c] = null;
      }
    }
  }

  /** 获取矩形覆盖的细粒度网格单元格 */
  getCellsCoveredByRect(x, y, w, h) {
    const startC = Math.floor(x / this.cellSize);
    const startR = Math.floor(y / this.cellSize);
    const endC = Math.floor((x + w - 1) / this.cellSize);
    const endR = Math.floor((y + h - 1) / this.cellSize);
    const cells = [];
    for (let r = startR; r <= endR; r++) {
      for (let c = startC; c <= endC; c++) {
        cells.push({ r, c });
      }
    }
    return cells;
  }

  /** 检查某个位置是否有车（排除自身） */
  isOccupied(x, y, selfCar) {
    const c = Math.floor(x / this.cellSize);
    const r = Math.floor(y / this.cellSize);
    if (!this.isValidCell(r, c)) return true; // 越界视为障碍
    const occupant = this.cells[r][c];
    return occupant !== null && occupant !== selfCar;
  }

  /** 检查矩形区域是否被占用 */
  isRectOccupied(x, y, w, h, selfCar) {
    const cells = this.getCellsCoveredByRect(x, y, w, h);
    for (const cell of cells) {
      if (!this.isValidCell(cell.r, cell.c)) return true;
      const occupant = this.cells[cell.r][cell.c];
      if (occupant !== null && occupant !== selfCar) return true;
    }
    return false;
  }

  /** 检查坐标是否在有效网格内 */
  isValidCell(r, c) {
    return r >= 0 && r < this.fineRows && c >= 0 && c < this.fineCols;
  }

  /** 检查矩形是否在停车区域内 */
  isInsideParkingArea(x, y, w, h) {
    return (
      x >= this.offsetX &&
      y >= this.offsetY &&
      x + w <= this.offsetX + this.displayCellSize * this.logicalCols &&
      y + h <= this.offsetY + this.displayCellSize * this.logicalRows
    );
  }

  /** 检查矩形是否完全在屏幕内 */
  isInsideScreen(x, y, w, h) {
    return x >= 0 && y >= 0 && x + w <= SCREEN_WIDTH && y + h <= SCREEN_HEIGHT;
  }

  /** 像素坐标 → 逻辑网格坐标 */
  pixelToLogicalGrid(px, py) {
    const col = Math.floor((px - this.offsetX) / this.displayCellSize);
    const row = Math.floor((py - this.offsetY) / this.displayCellSize);
    return { row, col };
  }

  /** 逻辑网格坐标 → 像素坐标（格子左上角） */
  logicalGridToPixel(row, col) {
    return {
      x: this.offsetX + col * this.displayCellSize,
      y: this.offsetY + row * this.displayCellSize,
    };
  }

  /** 渲染网格线 */
  render(ctx) {
    // 网格区域背景
    ctx.fillStyle = '#F0F0F0';
    ctx.fillRect(
      this.offsetX, this.offsetY,
      this.displayCellSize * this.logicalCols,
      this.displayCellSize * this.logicalRows
    );

    // 网格线
    ctx.strokeStyle = '#E0E0E0';
    ctx.lineWidth = 1;

    for (let r = 0; r <= this.logicalRows; r++) {
      const y = this.offsetY + r * this.displayCellSize;
      ctx.beginPath();
      ctx.moveTo(this.offsetX, y);
      ctx.lineTo(this.offsetX + this.displayCellSize * this.logicalCols, y);
      ctx.stroke();
    }

    for (let c = 0; c <= this.logicalCols; c++) {
      const x = this.offsetX + c * this.displayCellSize;
      ctx.beginPath();
      ctx.moveTo(x, this.offsetY);
      ctx.lineTo(x, this.offsetY + this.displayCellSize * this.logicalRows);
      ctx.stroke();
    }
  }
}

module.exports = Grid;
module.exports.GRID_CELL_SIZE = GRID_CELL_SIZE;
