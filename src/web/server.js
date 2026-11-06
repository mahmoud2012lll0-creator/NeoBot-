'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const { ChannelType, PermissionFlagsBits: P } = require('discord.js');
const db = require('../db');
const tickets = require('../bot/tickets');
const branding = require('../bot/branding');

const API = 'https://discord.com/api/v10';
const DAY = 86400000;

function startWeb(client) {
  const app = express();
  const BASE = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const secure = BASE.startsWith('https://');
  const REDIRECT = `${BASE}/auth/callback`;
  const port = Number(process.env.PORT) || 3000;
  // محلياً بنسمع على جهازك فقط. إذا BASE_URL رابط حقيقي بنفتح للخارج (تسجيل الدخول بيحمي الموقع).
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(BASE);
  const host = process.env.HOST || (isLocal ? '127.0.0.1' : '0.0.0.0');

  app.disable('x-powered-by');
  if (secure) app.set('trust proxy', 1);
  app.use(express.json({ limit: '12mb' }));
  app.use(
    session({
      name: 'neobot.sid',
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: 'lax', secure, maxAge: 7 * DAY },
    }),
  );

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; frame-ancestors 'none'",
    );
    next();
  });

  // أي طلب يغيّر بيانات لازم يكون JSON (بيمنع المواقع الغريبة من إرسال طلبات باسمك)
  app.use('/api', (req, res, next) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !req.is('application/json')) {
      return res.status(415).json({ error: 'Content-Type must be application/json' });
    }
    next();
  });

  /* ------------------------------ تسجيل الدخول بديسكورد ------------------------------ */
  app.get('/auth/login', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauthState = state;
    const url = new URL('https://discord.com/oauth2/authorize');
    url.search = new URLSearchParams({
      client_id: process.env.CLIENT_ID,
      redirect_uri: REDIRECT,
      response_type: 'code',
      scope: 'identify',
      state,
    }).toString();
    req.session.save(() => res.redirect(url.toString()));
  });

  app.get('/auth/callback', async (req, res) => {
    const { code, state } = req.query;
    if (req.query.error) {
      console.error('[web] ديسكورد رجّع خطأ:', req.query.error, req.query.error_description || '');
      return res.status(400).send('ديسكورد رفض تسجيل الدخول (شوف الـ cmd). <a href="/">رجوع</a>');
    }
    if (!code || !state || state !== req.session.oauthState) {
      console.error(
        '[web] فشل التحقق: ' +
          (!req.session.oauthState
            ? 'الكوكي ما وصل. افتح الموقع بنفس الرابط الموجود بـ BASE_URL بالضبط (localhost مش 127.0.0.1)'
            : 'state مختلف'),
      );
      return res.status(400).send('طلب غير صالح. افتح <a href="/">الموقع</a> وجرّب مرة ثانية.');
    }
    delete req.session.oauthState;
    try {
      const tokenRes = await fetch(`${API}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.CLIENT_ID,
          client_secret: process.env.CLIENT_SECRET,
          grant_type: 'authorization_code',
          code: String(code),
          redirect_uri: REDIRECT,
        }),
      });
      if (!tokenRes.ok) throw new Error(`token ${tokenRes.status}`);
      const token = await tokenRes.json();
      const meRes = await fetch(`${API}/users/@me`, { headers: { Authorization: `Bearer ${token.access_token}` } });
      if (!meRes.ok) throw new Error(`me ${meRes.status}`);
      const me = await meRes.json();
      console.log(`[web] تسجيل دخول: ${me.username} (${me.id})`);
      // منخزّن فقط المعلومات العامة، بدون التوكن
      req.session.regenerate((err) => {
        if (err) return res.status(500).send('خطأ بالجلسة');
        req.session.user = {
          id: me.id,
          username: me.global_name || me.username,
          avatar: me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=64` : null,
        };
        req.session.save(() => res.redirect('/'));
      });
    } catch (e) {
      console.error('[web] oauth failed:', e.message);
      res.status(500).send('فشل تسجيل الدخول. تأكد من CLIENT_SECRET ومن إضافة رابط الرجوع. <a href="/">رجوع</a>');
    }
  });

  app.post('/auth/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

  /* ------------------------------ صلاحيات ------------------------------ */
  const needUser = (req, res, next) => (req.session.user ? next() : res.status(401).json({ error: 'unauthorized' }));

  // تحقق حي من ديسكورد بكل طلب: لازم يكون Administrator أو Manage Server (أو صاحب السيرفر)
  async function canManage(guild, userId) {
    if (guild.ownerId === userId) return true;
    const m = await guild.members.fetch(userId).catch(() => null);
    return !!m && (m.permissions.has(P.Administrator) || m.permissions.has(P.ManageGuild));
  }

  async function needGuild(req, res, next) {
    try {
      const guild = client.guilds.cache.get(req.params.id);
      if (!guild) return res.status(404).json({ error: 'البوت مش موجود بهالسيرفر' });
      if (!(await canManage(guild, req.session.user.id))) return res.status(403).json({ error: 'ما عندك صلاحية' });
      req.guild = guild;
      next();
    } catch (e) {
      console.error('[web] auth check failed:', e.message);
      res.status(500).json({ error: 'خطأ داخلي' });
    }
  }

  const wrap = (fn) => (req, res) =>
    Promise.resolve(fn(req, res)).catch((e) => {
      console.error('[web]', req.method, req.path, e);
      res.status(500).json({ error: 'خطأ داخلي' });
    });

  /* ------------------------------ API ------------------------------ */
  app.get('/api/me', needUser, (req, res) => res.json(req.session.user));

  app.get(
    '/api/guilds',
    needUser,
    wrap(async (req, res) => {
      const out = [];
      for (const g of client.guilds.cache.values()) {
        if (await canManage(g, req.session.user.id)) {
          const b = branding.brandOf(g);
          out.push({ id: g.id, name: g.name, icon: g.iconURL({ size: 128 }), members: g.memberCount, botName: b.name, botLogo: b.logo });
        }
      }
      const invite = `https://discord.com/oauth2/authorize?client_id=${process.env.CLIENT_ID}&scope=bot%20applications.commands&permissions=8`;
      res.json({ guilds: out, invite });
    }),
  );

  const G = '/api/guilds/:id';

  app.get(`${G}/meta`, needUser, needGuild, (req, res) => {
    const g = req.guild;
    const b = branding.brandOf(g);
    const chans = [...g.channels.cache.values()].sort((a, c) => a.rawPosition - c.rawPosition);
    res.json({
      id: g.id,
      name: g.name,
      icon: g.iconURL({ size: 128 }),
      members: g.memberCount,
      bot: { name: b.name, logo: b.logo },
      channels: chans
        .filter((c) => c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement)
        .map((c) => ({ id: c.id, name: c.name })),
      categories: chans.filter((c) => c.type === ChannelType.GuildCategory).map((c) => ({ id: c.id, name: c.name })),
      roles: [...g.roles.cache.values()]
        .filter((r) => r.id !== g.id && !r.managed)
        .sort((a, c) => c.position - a.position)
        .map((r) => ({ id: r.id, name: r.name, color: r.hexColor })),
    });
  });

  app.post(
    `${G}/branding`,
    needUser,
    needGuild,
    wrap(async (req, res) => {
      const b = req.body || {};
      try {
        await branding.apply(client, req.guild, {
          name: typeof b.name === 'string' ? b.name : undefined,
          logo: typeof b.logo === 'string' ? b.logo : undefined,
          reset: !!b.reset,
        });
        res.json(branding.brandOf(req.guild));
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    }),
  );

  app.get(`${G}/settings`, needUser, needGuild, (req, res) => res.json(db.getSettings(req.guild.id)));

  app.put(`${G}/settings`, needUser, needGuild, (req, res) => {
    if (!req.body || typeof req.body !== 'object') return res.status(400).json({ error: 'بيانات غير صالحة' });
    res.json(db.setSettings(req.guild.id, req.body));
  });

  app.post(
    `${G}/panel`,
    needUser,
    needGuild,
    wrap(async (req, res) => {
      const channelId = String((req.body && req.body.channelId) || '');
      if (!req.guild.channels.cache.has(channelId)) return res.status(400).json({ error: 'اختر قناة صالحة' });
      try {
        await tickets.sendPanel(req.guild, channelId);
        res.json({ ok: true });
      } catch (e) {
        res.status(400).json({ error: e.message });
      }
    }),
  );

  app.get(`${G}/tickets`, needUser, needGuild, (req, res) => {
    const { status, q } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    res.json(db.listTickets(req.guild.id, { status, q: q && String(q).slice(0, 100), page }));
  });

  app.get(`${G}/tickets/:num`, needUser, needGuild, (req, res) => {
    const t = db.getTicket(req.guild.id, req.params.num);
    if (!t) return res.status(404).json({ error: 'التذكرة مش موجودة' });
    res.json(t);
  });

  app.get(`${G}/cases`, needUser, needGuild, (req, res) => {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const type = ['ban', 'unban', 'kick', 'timeout', 'untimeout', 'warn'].includes(req.query.type) ? req.query.type : undefined;
    const userId = /^\d{15,25}$/.test(req.query.userId || '') ? req.query.userId : undefined;
    res.json(db.listCases(req.guild.id, { page, type, userId }));
  });

  app.get(`${G}/stats`, needUser, needGuild, (req, res) => {
    const all = db.allTickets(req.guild.id);
    const closed = all.filter((t) => t.status === 'closed' && t.closedAt);
    const now = Date.now();
    const startOfToday = new Date().setHours(0, 0, 0, 0);

    const perDay = [];
    for (let i = 6; i >= 0; i--) {
      const from = startOfToday - i * DAY;
      perDay.push({
        date: new Date(from).toISOString().slice(0, 10),
        count: all.filter((t) => t.createdAt >= from && t.createdAt < from + DAY).length,
      });
    }

    const byType = {};
    const staff = {};
    for (const t of all) {
      const k = t.typeLabel || t.type;
      byType[k] = (byType[k] || 0) + 1;
      if (t.claimedBy) {
        staff[t.claimedBy] ||= { id: t.claimedBy, tag: t.claimedByTag, count: 0 };
        staff[t.claimedBy].count++;
      }
    }
    const avgCloseMs = closed.length ? closed.reduce((a, t) => a + (t.closedAt - t.createdAt), 0) / closed.length : 0;

    res.json({
      members: req.guild.memberCount,
      tickets: {
        total: all.length,
        open: all.filter((t) => t.status === 'open').length,
        closed: closed.length,
        today: all.filter((t) => t.createdAt >= startOfToday).length,
        last30: all.filter((t) => now - t.createdAt < 30 * DAY).length,
        claimedRate: all.length ? Math.round((all.filter((t) => t.claimedBy).length / all.length) * 100) : 0,
        avgCloseMinutes: Math.round(avgCloseMs / 60000),
        perDay,
        byType: Object.entries(byType).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
        topStaff: Object.values(staff).sort((a, b) => b.count - a.count).slice(0, 5),
      },
      cases: db.caseCounts(req.guild.id),
    });
  });

  /* ------------------------------ الملفات الثابتة ------------------------------ */
  app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html', maxAge: 0 }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'not found' }));

  app.listen(port, host, () => {
    console.log(`[web] لوحة التحكم: ${BASE} (المنفذ ${port}، ${host})`);
    console.log(`[web] تأكد إن هالرابط مضاف بـ Redirects بالـ Developer Portal: ${REDIRECT}`);
  });
  return app;
}

module.exports = { startWeb };
