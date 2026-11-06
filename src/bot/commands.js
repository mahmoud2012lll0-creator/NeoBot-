'use strict';

const { SlashCommandBuilder, PermissionFlagsBits: P, EmbedBuilder, ChannelType } = require('discord.js');
const db = require('../db');
const tickets = require('./tickets');
const { EPH, sendTo } = require('./helpers');
const branding = require('./branding');

const TYPE_AR = {
  ban: 'حظر',
  unban: 'فك حظر',
  kick: 'طرد',
  timeout: 'تايم أوت',
  untimeout: 'فك تايم أوت',
  warn: 'تحذير',
};

const reasonOpt = (o) => o.setName('reason').setDescription('السبب');

const defs = [
  new SlashCommandBuilder()
    .setName('panel')
    .setDescription('إرسال لوحة التذاكر')
    .setDefaultMemberPermissions(P.ManageGuild)
    .addChannelOption((o) =>
      o.setName('channel').setDescription('القناة (الافتراضي: الحالية)').addChannelTypes(ChannelType.GuildText),
    ),
  new SlashCommandBuilder()
    .setName('branding')
    .setDescription('غيّر اسم وصورة البوت بهالسيرفر')
    .setDefaultMemberPermissions(P.ManageGuild)
    .addStringOption((o) => o.setName('name').setDescription('الاسم الجديد (حتى 32 حرف)').setMaxLength(32))
    .addAttachmentOption((o) => o.setName('logo').setDescription('صورة اللوقو (png, jpg, gif, webp)'))
    .addBooleanOption((o) => o.setName('reset').setDescription('رجّع الاسم والصورة الأصلية')),
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('حظر عضو')
    .setDefaultMemberPermissions(P.BanMembers)
    .addUserOption((o) => o.setName('user').setDescription('العضو').setRequired(true))
    .addStringOption(reasonOpt)
    .addIntegerOption((o) =>
      o.setName('delete_days').setDescription('حذف رسائل آخر X أيام (0-7)').setMinValue(0).setMaxValue(7),
    ),
  new SlashCommandBuilder()
    .setName('unban')
    .setDescription('فك حظر')
    .setDefaultMemberPermissions(P.BanMembers)
    .addStringOption((o) => o.setName('user_id').setDescription('آيدي العضو').setRequired(true))
    .addStringOption(reasonOpt),
  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('طرد عضو')
    .setDefaultMemberPermissions(P.KickMembers)
    .addUserOption((o) => o.setName('user').setDescription('العضو').setRequired(true))
    .addStringOption(reasonOpt),
  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('تايم أوت لعضو')
    .setDefaultMemberPermissions(P.ModerateMembers)
    .addUserOption((o) => o.setName('user').setDescription('العضو').setRequired(true))
    .addIntegerOption((o) =>
      o.setName('minutes').setDescription('المدة بالدقائق').setRequired(true).setMinValue(1).setMaxValue(40320),
    )
    .addStringOption(reasonOpt),
  new SlashCommandBuilder()
    .setName('untimeout')
    .setDescription('فك التايم أوت')
    .setDefaultMemberPermissions(P.ModerateMembers)
    .addUserOption((o) => o.setName('user').setDescription('العضو').setRequired(true)),
  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('تحذير عضو')
    .setDefaultMemberPermissions(P.ModerateMembers)
    .addUserOption((o) => o.setName('user').setDescription('العضو').setRequired(true))
    .addStringOption(reasonOpt),
  new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('سجل عقوبات عضو')
    .setDefaultMemberPermissions(P.ModerateMembers)
    .addUserOption((o) => o.setName('user').setDescription('العضو').setRequired(true)),
  new SlashCommandBuilder()
    .setName('clearwarns')
    .setDescription('تصفير تحذيرات عضو')
    .setDefaultMemberPermissions(P.ModerateMembers)
    .addUserOption((o) => o.setName('user').setDescription('العضو').setRequired(true)),
  new SlashCommandBuilder()
    .setName('purge')
    .setDescription('حذف رسائل')
    .setDefaultMemberPermissions(P.ManageMessages)
    .addIntegerOption((o) =>
      o.setName('amount').setDescription('العدد (1-100)').setRequired(true).setMinValue(1).setMaxValue(100),
    )
    .addUserOption((o) => o.setName('user').setDescription('حذف رسائل عضو معيّن فقط')),
].map((d) => d.toJSON());

async function register(guild) {
  try {
    await guild.commands.set(defs);
  } catch (e) {
    console.error(`[commands] فشل تسجيل الأوامر بسيرفر ${guild.name}: ${e.message}`);
  }
}

/* ------------------------------ أدوات مشتركة ------------------------------ */
function hierarchyError(i, target) {
  if (!target) return null; // مش موجود بالسيرفر
  if (target.id === i.user.id) return 'ما بتقدر تطبّق هالأمر على نفسك.';
  if (target.id === i.client.user.id) return 'ما بتقدر تطبّقه عليّ 😅';
  if (target.id === i.guild.ownerId) return 'ما بتقدر تطبّقه على صاحب السيرفر.';
  if (i.guild.ownerId !== i.user.id && i.member.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    return 'رتبة هالعضو أعلى منك أو تساويك.';
  }
  return null;
}

