// 云函数：上传/更新关卡（乐观并发控制 — version 字段）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { name, data, version, published } = event;
  if (!name || !data) {
    return { code: -1, msg: '缺少 name 或 data' };
  }

  const clientVersion = (typeof version === 'number') ? version : 0;
  const pigCount = (data.pigs && data.pigs.length) || 0;
  const starScores = (Array.isArray(data.starScores) && data.starScores.length === 4) ? data.starScores : null;
  const hasPublishedParam = (published !== null && published !== undefined);
  const now = Date.now();

  try {
    const exist = await db.collection('levels')
      .where({ name })
      .get();

    if (exist.data.length === 0) {
      // 新增（首次上传）：默认未发布
      const stepBonusThreshold = (typeof data.stepBonusThreshold === 'number') ? data.stepBonusThreshold : (typeof data.crownSteps === 'number' ? data.crownSteps : 0);
      data.version = 1;
      var pub = hasPublishedParam ? !!published : false;
      const res = await db.collection('levels').add({
        data: {
          _openid: OPENID, name, data, pigCount, stepBonusThreshold, starScores,
          version: 1, published: pub,
          createdAt: now, updatedAt: now
        }
      });
      return { code: 0, msg: 'created', id: res._id, version: 1, stepBonusThreshold, starScores };
    }

    // 已存在 — 版本号检查（乐观并发）
    const doc = exist.data[0];
    const serverVersion = (typeof doc.version === 'number') ? doc.version : 0;
    // 深度合并：以客户端 data 为准全覆盖，避免旧文档缺字段（如 stepBonusThreshold）
    const mergedData = Object.assign({}, doc.data, data);
    mergedData.version = serverVersion + 1;

    if (serverVersion > 0 && clientVersion !== serverVersion) {
      return {
        code: 2, msg: 'conflict',
        serverVersion,
        data: doc.data
      };
    }

    // 版本匹配 — 原子条件更新
    const newVersion = serverVersion + 1;
    const stepBonusThreshold = (typeof data.stepBonusThreshold === 'number') ? data.stepBonusThreshold : (typeof data.crownSteps === 'number' ? data.crownSteps : 0);
    const whereCond = serverVersion > 0
      ? { _id: doc._id, version: serverVersion }
      : { _id: doc._id };
    
    // published: null/undefined → 保持现有值不变
    var updateData = { data: mergedData, pigCount, stepBonusThreshold, starScores, version: newVersion, updatedAt: now };
    if (hasPublishedParam) updateData.published = !!published;
    
    const result = await db.collection('levels')
      .where(whereCond)
      .update({ data: updateData });

    if (result.stats.updated === 0) {
      // 并发写入导致匹配失败（极小概率）
      return { code: 2, msg: 'conflict', serverVersion };
    }

    return { code: 0, msg: 'updated', id: doc._id, version: newVersion, stepBonusThreshold, starScores };
  } catch (err) {
    return { code: -1, msg: err.message };
  }
};
