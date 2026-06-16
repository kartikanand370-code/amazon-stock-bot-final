const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const cheerio = require('cheerio');
const express = require('express');

// --- CONFIGURATION ---
const BOT_TOKEN = '8940524104:AAGf7rFaKp-k12qpHqsO_KRz2ucFxKyxMLY'; 
const ADMIN_CHAT_ID = '7485181331'; 
const CHECK_INTERVAL = 15000; // 15 Seconds
// ---------------------

const bot = new Telegraf(BOT_TOKEN);
const activeUsers = {};

// Hardlocked Array: Shuruat mein aapki ID isme permanent rahegi
global.approvedList = global.approvedList || [ADMIN_CHAT_ID.toString()];

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0'
];

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Flipkart Command Approval Server Running!'));
app.listen(PORT, () => console.log(`Web server listening on port ${PORT}`));

// Function to check access directly inside commands
function checkAccess(ctx) {
    const userId = ctx.from.id.toString();
    if (global.approvedList.includes(userId)) return true;

    const name = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || 'No Name';
    
    ctx.reply(`🔒 **Access Denied!**\nAap abhi approved nahi hain.\nAapki Telegram ID: \`${userId}\`\n\nAdmin ko apni ID send karein approval ke liye.`);
    
    // Admin ko alert bhej raha hai seedhe manual command text ke sath
    bot.telegram.sendMessage(ADMIN_CHAT_ID, 
        `🚨 **New Flipkart Bot Request!**\n\n👤 Name: ${name}\n🆔 ID: \`${userId}\`\n\n👉 Approve karne ke liye is command ko copy karke send karein:\n\`/approve ${userId}\``
    );
    return false;
}

bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (data.startsWith('stop_url_')) {
        const index = parseInt(data.split('_')[2]);
        const chatId = ctx.chat.id.toString();
        
        if (activeUsers[chatId] && activeUsers[chatId][index]) {
            const removedItem = activeUsers[chatId][index];
            clearInterval(removedItem.interval);
            activeUsers[chatId].splice(index, 1);
            await ctx.answerCbQuery("Tracking band ho gayi! 🛑");
            return ctx.reply(`🛑 Tracking stopped for:\n${removedItem.url}`, { disable_web_page_preview: true });
        }
    }
    await ctx.answerCbQuery();
});

// --- STRICT OWNER/ADMIN COMMAND TO MANUAL APPROVE ---
bot.command('approve', (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_CHAT_ID.toString()) return ctx.reply("❌ Strict Admin Only!");
    
    const args = ctx.message.text.split(' ').filter(arg => arg.trim() !== '');
    if (args.length < 2) return ctx.reply("⚠️ Format: `/approve <User_ID>`");
    
    const targetUserId = args[1].trim();
    if (!global.approvedList.includes(targetUserId)) {
        global.approvedList.push(targetUserId);
        ctx.reply(`✅ Success! User ID \`${targetUserId}\` ko successfully approve kar diya gaya hai.`);
        bot.telegram.sendMessage(targetUserId, "🥳 Mubarak ho! Admin ne aapka request approve kar diya hai Flipkart tracker ke liye.\n\nProduct track karne ke liye bhejien:\n`/start_track <Flipkart_URL>`");
    } else {
        ctx.reply("⚠️ Yeh user pehle se approved list mein hai.");
    }
});

bot.start((ctx) => {
    if (!checkAccess(ctx)) return;
    ctx.reply("🤖 Flipkart Tracker Bot Active!\n\n🔹 `/start_track <Flipkart_URL>`\n🔹 `/list_track`\n🔹 `/stop_all`");
});

