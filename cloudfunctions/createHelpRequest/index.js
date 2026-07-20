// 云函数：创建场外求助
// 接收序列化后的棋盘快照（原始 JSON 字符串）与服务端压缩为 BASE64(DEFLATE) 存储，
// 服务端生成不可猜测的 helpKey，原子地把 helpKey 推入 players.helpKeys，返回 helpKey 供客户端分享。
// 说明：压缩在服务端用 node zlib 完成，客户端无需携带 pako deflate，仅回放时解压（pako_inflate）。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const crypto = require('crypto');
const zlib = require('zlib');

const EXPIRE_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();

  // snapshot 为客户端 JSON.stringify 后的原始串；recording 同理（submitAssist）。
  const { snapshot, snapshotMeta, requester, levelName } = event;

  // 入参校验
  if (!snapshot || typeof snapshot !== 'string') {
    return { code: 1, msg: 'snapshot missing' };
  }
  if (!requester || !requester.nickName) {
    return { code: 1, msg: 'requester missing' };
  }
  if (!levelName) {
    return { code: 1, msg: 'levelName missing' };
  }

  // 服务端压缩：原始 JSON → zlib deflate → base64
  const snapshotB64 = zlib.deflateSync(snapshot).toString('base64');

  // 生成全局唯一、不可猜测的 helpKey（128bit 随机）
  const helpKey = 'hk_' + crypto.randomBytes(16).toString('hex');

  try {
    await db.collection('help_requests').add({
      data: {
        helpKey,
        requesterOpenId: OPENID,
        requester: {
          nickName: requester.nickName || '',
          avatarUrl: requester.avatarUrl || '',
        },
        levelName,
        snapshot: snapshotB64,                          // BASE64(DEFLATE(自包含快照))
        snapshotMeta: snapshotMeta || {},               // 列表免解压即可展示
        status: 'open',
        assists: [],
        createdAt: db.serverDate(),
        expiresAt: db.serverDate({ offset: EXPIRE_MS }),
      },
    });

    // 原子推送 helpKey 到发起人 players.helpKeys（同一关可含多条）
    await db.collection('players')
      .where({ _openid: OPENID })
      .update({ data: { helpKeys: _.push(helpKey) } });

    return { code: 0, helpKey };
  } catch (err) {
    return { code: -1, msg: err.message };
  }
};
