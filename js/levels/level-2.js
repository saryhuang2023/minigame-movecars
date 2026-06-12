// 第2关：5×5 网格，3色6车

const { SCREEN_WIDTH, SCREEN_HEIGHT } = require('../render.js');

class Level2 {
  constructor() {
    this.level = 2;
    this.gridRows = 5;
    this.gridCols = 5;
    this.cellSize = 20;

    const gridW = SCREEN_WIDTH - 40;
    const gridH = SCREEN_HEIGHT - 250;
    const displayCell = Math.min(gridW / this.gridCols, gridH / this.gridRows, 75);

    const gridPixelW = displayCell * this.gridCols;
    const gridPixelH = displayCell * this.gridRows;
    const offsetX = (SCREEN_WIDTH - gridPixelW) / 2;
    const offsetY = 160 + (SCREEN_HEIGHT - 160 - 90 - gridPixelH) / 2;

    const cell = displayCell;
    const carSize = cell * 0.82;

    const carConfigs = [
      { id: 'car_01', color: 'blue',  row: 0, col: 0, direction: 0   },
      { id: 'car_02', color: 'blue',  row: 2, col: 4, direction: 90  },
      { id: 'car_03', color: 'red',   row: 0, col: 4, direction: 0   },
      { id: 'car_04', color: 'red',   row: 1, col: 1, direction: 90  },
      { id: 'car_05', color: 'green', row: 0, col: 2, direction: 90  },
      { id: 'car_06', color: 'green', row: 2, col: 2, direction: 0   },
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

    this.pickupSlots = [
      { id: 'slot_01', color: 'blue',  maxWait: 2 },
      { id: 'slot_02', color: 'red',   maxWait: 2 },
      { id: 'slot_03', color: 'green', maxWait: 2 },
    ];
  }
}

module.exports = Level2;
