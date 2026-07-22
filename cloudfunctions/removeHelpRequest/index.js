// 云函数：删除整条场外求助记录（仅发起人可操作）
// 与 removeAssist 的区别：
//   - removeAssist 只删「某一条协助者条目」，删空也仅留空数组、绝不删除整条文档；
//   - 本函数直接移除整个 help_requests 文档（含其下全部协助），
//     仅当 doc.requesterOpenId === OPENID 才允许，杜绝协助者误删他人记录。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: 1, msg: 'no openid' };

  const { helpKey } = event;
  if (!helpKey) return { code: 1, msg: 'helpKey missing' };

  try {
    const res = await db.collection('help_requests').where({ helpKey }).get();
    if (res.data.length === 0) return { code: 2, msg: 'not found' };

    const doc = res.data[0];
    // 权限：只有发起人能删除整条记录（协助者无权删别人的东西）
    if (doc.requesterOpenId !== OPENID) {
      return { code: 5, msg: 'not requester, forbidden' };
    }

    await db.collection('help_requests').doc(doc._id).remove();
    return { code: 0 };
  } catch (err) {
    return { code: -1, msg: err.message };
  }
};
