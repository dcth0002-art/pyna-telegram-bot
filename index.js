require("dotenv").config();
const { Telegraf } = require("telegraf");

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
  console.error("❌ Missing BOT_TOKEN in .env");
  process.exit(1);
}

const bot = new Telegraf(TOKEN);

// ================== CẤU HÌNH ==================
const CONFIG = {
  // Chỉ cho phép các domain này (bạn thêm domain của bạn vào)
  WHITELIST_DOMAINS: [
    "t.me",
    "telegram.me",
    "play.google.com",
    "github.com",
    "github.io",
  ],

  // Từ khóa cấm (bạn tự thêm dần theo spam thực tế)
  BAD_WORDS: [
    "xxx",
    "porn",
    "sex",
    "18+",
    "địt",
    "đụ",
    "lồn",
    "cặc",
  ],

  // Anti-spam
  MAX_MSG_PER_10S: 6,

  // Hình phạt
  WARN_TO_MUTE: 2,        // warn lần 2 -> mute
  WARN_TO_BAN: 3,         // warn lần 3 -> ban
  MUTE_SECONDS: 30 * 60,  // 30 phút
};

// ================== LƯU TRẠNG THÁI (RAM) ==================
const warnMap = new Map(); // key chatId:userId -> count
const spamMap = new Map(); // key chatId:userId -> timestamps

function k(chatId, userId) {
  return `${chatId}:${userId}`;
}

function norm(s) {
  return (s || "").toLowerCase();
}

function extractDomains(text) {
  const t = text || "";
  const urls = t.match(/https?:\/\/[^\s]+/gi) || [];
  const domains = [];
  for (const u of urls) {
    try {
      const host = new URL(u).hostname.replace(/^www\./, "");
      domains.push(host);
    } catch {}
  }
  return domains;
}

function hasNonWhitelistedLink(text) {
  const domains = extractDomains(text);
  if (domains.length === 0) return false;
  return domains.some((d) => {
    return !CONFIG.WHITELIST_DOMAINS.some((w) => d === w || d.endsWith("." + w));
  });
}

function containsBadWords(text) {
  const t = norm(text);
  return CONFIG.BAD_WORDS.some((w) => w && t.includes(norm(w)));
}

function isSpam(chatId, userId) {
  const key = k(chatId, userId);
  const now = Date.now();
  const arr = spamMap.get(key) || [];
  const recent = arr.filter((x) => now - x < 10_000);
  recent.push(now);
  spamMap.set(key, recent);
  return recent.length > CONFIG.MAX_MSG_PER_10S;
}

async function safeDelete(ctx) {
  try { await ctx.deleteMessage(); } catch {}
}

async function muteUser(ctx, seconds) {
  const untilDate = Math.floor(Date.now() / 1000) + seconds;
  await ctx.restrictChatMember(ctx.from.id, {
    permissions: {
      can_send_messages: false,
      can_send_audios: false,
      can_send_documents: false,
      can_send_photos: false,
      can_send_videos: false,
      can_send_video_notes: false,
      can_send_voice_notes: false,
      can_send_polls: false,
      can_send_other_messages: false,
      can_add_web_page_previews: false,
      can_change_info: false,
      can_invite_users: false,
      can_pin_messages: false,
      can_manage_topics: false,
    },
    until_date: untilDate,
  });
}

async function warn(ctx, reason) {
  const chatId = ctx.chat.id;
  const userId = ctx.from.id;
  const key = k(chatId, userId);
  const count = (warnMap.get(key) || 0) + 1;
  warnMap.set(key, count);

  await ctx.reply(`⚠️ Cảnh báo (${count}/${CONFIG.WARN_TO_BAN}): ${reason}`);

  if (count >= CONFIG.WARN_TO_BAN) {
    // Ban
    try {
      await ctx.banChatMember(userId);
      await ctx.reply("⛔ Đã ban vì vi phạm nhiều lần.");
    } catch {
      await ctx.reply("❌ Không ban được (kiểm tra quyền admin của bot).");
    }
    return;
  }

  if (count >= CONFIG.WARN_TO_MUTE) {
    // Mute
    try {
      await muteUser(ctx, CONFIG.MUTE_SECONDS);
      await ctx.reply(`🔇 Đã mute ${Math.floor(CONFIG.MUTE_SECONDS / 60)} phút.`);
    } catch {
      await ctx.reply("❌ Không mute được (kiểm tra quyền admin của bot).");
    }
  }
}

// ================== KIỂM DUYỆT MESSAGE ==================
bot.on("message", async (ctx) => {
  if (!ctx.chat || !ctx.from) return;
  if (ctx.from.is_bot) return;

  const text = ctx.message?.text || ctx.message?.caption || "";

  // 1) Chặn link ngoài whitelist
  if (hasNonWhitelistedLink(text)) {
    await safeDelete(ctx);
    return warn(ctx, "không được gửi link.");
  }

  // 2) Chặn từ khóa độc
  if (containsBadWords(text)) {
    await safeDelete(ctx);
    return warn(ctx, "Nội dung vi phạm nội quy.");
  }

  // 3) Anti-spam
  if (isSpam(ctx.chat.id, ctx.from.id)) {
    await safeDelete(ctx);
    return warn(ctx, "Spam quá nhanh.");
  }
});

// ================== LỆNH QUẢN TRỊ (đơn giản) ==================
bot.command("whitelist", async (ctx) => {
  await ctx.reply("✅ Whitelist domains:\n" + CONFIG.WHITELIST_DOMAINS.join("\n"));
});

bot.command("addbad", async (ctx) => {
  const w = (ctx.message.text || "").split(" ").slice(1).join(" ").trim();
  if (!w) return ctx.reply("Dùng: /addbad <tu_khoa>");
  CONFIG.BAD_WORDS.push(w);
  return ctx.reply(`✅ Đã thêm từ khóa cấm: ${w}`);
});

bot.command("delbad", async (ctx) => {
  const w = (ctx.message.text || "").split(" ").slice(1).join(" ").trim();
  if (!w) return ctx.reply("Dùng: /delbad <tu_khoa>");
  const before = CONFIG.BAD_WORDS.length;
  CONFIG.BAD_WORDS = CONFIG.BAD_WORDS.filter((x) => norm(x) !== norm(w));
  const after = CONFIG.BAD_WORDS.length;
  return ctx.reply(before === after ? "⚠️ Không thấy từ khóa đó." : `✅ Đã xóa: ${w}`);
});

// ================== CHẠY BOT ==================
bot.launch();
console.log("🤖 Moderation bot running...");

// Tắt gọn
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
