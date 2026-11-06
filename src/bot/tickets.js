'use strict';

const {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ChannelType,
  PermissionFlagsBits: P,
  AttachmentBuilder,
} = require('discord.js');
const db = require('../db');
const { EPH, colorOf, fill, validUrl, sendTo, isStaff, brandOf, setBrandFooter } = require('./helpers');

const MEMBER_PERMS = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks];
const closing = new Set();

/* ------------------------------ اللوحة ------------------------------ */
function buildPanel(settings, withEmoji = true, guild = null) {
  const p = settings.tickets.panel;
  const embed = new EmbedBuilder().setTitle(p.title || 'Tickets').setColor(colorOf(p.color));
  if (p.description) embed.setDescription(p.description);
  const logo = validUrl(p.thumbnailUrl) ? p.thumbnailUrl : brandOf(guild).logo;
  if (logo) embed.setThumbnail(logo);
  if (validUrl(p.bannerUrl)) embed.setImage(p.bannerUrl);
  setBrandFooter(embed, guild, p.footer);

  const options = settings.tickets.types.map((t) => {
    const o = { label: t.label, value: t.value };
    if (t.description) o.description = t.description;
    if (withEmoji && t.emoji) o.emoji = t.emoji;
    return o;
  });
  const menu = new StringSelectMenuBuilder()
    .setCustomId('ticket:select')
    .setPlaceholder(p.placeholder || 'Choose Ticket ...')
    .addOptions(options);
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

async function sendPanel(guild, channelId) {
  const settings = db.getSettings(guild.id);
  if (!settings.tickets.types.length) throw new Error('ما في أنواع تذاكر. ضيف نوع واحد على الأقل.');
  const ch = guild.channels.cache.get(channelId);
  if (!ch || !ch.isTextBased()) throw new Error('القناة غير صالحة.');
  try {
    return await ch.send(buildPanel(settings, true, guild));
  } catch (e) {
    // غالباً إيموجي غير صالح بأحد الأنواع: نجرب بدون إيموجي
    try {
      return await ch.send(buildPanel(settings, false, guild));
    } catch (e2) {
      throw new Error(`فشل إرسال اللوحة: ${e2.message} (تأكد من صلاحيات البوت بالقناة)`);
    }
  }
}

function controls(claimedByTag) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket:claim')
      .setLabel(claimedByTag ? `استلمها: ${claimedByTag}` : 'استلام')
      .setEmoji('🙋')
      .setStyle(ButtonStyle.Success)
      .setDisabled(!!claimedByTag),
    new ButtonBuilder().setCustomId('ticket:close').setLabel('إغلاق').setEmoji('🔒').setStyle(ButtonStyle.Danger),
  );
}

/* ------------------------------ فتح تذكرة ------------------------------ */
async function handleSelect(i) {
  const guild = i.guild;
  const settings = db.getSettings(guild.id);
  await i.deferReply({ flags: EPH });

  // رجّع القائمة لوضعها الأصلي عشان نقدر نختار نفس النوع مرة ثانية
  i.message.edit({ components: buildPanel(settings, true, guild).components }).catch(() => {});

  if (!settings.tickets.enabled) return i.editReply('نظام التذاكر متوقف حالياً.');
  const type = settings.tickets.types.find((t) => t.value === i.values[0]);
  if (!type) return i.editReply('هالنوع مش موجود. جرّب مرة ثانية.');

  // نظّف التذاكر اللي انحذفت قنواتها يدوياً
  const open = db.getOpenTicketsByUser(guild.id, i.user.id);
  for (const t of open) {
    if (!guild.channels.cache.has(t.channelId)) {
      db.updateTicket(t, { status: 'closed', closedAt: Date.now(), closedByTag: 'تم حذف القناة يدوياً' });
    }
  }
  const live = open.filter((t) => t.status === 'open');
  if (live.length >= settings.tickets.maxOpenPerUser) {
    return i.editReply(`عندك تذكرة مفتوحة أصلاً: <#${live[0].channelId}>`);
  }

  const me = guild.members.me;
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [P.ViewChannel] },
    { id: i.user.id, allow: MEMBER_PERMS },
    { id: me.id, allow: [...MEMBER_PERMS, P.ManageChannels] },
  ];
  for (const rid of settings.tickets.supportRoleIds) {
    if (guild.roles.cache.has(rid)) overwrites.push({ id: rid, allow: MEMBER_PERMS });
  }

  const cat = settings.tickets.categoryId && guild.channels.cache.get(settings.tickets.categoryId);
  const parent = cat && cat.type === ChannelType.GuildCategory ? cat.id : null;

  let channel;
  try {
    const number = (db.allTickets(guild.id).length || 0) + 1;
    channel = await guild.channels.create({
      name: `${type.value}-${String(number).padStart(4, '0')}`.slice(0, 90),
      type: ChannelType.GuildText,
      parent,
      topic: `ticket_owner:${i.user.id}`,
      permissionOverwrites: overwrites,
      reason: `Ticket opened by ${i.user.username}`,
    });
  } catch (e) {
    console.error('[tickets] create channel failed:', e.message);
    return i.editReply('ما قدرت أفتح القناة. تأكد إن عندي صلاحية Manage Channels وإن الكاتيجوري مو ممتلئة.');
  }

  const ticket = db.createTicket({
    guildId: guild.id,
    channelId: channel.id,
    ownerId: i.user.id,
    ownerTag: i.user.username,
    type: type.value,
    typeLabel: type.label,
  });

  const embed = new EmbedBuilder()
    .setTitle(`${type.emoji ? type.emoji + ' ' : ''}${type.label} | #${String(ticket.number).padStart(4, '0')}`)
    .setDescription(
      fill(settings.tickets.messages.welcome, {
        user: i.user.toString(),
        username: i.user.username,
        type: type.label,
        server: guild.name,
      }),
    )
    .setColor(colorOf(settings.tickets.panel.color))
    .setTimestamp();
  const tLogo = validUrl(settings.tickets.panel.thumbnailUrl) ? settings.tickets.panel.thumbnailUrl : brandOf(guild).logo;
  if (tLogo) embed.setThumbnail(tLogo);
  setBrandFooter(embed, guild, settings.tickets.panel.footer);

  const roles = settings.tickets.supportRoleIds.filter((id) => guild.roles.cache.has(id));
  await channel
    .send({
      content: [i.user.toString(), ...roles.map((r) => `<@&${r}>`)].join(' '),
      embeds: [embed],
      components: [controls(null)],
      allowedMentions: { users: [i.user.id], roles },
    })
    .catch((e) => console.error('[tickets] welcome send failed:', e.message));

  return i.editReply(`تم فتح تذكرتك: ${channel}`);
}

