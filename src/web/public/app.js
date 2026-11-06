'use strict';

/* ============================== أدوات ============================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleString('en-GB', { hour12: false }).slice(0, 17) : '—');
const fmtMin = (m) => (m >= 120 ? `${(m / 60).toFixed(1)} ساعة` : `${m} دقيقة`);
const safeAvatar = (u) => (typeof u === 'string' && u.startsWith('https://cdn.discordapp.com/') ? u : '');

const getp = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function setp(o, p, v) {
  const ks = p.split('.');
  const last = ks.pop();
  const t = ks.reduce((a, k) => (a[k] ??= {}), o);
  t[last] = v;
}

let toastTimer;
function toast(msg, type = 'ok') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast ${type}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* ignore */
  }
  if (res.status === 401) {
    // لا نعيد الرسم إذا كنا أصلاً غير مسجلين (بيمنع حلقة لا نهائية)
    if (state.user) {
      state.user = null;
      render();
    }
    throw new Error('انتهت الجلسة');
  }
  if (!res.ok) throw new Error((data && data.error) || `خطأ ${res.status}`);
  return data;
}

/* ============================== الحالة ============================== */
const state = {
  user: null,
  guilds: [],
  invite: '',
  gid: null,
  meta: null,
  settings: null,
  page: 'stats',
  dirty: false,
  log: { status: '', q: '', page: 1 },
  cases: { type: '', page: 1 },
  ticketId: null,
};

const PAGES = [
  ['stats', '📊', 'الإحصائيات'],
  ['branding', '🎨', 'هوية البوت'],
  ['tickets', '🎫', 'التذاكر'],
  ['ticketlog', '🗂️', 'سجل التذاكر'],
  ['welcome', '👋', 'الترحيب والرتب'],
  ['logs', '📜', 'اللوقات'],
  ['protection', '🛡️', 'الحماية'],
  ['moderation', '🔨', 'المودريشن'],
];
const SAVE_PAGES = new Set(['tickets', 'welcome', 'logs', 'protection', 'moderation']);

/* ============================== حقول النماذج ============================== */
const val = (p) => getp(state.settings, p);

const F = {
  text: (p, label, hint = '') =>
    `<div class="field"><label>${label}</label><input type="text" data-path="${p}" value="${esc(val(p))}">${hint ? `<div class="hint">${hint}</div>` : ''}</div>`,
  url: (p, label, hint = '') =>
    `<div class="field"><label>${label}</label><input type="url" dir="ltr" placeholder="https://..." data-path="${p}" value="${esc(val(p))}">${hint ? `<div class="hint">${hint}</div>` : ''}</div>`,
  area: (p, label, hint = '') =>
    `<div class="field"><label>${label}</label><textarea data-path="${p}">${esc(val(p))}</textarea>${hint ? `<div class="hint">${hint}</div>` : ''}</div>`,
  num: (p, label, min, max, hint = '') =>
    `<div class="field"><label>${label}</label><input type="number" min="${min}" max="${max}" data-path="${p}" value="${esc(val(p))}">${hint ? `<div class="hint">${hint}</div>` : ''}</div>`,
  color: (p, label) =>
    `<div class="field"><label>${label}</label><input type="color" data-path="${p}" value="${esc(val(p))}"></div>`,
  sw: (p, label) =>
    `<label class="switch"><input type="checkbox" data-path="${p}" ${val(p) ? 'checked' : ''}><span>${label}</span></label>`,
  select: (p, label, items, none = '— بدون —') => {
    const cur = val(p);
    const opts = items.map((i) => `<option value="${esc(i.id)}" ${i.id === cur ? 'selected' : ''}>${esc(i.name)}</option>`).join('');
    return `<div class="field"><label>${label}</label><select data-path="${p}"><option value="">${none}</option>${opts}</select></div>`;
  },
  chan: (p, label) => F.select(p, label, state.meta.channels.map((c) => ({ id: c.id, name: '# ' + c.name }))),
  cat: (p, label) => F.select(p, label, state.meta.categories),
  fixed: (p, label, items) => {
    const cur = val(p);
    return `<div class="field"><label>${label}</label><select data-path="${p}">${items
      .map(([v, n]) => `<option value="${v}" ${v === cur ? 'selected' : ''}>${n}</option>`)
      .join('')}</select></div>`;
  },
  chips: (p, label, items, prefix = '') => {
    const cur = new Set(val(p) || []);
    const chips = items
      .map((i) => `<span class="chip ${cur.has(i.id) ? 'on' : ''}" data-id="${esc(i.id)}">${prefix}${esc(i.name)}</span>`)
      .join('');
    return `<div class="field"><label>${label}</label><div class="chips" data-path="${p}" data-kind="chips">${chips || '<span class="hint">ما في عناصر</span>'}</div></div>`;
  },
  roles: (p, label) => F.chips(p, label, state.meta.roles, '@ '),
  channels: (p, label) => F.chips(p, label, state.meta.channels, '# '),
  lines: (p, label, hint = '') =>
    `<div class="field"><label>${label}</label><textarea data-kind="lines" data-path="${p}" dir="ltr">${esc((val(p) || []).join('\n'))}</textarea>${hint ? `<div class="hint">${hint}</div>` : ''}</div>`,
};

