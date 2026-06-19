// 主入口：启动主循环

const cloud = require('./cloud.js');
cloud.initCloud();

const GameEngine = require('./core/GameEngine.js');
const databus = require('./databus.js');
const BugReporter = require('./debug/BugReporter.js');

const engine = new GameEngine();

// 排查系统初始化（在 GameEngine 创建后，确保引擎引用可达）
BugReporter.init(engine, databus);
