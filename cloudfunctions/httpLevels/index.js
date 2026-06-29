// 云函数：HTTP 触发器 — 关卡管理后台
// 通过 HTTP 访问服务 URL: https://cloud1-4gmoyu9g16089510.service.tcloudbase.com/

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8'
};

function jsonResponse(data) {
  return {
    statusCode: 200,
    headers: { ...CORS_HEADERS },
    body: JSON.stringify(data)
  };
}

exports.main = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { ...CORS_HEADERS }, body: '' };
  }

  const { action, id, name } = event.queryStringParameters || {};

  try {
    if (action === 'list') {
      const res = await db.collection('levels')
        .field({
          _id: true, _openid: true, name: true, pigCount: true,
          version: true, updatedAt: true, data: true
        })
        .orderBy('name', 'asc')
        .limit(200)
        .get();

      const list = res.data.map(doc => ({
        id: doc._id,
        author: (doc._openid || '').slice(-6),
        name: doc.name,
        pigCount: doc.pigCount || 0,
        version: doc.version || 0,
        ready: (doc.data && doc.data.ready) || 0,
        updatedAt: doc.updatedAt
          ? new Date(doc.updatedAt).toISOString().slice(0, 19).replace('T', ' ')
          : ''
      }));

      return jsonResponse({ code: 0, data: list, total: list.length });
    }

    if (action === 'delete') {
      if (!id) {
        return jsonResponse({ code: -1, msg: '缺少关卡 ID' });
      }
      try {
        await db.collection('levels').doc(id).remove();
        return jsonResponse({ code: 0, msg: '已删除' });
      } catch (e) {
        return jsonResponse({ code: -1, msg: '删除失败: ' + e.message });
      }
    }

    if (action === 'download') {
      let doc = null;
      if (id) {
        doc = await db.collection('levels').doc(id).get();
      } else if (name) {
        const result = await db.collection('levels').where({ name }).limit(1).get();
        if (result.data.length > 0) doc = { data: result.data[0] };
      }

      if (!doc || !doc.data) {
        return jsonResponse({ code: -1, msg: '关卡不存在' });
      }

      return {
        statusCode: 200,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${doc.data.name}.json"`
        },
        body: JSON.stringify(doc.data.data, null, 2)
      };
    }

    return jsonResponse({
      code: 0,
      msg: '关卡管理后台 API',
      actions: {
        list: '?action=list',
        download: '?action=download&id=xxx',
        downloadByName: '?action=download&name=0001',
        delete: '?action=delete&id=xxx'
      }
    });

  } catch (err) {
    return jsonResponse({ code: -1, msg: err.message });
  }
};
