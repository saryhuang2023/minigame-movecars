// 主入口：启动主循环

const cloud = require('./cloud.js');
cloud.initCloud();

const GameEngine = require('./core/GameEngine.js');

new GameEngine();
