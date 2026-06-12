// Canvas 初始化 + 屏幕尺寸常量

const canvas = wx.createCanvas();
const ctx = canvas.getContext('2d');

const SCREEN_WIDTH = canvas.width;
const SCREEN_HEIGHT = canvas.height;

module.exports = { canvas, ctx, SCREEN_WIDTH, SCREEN_HEIGHT };
