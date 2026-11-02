const { del } = require('@vercel/blob');
const { handleCors } = require('./_auth');
const { kvGet, kvSet } = require('./db');

const TYPE_KEYS = {
  licenses: 'tom_licenses',
  properties: 'tom_properties',
  checklists: 'tom_checklists',
  notes: 'tom_notes',
  goals: 'tom_goals',
  compliance: 'tom_compliance_weapons',
};

function getItems(data, itemType) {
  if (itemType === 'licenses') return data.licenses || [];
  return data[itemType] || data.items || [];
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  const itemType = req.query.type;
  const itemId = req.query.itemId;

  if (req.method === 'GET') {
    const action = req.query.action;

    if (action === 'download') {
      const blobUrl = req.query.url;
      if (!blobUrl) return res.status(400).json({ error: 'url param required' });
      try {
        const token = process.env.BLOB_READ_WRITE_TOKEN;
        const proxyRes = await fetch(blobUrl, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
        if (!proxyRes.ok) return res.status(proxyRes.status).json({ error: 'Fetch failed' });
        const ct = proxyRes.headers.get('content-type') || 'application/octet-stream';
        const fname = decodeURIComponent(blobUrl.split('/').pop().split('?')[0] || 'download');
        const viewable = /\.(jpg|jpeg|png|gif|webp|svg|pdf)$/i.test(fname);
        res.setHeader('Content-Type', ct);
        res.setHeader('Content-Disposition', (viewable ? 'inline' : 'attachment') + '; filename="' + fname + '"');
        const buffer = Buffer.from(await proxyRes.arrayBuffer());
        return res.status(200).send(buffer);
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }

    if (!itemType || !itemId) return res.status(400).json({ error: 'type and itemId required' });
    const kvKey = TYPE_KEYS[itemType];
    if (!kvKey) return res.status(400).json({ error: 'Unknown type' });

    const data = await kvGet(kvKey);
    if (!data) return res.status(200).json({ attachments: [] });
    if (itemType === 'compliance') {
      const section = req.query.section;
      const all = data.attachments || [];
      return res.status(200).json({ attachments: section ? all.filter(a => a.section === section) : all });
    }
    const items = getItems(data, itemType);
    const item = items.find(i => i.id === itemId);
    return res.status(200).json({ attachments: item?.attachments || [] });
  }

  if (req.method === 'POST') {
    const { action } = req.body;

    if (action === 'delete') {
      const { attachmentId } = req.body;
      if (!itemType || !itemId || !attachmentId) return res.status(400).json({ error: 'type, itemId, attachmentId required' });
      const kvKey = TYPE_KEYS[itemType];
      if (!kvKey) return res.status(400).json({ error: 'Unknown type' });

      const data = await kvGet(kvKey);
      if (!data) return res.status(404).json({ error: 'Not found' });

      let attList;
      if (itemType === 'compliance') {
        attList = data.attachments || [];
      } else {
        const items = getItems(data, itemType);
        const item = items.find(i => i.id === itemId);
        if (!item || !item.attachments) return res.status(404).json({ error: 'Item not found' });
        attList = item.attachments;
      }

      const att = attList.find(a => a.id === attachmentId);
      if (att && att.type === 'file' && att.url) {
        try { await del(att.url); } catch (_) {}
      }
      if (itemType === 'compliance') {
        data.attachments = (data.attachments || []).filter(a => a.id !== attachmentId);
      } else {
        const items = getItems(data, itemType);
        const item = items.find(i => i.id === itemId);
        item.attachments = item.attachments.filter(a => a.id !== attachmentId);
      }
      data.updated = new Date().toISOString();
      await kvSet(kvKey, data);
      return res.status(200).json({ success: true });
    }

    if (action === 'add_link') {
      const { label, url } = req.body;
      if (!itemType || !itemId || !url) return res.status(400).json({ error: 'type, itemId, url required' });
      const kvKey = TYPE_KEYS[itemType];
      if (!kvKey) return res.status(400).json({ error: 'Unknown type' });

      const data = await kvGet(kvKey);
      if (!data) return res.status(404).json({ error: 'Not found' });

      const link = {
        id: 'att_' + Date.now(),
        type: 'link',
        label: label || url,
        url,
        addedAt: new Date().toISOString(),
      };
      if (itemType === 'compliance') {
        link.section = req.body.section || 'general';
        if (!data.attachments) data.attachments = [];
        data.attachments.push(link);
      } else {
        const items = getItems(data, itemType);
        const item = items.find(i => i.id === itemId);
        if (!item) return res.status(404).json({ error: 'Item not found' });
        if (!item.attachments) item.attachments = [];
        item.attachments.push(link);
      }
      data.updated = new Date().toISOString();
      await kvSet(kvKey, data);
      return res.status(200).json({ success: true, attachment: link });
    }

    return res.status(400).json({ error: 'Unknown action' });
  }

  return res.status(405).json({ error: 'GET or POST' });
};
