// Canvas 初始化 + 屏幕尺寸常量 + 超采样抗锯齿

const DPR = 2; // 超采样倍率（2x 渲染 → 缩小回 1x 消除锯齿）

const realCanvas = wx.createCanvas();
const realCtx = realCanvas.getContext('2d');

const SCREEN_WIDTH = realCanvas.width;
const SCREEN_HEIGHT = realCanvas.height;

// 全局存储：用于屏幕适配测试（默认值 = 真实设备宽度）
const databus = require('./databus.js');
databus.storedScreenWidth = SCREEN_WIDTH;

// 离屏 Canvas：2x 分辨率，所有内容先渲染到这里
const offCanvas = wx.createCanvas();
offCanvas.width = SCREEN_WIDTH * DPR;
offCanvas.height = SCREEN_HEIGHT * DPR;
const offCtx = offCanvas.getContext('2d');
offCtx.imageSmoothingEnabled = true;
offCtx.imageSmoothingQuality = 'high';
offCtx.scale(DPR, DPR);

// 所有渲染模块使用的 ctx（指向离屏 Canvas，坐标与 1x 完全一致）
const ctx = offCtx;

function beginFrame() {
  offCtx.clearRect(0, 0, SCREEN_WIDTH * DPR, SCREEN_HEIGHT * DPR);
}

function present() {
  realCtx.clearRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
  realCtx.drawImage(offCanvas, 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
}

module.exports = { canvas: realCanvas, ctx, SCREEN_WIDTH, SCREEN_HEIGHT, beginFrame, present };
