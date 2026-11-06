'use strict';

const fs = require('fs');
const path = require('path');
const defaults = require('./defaults');
const { sanitize } = require('./sanitize');

const DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DIR, 'db.json');

const ID_RE = /^\d{15,25}$/;
const URL_RE = /^https?:\/\/\S+$/i;
const COLOR_RE = /^#[0-9a-f]{6}$/i;

let data = { guilds: {}, tickets: [], cases: [], counters: { ticket: {}, case: {} } };
const cache = new Map();

/* ------------------------------ تحميل/حفظ ------------------------------ */
function load() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    if (!fs.existsSync(FILE)) return;
    const text = fs.readFileSync(FILE, 'utf8');
    try {
      const raw = JSON.parse(text);
      data = { ...data, ...raw, counters: { ticket: {}, case: {}, ...(raw.counters || {}) } };
    } catch (e) {
      const backup = `${FILE}.corrupt-${Date.now()}`;
      fs.renameSync(FILE, backup);
      console.error(`[db] الملف تالف. انحفظت نسخة بـ ${backup} وبلشنا من جديد.`);
    }
  } catch (e) {
    console.error('[db] فشل التحميل:', e.message);
  }
}

let timer = null;
function save() {
  if (timer) return;
  timer = setTimeout(flush, 400);
}
function flush() {
  if (timer) clearTimeout(timer);
  timer = null;
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, FILE);
  } catch (e) {
    console.error('[db] فشل الحفظ:', e.message);
  }
}
process.on('exit', flush);

load();

/* ------------------------------ الإعدادات ------------------------------ */
const clamp = (v, min, max, def) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};

function normalizeTypes(types) {
  const seen = new Set();
  const out = [];
  for (const t of types) {
    const value = String(t.value || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
    const label = String(t.label || '').trim().slice(0, 100);
    if (!value || !label || seen.has(value)) continue;
    seen.add(value);
    out.push({
      value,
      label,
      description: String(t.description || '').trim().slice(0, 100),
      emoji: String(t.emoji || '').trim().slice(0, 60),
    });
    if (out.length >= 25) break;
  }
  return out;
}

function walk(obj) {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (Array.isArray(v)) {
      if (k.endsWith('Ids')) obj[k] = [...new Set(v.filter((x) => ID_RE.test(x)))].slice(0, 50);
    } else if (v && typeof v === 'object') {
      walk(v);
    } else if (typeof v === 'string') {
      if (k.endsWith('Id')) obj[k] = ID_RE.test(v) ? v : '';
      else if (k.endsWith('Url')) obj[k] = URL_RE.test(v) ? v.slice(0, 500) : '';
      else if (k === 'color') obj[k] = COLOR_RE.test(v) ? v : '#29B6F6';
    }
  }
}

function normalize(s) {
  walk(s);
  s.tickets.types = normalizeTypes(s.tickets.types);
  s.tickets.maxOpenPerUser = clamp(s.tickets.maxOpenPerUser, 1, 10, 1);
  s.tickets.panel.title = s.tickets.panel.title.slice(0, 256);
  s.tickets.panel.description = s.tickets.panel.description.slice(0, 2000);
  s.tickets.panel.footer = s.tickets.panel.footer.slice(0, 200);
  s.tickets.panel.placeholder = s.tickets.panel.placeholder.slice(0, 100);

  s.moderation.warnsBeforeTimeout = clamp(s.moderation.warnsBeforeTimeout, 0, 20, 3);
  s.moderation.autoTimeoutMinutes = clamp(s.moderation.autoTimeoutMinutes, 1, 40320, 60);

  const p = s.protection;
  p.antiSpam.maxMessages = clamp(p.antiSpam.maxMessages, 2, 30, 5);
  p.antiSpam.perSeconds = clamp(p.antiSpam.perSeconds, 1, 60, 5);
  p.antiSpam.timeoutMinutes = clamp(p.antiSpam.timeoutMinutes, 1, 40320, 10);
  p.antiMassMention.max = clamp(p.antiMassMention.max, 2, 50, 5);
  p.antiMassMention.timeoutMinutes = clamp(p.antiMassMention.timeoutMinutes, 1, 40320, 10);
  p.antiRaid.maxJoins = clamp(p.antiRaid.maxJoins, 2, 100, 8);
  p.antiRaid.perSeconds = clamp(p.antiRaid.perSeconds, 2, 300, 10);
  p.antiRaid.minAccountAgeDays = clamp(p.antiRaid.minAccountAgeDays, 0, 365, 0);
  if (!['kick', 'ban'].includes(p.antiRaid.action)) p.antiRaid.action = 'kick';
  p.antiLinks.allowedDomains = [
    ...new Set(
      p.antiLinks.allowedDomains
        .map((d) => d.toLowerCase().trim().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0])
        .filter(Boolean),
    ),
  ].slice(0, 100);
  return s;
}