function collect() {
  if (!state.settings) return;
  $$('#content [data-path]').forEach((el) => {
    const p = el.dataset.path;
    let v;
    if (el.dataset.kind === 'chips') v = $$('.chip.on', el).map((c) => c.dataset.id);
    else if (el.dataset.kind === 'lines') v = el.value.split('\n').map((x) => x.trim()).filter(Boolean);
    else if (el.type === 'checkbox') v = el.checked;
    else if (el.type === 'number') v = el.value === '' ? 0 : Number(el.value);
    else v = el.value;
    setp(state.settings, p, v);
  });
  const rows = $$('#content .trow');
  if (rows.length || $('#types')) {
    state.settings.tickets.types = rows.map((r) => ({
      emoji: $('[data-f=emoji]', r).value,
      value: $('[data-f=value]', r).value,
      label: $('[data-f=label]', r).value,
      description: $('[data-f=description]', r).value,
    }));
  }
}

async function save() {
  collect();
  const btn = $('#saveBtn');
  if (btn) btn.disabled = true;
  try {
    state.settings = await api(`/api/guilds/${state.gid}/settings`, { method: 'PUT', body: state.settings });
    state.dirty = false;
    toast('تم الحفظ ✅');
    renderPage();
  } catch (e) {
    toast(e.message, 'err');
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ============================== الصفحات ============================== */
const section = (title, body) => `<div class="card"><h3>${title}</h3>${body}</div>`;

const pages = {
  async stats() {
    const s = await api(`/api/guilds/${state.gid}/stats`);
    const t = s.tickets;
    const max = Math.max(1, ...t.perDay.map((d) => d.count));
    const maxType = Math.max(1, ...t.byType.map((x) => x.count));
    const tile = (n, l) => `<div class="stat"><b>${esc(n)}</b><span>${l}</span></div>`;
    const caseNames = { ban: 'حظر', kick: 'طرد', timeout: 'تايم أوت', warn: 'تحذير', unban: 'فك حظر', untimeout: 'فك تايم أوت' };
    return `
      <h1>الإحصائيات</h1><p class="sub">نظرة سريعة على نشاط السيرفر.</p>
      <div class="grid g4" style="margin-bottom:16px">
        ${tile(s.members, 'عدد الأعضاء')}${tile(t.total, 'كل التذاكر')}${tile(t.open, 'مفتوحة الآن')}${tile(t.today, 'تذاكر اليوم')}
        ${tile(t.closed, 'مغلقة')}${tile(t.last30, 'آخر 30 يوم')}${tile(t.claimedRate + '%', 'نسبة الاستلام')}${tile(t.avgCloseMinutes ? fmtMin(t.avgCloseMinutes) : '—', 'متوسط وقت الإغلاق')}
      </div>
      <div class="grid g2">
        ${section('التذاكر آخر 7 أيام', `<div class="bars">${t.perDay.map((d) => `<div class="bar"><span>${d.count}</span><div style="height:${(d.count / max) * 100}%"></div><span>${esc(d.date.slice(5))}</span></div>`).join('')}</div>`)}
        ${section('حسب النوع', t.byType.length ? t.byType.map((x) => `<div class="hbar"><span>${esc(x.label)}</span><div class="track"><i style="width:${(x.count / maxType) * 100}%"></i></div><span>${x.count}</span></div>`).join('') : '<div class="empty">لا يوجد بيانات</div>')}
        ${section('أفضل فريق الدعم (استلام)', t.topStaff.length ? t.topStaff.map((u, i) => `<div class="hbar"><span>${i + 1}. ${esc(u.tag || u.id)}</span><div class="track"><i style="width:${(u.count / t.topStaff[0].count) * 100}%"></i></div><span>${u.count}</span></div>`).join('') : '<div class="empty">لا يوجد بيانات</div>')}
        ${section('عقوبات المودريشن', Object.keys(s.cases).length ? Object.entries(s.cases).map(([k, n]) => `<div class="hbar"><span>${caseNames[k] || esc(k)}</span><div class="track"><i style="width:${Math.min(100, n * 5)}%"></i></div><span>${n}</span></div>`).join('') : '<div class="empty">لا يوجد بيانات</div>')}
      </div>`;
  },

  async branding() {
    const b = state.meta.bot || { name: '', logo: '' };
    return `
      <h1>هوية البوت</h1>
      <p class="sub">غيّر اسم وصورة البوت لهالسيرفر فقط. الاسم والصورة بيظهروا على رسائله وإيمبداته وفوتر اللوحات.</p>
      ${section(
        'الاسم والصورة',
        `<div class="row" style="align-items:flex-start;gap:22px">
          <img id="brandImg" class="biglogo" src="${esc(safeAvatar(b.logo) || '/logo.png')}" alt="">
          <div style="flex:1;min-width:240px;display:grid;gap:14px">
            <div class="field"><label>اسم البوت (حتى 32 حرف)</label><input type="text" id="brandName" maxlength="32" value="${esc(b.name)}"></div>
            <div class="field"><label>صورة اللوقو (png, jpg, gif, webp — حتى 8MB)</label><input type="file" id="brandFile" accept="image/png,image/jpeg,image/gif,image/webp"></div>
            <div class="row"><button class="btn" data-act="brandapply" type="button">تطبيق</button>
              <button class="btn ghost" data-act="brandreset" type="button">رجوع للأصلي</button></div>
            <div class="hint">تغيير الصورة إله حد يومي من ديسكورد، فإذا رفض جرّب بعد شوي. نفس الشي بتعمله من ديسكورد بأمر <b>/branding</b>.</div>
          </div></div>`,
      )}`;
  },

  async tickets() {
    const p = state.settings.tickets.panel;
    const types = state.settings.tickets.types
      .map(
        (t) => `<div class="trow">
          <input type="text" data-f="emoji" value="${esc(t.emoji)}" placeholder="🛠️" maxlength="60">
          <input type="text" data-f="value" value="${esc(t.value)}" placeholder="id (إنجليزي)" dir="ltr" maxlength="40">
          <input type="text" data-f="label" value="${esc(t.label)}" placeholder="الاسم" maxlength="100">
          <input type="text" data-f="description" value="${esc(t.description)}" placeholder="وصف قصير" maxlength="100">
          <button class="btn danger" data-act="deltype" type="button">✕</button></div>`,
      )
      .join('');
    return `
      <h1>نظام التذاكر</h1><p class="sub">إعدادات اللوحة وأنواع التذاكر وصلاحيات الفريق.</p>
      ${section(
        'عام',
        `<div class="grid g2">${F.sw('tickets.enabled', 'تفعيل نظام التذاكر')}<span></span>
          ${F.cat('tickets.categoryId', 'الكاتيجوري (وين تنفتح التذاكر)')}
          ${F.chan('tickets.logChannelId', 'قناة لوج التذاكر (نسخة المحادثة)')}
          ${F.num('tickets.maxOpenPerUser', 'أقصى عدد تذاكر مفتوحة للعضو', 1, 10)}</div>
         <div style="margin-top:14px">${F.roles('tickets.supportRoleIds', 'رتب فريق الدعم')}</div>`,
      )}
      ${section(
        'شكل اللوحة',
        `<div class="grid g2">${F.text('tickets.panel.title', 'العنوان')}${F.text('tickets.panel.placeholder', 'نص القائمة المنسدلة')}
          ${F.color('tickets.panel.color', 'لون الشريط')}${F.text('tickets.panel.footer', 'الفوتر', 'اتركه فاضي ليظهر: Powered by (اسم البوت بالسيرفر)')}
          ${F.url('tickets.panel.thumbnailUrl', 'اللوقو (صورة صغيرة)', 'اتركه فاضي لاستخدام صورة البوت بهالسيرفر')}${F.url('tickets.panel.bannerUrl', 'البانر (صورة كبيرة)')}</div>
         <div style="margin-top:14px">${F.area('tickets.panel.description', 'وصف اللوحة (اختياري)')}</div>
         <div class="lbl" style="margin:14px 0 6px">معاينة</div>
         <div id="preview" style="border-inline-start:4px solid ${esc(p.color)};background:var(--panel2);border-radius:8px;padding:12px;max-width:460px">
           <b id="pvTitle">${esc(p.title)}</b>
           <div id="pvImg" style="margin-top:8px">${p.bannerUrl ? `<img src="${esc(p.bannerUrl)}" style="width:100%;border-radius:6px" alt="">` : ''}</div>
           <div class="hint" id="pvFoot" style="margin-top:6px">${esc(p.footer)}</div></div>`,
      )}
      ${section(
        'أنواع التذاكر (القائمة المنسدلة)',
        `<div id="types">${types}</div><button class="btn ghost" data-act="addtype" type="button">+ إضافة نوع</button>
         <div class="hint" style="margin-top:8px">الحد الأقصى 25 نوع. الـ id لازم يكون أحرف إنجليزية وأرقام فقط.</div>`,
      )}
      ${section(
        'رسالة الترحيب داخل التذكرة',
        `${F.area('tickets.messages.welcome', 'النص', 'المتغيرات: {user} {username} {type} {server}')}`,
      )}
      ${section(
        'إرسال اللوحة',
        `<div class="row">${`<div style="flex:1;min-width:220px">${F.select('_panelChannel', 'القناة', state.meta.channels.map((c) => ({ id: c.id, name: '# ' + c.name })), '— اختر قناة —')}</div>`}
          <button class="btn" data-act="sendpanel" type="button">حفظ وإرسال اللوحة</button></div>
         <div class="hint">بيحفظ الإعدادات الحالية أول ثم بيرسل اللوحة. اللوحات القديمة ما بتتغير، احذفها وأرسل جديدة.</div>`,
      )}`;
  },

  async ticketlog() {
    if (state.ticketId) {
      const t = await api(`/api/guilds/${state.gid}/tickets/${state.ticketId}`);
      const msgs = (t.messages || [])
        .map((m) => {
          const av = safeAvatar(m.avatar);
          return `<div class="msg">${av ? `<img class="avatar" src="${esc(av)}" alt="">` : '<div class="avatar"></div>'}
            <div><div class="meta"><b>${esc(m.author)}</b> · ${fmtDate(m.ts)}</div>
            <div class="txt">${esc(m.content)}</div>
            ${(m.attachments || []).map((a) => `<div class="meta">📎 ${esc(a.name)}</div>`).join('')}</div></div>`;
        })
        .join('');
      return `
        <button class="btn ghost" data-act="back" type="button">← رجوع</button>
        <h1 style="margin-top:14px">تذكرة #${String(t.number).padStart(4, '0')}</h1>
        <p class="sub"><span class="tag ${t.status}">${t.status === 'open' ? 'مفتوحة' : 'مغلقة'}</span> ${esc(t.typeLabel || t.type)}</p>
        <div class="grid g4" style="margin-bottom:16px">
          <div class="stat"><b style="font-size:16px">${esc(t.ownerTag)}</b><span>صاحب التذكرة</span></div>
          <div class="stat"><b style="font-size:16px">${esc(t.claimedByTag || '—')}</b><span>استلمها</span></div>
          <div class="stat"><b style="font-size:16px">${fmtDate(t.createdAt)}</b><span>فُتحت</span></div>
          <div class="stat"><b style="font-size:16px">${t.closedAt ? fmtDate(t.closedAt) : '—'}</b><span>أُغلقت ${t.closedByTag ? 'بواسطة ' + esc(t.closedByTag) : ''}</span></div>
        </div>
        ${section(`المحادثة (${t.messageCount || 0})`, msgs ? `<div class="msgs">${msgs}</div>` : '<div class="empty">المحادثة بتنحفظ عند إغلاق التذكرة.</div>')}`;
    }
    const { status, q, page } = state.log;
    const r = await api(`/api/guilds/${state.gid}/tickets?page=${page}&status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}`);
    const rows = r.items
      .map(
        (t) => `<tr class="click" data-num="${t.number}"><td>#${String(t.number).padStart(4, '0')}</td><td>${esc(t.ownerTag)}</td>
        <td>${esc(t.typeLabel || t.type)}</td><td><span class="tag ${t.status}">${t.status === 'open' ? 'مفتوحة' : 'مغلقة'}</span></td>
        <td>${esc(t.claimedByTag || '—')}</td><td>${fmtDate(t.createdAt)}</td></tr>`,
      )
      .join('');
    const pages = Math.max(1, Math.ceil(r.total / r.pageSize));
    return `
      <h1>سجل التذاكر</h1><p class="sub">كل التذاكر مع المحادثات المحفوظة (${r.total}).</p>
      <div class="card"><div class="row">
        <input type="text" id="logq" placeholder="بحث: رقم، اسم، آيدي، نوع" value="${esc(q)}" style="flex:1;min-width:200px">
        <select id="logstatus" style="width:140px"><option value="">الكل</option><option value="open" ${status === 'open' ? 'selected' : ''}>مفتوحة</option><option value="closed" ${status === 'closed' ? 'selected' : ''}>مغلقة</option></select>
        <button class="btn" data-act="logsearch" type="button">بحث</button></div></div>
      <div class="card">${rows ? `<table><thead><tr><th>#</th><th>العضو</th><th>النوع</th><th>الحالة</th><th>استلمها</th><th>التاريخ</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="empty">ما في تذاكر</div>'}
        <div class="pager"><button class="btn ghost" data-act="pg" data-d="-1" ${page <= 1 ? 'disabled' : ''}>السابق</button><span>${page} / ${pages}</span><button class="btn ghost" data-act="pg" data-d="1" ${page >= pages ? 'disabled' : ''}>التالي</button></div></div>`;
  },

  async welcome() {
    return `
      <h1>الترحيب والرتب</h1><p class="sub">المتغيرات: {user} {username} {server} {memberCount} {id}</p>
      ${section(
        'رسالة الترحيب',
        `<div style="margin-bottom:14px">${F.sw('welcome.enabled', 'تفعيل نظام الترحيب')}</div>
         <div class="grid g2">${F.chan('welcome.channelId', 'قناة الترحيب')}${F.color('welcome.color', 'لون الإيمبد')}</div>
         <div style="margin:14px 0">${F.area('welcome.message', 'نص الترحيب')}</div>
         <div class="grid g2">${F.url('welcome.bannerUrl', 'بانر الترحيب (اختياري)')}<div style="padding-top:24px">${F.sw('welcome.useEmbed', 'إرسالها كإيمبد')}</div></div>`,
      )}
      ${section('رتب تلقائية', `<div class="grid g2">${F.roles('welcome.autoRoleIds', 'رتب الأعضاء الجدد')}${F.roles('welcome.botAutoRoleIds', 'رتب البوتات الجديدة')}</div>
        <div class="hint" style="margin-top:8px">لازم رتبة البوت تكون أعلى من هالرتب.</div>`)}
      ${section('رسالة خاصة (DM)', `${F.sw('welcome.dmEnabled', 'إرسال رسالة خاصة للعضو الجديد')}<div style="margin-top:12px">${F.area('welcome.dmMessage', 'نص الرسالة الخاصة')}</div>`)}
      ${section('رسالة المغادرة', `${F.sw('welcome.leaveEnabled', 'تفعيل رسالة المغادرة')}<div class="grid g2" style="margin-top:12px">${F.chan('welcome.leaveChannelId', 'قناة المغادرة')}${F.text('welcome.leaveMessage', 'النص')}</div>`)}`;
  },

  async logs() {
    const ev = [
      ['messageDelete', 'حذف الرسائل'], ['messageEdit', 'تعديل الرسائل'], ['memberJoin', 'دخول الأعضاء'], ['memberLeave', 'خروج الأعضاء'],
      ['memberUpdate', 'تحديث الأعضاء (رتب، لقب، تايم أوت)'], ['ban', 'الحظر وفك الحظر'], ['channel', 'القنوات'], ['role', 'الرتب'], ['voice', 'الصوت'],
    ];
    return `
      <h1>اللوقات</h1><p class="sub">تسجيل أحداث السيرفر بقناة واحدة.</p>
      ${section('عام', `<div class="grid g2">${F.sw('logs.enabled', 'تفعيل اللوقات')}<span></span>${F.chan('logs.channelId', 'قناة اللوق')}</div>`)}
      ${section('الأحداث', `<div class="grid g2">${ev.map(([k, n]) => F.sw(`logs.events.${k}`, n)).join('')}</div>`)}`;
  },

  async protection() {
    return `
      <h1>الحماية</h1><p class="sub">حماية تلقائية للسيرفر. الأدمن ومن عنده Manage Server مستثنين دائماً.</p>
      ${section('عام', `${F.sw('protection.enabled', 'تفعيل نظام الحماية')}
        <div class="grid g2" style="margin-top:14px">${F.chan('protection.logChannelId', 'قناة لوق الحماية', '')}<span class="hint" style="padding-top:26px">إذا تركتها فاضية بيستخدم قناة اللوقات العامة.</span></div>
        <div class="grid g2" style="margin-top:14px">${F.roles('protection.whitelistRoleIds', 'رتب مستثناة')}${F.channels('protection.whitelistChannelIds', 'قنوات مستثناة')}</div>`)}
      ${section('منع السبام', `${F.sw('protection.antiSpam.enabled', 'تفعيل')}<div class="grid g3" style="margin-top:12px">
        ${F.num('protection.antiSpam.maxMessages', 'عدد الرسائل', 2, 30)}${F.num('protection.antiSpam.perSeconds', 'خلال (ثواني)', 1, 60)}${F.num('protection.antiSpam.timeoutMinutes', 'مدة التايم أوت (دقائق)', 1, 40320)}</div>`)}
      ${section('منع الروابط', `${F.sw('protection.antiLinks.enabled', 'تفعيل')}<div style="margin-top:12px">${F.lines('protection.antiLinks.allowedDomains', 'دومينات مسموحة', 'دومين بكل سطر، مثل: youtube.com')}</div>`)}
      ${section('منع روابط الدعوات', F.sw('protection.antiInvites.enabled', 'حذف روابط دعوات سيرفرات ديسكورد'))}
      ${section('منع المنشن الجماعي', `${F.sw('protection.antiMassMention.enabled', 'تفعيل')}<div class="grid g2" style="margin-top:12px">${F.num('protection.antiMassMention.max', 'أقصى عدد منشن بالرسالة', 2, 50)}${F.num('protection.antiMassMention.timeoutMinutes', 'مدة التايم أوت (دقائق)', 1, 40320)}</div>`)}
      ${section('حماية الدخول (Anti-Raid)', `${F.sw('protection.antiRaid.enabled', 'تفعيل')}<div class="grid g2" style="margin-top:12px">
        ${F.num('protection.antiRaid.maxJoins', 'عدد الداخلين المشبوه', 2, 100)}${F.num('protection.antiRaid.perSeconds', 'خلال (ثواني)', 2, 300)}
        ${F.num('protection.antiRaid.minAccountAgeDays', 'أقل عمر حساب بالأيام (0 = معطل)', 0, 365)}${F.fixed('protection.antiRaid.action', 'الإجراء', [['kick', 'طرد'], ['ban', 'حظر']])}</div>`)}`;
  },

  async moderation() {
    const { type, page } = state.cases;
    const r = await api(`/api/guilds/${state.gid}/cases?page=${page}&type=${encodeURIComponent(type)}`);
    const names = { ban: 'حظر', unban: 'فك حظر', kick: 'طرد', timeout: 'تايم أوت', untimeout: 'فك تايم أوت', warn: 'تحذير' };
    const rows = r.items
      .map(
        (c) => `<tr><td>#${c.number}</td><td><span class="tag ${esc(c.type)}">${names[c.type] || esc(c.type)}</span></td><td>${esc(c.userTag)}</td>
        <td>${esc(c.modTag)}</td><td>${esc(c.reason || '—')}${c.cleared ? ' <span class="tag">مصفّر</span>' : ''}</td><td>${fmtDate(c.createdAt)}</td></tr>`,
      )
      .join('');
    const pages = Math.max(1, Math.ceil(r.total / r.pageSize));
    return `
      <h1>المودريشن</h1><p class="sub">الأوامر: /ban /unban /kick /timeout /untimeout /warn /warnings /clearwarns /purge</p>
      ${section('الإعدادات', `<div class="grid g2">${F.chan('moderation.logChannelId', 'قناة لوق المودريشن')}<div style="padding-top:26px">${F.sw('moderation.dmOnAction', 'إرسال رسالة خاصة للعضو عند العقوبة')}</div>
        ${F.num('moderation.warnsBeforeTimeout', 'عدد التحذيرات قبل التايم أوت التلقائي (0 = معطل)', 0, 20)}${F.num('moderation.autoTimeoutMinutes', 'مدة التايم أوت التلقائي (دقائق)', 1, 40320)}</div>`)}
      ${section(
        `سجل العقوبات (${r.total})`,
        `<div class="row" style="margin-bottom:12px"><select id="casetype" style="width:180px"><option value="">كل الأنواع</option>${Object.entries(names).map(([k, n]) => `<option value="${k}" ${type === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
         ${rows ? `<table><thead><tr><th>#</th><th>النوع</th><th>العضو</th><th>المشرف</th><th>السبب</th><th>التاريخ</th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="empty">ما في عقوبات</div>'}
         <div class="pager"><button class="btn ghost" data-act="cpg" data-d="-1" ${page <= 1 ? 'disabled' : ''}>السابق</button><span>${page} / ${pages}</span><button class="btn ghost" data-act="cpg" data-d="1" ${page >= pages ? 'disabled' : ''}>التالي</button></div>`,
      )}`;
  },
};

/* ============================== العرض ============================== */
async function render() {
  const app = $('#app');

  if (!state.user) {
    try {
      state.user = await api('/api/me');
    } catch {
      app.innerHTML = `<div class="center"><div class="login"><img class="hero" src="/logo.png" alt="NeoBot" style="margin-bottom:14px"><h1>NeoBot</h1>
        <p class="sub">لوحة تحكم البوت. سجّل دخولك بحساب ديسكورد لإدارة سيرفراتك.</p>
        <a class="btn" href="/auth/login" style="display:inline-block;text-decoration:none">تسجيل الدخول بديسكورد</a></div></div>`;
      return;
    }
  }

  if (!state.gid) {
    if (!state.guilds.length) {
      try {
        const r = await api('/api/guilds');
        state.guilds = r.guilds;
        state.invite = r.invite;
      } catch (e) {
        toast(e.message, 'err');
      }
    }
    let last = '';
    try {
      last = localStorage.getItem('neobot.guild') || '';
    } catch {
      /* ignore */
    }
    const sel = state.guilds.find((g) => g.id === last) || state.guilds[0];
    app.innerHTML = `<div class="center"><div class="login" style="width:min(460px,100%)">
      <img class="hero" src="/logo.png" alt="NeoBot" style="margin-bottom:14px"><h1>NeoBot</h1>
      <p class="sub">أهلاً ${esc(state.user.username)}، اختر السيرفر اللي بدك تديره.</p>
      ${state.guilds.length ? `<div class="card" style="text-align:start">
        <div class="field"><label>السيرفر</label>
          <select id="guildSelect">${state.guilds.map((g) => `<option value="${esc(g.id)}" ${sel && g.id === sel.id ? 'selected' : ''}>${esc(g.name)} — ${esc(g.botName || 'NeoBot')}</option>`).join('')}</select></div>
        <div class="row" id="guildPrev" style="margin:14px 0;gap:14px"></div>
        <button class="btn" data-act="entergid" style="width:100%">دخول للوحة التحكم</button></div>`
        : `<p class="sub">ما لقيت سيرفر تديره والبوت موجود فيه.<br>لازم يكون عندك صلاحية Manage Server، وهاد البوت مضاف للسيرفر.</p>`}
      <div class="row" style="justify-content:center"><a class="btn ghost" href="${esc(state.invite)}" target="_blank" rel="noopener" style="text-decoration:none">+ إضافة البوت لسيرفر</a>
      <button class="btn ghost" data-act="reload">تحديث</button>
      <button class="btn ghost" data-act="logout">تسجيل الخروج</button></div></div></div>`;
    updateGuildPreview();
    return;
  }

  if (!state.meta) {
    try {
      [state.meta, state.settings] = await Promise.all([
        api(`/api/guilds/${state.gid}/meta`),
        api(`/api/guilds/${state.gid}/settings`),
      ]);
    } catch (e) {
      toast(e.message, 'err');
      state.gid = null;
      return render();
    }
  }

  const u = state.user;
  app.innerHTML = `<div class="layout">
    <aside class="side">
      <div class="brand"><img src="/logo.png" alt=""> NeoBot</div>
      <div class="guildbox" data-act="switch">${state.meta.icon ? `<img src="${esc(state.meta.icon)}" alt="">` : '<img alt="">'}
        <div><b>${esc(state.meta.name)}</b><small>تغيير السيرفر</small></div></div>
      <nav class="nav">${PAGES.map(([k, ic, n]) => `<button data-page="${k}" class="${state.page === k ? 'active' : ''}">${ic} ${n}</button>`).join('')}</nav>
      <div class="userbar">${u.avatar ? `<img class="avatar" src="${esc(u.avatar)}" alt="">` : '<div class="avatar"></div>'}
        <div class="name">${esc(u.username)}</div><button class="btn ghost" data-act="logout" title="خروج">⎋</button></div>
    </aside>
    <main class="main"><div id="content"></div></main>
    ${SAVE_PAGES.has(state.page) ? `<div class="savebar"><span class="hint" id="dirtyHint"></span><button class="btn" id="saveBtn">حفظ التغييرات</button></div>` : ''}
  </div>`;
  await renderPage();
}

async function renderPage() {
  const c = $('#content');
  if (!c) return;
  c.innerHTML = '<div class="empty">جاري التحميل...</div>';
  try {
    c.innerHTML = await pages[state.page]();
  } catch (e) {
    c.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
  const h = $('#dirtyHint');
  if (h) h.textContent = state.dirty ? 'عندك تغييرات غير محفوظة' : '';
}

/* ============================== الأحداث ============================== */
document.addEventListener('click', async (e) => {
  const t = e.target;

  const chip = t.closest('.chip');
  if (chip) {
    chip.classList.toggle('on');
    return markDirty();
  }

  const nav = t.closest('[data-page]');
  if (nav) {
    collect();
    state.page = nav.dataset.page;
    state.ticketId = null;
    return render();
  }

  const gc = t.closest('[data-gid]');
  if (gc) {
    state.gid = gc.dataset.gid;
    state.meta = null;
    state.page = 'stats';
    state.dirty = false;
    return render();
  }

  const row = t.closest('tr[data-num]');
  if (row) {
    state.ticketId = row.dataset.num;
    return renderPage();
  }

  if (t.id === 'saveBtn') return save();

  const act = t.closest('[data-act]')?.dataset.act;
  if (!act) return;
  const d = Number(t.closest('[data-act]').dataset.d || 0);

  switch (act) {
    case 'logout':
      await api('/auth/logout', { method: 'POST', body: {} }).catch(() => {});
      Object.assign(state, { user: null, guilds: [], gid: null, meta: null, settings: null, dirty: false });
      return render();
    case 'entergid': {
      const id = $('#guildSelect') && $('#guildSelect').value;
      if (!id) return;
      try {
        localStorage.setItem('neobot.guild', id);
      } catch {
        /* ignore */
      }
      state.gid = id;
      state.meta = null;
      state.page = 'stats';
      state.dirty = false;
      return render();
    }
    case 'reload':
      state.guilds = [];
      return render();
    case 'switch':
      if (state.dirty && !confirm('عندك تغييرات غير محفوظة. تتجاهلها؟')) return;
      Object.assign(state, { gid: null, meta: null, settings: null, dirty: false, guilds: [] });
      return render();
    case 'addtype': {
      collect();
      if (state.settings.tickets.types.length >= 25) return toast('الحد الأقصى 25 نوع', 'err');
      state.settings.tickets.types.push({ value: '', label: '', description: '', emoji: '' });
      markDirty();
      return renderPage();
    }
    case 'deltype': {
      collect();
      const rows = $$('.trow');
      state.settings.tickets.types.splice(rows.indexOf(t.closest('.trow')), 1);
      markDirty();
      return renderPage();
    }
    case 'sendpanel': {
      const ch = $('[data-path="_panelChannel"]').value;
      if (!ch) return toast('اختر قناة أول', 'err');
      collect();
      try {
        const copy = { ...state.settings };
        delete copy._panelChannel;
        state.settings = await api(`/api/guilds/${state.gid}/settings`, { method: 'PUT', body: copy });
        state.dirty = false;
        await api(`/api/guilds/${state.gid}/panel`, { method: 'POST', body: { channelId: ch } });
        toast('تم إرسال اللوحة ✅');
      } catch (err) {
        toast(err.message, 'err');
      }
      return;
    }
    case 'brandapply':
    case 'brandreset': {
      const body = {};
      if (act === 'brandreset') {
        if (!confirm('ترجع اسم وصورة البوت الأصلية بهالسيرفر؟')) return;
        body.reset = true;
      } else {
        body.name = $('#brandName').value;
        const f = $('#brandFile').files[0];
        if (f) {
          if (f.size > 8 * 1024 * 1024) return toast('الصورة أكبر من 8MB', 'err');
          body.logo = await new Promise((ok, no) => {
            const r = new FileReader();
            r.onload = () => ok(r.result);
            r.onerror = () => no(new Error('ما قدرت أقرأ الملف'));
            r.readAsDataURL(f);
          }).catch(() => null);
          if (!body.logo) return toast('ما قدرت أقرأ الملف', 'err');
        }
      }
      const btns = $$('[data-act^=brand]');
      btns.forEach((x) => (x.disabled = true));
      try {
        await api(`/api/guilds/${state.gid}/branding`, { method: 'POST', body });
        state.meta = await api(`/api/guilds/${state.gid}/meta`);
        toast('تم تحديث الهوية ✅');
        return render();
      } catch (err) {
        toast(err.message, 'err');
      } finally {
        btns.forEach((x) => (x.disabled = false));
      }
      return;
    }
    case 'back':
      state.ticketId = null;
      return renderPage();
    case 'logsearch':
      state.log = { status: $('#logstatus').value, q: $('#logq').value.trim(), page: 1 };
      return renderPage();
    case 'pg':
      state.log.page = Math.max(1, state.log.page + d);
      return renderPage();
    case 'cpg':
      state.cases.page = Math.max(1, state.cases.page + d);
      return renderPage();
    default:
  }
});

function updateGuildPreview() {
  const sel = $('#guildSelect');
  const box = $('#guildPrev');
  if (!sel || !box) return;
  const g = state.guilds.find((x) => x.id === sel.value);
  if (!g) return;
  const img = (u, alt) => `<img class="avatar" style="width:46px;height:46px" src="${esc(u || '/logo.png')}" alt="${alt}">`;
  box.innerHTML = `${img(g.icon, '')}<div><b>${esc(g.name)}</b><div class="hint">${g.members} عضو</div></div>
    <span style="flex:1"></span>${img(safeAvatar(g.botLogo) || '/logo.png', '')}<div><b>${esc(g.botName || 'NeoBot')}</b><div class="hint">اسم البوت هنا</div></div>`;
}

document.addEventListener('change', (e) => {
  if (e.target.id === 'guildSelect') updateGuildPreview();
  if (e.target.id === 'brandFile' && e.target.files[0]) {
    const r = new FileReader();
    r.onload = () => ($('#brandImg').src = r.result);
    r.readAsDataURL(e.target.files[0]);
  }
  if (e.target.id === 'casetype') {
    state.cases = { type: e.target.value, page: 1 };
    renderPage();
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'logq') $('[data-act=logsearch]').click();
});

function markDirty() {
  state.dirty = true;
  const h = $('#dirtyHint');
  if (h) h.textContent = 'عندك تغييرات غير محفوظة';
}

document.addEventListener('input', (e) => {
  if (!e.target.closest('#content')) return;
  if (e.target.dataset.path === '_panelChannel' || e.target.id === 'logq') return;
  if (e.target.id === 'brandName' || e.target.id === 'brandFile') return;
  if (e.target.id === 'casetype' || e.target.id === 'logstatus') return;
  markDirty();
  // معاينة اللوحة
  const p = e.target.dataset.path;
  if (p === 'tickets.panel.title') $('#pvTitle').textContent = e.target.value;
  if (p === 'tickets.panel.footer') $('#pvFoot').textContent = e.target.value;
  if (p === 'tickets.panel.color') $('#preview').style.borderInlineStartColor = e.target.value;
  if (p === 'tickets.panel.bannerUrl') {
    const box = $('#pvImg');
    box.textContent = '';
    if (/^https?:\/\/\S+$/i.test(e.target.value)) {
      const img = document.createElement('img');
      img.src = e.target.value;
      img.style.cssText = 'width:100%;border-radius:6px';
      img.alt = '';
      box.appendChild(img);
    }
  }
});

window.addEventListener('beforeunload', (e) => {
  if (state.dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

render();
