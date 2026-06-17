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
  const t0 = Date.now();

  // 参数摘要
  const argsSummary = {};
  for (const k of Object.keys(data)) {
    const v = data[k];
    if (k === 'data') {
      argsSummary[k] = `[${typeof v}, ${JSON.stringify(v).length} chars]`;
    } else {
      argsSummary[k] = typeof v === 'string' && v.length < 80 ? v : (v === undefined ? 'undefined' : JSON.stringify(v).substring(0, 80));
    }
  }
  console.log(`[Cloud] → ${name}`, argsSummary);

  try {
    const res = await wx.cloud.callFunction({ name, data });
    const duration = Date.now() - t0;
    const result = res.result;
    // 结果摘要
    let resultSummary;
    if (result && typeof result === 'object') {
      if (Array.isArray(result)) {
        resultSummary = `[${result.length} items]`;
      } else if (result.data && Array.isArray(result.data)) {
        resultSummary = `data[${result.data.length}], code=${result.code}`;
      } else {
        resultSummary = `keys:{${Object.keys(result).join(',')}}, code=${result.code}`;
      }
    } else {
      resultSummary = String(result).substring(0, 80);
    }
    console.log(`[Cloud] ← ${name}  ${duration}ms  ${resultSummary}`);

    // 额外诊断：如果 code 是 undefined，打印完整 result
    if (result && typeof result === 'object' && result.code === undefined) {
      console.warn(`[Cloud] ⚠ ${name} 返回结果缺少 code 字段`);
      console.warn(`[Cloud] res顶层keys:`, Object.keys(res).join(','), `| errMsg:`, res.errMsg);
      console.warn(`[Cloud] res.result:`, JSON.stringify(result).substring(0, 500));
    }

    return result;
  } catch (err) {
    const duration = Date.now() - t0;
    console.error(`[Cloud] ✗ ${name}  ${duration}ms  ${(err && err.message) || String(err)}`);
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

/**
 * 上传/保存关卡到云端（乐观并发控制）
 * @param {string} name 关卡名（如 "0001"）
 * @param {object} data 关卡数据 { board, pigs }
 * @param {number} version 客户端持有的版本号（首次上传传 0）
 */
async function uploadLevel(name, data, version) {
  return callFunction('uploadLevel', { name, data, version });
}

/**
 * 获取云端关卡列表（仅元数据）
 * @returns {Promise<Array<{_id, name, pigCount, updatedAt}>>}
 */
async function listLevels() {
  const res = await callFunction('listLevels');
  return res.data || [];
}

/**
 * 下载完整关卡数据
 * @param {string} [id] 云端记录 _id（优先）
 * @param {string} [name] 关卡名
 */
async function downloadLevel(id, name) {
  const res = await callFunction('downloadLevel', { id, name });
  return res.data || null;
}

/**
 * 从云端删除关卡
 * @param {string} [id] 云端记录 _id（优先）
 * @param {string} [name] 关卡名
 */
async function deleteLevel(id, name) {
  return callFunction('deleteLevel', { id, name });
}

module.exports = {
  initCloud,
  callFunction,
  getPlayerData,
  savePlayerData,
  uploadLevel,
  listLevels,
  downloadLevel,
  deleteLevel,
};
