// 主入口：初始化云开发并启动主循环

const cloud = require('./cloud.js');
const GameEngine = require('./core/GameEngine.js');

// 初始化微信云开发
cloud.initCloud();

new GameEngine();
