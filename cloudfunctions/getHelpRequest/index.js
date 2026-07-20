// 云函数：按 helpKey 拉取求助详情（含压缩快照）
// 任何持有 helpKey 的人（发起人/好友）都可读取；helpKey 不可猜测，靠分享卡片传播。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

function isExpired(doc) {
  if (!doc.expiresAt) return false;
  const t = (doc.expiresAt instanceof Date) ? doc.expiresAt.getTime() : new Date(doc.expiresAt).getTime();
  return t <= Date.now();
}

exports.main = async (event, context) => {
  const { helpKey } = event;

  if (!helpKey) {
    return { code: 1, msg: 'helpKey missing' };
  }

  try {
    const res = await db.collection('help_requests').where({ helpKey }).get();
    if (res.data.length === 0) {
      return { code: 2, msg: 'not found' }; // NOT_FOUND
    }
    const doc = res.data[0];

    // 过期判定（以服务端时间为准），顺手标记便于后续清理，不阻塞读取
    if (isExpired(doc) && doc.status !== 'expired') {
      await db.collection('help_requests').doc(doc._id).update({ data: { status: 'expired' } });
      doc.status = 'expired';
    }

    return { code: 0, data: doc };
  } catch (err) {
    return { code: -1, msg: err.message };
  }
};