bot.command('start_track', async (ctx) => {
    if (!checkAccess(ctx)) return;
    const chatId = ctx.chat.id.toString();
    const args = ctx.message.text.replace(/\n/g, ' ').split(' ').filter(arg => arg.trim() !== '');
    const flipkartLink = args.find(arg => arg.includes('flipkart.com') || arg.includes('fkrt.it'));
    
    if (!flipkartLink) return ctx.reply("❌ Valid Flipkart link bhejo!");
    if (!activeUsers[chatId]) activeUsers[chatId] = [];
    if (activeUsers[chatId].some(item => item.url === flipkartLink)) return ctx.reply("⚠️ Already tracking this link!");
    
    const itemConfig = { 
        url: flipkartLink, 
        lastStatus: 'out_of_stock', 
        interval: null 
    };
    
    itemConfig.interval = setInterval(() => { checkFlipkartStock(ctx, chatId, flipkartLink, itemConfig); }, CHECK_INTERVAL);
    activeUsers[chatId].push(itemConfig);
    
    ctx.reply(`🚀 Flipkart tracking chalu ho gayi hai...`);
    checkFlipkartStock(ctx, chatId, flipkartLink, itemConfig);
});

bot.command('list_track', (ctx) => {
    if (!checkAccess(ctx)) return;
    const chatId = ctx.chat.id.toString();
    if (!activeUsers[chatId] || activeUsers[chatId].length === 0) return ctx.reply("😴 Koyi active tracking nahi hai.");
    let msg = "📋 **Active Flipkart Links:**\n\n";
    activeUsers[chatId].forEach((item, i) => { msg += `${i + 1}. ${item.url}\n\n`; });
    ctx.reply(msg, { parse_mode: 'Markdown', disable_web_page_preview: true });
});

bot.command('stop_all', (ctx) => {
    if (!checkAccess(ctx)) return;
    const chatId = ctx.chat.id.toString();
    if (activeUsers[chatId] && activeUsers[chatId].length > 0) {
        activeUsers[chatId].forEach(item => clearInterval(item.interval));
        delete activeUsers[chatId];
        ctx.reply("🛑 Saari tracking band kar di gayi.");
    } else { ctx.reply("⚠️ Koyi active tracking nahi mili."); }
});

async function checkFlipkartStock(ctx, chatId, targetUrl, itemConfig) {
    if (!activeUsers[chatId]) return;
    const itemIndex = activeUsers[chatId].findIndex(item => item.url === targetUrl);
    if (itemIndex === -1) return;

    const randomAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

    try {
        const response = await axios.get(targetUrl, { headers: { 'User-Agent': randomAgent, 'Accept-Language': 'en-US,en;q=0.9' }, timeout: 8000 });
        const $ = cheerio.load(response.data);
        const pageText = $('body').text().toLowerCase();
        
        const isOutOfStock = pageText.includes('currently unavailable') || 
                             pageText.includes('this item is currently out of stock') || 
                             pageText.includes('notify me');
                             
        const hasBuyButtons = pageText.includes('buy now') || pageText.includes('add to cart');

        if (!isOutOfStock && hasBuyButtons) {
            itemConfig.lastStatus = 'in_stock';
            await bot.telegram.sendMessage(chatId, `🚨 STOCK AAGYA 🚨\n\n🔥 bhai flipkart pr stock aagya jaldi lga jake 🔥\n\nLink:\n${targetUrl}`,
                Markup.inlineKeyboard([[Markup.button.callback('Stop Tracking 🛑', `stop_url_${itemIndex}`)]])
            ).catch(e => console.log("Rate Limit Protection"));
        } else {
            if (itemConfig.lastStatus === 'in_stock') {
                itemConfig.lastStatus = 'out_of_stock';
                await bot.telegram.sendMessage(chatId, `⚠️ **ALERT: Stock Over!**\n\nFlipkart product ab wapas Out of Stock ho chuka hai.\nLink: ${targetUrl}`, { disable_web_page_preview: true });
            }
        }
    } catch (e) { console.log(`[Flipkart Loop] Error, retrying next cycle...`); }
}

bot.launch().then(() => console.log("Flipkart Command Engine Deployed..."));
