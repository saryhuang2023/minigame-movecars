// 云函数：删除协助记录中的某条协助信息
// 权限矩阵（严格对齐产品纪律）：
//   发起人（requesterOpenId === OPENID）：可删任意一条 assist；若删空则整条文档归发起人，可移除。
//   协助者（assists[].assistantOpenId === OPENID 且非发起人）：只能删「自己那条」，
//     即使删空也绝不 remove 整条文档（那是别人发起的，无权删别人的东西）。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

function toMs(t) {
  if (!t) return 0;
  if (t instanceof Date) return t.getTime();
  if (typeof t === 'object' && typeof t.getTime === 'function') return t.getTime();
  const d = new Date(t);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function isExpired(doc) {
  if (!doc.expiresAt) return false;
  const t = toMs(doc.expiresAt);
  return t > 0 && t <= Date.now();
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: 1, msg: 'no openid' };

  const { helpKey, targetOpenId } = event;
  if (!helpKey) return { code: 1, msg: 'helpKey missing' };
  if (!targetOpenId) return { code: 1, msg: 'targetOpenId missing' };

  try {
    const res = await db.collection('help_requests').where({ helpKey }).get();
    if (res.data.length === 0) return { code: 2, msg: 'not found' };

    const doc = res.data[0];
    const isRequester = doc.requesterOpenId === OPENID;
    const assists = doc.assists || [];

    if (isRequester) {
      // 发起人：可删任意协助者；无协助者或删空后整条文档归我，可移除。
      if (assists.length === 0) {
        await db.collection('help_requests').doc(doc._id).remove();
        return { code: 0, removedDoc: true };
      }
      const idx = assists.findIndex(a => a.assistantOpenId === targetOpenId);
      if (idx < 0) return { code: 3, msg: 'target not in assists' };
      const newAssists = assists.filter((_, i) => i !== idx);
      if (newAssists.length === 0) {
        // 删空：整条文档归发起人，移除。
        await db.collection('help_requests').doc(doc._id).remove();
        return { code: 0, removedDoc: true };
      }
      await db.collection('help_requests').doc(doc._id).update({ data: { assists: newAssists } });
      return { code: 0, removedDoc: false };
    } else {
      // 协助者：只能删自己那条；绝无权删整条文档（别人发起的）。
      if (targetOpenId !== OPENID) return { code: 5, msg: 'cannot remove others' };
      const myIdx = assists.findIndex(a => a.assistantOpenId === OPENID);
      if (myIdx < 0) return { code: 4, msg: 'not your assist' };
      const newAssists = assists.filter((_, i) => i !== myIdx);
      await db.collection('help_requests').doc(doc._id).update({ data: { assists: newAssists } });
      return { code: 0, removedDoc: false };
    }
  } catch (err) {
    return { code: -1, msg: err.message };
  }
};