async function record(i, type, user, reason, extra = {}) {
  const s = db.getSettings(i.guild.id);
  const c = db.addCase(i.guild.id, {
    type,
    userId: user.id,
    userTag: user.username,
    modId: i.user.id,
    modTag: i.user.username,
    reason,
    ...extra,
  });
  const embed = new EmbedBuilder()
    .setColor(0x29b6f6)
    .setTitle(`Case #${c.number} | ${TYPE_AR[type]}`)
    .addFields(
      { name: 'العضو', value: `${user} (${user.id})`, inline: true },
      { name: 'المشرف', value: `${i.user}`, inline: true },
      { name: 'السبب', value: reason || '—' },
    )
    .setTimestamp();
  if (extra.minutes) embed.addFields({ name: 'المدة', value: `${extra.minutes} دقيقة`, inline: true });
  await sendTo(i.guild, s.moderation.logChannelId, { embeds: [embed] });
  return c;
}

async function dm(i, user, type, reason) {
  if (!db.getSettings(i.guild.id).moderation.dmOnAction) return;
  await user
    .send(`تم تطبيق **${TYPE_AR[type]}** عليك في **${i.guild.name}**.\nالسبب: ${reason}`)
    .catch(() => {});
}

const reasonOf = (i) => (i.options.getString('reason') || 'بدون سبب').slice(0, 400);

