// 精准获取「顶部可用区域上边界」—— 完全基于微信运行时 API，绝不写死任何机型 / 摄像头位置。
//
// 单位说明：返回的所有坐标均为「1x 逻辑像素」，与 render.js 的 ctx(已 scale(DPR)) 一致，
//   因此可直接用于游戏绘制坐标，无需再乘 pixelRatio。
//
// ===== 设计模型（用户硬约束）=====
// 不同手机形态千差万别：中心挖孔 / 左上刘海 / 大刘海 / 平面屏 …… 摄像头、刘海的具体位置
// 我们「不该、也不能」去建模（那必须写死机型型号，违背约束）。
//
// 微信运行时只给两个可靠的、按当前设备算好的信号：
//   1) safeArea.top —— 操作系统按这台手机算出的「安全区上边界」。
//      大刘海就大、平面屏就小、挖孔屏也会算进去 → 天然适配所有机型，零写死。
//      它就是顶部该预留的统一高度，全宽一致（我们不能比 OS 更懂某台手机的硬件布局）。
//   2) 微信右上角胶囊（···/⊙）—— 这是微信自己的 UI（非硬件），用
//      getMenuButtonBoundingClientRect 精确取得，仅在其水平覆盖范围内把线抬到 capsule.bottom，
//      避免 HUD 被胶囊遮挡。
//
// safeLineY(x)：屏幕横坐标 x 处「可用区域上边界」的 y 值（线以下为可用区）。
//   形状：
//     - 绝大多数宽度 → 统一 = safeArea.top（OS 算好的安全高度）
//     - 仅右上胶囊水平覆盖区 → 平滑抬升到 capsule.bottom（避开微信 UI）
//   没有任何「中央摄像头下凹」之类的硬编码形状。

function _getWin() {
  try {
    if (typeof wx !== 'undefined' && wx.getWindowInfo) return wx.getWindowInfo();
  } catch (e) {}
  try {
    if (typeof wx !== 'undefined' && wx.getSystemInfoSync) return wx.getSystemInfoSync();
  } catch (e) {}
  return {};
}

function getSafeLayout() {
  var win = _getWin();
  var screenW = win.screenWidth || (win.windowWidth || 375);
  var screenH = win.screenHeight || (win.windowHeight || 667);
  var statusBarH = (typeof win.statusBarHeight === 'number') ? win.statusBarHeight : 20;
  var safeArea = win.safeArea || null;
  var safeTop, safeBottom;
  if (safeArea && typeof safeArea.top === 'number') {
    safeTop = safeArea.top;
    safeBottom = screenH - safeArea.bottom;
  } else {
    safeTop = statusBarH;
    safeBottom = 0;
  }

  // 微信胶囊（···/⊙）：微信自己的 UI，必须用 API 取，不能假设位置/尺寸
  var capsule = null;
  try {
    if (typeof wx !== 'undefined' && wx.getMenuButtonBoundingClientRect) {
      capsule = wx.getMenuButtonBoundingClientRect();
    }
  } catch (e) {}

  // ---- 可调参数（极简，仅胶囊避让相关）----
  var CAP_MARGIN = 4;   // 胶囊外扩留白(px)，避免贴边
  var RAMP = 16;        // 胶囊台阶处的缓升宽度(px)，让线在右侧平滑翘起而非硬跳

  var capL = capsule ? (capsule.left - CAP_MARGIN) : screenW;
  var capR = capsule ? (capsule.right + CAP_MARGIN) : screenW;
  var capB = capsule ? (capsule.bottom + CAP_MARGIN) : safeTop;

  // 可用区上边界曲线：默认全宽统一 = safeArea.top；仅胶囊水平区平滑抬升。
  function safeLineY(x) {
    var y = safeTop;
    if (capsule && typeof x === 'number') {
      if (x >= capR) {
        y = Math.max(y, capB);
      } else if (x > capL) {
        // 胶囊左缘到胶囊右缘之间：从 safeTop 平滑升到 capB，避免竖直硬折线
        var t = (x - capL) / Math.max(1, capR - capL); // 0..1
        y = safeTop + (capB - safeTop) * t;
      }
    }
    return y;
  }

  // 障碍物清单（仅用于真机可视化核对）：微信胶囊（硬件摄像头/刘海不建模，已由 safeArea.top 统一涵盖）
  function getObstructions() {
    var obs = [];
    if (capsule) {
      obs.push({
        type: 'rect',
        x: capsule.left - CAP_MARGIN,
        y: capsule.top - CAP_MARGIN,
        w: capsule.width + CAP_MARGIN * 2,
        h: capsule.height + CAP_MARGIN * 2,
        label: 'capsule',
      });
    }
    return obs;
  }

  return {
    screenW: screenW,
    screenH: screenH,
    statusBarH: statusBarH,
    safeTop: safeTop,             // 顶部统一安全高度（OS 算好，全宽一致）
    safeBottom: safeBottom,
    capsule: capsule,             // 右上角胶囊(···/○)占用矩形，HUD 应避开
    safeLineY: safeLineY,         // 可用区上边界曲线函数
    getObstructions: getObstructions,
    _cfg: { CAP_MARGIN: CAP_MARGIN, RAMP: RAMP },
  };
}

module.exports = { getSafeLayout };
