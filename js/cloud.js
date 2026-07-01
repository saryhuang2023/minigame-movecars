// 微信云开发工具模块

const CLOUD_ENV = 'cloud1-4gmoyu9g16089510'; // TODO: 替换为你的云环境 ID
const CLOUD_DATA_PREFIX = 'cloud://cloud1-4gmoyu9g16089510.636c-cloud1-4gmoyu9g16089510-1316941984/data/';

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
      argsSummary[k] = `[obj, ${JSON.stringify(v).length}c]`;
    } else if (v === null) {
      argsSummary[k] = 'null';
    } else if (v === undefined) {
      argsSummary[k] = 'undefined';
    } else {
      argsSummary[k] = typeof v === 'string' && v.length < 80 ? v : JSON.stringify(v).substring(0, 80);
    }
  }
  const reqSize = JSON.stringify(data).length;
  const reqSizeStr = reqSize >= 1024 ? (reqSize / 1024).toFixed(1) + 'KB' : reqSize + 'B';
  console.log(`[Cloud] → ${name}  ${reqSizeStr}`, argsSummary);

  try {
    const res = await wx.cloud.callFunction({ name, data });
    const duration = Date.now() - t0;
    const result = res.result;

    // 响应包大小
    const resSize = JSON.stringify(res).length;
    const sizeStr = resSize >= 1024 ? (resSize / 1024).toFixed(1) + 'KB' : resSize + 'B';

    // 结果摘要
    let resultSummary;
    if (result && typeof result === 'object') {
      if (Array.isArray(result)) {
        resultSummary = `[${result.length} items]`;
      } else if (result.data && Array.isArray(result.data)) {
        resultSummary = `data[${result.data.length}], code=${result.code}`;
      } else {
        var keys = Object.keys(result).join(',');
        resultSummary = `keys:{${keys}}, code=${result.code}`;
      }
    } else {
      resultSummary = String(result).substring(0, 80);
    }
    console.log(`[Cloud] ← ${name}  ${duration}ms  ${sizeStr}  ${resultSummary}`);

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
async function uploadLevel(name, data, version, published) {
  console.log('[Cloud] uploadLevel 参数: name=' + name
    + ' pigs=' + (data && data.pigs ? data.pigs.length : 0)
    + ' board.cols=' + (data && data.board ? data.board.cols : '?')
    + ' board.rows=' + (data && data.board ? data.board.rows : '?')
    + ' crownSteps=' + (data && data.crownSteps)
    + ' published=' + published
    + ' version=' + version);
  return callFunction('uploadLevel', { name, data, version, published });
}

/**
 * 获取云端已发布关卡范围
 * @returns {Promise<{minLevel: number, maxLevel: number}>}
 */
async function listLevels() {
  const res = await callFunction('listLevels');
  return res.data || { minLevel: 0, maxLevel: 0 };
}

/**
 * 下载完整关卡数据
 * @param {string} [id] 云端记录 _id（优先）
 * @param {string} [name] 关卡名
 * @param {boolean} [publishedOnly] 仅拉取已发布关卡
 */
async function downloadLevel(id, name, publishedOnly) {
  const res = await callFunction('downloadLevel', { id, name, publishedOnly });
  if (!res || !res.data) {
    console.log('[Cloud] downloadLevel 返回: null (code=' + (res && res.code) + ' msg=' + (res && res.msg) + ')');
  }
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

/**
 * 上报 Bug 诊断快照
 * @param {object} snapshot BugReporter 生成的快照对象
 */
async function reportBug(snapshot) {
  return callFunction('reportBug', { report: snapshot });
}

/**
 * 获取关卡信息（关主）
 * @param {string} levelId 关卡名（如 "0001"）
 * @returns {Promise<{masterUserId, masterSteps, masterAvatarUrl, masterNickname}|null>}
 */
async function getLevelInfo(levelId) {
  const res = await callFunction('getLevelInfo', { levelId });
  return res.data || null;
}

/**
 * 尝试夺取关主
 * @param {string} levelId 关卡名
 * @param {number} steps 步数
 * @param {string} [avatarUrl] 玩家头像
 * @param {string} [nickname] 玩家昵称
 * @returns {Promise<{claimed: boolean, master: object}>}
 */
async function claimLevelMaster(levelId, steps, avatarUrl, nickname) {
  return callFunction('claimLevelMaster', { levelId, steps, avatarUrl, nickname });
}

/**
 * 获取当前用户的 openid
 * @returns {Promise<string>}
 */
async function getOpenId() {
  const res = await callFunction('getOpenId');
  return res.openid || '';
}

/**
 * 从云存储下载 JSON 文件
 * @param {string} relativePath 相对于 CLOUD_DATA_PREFIX 的路径（如 'level/index.json'）
 * @returns {Promise<object|null>} 解析后的 JSON 对象，失败返回 null
 */
async function downloadCloudFile(relativePath) {
  const fileID = CLOUD_DATA_PREFIX + relativePath;
  const t0 = Date.now();
  try {
    var downloadRes = await wx.cloud.downloadFile({ fileID });
    if (downloadRes.statusCode !== 200) {
      console.warn('[Cloud] downloadCloudFile ' + relativePath + ' HTTP ' + downloadRes.statusCode);
      return null;
    }
    var fs = wx.getFileSystemManager();
    var raw = fs.readFileSync(downloadRes.tempFilePath, 'utf8');
    var fileSize = raw.length;
    var obj = JSON.parse(raw);
    var duration = Date.now() - t0;
    var sizeStr = fileSize >= 1024 ? (fileSize / 1024).toFixed(1) + 'KB' : fileSize + 'B';
    var itemCount = Array.isArray(obj) ? obj.length : (typeof obj === 'object' ? Object.keys(obj).length : 1);
    console.log('[Cloud] downloadCloudFile ' + relativePath + '  ' + duration + 'ms  ' + sizeStr + '  ' + itemCount + ' entries');
    return obj;
  } catch (e) {
    var duration = Date.now() - t0;
    console.warn('[Cloud] downloadCloudFile ' + relativePath + '  ' + duration + 'ms  FAILED:', (e && e.message) || String(e));
    return null;
  }
}

/**
 * 从云存储下载图片/二进制文件
 * @param {string} relativePath 相对于 CLOUD_DATA_PREFIX 的路径（如 'skins/rock/idle/1.png'）
 * @returns {Promise<string>} 本地临时文件路径
 */
async function downloadCloudImage(relativePath) {
  const fileID = CLOUD_DATA_PREFIX + relativePath;
  const t0 = Date.now();
  try {
    var downloadRes = await wx.cloud.downloadFile({ fileID });
    if (downloadRes.statusCode !== 200) {
      console.warn('[Cloud] downloadCloudImage ' + relativePath + ' HTTP ' + downloadRes.statusCode);
      throw new Error('HTTP ' + downloadRes.statusCode);
    }
    var duration = Date.now() - t0;
    console.log('[Cloud] downloadCloudImage ' + relativePath + '  ' + duration + 'ms  → ' + downloadRes.tempFilePath);
    return downloadRes.tempFilePath;
  } catch (e) {
    var duration = Date.now() - t0;
    console.warn('[Cloud] downloadCloudImage ' + relativePath + '  ' + duration + 'ms  FAILED:', (e && e.message) || String(e));
    throw e;
  }
}

/**
 * 关卡金币结算（服务器权威）
 * @param {string} levelId 关卡名（如 "0001"）
 * @param {number} pigCount 该关卡小猪数量
 * @param {number} stepBonus 步数奖励金币数（奖杯剩余步数，0=无）
 * @param {boolean} double 是否双倍
 * @returns {Promise<{code, gold, reward, claimed}>}
 */
async function settleLevel(levelId, pigCount, stepBonus, double) {
  return callFunction('settleLevel', { levelId, pigCount, stepBonus, double });
}

/**
 * 删除云端玩家档案（含金币、进度、皮肤等）
 * @returns {Promise<{code, deleted}>}
 */
async function deletePlayerProfile() {
  return callFunction('deletePlayerProfile');
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
  reportBug,
  getLevelInfo,
  claimLevelMaster,
  getOpenId,
  downloadCloudFile,
  downloadCloudImage,
  settleLevel,
  deletePlayerProfile
};
