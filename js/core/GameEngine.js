// 主循环：每帧 update + render

const databus = require('../databus.js');
const { canvas, ctx, SCREEN_WIDTH, SCREEN_HEIGHT } = require('../render.js');

// 所有系统/UI 模块在顶层统一 require（CommonJS 缓存保证单例）
const MoveSystem = require('../systems/MoveSystem.js');
const PickupSystem = require('../systems/PickupSystem.js');
const WinLoseSystem = require('../systems/WinLoseSystem.js');
const Button = require('../ui/Button.js');
const PickupZoneUI = require('../ui/PickupZoneUI.js');
const HUD = require('../ui/HUD.js');
const Popup = require('../ui/Popup.js');

class GameEngine {
  constructor() {
    this.lastTime = 0;
    this.running = false;
  }

  /** 启动主循环 */
  start() {
    this.running = true;
    this.lastTime = Date.now();
    this.loop();
  }

  /** 停止主循环 */
  stop() {
    this.running = false;
  }

  /** 主循环 */
  loop() {
    if (!this.running) return;

    const now = Date.now();
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;

    // 防止大帧跳跃
    if (dt > 0.1) dt = 0.016;
    if (dt <= 0) dt = 0.016;

    databus.frame++;

    this.update(dt);
    this.render();

    requestAnimationFrame(() => this.loop());
  }

  /** 每帧更新 */
  update(dt) {
    // 处理积压的触摸事件
    if (GameEngine._inputManager) {
      GameEngine._inputManager.handlePendingEvents();
    }

    // 更新系统
    if (databus.gameState === 'playing') {
      MoveSystem.update(dt);
      PickupSystem.update(dt);
      WinLoseSystem.check();
    }

    // 检测状态变更（WinLoseSystem 或按钮回调可能触发状态变化）
    if (GameEngine._stateMachine && databus.gameState !== GameEngine._stateMachine.current) {
      GameEngine._stateMachine.transition(databus.gameState);
    }

    // 更新 UI 按钮
    Button.updateAll(dt);
  }

  /** 渲染 */
  render() {
    ctx.clearRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    // 背景：游戏场景用图片，菜单用纯色
    if (databus.gameState === 'playing' || databus.gameState === 'victory' || databus.gameState === 'defeat') {
      if (databus.gameBgImage) {
        ctx.drawImage(databus.gameBgImage, 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
      } else {
        ctx.fillStyle = '#FAFAFA';
        ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
      }
    } else {
      ctx.fillStyle = '#FAFAFA';
      ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    }

    if (databus.gameState === 'playing') {
      // 渲染网格
      if (databus.grid) databus.grid.render(ctx);

      // 渲染汽车
      for (const car of databus.cars) car.render(ctx);

      // 渲染接待区（停车位）
      PickupZoneUI.render(ctx);

      // 渲染等待中的乘客（按 slot 分组编号）
      const slotPassengerIndex = {};
      for (const passenger of databus.passengers) {
        if (!passenger.boarded) {
          const slotId = passenger.slotRef.id;
          if (slotPassengerIndex[slotId] === undefined) {
            slotPassengerIndex[slotId] = 0;
          }
          passenger.render(ctx, slotPassengerIndex[slotId]++);
        }
      }

      // 渲染 HUD
      HUD.render(ctx);

      // 渲染按钮
      Button.renderAll(ctx);

    } else if (databus.gameState === 'menu') {
      // 主菜单
      ctx.fillStyle = '#333';
      ctx.font = 'bold 28px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('停车接客', SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2 - 40);
      ctx.font = '16px sans-serif';
      ctx.fillText('点击开始游戏', SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2 + 10);
      Button.renderAll(ctx);

    } else if (databus.gameState === 'victory' || databus.gameState === 'defeat') {
      // 先渲染游戏画面作为背景
      if (databus.grid) databus.grid.render(ctx);
      for (const car of databus.cars) car.render(ctx);
      PickupZoneUI.render(ctx);
      HUD.render(ctx);

      // 弹窗
      Popup.render(ctx);
      Button.renderAll(ctx);

    } else if (databus.gameState === 'victory_all') {
      // 全部通关
      ctx.fillStyle = '#333';
      ctx.font = 'bold 28px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🎉 恭喜通关！', SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2 - 40);
      ctx.font = '16px sans-serif';
      ctx.fillText('所有关卡已完成', SCREEN_WIDTH / 2, SCREEN_HEIGHT / 2 + 10);
      Button.renderAll(ctx);
    }
  }

  /** 获取/设置 InputManager 实例引用 */
  static getInputManager() {
    return GameEngine._inputManager;
  }

  static setInputManager(im) {
    GameEngine._inputManager = im;
  }

  /** 获取/设置 StateMachine 实例引用 */
  static getStateMachine() {
    return GameEngine._stateMachine;
  }

  static setStateMachine(sm) {
    GameEngine._stateMachine = sm;
  }
}

module.exports = GameEngine;
