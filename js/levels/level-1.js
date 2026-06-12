// 第1关：4×4 网格，2色4车

const { SCREEN_WIDTH, SCREEN_HEIGHT } = require('../render.js');

class Level1 {
  constructor() {
    this.level = 1;
    this.gridRows = 4;
    this.gridCols = 4;
    this.cellSize = 20; // 细粒度网格单元大小

    // 计算网格像素尺寸
    const gridW = SCREEN_WIDTH - 40;
    const gridH = SCREEN_HEIGHT - 250;
    const displayCell = Math.min(gridW / this.gridCols, gridH / this.gridRows, 80);

    const gridPixelW = displayCell * this.gridCols;
    const gridPixelH = displayCell * this.gridRows;
    const offsetX = (SCREEN_WIDTH - gridPixelW) / 2;
    const offsetY = 160 + (SCREEN_HEIGHT - 160 - 90 - gridPixelH) / 2;

    const cell = displayCell;
    const carSize = cell * 0.85;

    // 汽车配置：{ id, color, row, col, direction(角度) }
    const carConfigs = [
      { id: 'car_01', color: 'blue',  row: 0, col: 0, direction: 0   },  // ↑
      { id: 'car_02', color: 'blue',  row: 2, col: 2, direction: 90  },  // →
      { id: 'car_03', color: 'red',   row: 0, col: 3, direction: 90  },  // →
      { id: 'car_04', color: 'red',   row: 1, col: 1, direction: 0   },  // ↑
    ];

    this.cars = carConfigs.map(c => ({
      id: c.id,
      color: c.color,
      x: offsetX + c.col * cell + (cell - carSize) / 2,
      y: offsetY + c.row * cell + (cell - carSize) / 2,
      width: carSize,
      height: carSize,
      direction: c.direction,
      seats: 2,
    }));

    // 停车位配置
    this.pickupSlots = [
      { id: 'slot_01', color: 'blue',  maxWait: 2 },
      { id: 'slot_02', color: 'red',   maxWait: 2 },
    ];
  }
}

module.exports = Level1;
