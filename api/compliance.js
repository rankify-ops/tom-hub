const { handleCors } = require('./_auth');
const { kvGet, kvSet } = require('./db');

const KV_KEY = 'tom_compliance_weapons';

function blank() {
  return {
    id: 'weapons',
    licence: {
      number: '', categories: [], conditions: [],
      issueDate: '', expiryDate: '', renewalWindowStart: '', renewalWindowEnd: '',
    },
    genuineReason: {
      club: '', memberNumber: '', expiryDate: '', reminderDays: 30,
    },
    storage: {
      address: '', owner: '', safeType: '', boltedDown: false,
      safePhotoDate: '', form4aLodgedDate: '', form4aConfirmation: '',
    },
    firearms: [],
    training: [],
    complianceLog: [],
    contacts: [{ name: 'QPS Weapons Licensing', phone: '(07) 3015 7777' }],
    attachments: [],
    updated: '',
  };
}

function merge(target, source) {
  for (const k of Object.keys(source)) {
    if (source[k] && typeof source[k] === 'object' && !Array.isArray(source[k]) && target[k] && typeof target[k] === 'object' && !Array.isArray(target[k])) {
      merge(target[k], source[k]);
    } else {
      target[k] = source[k];
    }
  }
}

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) return;

  let data = await kvGet(KV_KEY);
  if (!data) data = blank();

  if (req.method === 'GET') {
    return res.status(200).json(data);
  }

  if (req.method === 'PATCH') {
    merge(data, req.body);
    data.updated = new Date().toISOString();
    await kvSet(KV_KEY, data);
    return res.status(200).json({ success: true, data });
  }

  if (req.method === 'POST') {
    const { action } = req.body;

    if (action === 'add_firearm') {
      const f = req.body.firearm || {};
      f.id = f.id || 'fa_' + Date.now();
      f.attachments = f.attachments || [];
      data.firearms.push(f);
    } else if (action === 'remove_firearm') {
      data.firearms = data.firearms.filter(f => f.id !== req.body.firearmId);
    } else if (action === 'update_firearm') {
      const idx = data.firearms.findIndex(f => f.id === req.body.firearmId);
      if (idx >= 0) merge(data.firearms[idx], req.body.fields || {});
    } else if (action === 'add_training') {
      const t = req.body.training || {};
      t.id = t.id || 'tr_' + Date.now();
      t.attachments = t.attachments || [];
      data.training.push(t);
    } else if (action === 'remove_training') {
      data.training = data.training.filter(t => t.id !== req.body.trainingId);
    } else if (action === 'add_log') {
      const entry = req.body.entry || {};
      entry.id = entry.id || 'cl_' + Date.now();
      entry.date = entry.date || new Date().toISOString().slice(0, 10);
      data.complianceLog.unshift(entry);
    } else if (action === 'remove_log') {
      data.complianceLog = data.complianceLog.filter(e => e.id !== req.body.logId);
    } else if (action === 'add_contact') {
      data.contacts.push(req.body.contact || {});
    } else if (action === 'remove_contact') {
      data.contacts = data.contacts.filter((_, i) => i !== req.body.index);
    } else {
      return res.status(400).json({ error: 'Unknown action: ' + action });
    }

    data.updated = new Date().toISOString();
    await kvSet(KV_KEY, data);
    return res.status(200).json({ success: true, data });
  }

  return res.status(405).json({ error: 'GET, PATCH or POST' });
};
