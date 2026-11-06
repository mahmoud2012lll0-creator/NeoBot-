'use strict';

const { EmbedBuilder, Events } = require('discord.js');
const { sendLog, clip } = require('./helpers');

const GREEN = 0x2ecc71;
const RED = 0xe74c3c;
const YELLOW = 0xf1c40f;
const BLUE = 0x3498db;

const mk = (color, title) => new EmbedBuilder().setColor(color).setTitle(title).setTimestamp();
const ts = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;

function register(client) {
  client.on(Events.MessageDelete, async (m) => {
    if (!m.guild || m.author?.bot) return;
    const e = mk(RED, '🗑️ رسالة محذوفة').addFields(
      { name: 'الكاتب', value: m.author ? `${m.author} (${m.author.id})` : 'غير معروف', inline: true },
      { name: 'القناة', value: `${m.channel}`, inline: true },
      { name: 'المحتوى', value: clip(m.content) || '—' },
    );
    if (m.attachments?.size) {
      e.addFields({ name: 'مرفقات', value: clip([...m.attachments.values()].map((a) => a.url).join('\n')) });
    }
    await sendLog(m.guild, 'messageDelete', e);
  });

  client.on(Events.MessageUpdate, async (oldM, newM) => {
    if (!newM.guild) return;
    if (newM.partial) newM = await newM.fetch().catch(() => null);
    if (!newM || newM.author?.bot) return;
    if (oldM.content === newM.content) return;
    const e = mk(YELLOW, '✏️ رسالة معدّلة')
      .addFields(
        { name: 'الكاتب', value: `${newM.author} (${newM.author.id})`, inline: true },
        { name: 'القناة', value: `${newM.channel}`, inline: true },
        { name: 'قبل', value: clip(oldM.content) || 'غير معروف' },
        { name: 'بعد', value: clip(newM.content) || '—' },
      )
      .setURL(newM.url);
    await sendLog(newM.guild, 'messageEdit', e);
  });

  client.on(Events.GuildMemberAdd, async (m) => {
    const e = mk(GREEN, '📥 عضو دخل')
      .setThumbnail(m.user.displayAvatarURL({ size: 128 }))
      .addFields(
        { name: 'العضو', value: `${m} (${m.id})`, inline: true },
        { name: 'عمر الحساب', value: ts(m.user.createdTimestamp), inline: true },
        { name: 'عدد الأعضاء', value: String(m.guild.memberCount), inline: true },
      );
    await sendLog(m.guild, 'memberJoin', e);
  });

  client.on(Events.GuildMemberRemove, async (m) => {
    const e = mk(RED, '📤 عضو طلع')
      .setThumbnail(m.user.displayAvatarURL({ size: 128 }))
      .addFields(
        { name: 'العضو', value: `${m.user} (${m.id})`, inline: true },
        { name: 'انضم', value: m.joinedTimestamp ? ts(m.joinedTimestamp) : 'غير معروف', inline: true },
      );
    await sendLog(m.guild, 'memberLeave', e);
  });

  client.on(Events.GuildMemberUpdate, async (o, n) => {
    if (o.partial) return;
    const fields = [];
    const added = n.roles.cache.filter((r) => !o.roles.cache.has(r.id));
    const removed = o.roles.cache.filter((r) => !n.roles.cache.has(r.id));
    if (added.size) fields.push({ name: 'رتب انضافت', value: clip(added.map((r) => r.toString()).join(' ')) });
    if (removed.size) fields.push({ name: 'رتب انشالت', value: clip(removed.map((r) => r.toString()).join(' ')) });
    if (o.nickname !== n.nickname) {
      fields.push({ name: 'اللقب', value: `${o.nickname || '—'} ← ${n.nickname || '—'}` });
    }
    if (o.communicationDisabledUntilTimestamp !== n.communicationDisabledUntilTimestamp) {
      const until = n.communicationDisabledUntilTimestamp;
      fields.push({
        name: 'التايم أوت',
        value: until && until > Date.now() ? `ينتهي ${ts(until)}` : 'انتهى أو انشال',
      });
    }
    if (!fields.length) return;
    const e = mk(BLUE, '👤 تحديث عضو').addFields({ name: 'العضو', value: `${n} (${n.id})` }, ...fields);
    await sendLog(n.guild, 'memberUpdate', e);
  });

  client.on(Events.GuildBanAdd, async (ban) => {
    if (ban.partial) ban = await ban.fetch().catch(() => ban);
    const e = mk(RED, '🔨 عضو انحظر').addFields(
      { name: 'العضو', value: `${ban.user} (${ban.user.id})`, inline: true },
      { name: 'السبب', value: clip(ban.reason) || '—', inline: true },
    );
    await sendLog(ban.guild, 'ban', e);
  });

  client.on(Events.GuildBanRemove, async (ban) => {
    const e = mk(GREEN, '✅ فك حظر').addFields({ name: 'العضو', value: `${ban.user} (${ban.user.id})` });
    await sendLog(ban.guild, 'ban', e);
  });

  client.on(Events.ChannelCreate, async (ch) => {
    if (!ch.guild) return;
    await sendLog(ch.guild, 'channel', mk(GREEN, '📁 قناة جديدة').setDescription(`${ch} (\`${ch.name}\`)`));
  });
  client.on(Events.ChannelDelete, async (ch) => {
    if (!ch.guild) return;
    await sendLog(ch.guild, 'channel', mk(RED, '🗑️ قناة انحذفت').setDescription(`\`${ch.name}\``));
  });

  client.on(Events.GuildRoleCreate, async (r) => {
    await sendLog(r.guild, 'role', mk(GREEN, '🏷️ رتبة جديدة').setDescription(`${r} (\`${r.name}\`)`));
  });
  client.on(Events.GuildRoleDelete, async (r) => {
    await sendLog(r.guild, 'role', mk(RED, '🏷️ رتبة انحذفت').setDescription(`\`${r.name}\``));
  });

  client.on(Events.VoiceStateUpdate, async (o, n) => {
    if (o.channelId === n.channelId) return;
    const member = n.member || o.member;
    if (!member || member.user.bot) return;
    let desc;
    if (!o.channelId) desc = `دخل ${n.channel}`;
    else if (!n.channelId) desc = `طلع من ${o.channel}`;
    else desc = `انتقل من ${o.channel} إلى ${n.channel}`;
    await sendLog(member.guild, 'voice', mk(BLUE, '🔊 صوت').setDescription(`${member} ${desc}`));
  });
}

module.exports = { register };
