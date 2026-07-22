// 云函数：列出当前用户的场外求助（「我发出的」+「我协助的」双视图）
// 服务端按 requesterOpenId / assists.assistantOpenId 查询，刻意剔除 snapshot/recording 大字段。
// 返回 { code:0, sent:[...], assisted:[...] }，每个求助聚合为一张卡片：assists 为协助者明细数组（含各自跑出猪数）。
// 客户端不再计算/展示亲密度；n/m 的 n 直接取 assists.length，m 固定为 3。
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

function normalizeStatus(doc) {
  if (isExpired(doc)) return 'expired';
  return doc.status || 'open';
}

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  if (!OPENID) return { code: 1, msg: 'no openid' };

  try {
    // === 我发出的：我是 requester，按发布时间倒序 ===
    const sentRes = await db.collection('help_requests')
      .where({ requesterOpenId: OPENID })
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();

    const sent = [];
    for (const doc of (sentRes.data || [])) {
      const base = {
        helpKey: doc.helpKey,
        levelName: doc.levelName || '',
        createdAt: toMs(doc.createdAt),
        expiresAt: toMs(doc.expiresAt),
        status: normalizeStatus(doc),
      };
      // 同一求助聚合为一张卡片：assists 为该求助的全部协助者明细
      const assists = (doc.assists || []).map((a, i) => ({
        openId: a.assistantOpenId,
        nickName: a.assistant ? a.assistant.nickName : '',
        avatarUrl: a.assistant ? a.assistant.avatarUrl : '',
        result: a.result || null,
        recordedAt: toMs(a.recordedAt),
        idx: i,
      }));
      // baseEscaped = 发起求助时的残局已逃出猪数（snapshotMeta.escapedPigs）；
      // 协助者「跑出 X 头」应显示好友协助期间【额外】逃出的猪数 = result.escapedPigs − baseEscaped，而非整关总数。
      const baseEscaped = (doc.snapshotMeta && typeof doc.snapshotMeta.escapedPigs === 'number') ? doc.snapshotMeta.escapedPigs : 0;
      sent.push(Object.assign({}, base, { assists, assistCount: assists.length, baseEscaped }));
    }

    // === 我协助的：我是某条协助记录的 assistant，按我的协助时间倒序 ===
    const asRes = await db.collection('help_requests')
      .where({ 'assists.assistantOpenId': OPENID })
      .limit(100)
      .get();

      const assisted = [];
      for (const doc of (asRes.data || [])) {
        // 该求助的全部协助者明细（仅用于取本人那条 + 统计总数）
        const all = (doc.assists || []).map((a, i) => ({
          openId: a.assistantOpenId,
          nickName: a.assistant ? a.assistant.nickName : '',
          avatarUrl: a.assistant ? a.assistant.avatarUrl : '',
          result: a.result || null,
          recordedAt: toMs(a.recordedAt),
          idx: i,
        }));
        const myIdx = all.findIndex(a => a.openId === OPENID);
        if (myIdx < 0) continue;
        assisted.push({
          helpKey: doc.helpKey,
          levelName: doc.levelName || '',
          createdAt: toMs(doc.createdAt),    // 发布日期（展示用）
          recordedAt: all[myIdx].recordedAt,  // 我的协助时间（排序用）
          status: normalizeStatus(doc),
          myIdx: myIdx,
          assistCount: all.length,          // 该求助总协助人数（头行 n/m 用，即便下方只回传本人那条）
          // 发起者头像/昵称（我协助的视图里行首展示「谁发起的」，而非我本人）
          requester: {
            openId: doc.requesterOpenId,
            nickName: doc.requester ? doc.requester.nickName : '',
            avatarUrl: doc.requester ? doc.requester.avatarUrl : '',
          },
          // baseEscaped = 发起求助时的残局已逃出猪数（同 doc.snapshotMeta，与「我发出的」视图一致）
          baseEscaped: (doc.snapshotMeta && typeof doc.snapshotMeta.escapedPigs === 'number') ? doc.snapshotMeta.escapedPigs : 0,
          assists: [all[myIdx]],            // 隐私：我协助的视图只回传本人协助明细，其余玩家属隐私不回传
        });
      }
    assisted.sort((a, b) => (b.recordedAt || 0) - (a.recordedAt || 0));

    return { code: 0, sent, assisted };
  } catch (err) {
    return { code: -1, msg: err.message };
  }
};
