// Canvas 初始化 + 屏幕尺寸常量 + 超采样抗锯齿

// 取设备像素比，上限 2（2x 渲染+缩小回 1x 提供自然抗锯齿）
var sysInfo = wx.getSystemInfoSync();
const DPR = Math.min(sysInfo.pixelRatio || 2, 2);

const realCanvas = wx.createCanvas();
const realCtx = realCanvas.getContext('2d');

// 逻辑分辨率（所有游戏坐标基于此）
// 主 canvas 在部分真机/预览环境下初始 width/height 为 0（尺寸尚未就绪），
// 此时用系统窗口尺寸兜底，避免 offCanvas 宽高为 0 导致 present() drawImage 崩溃。
const W = sysInfo.windowWidth || sysInfo.screenWidth || 375;
const H = sysInfo.windowHeight || sysInfo.screenHeight || 667;
const SCREEN_WIDTH = realCanvas.width || W;
const SCREEN_HEIGHT = realCanvas.height || H;

// 真实 Canvas 升级为物理分辨率，消除高 DPI 模糊
realCanvas.width = SCREEN_WIDTH * DPR;
realCanvas.height = SCREEN_HEIGHT * DPR;
realCtx.scale(DPR, DPR);
realCtx.imageSmoothingEnabled = true;
realCtx.imageSmoothingQuality = 'high';

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

module.exports = { canvas: realCanvas, ctx, DPR, SCREEN_WIDTH, SCREEN_HEIGHT, beginFrame, present };
