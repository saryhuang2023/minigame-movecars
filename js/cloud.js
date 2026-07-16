// 微信云开发工具模块

var CloudDefine = require('./define/CloudDefine.js');
var CLOUD_ENV = CloudDefine.CLOUD.ENV;
var CLOUD_DATA_PREFIX = CloudDefine.CLOUD.DATA_PREFIX;

// 资源清单模块级缓存（整个 session 只拉一次 version.json）
// 用 promise 串接，避免并发 init 重复下载。详见 getAssetManifest()。
var _manifestPromise = null;

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

  console.log('[cloud] 云开发初始化完成');
}

/**
 * 调用云函数
 * @param {string} name 云函数名称
 * @param {object} data 传入数据
 */
async function callFunction(name, data = {}, tag = '') {
  const t0 = Date.now();
  const prefix = tag ? `[${tag}][cloud]` : '[cloud]';

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
  console.log(`${prefix} → ${name}  ${reqSizeStr}`, argsSummary);

  try {
    const res = await wx.cloud.callFunction({ name, data });
    const duration = Date.now() - t0;
    const result = res.result;

    const resSize = JSON.stringify(res).length;
    const sizeStr = resSize >= 1024 ? (resSize / 1024).toFixed(1) + 'KB' : resSize + 'B';

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
    console.log(`${prefix} ← ${name}  ${duration}ms  ${sizeStr}  ${resultSummary}`);

    if (result && typeof result === 'object') {
      if (result.code === undefined) {
        console.error(`${prefix} ✗ ${name} 返回结果缺少 code 字段`);
        console.error(`${prefix} res顶层keys:`, Object.keys(res).join(','), `| errMsg:`, res.errMsg);
        console.error(`${prefix} res.result:`, JSON.stringify(result).substring(0, 500));
      } else if (result.code !== 0) {
        // 云函数逻辑失败（如版本冲突、权限、参数错误等）
        console.error(`${prefix} ✗ ${name}  code=${result.code}  msg=${result.msg || '?'}  ${JSON.stringify(result).substring(0, 300)}`);
      }
    }

    return result;
  } catch (err) {
    const duration = Date.now() - t0;
    console.error(`${prefix} ✗ ${name}  ${duration}ms  errCode=${(err && err.errCode) || '?'}  ${(err && err.message) || String(err)}`);
    throw err;
  }
}

/**
 * 获取玩家数据
 * @param {string} openid 玩家 openid（云函数自动获取）
 */
async function getPlayerData() {
  return callFunction('getPlayerData', {}, 'Load');
}

/**
 * 保存玩家数据
 * @param {object} data 玩家数据 { score, level, items 等 }
 */
async function savePlayerData(data) {
  return callFunction('savePlayerData', { data }, 'Game');
}

/**
 * 上传/保存关卡到云端（乐观并发控制）
 * @param {string} name 关卡名（如 "0001"）
 * @param {object} data 关卡数据 { board, pigs }
 * @param {number} version 客户端持有的版本号（首次上传传 0）
 */
async function uploadLevel(name, data, version, published) {
  console.log('[Edit][cloud] uploadLevel 参数: name=' + name
    + ' pigs=' + (data && data.pigs ? data.pigs.length : 0)
    + ' board.cols=' + (data && data.board ? data.board.cols : '?')
    + ' board.rows=' + (data && data.board ? data.board.rows : '?')
    + ' published=' + published
    + ' version=' + version);
  return callFunction('uploadLevel', { name, data, version, published }, 'Edit');
}

/**
 * 获取云端已发布关卡范围
 * @returns {Promise<{minLevel: number, maxLevel: number}>}
 */
async function listLevels() {
  const res = await callFunction('listLevels', {}, 'Load');
  var data = res.data || { minLevel: 0, maxLevel: 0 };
  console.log('[Load][cloud] listLevels 数据: min=' + data.minLevel + ' max=' + data.maxLevel);
  return data;
}

/**
 * 下载完整关卡数据
 * @param {string} [id] 云端记录 _id（优先）
 * @param {string} [name] 关卡名
 * @param {boolean} [publishedOnly] 仅拉取已发布关卡
 */
async function downloadLevel(id, name, publishedOnly) {
  const res = await callFunction('downloadLevel', { id, name, publishedOnly }, 'Load');
  if (!res || !res.data) {
    console.log('[Load][cloud] downloadLevel 返回: null (code=' + (res && res.code) + ' msg=' + (res && res.msg) + ')');
  }
  return res.data || null;
}

/**
 * 从云端删除关卡
 * @param {string} [id] 云端记录 _id（优先）
 * @param {string} [name] 关卡名
 */
async function deleteLevel(id, name) {
  return callFunction('deleteLevel', { id, name }, 'Edit');
}

/**
 * 上报 Bug 诊断快照
 * @param {object} snapshot BugReporter 生成的快照对象
 */
async function reportBug(snapshot) {
  return callFunction('reportBug', { report: snapshot }, 'Game');
}

/**
 * 获取当前用户的 openid
 * @returns {Promise<string>}
 */
async function getOpenId() {
  const res = await callFunction('getOpenId', {}, 'Load');
  return res.openid || '';
}

