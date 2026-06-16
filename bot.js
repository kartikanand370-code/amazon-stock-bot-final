const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const cheerio = require('cheerio');
const express = require('express');
const fs = require('fs');
const path = require('path');

// --- CONFIGURATION ---
const BOT_TOKEN = '7892802862:AAGZd5_xEITGVLJfpjl1cAxyEIW-B7KiZ5s'; 
const ADMIN_CHAT_ID = '7485181331'; 
const CHECK_INTERVAL = 10000; // 10 Seconds
// ---------------------

const bot = new Telegraf(BOT_TOKEN);
const activeUsers = {};
const FILE_PATH = path.join(__dirname, 'amazon_users.json');

// Memory persist karne ke liye file function
function loadApprovedUsers() {
    try {
        if (fs.existsSync(FILE_PATH)) {
            const data = fs.readFileSync(FILE_PATH, 'utf8');
            return new Set(JSON.parse(data));
        }
    } catch (e) { console.error("Error loading users:", e); }
    return new Set([ADMIN_CHAT_ID.toString()]);
}

function saveApprovedUsers() {
    try {
        fs.writeFileSync(FILE_PATH, JSON.stringify(Array.from(approvedUsers)), 'utf8');
    } catch (e) { console.error("Error saving users:", e); }
}

const approvedUsers = loadApprovedUsers();
const userNames = { [ADMIN_CHAT_ID.toString()]: "Admin (Aap)" };

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0'
];

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Amazon Bot is strictly alive and running!'));
app.listen(PORT, () => console.log(`Web server listening on port ${PORT}`));

bot.use(async (ctx, next) => {
    if (!ctx.from) return;
    const userId = ctx.from.id.toString();
    if (approvedUsers.has(userId) || (ctx.callbackQuery && ctx.from.id.toString() === ADMIN_CHAT_ID.toString())) {
        return next();
    }
    if (ctx.message && ctx.message.text === '/start') {
        const name = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || 'No Name';
        const username = ctx.from.username ? `@${ctx.from.username}` : 'No Username';
        userNames[userId] = name;
        ctx.reply("🔒 Access Denied! Request Admin ke paas bhej di gayi hai...");
        return bot.telegram.sendMessage(ADMIN_CHAT_ID, 
            `🚨 **New Access Request!**\n\n👤 Name: ${name}\n🆔 ID: ${userId}\n🌐 Username: ${username}`,
            Markup.inlineKeyboard([[Markup.button.callback('Approve ✅', `approve_${userId}`), Markup.button.callback('Decline ❌', `decline_${userId}`)]])
        );
    }
    return ctx.reply("❌ Aap approved nahi hain.");
});

bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const userId = ctx.from.id.toString();
    
    if (data.startsWith('stop_url_')) {
        const index = parseInt(data.split('_')[2]);
        const chatId = ctx.chat.id.toString();
        
        if (activeUsers[chatId] && activeUsers[chatId][index]) {
            const removedItem = activeUsers[chatId][index];
            clearInterval(removedItem.interval);
            activeUsers[chatId].splice(index, 1);
            await ctx.answerCbQuery("Tracking successfully band kar di gayi hai! 🛑");
            return ctx.reply(`🛑 Is product ki tracking band kar di gayi hai:\n${removedItem.url}`, { disable_web_page_preview: true });
        } else {
            return ctx.answerCbQuery("⚠️ Yeh product ab tracking mein nahi hai.");
        }
    }

    if (userId !== ADMIN_CHAT_ID.toString()) return ctx.answerCbQuery("Unauthorized!");
    const targetUserId = data.split('_')[1];
    if (data.startsWith('approve_')) {
        approvedUsers.add(targetUserId.toString());
        saveApprovedUsers(); // File me save ho gaya
        await ctx.editMessageText(`${ctx.callbackQuery.message.text}\n\n✅ **Status: Approved!**`);
        bot.telegram.sendMessage(targetUserId, "🥳 Approved! Use: `/start_track <Amazon_URL>`");
    } else if (data.startsWith('decline_')) {
        await ctx.editMessageText(`${ctx.callbackQuery.message.text}\n\n❌ **Status: Declined!**`);
    }
    await ctx.answerCbQuery();
});

bot.command('list_users', (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_CHAT_ID.toString()) return ctx.reply("❌ Admin Only!");
    if (approvedUsers.size <= 1) return ctx.reply("👥 Koyi approved user nahi hai.");
    let msg = "👥 **Approved Users List:**\n\n";
    let count = 1;
    approvedUsers.forEach((userId) => {
        if (userId !== ADMIN_CHAT_ID.toString()) {
            msg += `${count}. 👤 **${userNames[userId] || "User"}**\n🆔 ID: \`${userId}\`\n\n`;
            count++;
        }
    });
    ctx.reply(msg, { parse_mode: 'Markdown' });
});

