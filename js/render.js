// Canvas 初始化 + 屏幕尺寸常量

const canvas = wx.createCanvas();
const ctx = canvas.getContext('2d');

const SCREEN_WIDTH = canvas.width;
const SCREEN_HEIGHT = canvas.height;

// 全局存储：用于屏幕适配测试（默认值 = 真实设备宽度）
const databus = require('./databus.js');
databus.storedScreenWidth = SCREEN_WIDTH;

module.exports = { canvas, ctx, SCREEN_WIDTH, SCREEN_HEIGHT };
