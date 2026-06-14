// 游戏主循环引擎

const databus = require('../databus.js');
const { ctx, SCREEN_WIDTH, SCREEN_HEIGHT } = require('../render.js');
const InputManager = require('./InputManager.js');

class GameEngine {
  constructor() {
    this.input = new InputManager();
    this.start();
  }

  /** 启动主循环 */
  start() {
    databus.screenWidth = SCREEN_WIDTH;
    databus.screenHeight = SCREEN_HEIGHT;
    this.loop();
  }

  /** 每帧更新逻辑 */
  update() {
    databus.frame++;
    this.input.handlePendingEvents();
  }

  /** 每帧渲染 */
  render() {
    ctx.clearRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    // 背景
    ctx.fillStyle = '#2d8cf0';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    // 游戏标题
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('猪了个猪呀', SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2 - 20);

    // 副标题
    ctx.font = '16px sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.fillText('小游戏框架 | Frame: ' + databus.frame, SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2 + 30);
  }

  /** 主循环 */
  loop() {
    this.update();
    this.render();
    requestAnimationFrame(this.loop.bind(this));
  }
}

module.exports = GameEngine;
