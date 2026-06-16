const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const cheerio = require('cheerio');
const express = require('express'); // Render web service ke liye zaroori hai

// --- CONFIGURATION ---
const BOT_TOKEN = '7892802862:AAGZd5_xEITGVLJfpjl1cAxyEIW-B7KiZ5s'; 
const ADMIN_CHAT_ID = '7485181331'; 
const CHECK_INTERVAL = 30000; 
// ---------------------

const bot = new Telegraf(BOT_TOKEN);
const activeUsers = {};
const approvedUsers = new Set([ADMIN_CHAT_ID.toString()]);

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9'
};

// Render par Timeout / Port Errors ko rokne ke liye Dummy Web Server
const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot is strictly alive and running!'));
app.listen(PORT, () => console.log(`Web server listening on port ${PORT}`));

// Middleware: Access Controller
bot.use(async (ctx, next) => {
    if (!ctx.from) return;
    const userId = ctx.from.id.toString();
    if (approvedUsers.has(userId) || (ctx.callbackQuery && ctx.from.id.toString() === ADMIN_CHAT_ID.toString())) {
        return next();
    }
    if (ctx.message && ctx.message.text === '/start') {
        const name = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim();
        const username = ctx.from.username ? `@${ctx.from.username}` : 'No Username';
        ctx.reply("🔒 Access Denied! Aapka request Admin ke paas approval ke liye bhej diya gaya hai. Kripya thoda wait karein...");
        return bot.telegram.sendMessage(ADMIN_CHAT_ID, 
            `🚨 **New Access Request!**\n\n👤 Name: ${name}\n🆔 ID: ${userId}\n🌐 Username: ${username}`,
            Markup.inlineKeyboard([[Markup.button.callback('Approve ✅', `approve_${userId}`), Markup.button.callback('Decline ❌', `decline_${userId}`)]])
        );
    }
    return ctx.reply("❌ Aap approved nahi hain. Kripya Admin se approval lein.");
});

bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (ctx.from.id.toString() !== ADMIN_CHAT_ID.toString()) return ctx.answerCbQuery("Unauthorized!");
    const targetUserId = data.split('_')[1];
    if (data.startsWith('approve_')) {
        approvedUsers.add(targetUserId.toString());
        await ctx.editMessageText(`${ctx.callbackQuery.message.text}\n\n✅ **Status: Approved!**`);
        bot.telegram.sendMessage(targetUserId, "🥳 Mubarak ho! Admin ne aapka request approve kar diya hai.\n\nProduct track karne ke liye bhejien:\n`/start_track <Amazon_URL>`");
    } else if (data.startsWith('decline_')) {
        await ctx.editMessageText(`${ctx.callbackQuery.message.text}\n\n❌ **Status: Declined!**`);
        bot.telegram.sendMessage(targetUserId, "😭 Sorry! Admin ne aapka request reject kar diya hai.");
    }
    await ctx.answerCbQuery();
});

bot.start((ctx) => ctx.reply("🤖 Welcome back! Amazon Stock Tracker Bot active hai.\n\n🔹 `/start_track <URL>`\n🔹 `/list_track`\n🔹 `/stop_all`"));

bot.command('start_track', async (ctx) => {
    const chatId = ctx.chat.id.toString();
    const args = ctx.message.text.replace(/\n/g, ' ').split(' ').filter(arg => arg.trim() !== '');
    const amazonLink = args.find(arg => arg.includes('amazon.') || arg.includes('amzn.in'));
    if (!amazonLink) return ctx.reply("❌ Bhai valid Amazon link toh bhejo!");
    if (!activeUsers[chatId]) activeUsers[chatId] = [];
    if (activeUsers[chatId].some(item => item.url === amazonLink)) return ctx.reply("⚠️ Yeh link aap pehle se track kar rahe ho!");
    const intervalId = setInterval(() => { checkAmazonStock(ctx, chatId, amazonLink, intervalId); }, CHECK_INTERVAL);
    activeUsers[chatId].push({ url: amazonLink, interval: intervalId });
    ctx.reply(`🚀 Link list mein add ho gaya hai! Checking chalu hai...`);
    checkAmazonStock(ctx, chatId, amazonLink, intervalId);
});

bot.command('list_track', (ctx) => {
    const chatId = ctx.chat.id.toString();
    if (!activeUsers[chatId] || activeUsers[chatId].length === 0) return ctx.reply("😴 Abhi koi product track nahi ho raha hai.");
    let msg = "📋 **Active Tracking Links:**\n\n";
    activeUsers[chatId].forEach((item, i) => { msg += `${i + 1}. ${item.url}\n\n`; });
    ctx.reply(msg, { parse_mode: 'Markdown', disable_web_page_preview: true });
});

bot.command('stop_all', (ctx) => {
    const chatId = ctx.chat.id.toString();
    if (activeUsers[chatId] && activeUsers[chatId].length > 0) {
        activeUsers[chatId].forEach(item => clearInterval(item.interval));
        delete activeUsers[chatId];
        ctx.reply("🛑 Saari tracking band kar di gayi hai.");
    } else { ctx.reply("⚠️ Koyi active tracking nahi mili."); }
});

async function checkAmazonStock(ctx, chatId, targetUrl, intervalId) {
    if (!activeUsers[chatId]) return;
    try {
        const response = await axios.get(targetUrl, { headers: HEADERS });
        const $ = cheerio.load(response.data);
        const availabilityText = $('#availability').text().trim().toLowerCase();
        const addToCartBtn = $('#add-to-cart-button').length;
        if (!availabilityText.includes('currently unavailable') && (availabilityText.includes('in stock') || addToCartBtn > 0)) {
            // High priority keyword for ringtone trigger
            await bot.telegram.sendMessage(chatId, `🚨 STOCK AAGYA 🚨\n\n🔥 bhai stock aagya jldi lga jake 🔥\n\nLink:\n${targetUrl}`);
            clearInterval(intervalId);
            if (activeUsers[chatId]) {
                activeUsers[chatId] = activeUsers[chatId].filter(item => item.url !== targetUrl);
            }
        }
    } catch (e) { console.error(`Scraping error:`, e.message); }
}

bot.launch().then(() => console.log("Bot running successfully..."));
