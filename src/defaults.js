'use strict';

// الإعدادات الافتراضية لكل سيرفر.
// أي مفتاح جديد بتضيفه هون بيظهر تلقائياً بالسيرفرات القديمة.
module.exports = {
  tickets: {
    enabled: true,
    categoryId: '',
    supportRoleIds: [],
    logChannelId: '',
    maxOpenPerUser: 1,
    panel: {
      title: 'نظام تذاكر | Ticket System',
      description: '',
      color: '#29B6F6',
      thumbnailUrl: '',
      bannerUrl: '',
      footer: '',
      placeholder: 'Choose Ticket ...',
    },
    types: [
      { value: 'support', label: 'دعم فني', description: 'مشكلة أو سؤال تقني', emoji: '🛠️' },
      { value: 'report', label: 'تبليغ / شكوى', description: 'تبليغ عن لاعب أو مخالفة', emoji: '🚨' },
      { value: 'other', label: 'استفسار آخر', description: 'أي موضوع ثاني', emoji: '📩' },
    ],
    messages: {
      welcome:
        'أهلاً {user}، تم فتح تذكرتك من نوع **{type}**.\nاكتب مشكلتك بالتفصيل وانتظر الفريق، رح يردوا عليك بأقرب وقت.',
    },
  },

  welcome: {
    enabled: false,
    channelId: '',
    message: 'أهلاً {user} في **{server}** 🎉\nأنت العضو رقم **{memberCount}**',
    useEmbed: true,
    color: '#29B6F6',
    bannerUrl: '',
    autoRoleIds: [],
    botAutoRoleIds: [],
    dmEnabled: false,
    dmMessage: 'أهلاً فيك في {server}! نتمنى لك وقت ممتع.',
    leaveEnabled: false,
    leaveChannelId: '',
    leaveMessage: 'غادرنا **{username}** 😢',
  },

  logs: {
    enabled: false,
    channelId: '',
    events: {
      messageDelete: true,
      messageEdit: true,
      memberJoin: true,
      memberLeave: true,
      memberUpdate: true,
      ban: true,
      channel: true,
      role: true,
      voice: true,
    },
  },

  moderation: {
    logChannelId: '',
    dmOnAction: true,
    warnsBeforeTimeout: 3,
    autoTimeoutMinutes: 60,
  },

  protection: {
    enabled: false,
    logChannelId: '',
    whitelistRoleIds: [],
    whitelistChannelIds: [],
    antiSpam: { enabled: false, maxMessages: 5, perSeconds: 5, timeoutMinutes: 10 },
    antiLinks: { enabled: false, allowedDomains: [] },
    antiInvites: { enabled: false },
    antiMassMention: { enabled: false, max: 5, timeoutMinutes: 10 },
    antiRaid: { enabled: false, maxJoins: 8, perSeconds: 10, minAccountAgeDays: 0, action: 'kick' },
  },
};
