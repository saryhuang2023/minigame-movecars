// 主入口：初始化 → 启动主循环

const databus = require('./databus.js');
const GameEngine = require('./core/GameEngine.js');
const InputManager = require('./core/InputManager.js');
const StateMachine = require('./core/StateMachine.js');
const Button = require('./ui/Button.js');
const { SCREEN_WIDTH, SCREEN_HEIGHT } = require('./render.js');
const { setupGameButtons } = require('./systems/WinLoseSystem.js');

// 加载关卡
const Level1 = require('./levels/level-1.js');
const Level2 = require('./levels/level-2.js');
const Level3 = require('./levels/level-3.js');

databus.levels = [Level1, Level2, Level3];

class Main {
  constructor() {
    this.engine = new GameEngine();
    this.input = new InputManager();
    this.sm = new StateMachine();

    // 将 InputManager 和 StateMachine 注入 GameEngine
    GameEngine.setInputManager(this.input);
    GameEngine.setStateMachine(this.sm);

    // 初始状态：menu
    databus.gameState = 'menu';

    // 注册状态机处理器
    this.setupStateMachine();

    // 设置菜单按钮
    this.setupMenuButtons();

    // 启动主循环
    this.engine.start();
  }

  setupStateMachine() {
    this.sm.on('enter', 'playing', () => {
      setupGameButtons();
    });

    this.sm.on('exit', 'playing', () => {
      Button.clearAll();
    });

    this.sm.on('enter', 'victory', () => {
      const { SCREEN_WIDTH: sw, SCREEN_HEIGHT: sh } = require('./render.js');
      Button.clearAll();
      Button.add({
        id: 'next',
        text: '下一关',
        x: (sw - 200) / 2,
        y: sh / 2 + 110,
        w: 200,
        h: 44,
        onClick: () => {
          const nextLevel = databus.currentLevel + 1;
          if (nextLevel < databus.levels.length) {
            databus.loadLevel(nextLevel);
            this.sm.transition('playing');
          } else {
            // 通关所有关卡
            databus.gameState = 'victory_all';
          }
        },
      });
    });

    this.sm.on('enter', 'defeat', () => {
      const { SCREEN_WIDTH: sw, SCREEN_HEIGHT: sh } = require('./render.js');
      Button.clearAll();
      Button.add({
        id: 'retry',
        text: '重新挑战',
        x: (sw - 200) / 2,
        y: sh / 2 + 110,
        w: 200,
        h: 44,
        onClick: () => {
          databus.loadLevel(databus.currentLevel);
          this.sm.transition('playing');
        },
      });
    });

    this.sm.on('enter', 'victory_all', () => {
      const { SCREEN_WIDTH: sw, SCREEN_HEIGHT: sh } = require('./render.js');
      Button.clearAll();
      Button.add({
        id: 'replay',
        text: '重新开始',
        x: (sw - 200) / 2,
        y: sh / 2 + 80,
        w: 200,
        h: 52,
        onClick: () => {
          databus.loadLevel(0);
          this.sm.transition('playing');
        },
      });
    });
  }

  setupMenuButtons() {
    Button.add({
      id: 'start',
      text: '开始游戏',
      x: (SCREEN_WIDTH - 200) / 2,
      y: SCREEN_HEIGHT / 2 + 40,
      w: 200,
      h: 52,
      onClick: () => {
        databus.loadLevel(0);
        this.sm.transition('playing');
      },
    });
  }
}

new Main();
