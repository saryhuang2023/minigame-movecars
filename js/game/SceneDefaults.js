// 场景默认配置 — 关卡内可替换视觉元素集中管理
// 后续每发现一个可替换元素，统一声明在这里

module.exports = {
  // 场景 0 默认配置
  sceneId: 0,
  name: '默认场景',

  // 背景图
  background: 'assets/images/levels/0/bg.jpg',

  // 孔位颜色
  boardColors: {
    holeEmpty: '#7ED038',         // 空闲孔位绿色
    holeEmptyAlpha: 0.55,         // 空闲孔位透明度
    holeOccupied: '#66AE27',      // 已占用孔位绿色
  },

  // 棋盘可用区域（屏幕坐标）
  boardArea: {
    top: 170,           // 上边界：离屏幕顶部 170px
    bottom: 136,        // 下边界：离屏幕底部 136px
    hMargin: 5,         // 水平边距：左右各 5px
  },

  // 后续可替换元素统一追加于此：
  // fontFamily: 'sans-serif',
  // boardColors: { ... },
  // cardStyle: { ... },
  // decor: { ... },
};
