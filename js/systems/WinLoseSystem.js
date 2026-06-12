// 胜利/失败判定

const databus = require('../databus.js');
const { SCREEN_WIDTH, SCREEN_HEIGHT } = require('../render.js');
const MoveSystem = require('./MoveSystem.js');
const Button = require('../ui/Button.js');
const HintSolver = require('../ai/HintSolver.js');

const WinLoseSystem = {
  /**
   * 每步操作后检查胜负
   */
  check() {
    if (databus.gameState !== 'playing') return;

    // 检查胜利条件
    if (databus.allPassengersBoarded()) {
      this.triggerVictory();
      return;
    }

    // 检查失败条件：没有可移动的车 + 还有车在移动中则等待
    if (databus.isAnyCarMoving()) return;

    const hasMovableCar = databus.cars.some(car => {
      if (car.status !== 'idle') return false;
      return MoveSystem.scanRay(car, databus.grid) > 0;
    });

    if (!hasMovableCar && !databus.allPassengersBoarded()) {
      this.triggerDefeat();
    }
  },

  triggerVictory() {
    databus.gameState = 'victory';
    databus.animLock = false;
  },

  triggerDefeat() {
    databus.gameState = 'defeat';
    databus.animLock = false;
  },
};

/** 设置游戏中的按钮（提示 + 重来） */
function setupGameButtons() {
  Button.clearAll();

  Button.add({
    id: 'hint',
    text: '💡 提示',
    x: 30,
    y: SCREEN_HEIGHT - 70,
    w: 140,
    h: 48,
    onClick: () => {
      const carId = HintSolver.getHint();
      if (carId) {
        const car = databus.cars.find(c => c.id === carId);
        if (car) {
          databus.cars.forEach(c => c.highlighted = false);
          car.highlighted = true;
        }
      }
    },
  });

  Button.add({
    id: 'restart',
    text: '🔄 重来',
    x: SCREEN_WIDTH - 170,
    y: SCREEN_HEIGHT - 70,
    w: 140,
    h: 48,
    onClick: () => {
      databus.loadLevel(databus.currentLevel);
      setupGameButtons();
    },
  });
}

module.exports = WinLoseSystem;
module.exports.setupGameButtons = setupGameButtons;
