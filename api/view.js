const crypto = require('crypto');
const { update } = require('./_lib/store');
const WINDOW_MS = 60 * 1000;
const BLOCK_MS = 30 * 60 * 1000;
const LIMIT = 10;
function clientIp(req) { const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim(); return forwarded || String(req.socket?.remoteAddress || req.headers['x-real-ip'] || 'unknown'); }
function visitorKey(req) { const salt = process.env.VIEW_HASH_SALT || process.env.GITHUB_REPO || 'gmjh-view-salt'; return crypto.createHash('sha256').update(salt + '|' + clientIp(req)).digest('hex').slice(0, 32); }
function cleanMap(map, now) { const out = {}; for (const [key, value] of Object.entries(map || {})) { if (Array.isArray(value)) { const recent = value.filter(t => Number(t) > now - WINDOW_MS); if (recent.length) out[key] = recent; } else if (Number(value) > now) out[key] = Number(value); } return out; }
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const key = visitorKey(req); const now = Date.now();
    const result = await update(async ({ read }) => {
      const raw = await read('am'); const am = raw && typeof raw === 'object' ? raw : {};
      const recent = cleanMap(am.recent, now); const blocked = cleanMap(am.blocked, now);
      let totalViews = Math.max(0, Number(am.pageViews) || 0); let adsEnabled = true; let triggered = false;
      if (blocked[key] && blocked[key] > now) { adsEnabled = false; }
      else {
        const visits = [...(recent[key] || []), now].filter(t => t > now - WINDOW_MS);
        if (visits.length >= LIMIT) { totalViews = Math.max(0, totalViews - (visits.length - 1)); delete recent[key]; blocked[key] = now + BLOCK_MS; adsEnabled = false; triggered = true; }
        else { recent[key] = visits; totalViews += 1; }
      }
      const trim = obj => { const entries = Object.entries(obj); return entries.length > 2000 ? Object.fromEntries(entries.slice(-2000)) : obj; };
      const next = { ...am, pageViews: totalViews, recent: trim(recent), blocked: trim(blocked) };
      return { changes: { am: next }, result: { totalViews, adsEnabled, blocked: !adsEnabled, triggered } };
    }, 'system: register page view');
    return res.status(200).json(result);
  } catch (err) { console.error('view counter error:', err); return res.status(err.status || 500).json({ error: err.message || '瀏覽統計暫時不可用', totalViews: null, adsEnabled: false }); }
};
