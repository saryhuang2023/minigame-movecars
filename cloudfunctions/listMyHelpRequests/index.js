// 云函数：列出当前用户发起的全部求助
// 服务端按 requesterOpenId 查询；刻意剔除 snapshot / recording 大字段，列表仅展示索引与协助者信息。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

function isExpired(doc) {
  if (!doc.expiresAt) return false;
  const t = (doc.expiresAt instanceof Date) ? doc.expiresAt.getTime() : new Date(doc.expiresAt).getTime();
  return t <= Date.now();
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();

  try {
    const res = await db.collection('help_requests')
      .where({ requesterOpenId: OPENID })
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();

    const list = res.data.map(doc => {
      const expired = isExpired(doc);
      const status = (expired && doc.status !== 'expired') ? 'expired' : doc.status;
      return {
        helpKey: doc.helpKey,
        levelName: doc.levelName,
        snapshotMeta: doc.snapshotMeta || {},
        status,
        assists: (doc.assists || []).map(a => ({
          assistantOpenId: a.assistantOpenId,
          assistant: a.assistant,
          recordedAt: a.recordedAt,
          result: a.result,
          // 注意：故意剔除 a.recording 大字段
        })),
        createdAt: doc.createdAt,
        expiresAt: doc.expiresAt,
      };
    });

    return { code: 0, list };
  } catch (err) {
    return { code: -1, msg: err.message };
  }
};