function getSettings(guildId) {
  let s = cache.get(guildId);
  if (!s) {
    s = normalize(sanitize(data.guilds[guildId] || {}, defaults));
    cache.set(guildId, s);
  }
  return s;
}

function setSettings(guildId, input) {
  const s = normalize(sanitize(input, defaults));
  data.guilds[guildId] = s;
  cache.set(guildId, s);
  save();
  return s;
}

/* ------------------------------ العدادات ------------------------------ */
function nextNumber(kind, guildId) {
  const c = data.counters[kind];
  c[guildId] = (c[guildId] || 0) + 1;
  save();
  return c[guildId];
}

/* ------------------------------ التذاكر ------------------------------ */
function createTicket(t) {
  const ticket = {
    number: nextNumber('ticket', t.guildId),
    status: 'open',
    claimedBy: null,
    claimedByTag: null,
    createdAt: Date.now(),
    closedAt: null,
    closedBy: null,
    closedByTag: null,
    messageCount: 0,
    messages: [],
    ...t,
  };
  data.tickets.push(ticket);
  save();
  return ticket;
}

const getTicketByChannel = (channelId) =>
  data.tickets.find((t) => t.channelId === channelId && t.status === 'open');

const getOpenTicketsByUser = (guildId, userId) =>
  data.tickets.filter((t) => t.guildId === guildId && t.ownerId === userId && t.status === 'open');

function updateTicket(ticket, patch) {
  Object.assign(ticket, patch);
  save();
  return ticket;
}

const getTicket = (guildId, number) =>
  data.tickets.find((t) => t.guildId === guildId && t.number === Number(number));

const allTickets = (guildId) => data.tickets.filter((t) => t.guildId === guildId);

function listTickets(guildId, { status, q, page = 1, pageSize = 15 } = {}) {
  let list = allTickets(guildId);
  if (status === 'open' || status === 'closed') list = list.filter((t) => t.status === status);
  if (q) {
    const s = String(q).toLowerCase().trim().replace(/^#/, '');
    list = list.filter(
      (t) =>
        String(t.number) === s ||
        t.ownerId === s ||
        (t.ownerTag || '').toLowerCase().includes(s) ||
        (t.typeLabel || '').toLowerCase().includes(s),
    );
  }
  list = [...list].sort((a, b) => b.createdAt - a.createdAt || b.number - a.number);
  const total = list.length;
  const start = (Math.max(1, page) - 1) * pageSize;
  const items = list.slice(start, start + pageSize).map(({ messages, ...rest }) => rest);
  return { items, total, page, pageSize };
}

/* ------------------------------ حالات المودريشن ------------------------------ */
function addCase(guildId, c) {
  const rec = {
    number: nextNumber('case', guildId),
    guildId,
    createdAt: Date.now(),
    cleared: false,
    ...c,
  };
  data.cases.push(rec);
  save();
  return rec;
}

function listCases(guildId, { userId, type, page = 1, pageSize = 15, limit } = {}) {
  let list = data.cases.filter((c) => c.guildId === guildId);
  if (userId) list = list.filter((c) => c.userId === userId);
  if (type) list = list.filter((c) => c.type === type);
  list = [...list].sort((a, b) => b.createdAt - a.createdAt || b.number - a.number);
  const total = list.length;
  if (limit) return { items: list.slice(0, limit), total };
  const start = (Math.max(1, page) - 1) * pageSize;
  return { items: list.slice(start, start + pageSize), total, page, pageSize };
}

const activeWarns = (guildId, userId) =>
  data.cases.filter((c) => c.guildId === guildId && c.userId === userId && c.type === 'warn' && !c.cleared).length;

function clearWarns(guildId, userId) {
  let n = 0;
  for (const c of data.cases) {
    if (c.guildId === guildId && c.userId === userId && c.type === 'warn' && !c.cleared) {
      c.cleared = true;
      n++;
    }
  }
  if (n) save();
  return n;
}

function caseCounts(guildId) {
  const out = {};
  for (const c of data.cases) if (c.guildId === guildId) out[c.type] = (out[c.type] || 0) + 1;
  return out;
}

module.exports = {
  flush,
  getSettings,
  setSettings,
  createTicket,
  getTicketByChannel,
  getOpenTicketsByUser,
  updateTicket,
  getTicket,
  allTickets,
  listTickets,
  addCase,
  listCases,
  activeWarns,
  clearWarns,
  caseCounts,
};