bot.command('remove_user', (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_CHAT_ID.toString()) return ctx.reply("❌ Admin Only!");
    const args = ctx.message.text.split(' ').filter(arg => arg.trim() !== '');
    if (args.length < 2) return ctx.reply("⚠️ `/remove_user <User_ID>`");
    const targetUserId = args[1].trim();
    if (approvedUsers.has(targetUserId)) {
        approvedUsers.delete(targetUserId);
        saveApprovedUsers(); // File se ud gaya
        if (activeUsers[targetUserId]) {
            activeUsers[targetUserId].forEach(item => clearInterval(item.interval));
            delete activeUsers[targetUserId];
        }
        ctx.reply(`✅ User ${targetUserId} ko remove kar diya.`);
    } else { ctx.reply("⚠️ User nahi mila."); }
});

bot.start((ctx) => ctx.reply("🤖 Amazon Tracker Bot Active!\n\n🔹 `/start_track <URL>`\n🔹 `/list_track`\n🔹 `/stop_all`"));

bot.command('start_track', async (ctx) => {
    const chatId = ctx.chat.id.toString();
    const args = ctx.message.text.replace(/\n/g, ' ').split(' ').filter(arg => arg.trim() !== '');
    const amazonLink = args.find(arg => arg.includes('amazon.') || arg.includes('amzn.in'));
    if (!amazonLink) return ctx.reply("❌ Valid Amazon link bhejo!");
    if (!activeUsers[chatId]) activeUsers[chatId] = [];
    if (activeUsers[chatId].some(item => item.url === amazonLink)) return ctx.reply("⚠️ Yeh pehle se track ho raha hai!");
    
    const intervalId = setInterval(() => { checkAmazonStock(ctx, chatId, amazonLink); }, CHECK_INTERVAL);
    activeUsers[chatId].push({ url: amazonLink, interval: intervalId });
    ctx.reply(`🚀 Tracking chalu ho gayi hai...`);
    checkAmazonStock(ctx, chatId, amazonLink);
});

bot.command('list_track', (ctx) => {
    const chatId = ctx.chat.id.toString();
    if (!activeUsers[chatId] || activeUsers[chatId].length === 0) return ctx.reply("😴 Koyi active tracking nahi hai.");
    let msg = "📋 **Active Tracking Links:**\n\n";
    activeUsers[chatId].forEach((item, i) => { msg += `${i + 1}. ${item.url}\n\n`; });
    ctx.reply(msg, { parse_mode: 'Markdown', disable_web_page_preview: true });
});

bot.command('stop_all', (ctx) => {
    const chatId = ctx.chat.id.toString();
    if (activeUsers[chatId] && activeUsers[chatId].length > 0) {
        activeUsers[chatId].forEach(item => clearInterval(item.interval));
        delete activeUsers[chatId];
        ctx.reply("🛑 Saari tracking band kar di gayi.");
    } else { ctx.reply("⚠️ Koyi active tracking nahi mili."); }
});

async function checkAmazonStock(ctx, chatId, targetUrl) {
    if (!activeUsers[chatId]) return;
    const itemIndex = activeUsers[chatId].findIndex(item => item.url === targetUrl);
    if (itemIndex === -1) return;

    const randomAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

    try {
        const response = await axios.get(targetUrl, { headers: { 'User-Agent': randomAgent, 'Accept-Language': 'en-US,en;q=0.9' }, timeout: 8000 });
        const $ = cheerio.load(response.data);
        const availabilityText = $('#availability').text().trim().toLowerCase();
        const addToCartBtn = $('#add-to-cart-button').length;
        
        if (!availabilityText.includes('currently unavailable') && (availabilityText.includes('in stock') || addToCartBtn > 0)) {
            await bot.telegram.sendMessage(chatId, `🚨 STOCK AAGYA 🚨\n\n🔥 bhai Amazon pr stock aagya jldi lga jake 🔥\n\nLink:\n${targetUrl}`,
                Markup.inlineKeyboard([[Markup.button.callback('Stop Tracking 🛑', `stop_url_${itemIndex}`)]])
            );
        }
    } catch (e) { console.log(`[Amazon Bypass] Error or timeout, retrying...`); }
}

bot.launch().then(() => console.log("Amazon Ultimate Bot Live..."));