/**
 * 从云存储下载 JSON 文件
 * @param {string} relativePath 相对于 CLOUD_DATA_PREFIX 的路径（如 'level/index.json'）
 * @returns {Promise<object|null>} 解析后的 JSON 对象，失败返回 null
 */
async function downloadCloudFile(relativePath) {
  const fileID = CLOUD_DATA_PREFIX + relativePath;
  console.log('[Load][cloud] → downloadCloudFile ' + relativePath);
  const t0 = Date.now();
  try {
    var downloadRes = await wx.cloud.downloadFile({ fileID });
    if (downloadRes.statusCode !== 200) {
      console.warn('[Load][cloud] downloadCloudFile ' + relativePath + ' HTTP ' + downloadRes.statusCode);
      return null;
    }
    var fs = wx.getFileSystemManager();
    var raw = fs.readFileSync(downloadRes.tempFilePath, 'utf8');
    var fileSize = raw.length;
    var obj = JSON.parse(raw);
    var duration = Date.now() - t0;
    var sizeStr = fileSize >= 1024 ? (fileSize / 1024).toFixed(1) + 'KB' : fileSize + 'B';
    var itemCount = Array.isArray(obj) ? obj.length : (typeof obj === 'object' ? Object.keys(obj).length : 1);
    console.log('[Load][cloud] downloadCloudFile ' + relativePath + '  ' + duration + 'ms  ' + sizeStr + '  ' + itemCount + ' entries');
    return obj;
  } catch (e) {
    var duration = Date.now() - t0;
    console.warn('[Load][cloud] downloadCloudFile ' + relativePath + '  ' + duration + 'ms  FAILED:', (e && e.message) || String(e));
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
  console.log('[Load][cloud] → downloadCloudImage ' + relativePath);
  const t0 = Date.now();
  try {
    var downloadRes = await wx.cloud.downloadFile({ fileID });
    if (downloadRes.statusCode !== 200) {
      console.warn('[Load][cloud] downloadCloudImage ' + relativePath + ' HTTP ' + downloadRes.statusCode);
      throw new Error('HTTP ' + downloadRes.statusCode);
    }
    var duration = Date.now() - t0;
    console.log('[Load][cloud] downloadCloudImage ' + relativePath + '  ' + duration + 'ms  → ' + downloadRes.tempFilePath);
    return downloadRes.tempFilePath;
  } catch (e) {
    var duration = Date.now() - t0;
    console.warn('[Load][cloud] downloadCloudImage ' + relativePath + '  ' + duration + 'ms  FAILED:', (e && e.message) || String(e));
    throw e;
  }
}

/**
 * 拉取云端资源清单 version.json（一次下载，整体 session 复用）
 * 清单内容：{ "data/skins/rock/idle/1.png": "md5...", "audio/music/bgm.mp3": "md5..." }
 *   - 图片 key 以 "data/" 开头，音频 key 以 "audio/" 开头
 *   - 客户端启动时下载一次，与本地缓存指纹比对，只对变化的文件重新下载。
 * 设计要点（最简可靠方案）：
 *   - 不再依赖云函数 / 云数据库 / 定时器，资源清单就是一个 JSON 文件放云存储 data/ 下。
 *   - 模块级 _manifestPromise 缓存，保证 Loading 阶段图片批量下载与音频并发下载时只拉一次。
 *   - 失败降级为 {}（即"全部重新下载"），不阻塞游戏。
 * @returns {Promise<{[key:string]: string}>} 资源指纹表，失败返回 {}
 */
async function getAssetManifest() {
  if (_manifestPromise) return _manifestPromise;
  _manifestPromise = (async () => {
    try {
      const obj = await downloadCloudFile('version.json');
      console.log('[cloud] 资源清单 version.json 载入 ' + (obj ? Object.keys(obj).length : 0) + ' 条');
      return obj || {};
    } catch (e) {
      console.warn('[cloud] 资源清单载入失败（降级：全部重新下载）:', (e && e.message));
      return {};
    }
  })();
  return _manifestPromise;
}

/**
 * 使资源清单缓存失效（下次调用 getAssetManifest 重新下载）
 * 调试面板清缓存后可调用，正常流程无需。
 */
function invalidateAssetManifest() {
  _manifestPromise = null;
}

/**
 * 关卡金币结算（服务器权威）
 * @param {string} levelId 关卡名（如 "0001"）
 * @param {number} pigCount 该关卡小猪数量
 * @param {number} stepBonus 步数奖励金币数（剩余步数转化，0=无）
 * @param {boolean} double 是否双倍
 * @returns {Promise<{code, gold, reward, claimed}>}
 */
async function settleLevel(levelId, pigCount, stepBonus, double) {
  return callFunction('settleLevel', { levelId, pigCount, stepBonus, double }, 'Game');
}

/**
 * 删除云端玩家档案（含金币、进度、皮肤等）
 * @returns {Promise<{code, deleted}>}
 */
async function deletePlayerProfile() {
  return callFunction('deletePlayerProfile', {}, 'Game');
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
  getOpenId,
  downloadCloudFile,
  downloadCloudImage,
  getAssetManifest,
  invalidateAssetManifest,
  settleLevel,
  deletePlayerProfile
};