/* ------------------------------ الأوامر ------------------------------ */
const handlers = {
  async panel(i) {
    const ch = i.options.getChannel('channel') || i.channel;
    await i.deferReply({ flags: EPH });
    try {
      await tickets.sendPanel(i.guild, ch.id);
      await i.editReply(`✅ تم إرسال اللوحة في ${ch}`);
    } catch (e) {
      await i.editReply(`❌ ${e.message}`);
    }
  },

  async branding(i) {
    const name = i.options.getString('name');
    const att = i.options.getAttachment('logo');
    const reset = i.options.getBoolean('reset');
    if (!name && !att && !reset) {
      return i.reply({ content: 'اكتب `name` أو أرفق `logo` أو فعّل `reset`.', flags: EPH });
    }
    await i.deferReply({ flags: EPH });
    try {
      const logo = att && !reset ? await branding.attachmentToDataUri(att) : undefined;
      await branding.apply(i.client, i.guild, { name: name ?? undefined, logo, reset: !!reset });
      return i.editReply(reset ? '✅ رجعت الاسم والصورة الأصلية.' : '✅ تم تحديث هوية البوت بهالسيرفر.');
    } catch (e) {
      return i.editReply(`❌ ${e.message}`);
    }
  },

  async ban(i) {
    const user = i.options.getUser('user');
    const member = i.options.getMember('user');
    const reason = reasonOf(i);
    const err = hierarchyError(i, member);
    if (err) return i.reply({ content: err, flags: EPH });
    if (member && !member.bannable) return i.reply({ content: 'ما بقدر أحظره (رتبته أعلى من رتبتي).', flags: EPH });
    await i.deferReply();
    await dm(i, user, 'ban', reason);
    try {
      await i.guild.members.ban(user, {
        reason: `${reason} | by ${i.user.username}`,
        deleteMessageSeconds: (i.options.getInteger('delete_days') || 0) * 86400,
      });
    } catch (e) {
      return i.editReply(`❌ فشل الحظر: ${e.message}`);
    }
    const c = await record(i, 'ban', user, reason);
    return i.editReply(`🔨 تم حظر **${user.username}** | Case #${c.number}`);
  },

  async unban(i) {
    const id = i.options.getString('user_id').trim();
    const reason = reasonOf(i);
    await i.deferReply();
    try {
      const user = await i.client.users.fetch(id);
      await i.guild.members.unban(id, `${reason} | by ${i.user.username}`);
      const c = await record(i, 'unban', user, reason);
      return i.editReply(`✅ تم فك الحظر عن **${user.username}** | Case #${c.number}`);
    } catch {
      return i.editReply('❌ ما لقيت هالعضو بقائمة المحظورين (تأكد من الآيدي).');
    }
  },

  async kick(i) {
    const user = i.options.getUser('user');
    const member = i.options.getMember('user');
    const reason = reasonOf(i);
    if (!member) return i.reply({ content: 'هالعضو مش موجود بالسيرفر.', flags: EPH });
    const err = hierarchyError(i, member);
    if (err) return i.reply({ content: err, flags: EPH });
    if (!member.kickable) return i.reply({ content: 'ما بقدر أطرده (رتبته أعلى من رتبتي).', flags: EPH });
    await i.deferReply();
    await dm(i, user, 'kick', reason);
    try {
      await member.kick(`${reason} | by ${i.user.username}`);
    } catch (e) {
      return i.editReply(`❌ فشل الطرد: ${e.message}`);
    }
    const c = await record(i, 'kick', user, reason);
    return i.editReply(`👢 تم طرد **${user.username}** | Case #${c.number}`);
  },

  async timeout(i) {
    const user = i.options.getUser('user');
    const member = i.options.getMember('user');
    const minutes = i.options.getInteger('minutes');
    const reason = reasonOf(i);
    if (!member) return i.reply({ content: 'هالعضو مش موجود بالسيرفر.', flags: EPH });
    const err = hierarchyError(i, member);
    if (err) return i.reply({ content: err, flags: EPH });
    if (!member.moderatable) return i.reply({ content: 'ما بقدر أعطيه تايم أوت (رتبته أعلى من رتبتي).', flags: EPH });
    await i.deferReply();
    try {
      await member.timeout(minutes * 60000, `${reason} | by ${i.user.username}`);
    } catch (e) {
      return i.editReply(`❌ فشل: ${e.message}`);
    }
    await dm(i, user, 'timeout', `${reason} (${minutes} دقيقة)`);
    const c = await record(i, 'timeout', user, reason, { minutes });
    return i.editReply(`🔇 تم إعطاء **${user.username}** تايم أوت ${minutes} دقيقة | Case #${c.number}`);
  },

  async untimeout(i) {
    const user = i.options.getUser('user');
    const member = i.options.getMember('user');
    if (!member) return i.reply({ content: 'هالعضو مش موجود بالسيرفر.', flags: EPH });
    await i.deferReply();
    try {
      await member.timeout(null, `by ${i.user.username}`);
    } catch (e) {
      return i.editReply(`❌ فشل: ${e.message}`);
    }
    const c = await record(i, 'untimeout', user, '—');
    return i.editReply(`🔊 تم فك التايم أوت عن **${user.username}** | Case #${c.number}`);
  },

  async warn(i) {
    const user = i.options.getUser('user');
    const member = i.options.getMember('user');
    const reason = reasonOf(i);
    const err = hierarchyError(i, member);
    if (err) return i.reply({ content: err, flags: EPH });
    if (user.bot) return i.reply({ content: 'ما بتقدر تحذّر بوت.', flags: EPH });
    await i.deferReply();
    await dm(i, user, 'warn', reason);
    const c = await record(i, 'warn', user, reason);
    const n = db.activeWarns(i.guild.id, user.id);
    let text = `⚠️ تم تحذير **${user.username}** (تحذير رقم ${n}) | Case #${c.number}`;

    const s = db.getSettings(i.guild.id).moderation;
    if (s.warnsBeforeTimeout > 0 && n >= s.warnsBeforeTimeout && member && member.moderatable) {
      const ok = await member
        .timeout(s.autoTimeoutMinutes * 60000, `Auto: وصل ${n} تحذيرات`)
        .then(() => true)
        .catch(() => false);
      if (ok) {
        await record(i, 'timeout', user, `تلقائي: وصل ${n} تحذيرات`, { minutes: s.autoTimeoutMinutes });
        text += `\n🔇 انعطى تايم أوت تلقائي ${s.autoTimeoutMinutes} دقيقة.`;
      }
    }
    return i.editReply(text);
  },

  async warnings(i) {
    const user = i.options.getUser('user');
    const { items, total } = db.listCases(i.guild.id, { userId: user.id, limit: 10 });
    if (!total) return i.reply({ content: `**${user.username}** نظيف، ما عليه شي.`, flags: EPH });
    const embed = new EmbedBuilder()
      .setColor(0x29b6f6)
      .setTitle(`سجل ${user.username}`)
      .setDescription(
        items
          .map(
            (c) =>
              `**#${c.number}** ${TYPE_AR[c.type] || c.type}${c.cleared ? ' (مصفّر)' : ''} — ${c.reason || '—'} <t:${Math.floor(c.createdAt / 1000)}:R>`,
          )
          .join('\n')
          .slice(0, 4000),
      )
      .setFooter({ text: `تحذيرات فعّالة: ${db.activeWarns(i.guild.id, user.id)} | إجمالي السجل: ${total}` });
    return i.reply({ embeds: [embed], flags: EPH });
  },

  async clearwarns(i) {
    const user = i.options.getUser('user');
    const n = db.clearWarns(i.guild.id, user.id);
    return i.reply({ content: `🧹 تم تصفير ${n} تحذير عن **${user.username}**.`, flags: EPH });
  },

  async purge(i) {
    const amount = i.options.getInteger('amount');
    const user = i.options.getUser('user');
    await i.deferReply({ flags: EPH });
    try {
      let msgs = await i.channel.messages.fetch({ limit: 100 });
      if (user) msgs = msgs.filter((m) => m.author.id === user.id);
      const deleted = await i.channel.bulkDelete([...msgs.values()].slice(0, amount), true);
      return i.editReply(`🧹 تم حذف ${deleted.size} رسالة. (ما بينحذف أقدم من 14 يوم)`);
    } catch (e) {
      return i.editReply(`❌ فشل الحذف: ${e.message}`);
    }
  },
};

async function handle(i) {
  const fn = handlers[i.commandName];
  if (fn) await fn(i);
}

module.exports = { register, handle };
