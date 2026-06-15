// 微信云开发工具模块

const CLOUD_ENV = 'cloud1-4gmoyu9g16089510'; // TODO: 替换为你的云环境 ID

/**
 * 初始化云开发
 * 在 game.js 中调用
 */
function initCloud() {
  if (!wx.cloud) {
    console.warn('请使用 2.2.3 或以上的基础库以使用云能力');
    return;
  }

  wx.cloud.init({
    env: CLOUD_ENV,
    traceUser: true,
  });

  console.log('[Cloud] 云开发初始化完成');
}

/**
 * 调用云函数
 * @param {string} name 云函数名称
 * @param {object} data 传入数据
 */
async function callFunction(name, data = {}) {
  try {
    const res = await wx.cloud.callFunction({ name, data });
    return res.result;
  } catch (err) {
    console.error(`[Cloud] 调用 ${name} 失败:`, err);
    throw err;
  }
}

/**
 * 获取玩家数据
 * @param {string} openid 玩家 openid（云函数自动获取）
 */
async function getPlayerData() {
  return callFunction('getPlayerData');
}

/**
 * 保存玩家数据
 * @param {object} data 玩家数据 { score, level, items 等 }
 */
async function savePlayerData(data) {
  return callFunction('savePlayerData', { data });
}

module.exports = {
  initCloud,
  callFunction,
  getPlayerData,
  savePlayerData,
};
