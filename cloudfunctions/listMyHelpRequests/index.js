// 云函数：列出当前用户的场外求助（「我发出的」+「我协助的」双视图）
// 服务端按 requesterOpenId / assists.assistantOpenId 查询，刻意剔除 snapshot/recording 大字段。
// 返回 { code:0, sent:[...], assisted:[...] }，亲密度由客户端按 openId 对聚合计算。
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
      const assists = doc.assists || [];
      if (assists.length) {
        for (let i = 0; i < assists.length; i++) {
          const a = assists[i];
          sent.push(Object.assign({}, base, {
            noAssist: false,
            idx: i,
            friend: {
              openId: a.assistantOpenId,
              nickName: a.assistant ? a.assistant.nickName : '',
              avatarUrl: a.assistant ? a.assistant.avatarUrl : '',
            },
            result: a.result || null,
            recordedAt: toMs(a.recordedAt),
          }));
        }
      } else {
        // 无协助者：展示一条占位记录，好友/力度显示「暂无」，回放钮变「重发」
        sent.push(Object.assign({}, base, {
          noAssist: true,
          idx: -1,
          friend: null,
          result: null,
          recordedAt: 0,
        }));
      }
    }

    // === 我协助的：我是某条协助记录的 assistant，按我的协助时间倒序 ===
    const asRes = await db.collection('help_requests')
      .where({ 'assists.assistantOpenId': OPENID })
      .limit(100)
      .get();

    const assisted = [];
    for (const doc of (asRes.data || [])) {
      const assists = doc.assists || [];
      const idx = assists.findIndex(a => a.assistantOpenId === OPENID);
      if (idx < 0) continue;
      const my = assists[idx];
      assisted.push({
        helpKey: doc.helpKey,
        levelName: doc.levelName || '',
        createdAt: toMs(doc.createdAt),   // 发布日期（展示用）
        recordedAt: toMs(my.recordedAt),  // 我的协助时间（排序用）
        status: normalizeStatus(doc),
        noAssist: false,
        idx: idx,
        friend: {
          openId: doc.requesterOpenId,
          nickName: doc.requester ? doc.requester.nickName : '',
          avatarUrl: doc.requester ? doc.requester.avatarUrl : '',
        },
        result: my.result || null,
      });
    }
    assisted.sort((a, b) => (b.recordedAt || 0) - (a.recordedAt || 0));

    return { code: 0, sent, assisted };
  } catch (err) {
    return { code: -1, msg: err.message };
  }
};