/* ------------------------------ أزرار التذكرة ------------------------------ */
async function handleButton(i) {
  const settings = db.getSettings(i.guild.id);
  const ticket = db.getTicketByChannel(i.channelId);
  if (!ticket) return i.reply({ content: 'هاي التذكرة مش مسجلة بالنظام.', flags: EPH });
  const staff = isStaff(i.member, settings);
  const canClose = staff || i.user.id === ticket.ownerId;

  switch (i.customId) {
    case 'ticket:claim': {
      if (!staff) return i.reply({ content: 'هالزر لفريق الدعم فقط.', flags: EPH });
      if (ticket.claimedBy) return i.reply({ content: `التذكرة مستلمة من <@${ticket.claimedBy}>`, flags: EPH });
      db.updateTicket(ticket, { claimedBy: i.user.id, claimedByTag: i.user.username });
      await i.update({ components: [controls(i.user.username)] });
      return i.channel.send(`🙋 تم استلام التذكرة من قبل ${i.user}`).catch(() => {});
    }
    case 'ticket:close': {
      if (!canClose) return i.reply({ content: 'ما عندك صلاحية تسكر هالتذكرة.', flags: EPH });
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket:confirm').setLabel('تأكيد الإغلاق').setEmoji('🔒').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('ticket:cancel').setLabel('إلغاء').setStyle(ButtonStyle.Secondary),
      );
      return i.reply({ content: 'متأكد بدك تسكر التذكرة؟', components: [row], flags: EPH });
    }
    case 'ticket:confirm': {
      if (!canClose) return i.reply({ content: 'ما عندك صلاحية.', flags: EPH });
      await i.update({ content: '🔒 جاري إغلاق التذكرة... رح تنحذف بعد ثواني.', components: [] });
      return closeTicket(i.channel, i.user, ticket, settings);
    }
    case 'ticket:cancel':
      return i.update({ content: 'تم الإلغاء.', components: [] });
    default:
      return undefined;
  }
}

/* ------------------------------ الإغلاق وحفظ المحادثة ------------------------------ */
async function fetchAll(channel, cap = 5000) {
  const out = [];
  let before;
  while (out.length < cap) {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch || !batch.size) break;
    out.push(...batch.values());
    before = batch.last().id;
  }
  return out.reverse();
}

async function closeTicket(channel, closer, ticket, settings) {
  if (closing.has(channel.id)) return;
  closing.add(channel.id);
  try {
    const guild = channel.guild;
    const raw = await fetchAll(channel);
    const messages = raw.map((m) => ({
      ts: m.createdTimestamp,
      authorId: m.author.id,
      author: m.author.username,
      avatar: m.author.displayAvatarURL({ size: 64, extension: 'png' }),
      content: (m.content || (m.embeds.length ? '[embed]' : '')).slice(0, 4000),
      attachments: [...m.attachments.values()].map((a) => ({ name: a.name, url: a.url })),
    }));

    db.updateTicket(ticket, {
      status: 'closed',
      closedAt: Date.now(),
      closedBy: closer.id,
      closedByTag: closer.username,
      messages,
      messageCount: messages.length,
    });

    const text =
      messages
        .map(
          (m) =>
            `[${new Date(m.ts).toISOString().replace('T', ' ').slice(0, 19)}] ${m.author} (${m.authorId}): ${m.content}` +
            m.attachments.map((a) => `\n    [attachment] ${a.url}`).join(''),
        )
        .join('\n') || '(empty)';
    const file = () => new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: `ticket-${String(ticket.number).padStart(4, '0')}.txt` });

    const embed = new EmbedBuilder()
      .setTitle(`تم إغلاق تذكرة #${String(ticket.number).padStart(4, '0')}`)
      .setColor(colorOf(settings.tickets.panel.color))
      .addFields(
        { name: 'النوع', value: ticket.typeLabel || ticket.type, inline: true },
        { name: 'صاحب التذكرة', value: `<@${ticket.ownerId}>`, inline: true },
        { name: 'أغلقها', value: `${closer}`, inline: true },
        { name: 'استلمها', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : '—', inline: true },
        { name: 'عدد الرسائل', value: String(messages.length), inline: true },
      )
      .setTimestamp();
    await sendTo(guild, settings.tickets.logChannelId, { embeds: [embed], files: [file()] });

    const owner = await guild.members.fetch(ticket.ownerId).catch(() => null);
    if (owner) {
      await owner
        .send({ content: `تم إغلاق تذكرتك في **${guild.name}**. هاي نسخة من المحادثة:`, files: [file()] })
        .catch(() => {});
    }

    await new Promise((r) => setTimeout(r, 5000));
    await channel.delete(`Ticket closed by ${closer.username}`).catch(() => {});
  } finally {
    closing.delete(channel.id);
  }
}

module.exports = { sendPanel, handleSelect, handleButton };
