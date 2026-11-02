const { put } = require('@vercel/blob');
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

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const filename = req.headers['x-filename'];
  const itemType = req.headers['x-item-type'];
  const itemId = req.headers['x-item-id'];
  if (!filename) return res.status(400).json({ error: 'x-filename header required' });
  if (!itemType || !itemId) return res.status(400).json({ error: 'x-item-type and x-item-id headers required' });

  const kvKey = TYPE_KEYS[itemType];
  if (!kvKey) return res.status(400).json({ error: 'Unknown item type: ' + itemType });

  try {
    const blob = await put(`tom-hub/${itemType}/${itemId}/${filename}`, req, {
      access: 'private',
      addRandomSuffix: true,
    });

    const attachment = {
      id: 'att_' + Date.now(),
      type: 'file',
      filename,
      url: blob.url,
      contentType: blob.contentType || req.headers['content-type'] || 'application/octet-stream',
      size: blob.size || 0,
      uploadedAt: new Date().toISOString(),
    };

    const data = await kvGet(kvKey);
    if (!data) return res.status(404).json({ error: 'Item collection not found' });

    if (itemType === 'compliance') {
      attachment.section = req.headers['x-section'] || 'general';
      if (!data.attachments) data.attachments = [];
      data.attachments.push(attachment);
      data.updated = new Date().toISOString();
      await kvSet(kvKey, data);
    } else {
      const collectionKey = itemType === 'licenses' ? 'licenses' : itemType;
      const items = data[collectionKey] || data.items || [];
      const item = items.find(i => i.id === itemId);
      if (!item) return res.status(404).json({ error: 'Item not found: ' + itemId });

      if (!item.attachments) item.attachments = [];
      item.attachments.push(attachment);
      data.updated = new Date().toISOString();
      await kvSet(kvKey, data);
    }

    return res.status(200).json({ success: true, attachment });
  } catch (err) {
    console.error('upload error:', err);
    return res.status(500).json({ error: err.message });
  }
};
