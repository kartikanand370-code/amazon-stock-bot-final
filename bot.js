const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');
const cheerio = require('cheerio');
const express = require('express');

// --- CONFIGURATION ---
const BOT_TOKEN = '7892802862:AAGZd5_xEITGVLJfpjl1cAxyEIW-B7KiZ5s'; 
const ADMIN_CHAT_ID = '7485181331'; 
const CHECK_INTERVAL = 15000; // 15 Seconds
// ---------------------

const bot = new Telegraf(BOT_TOKEN);
const activeUsers = {};

// Hardlocked Approved List
global.amazonApprovedList = global.amazonApprovedList || [ADMIN_CHAT_ID.toString()];

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36'
];

const app = express();
const PORT = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Amazon Ultimate Tracking Server is Live!'));
app.listen(PORT, () => console.log(`Web server listening on port ${PORT}`));

// Security Access Checker
function checkAmazonAccess(ctx) {
    const userId = ctx.from.id.toString();
    if (global.amazonApprovedList.includes(userId)) return true;

    const name = `${ctx.from.first_name || ''} ${ctx.from.last_name || ''}`.trim() || 'No Name';
    ctx.reply(`🔒 **Access Denied!**\nAapki Telegram ID: \`${userId}\`\n\nAdmin se approval lein.`);
    
    bot.telegram.sendMessage(ADMIN_CHAT_ID, 
        `🚨 **New Amazon Bot Request!**\n\n👤 Name: ${name}\n🆔 ID: \`${userId}\`\n\n👉 Approve karne ke liye send karein:\n\`/approve ${userId}\``
    );
    return false;
}

// Inline button callback query handler
bot.on('callback_query', async (ctx) => {
    const data = ctx.callbackQuery.data;
    if (data.startsWith('stop_url_')) {
        const index = parseInt(data.split('_')[2]);
        const chatId = ctx.chat.id.toString();
        
        if (activeUsers[chatId] && activeUsers[chatId][index]) {
            const removedItem = activeUsers[chatId][index];
            clearInterval(removedItem.interval);
            activeUsers[chatId].splice(index, 1);
            await ctx.answerCbQuery("Tracking band kar di gayi hai! 🛑");
            return ctx.reply(`🛑 Tracking stopped for:\n${removedItem.url}`, { disable_web_page_preview: true });
        }
    }
    await ctx.answerCbQuery();
});

// --- OWNER ADMIN COMMANDS ---
bot.command('approve', (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_CHAT_ID.toString()) return ctx.reply("❌ Strict Admin Only!");
    const args = ctx.message.text.split(' ').filter(arg => arg.trim() !== '');
    if (args.length < 2) return ctx.reply("⚠️ Format: `/approve <User_ID>`");
    
    const targetUserId = args[1].trim();
    if (!global.amazonApprovedList.includes(targetUserId)) {
        global.amazonApprovedList.push(targetUserId);
        ctx.reply(`✅ Success! User ID \`${targetUserId}\` approved.`);
        bot.telegram.sendMessage(targetUserId, "🥳 Approved! Use: `/start_track <Amazon_URL>`");
    } else {
        ctx.reply("⚠️ Yeh user pehle se approved hai.");
    }
});

bot.command('remove_user', (ctx) => {
    if (ctx.from.id.toString() !== ADMIN_CHAT_ID.toString()) return ctx.reply("❌ Strict Admin Only!");
    const args = ctx.message.text.split(' ').filter(arg => arg.trim() !== '');
    if (args.length < 2) return ctx.reply("⚠️ Format: `/remove_user <User_ID>`");
    
    const targetUserId = args[1].trim();
    const index = global.amazonApprovedList.indexOf(targetUserId);
    if (index > -1) {
        global.amazonApprovedList.splice(index, 1);
        if (activeUsers[targetUserId]) {
            activeUsers[targetUserId].forEach(item => clearInterval(item.interval));
            delete activeUsers[targetUserId];
        }
        ctx.reply(`✅ User ID \`${targetUserId}\` removed.`);
        bot.telegram.sendMessage(targetUserId, "🔒 Admin ne aapka access remove kar diya hai.");
    }
});

// --- USER COMMANDS (AAPKE PATTERN KE MUTABIK RE-MAPPED) ---

bot.start((ctx) => {
    if (!checkAmazonAccess(ctx)) return;
    ctx.reply("🤖 Amazon Ultimate Tracker Bot Active!\n\n🔹 `/start_track <URL>` - Track product\n🔹 `/list` - View active links\n🔹 `/stop_track <URL>` - Stop specific link\n🔹 `/remove_all` - Stop everything");
});

bot.command('start_track', async (ctx) => {
    if (!checkAmazonAccess(ctx)) return;
    const chatId = ctx.chat.id.toString();
    const args = ctx.message.text.replace(/\n/g, ' ').split(' ').filter(arg => arg.trim() !== '');
    const amazonLink = args.find(arg => arg.includes('amazon.') || arg.includes('amzn.in'));
    
    if (!amazonLink) return ctx.reply("❌ Valid Amazon link bhejo!");
    if (!activeUsers[chatId]) activeUsers[chatId] = [];
    if (activeUsers[chatId].some(item => item.url === amazonLink)) return ctx.reply("⚠️ Pehle se track ho raha hai!");
    
    const itemConfig = { url: amazonLink, lastStatus: 'out_of_stock', interval: null };
    itemConfig.interval = setInterval(() => { checkAmazonStock(ctx, chatId, amazonLink, itemConfig); }, CHECK_INTERVAL);
    activeUsers[chatId].push(itemConfig);
    
    ctx.reply("🚀 Amazon tracking chalu ho gayi hai (Har 15 seconds)...");
    checkAmazonStock(ctx, chatId, amazonLink, itemConfig);
});

// AAPKE MUTABIK FIXED: /list command mapping
bot.command('list', (ctx) => {
    if (!checkAmazonAccess(ctx)) return;
    const chatId = ctx.chat.id.toString();
    if (!activeUsers[chatId] || activeUsers[chatId].length === 0) return ctx.reply("😴 Koyi active tracking nahi hai.");
    
    let msg = "📋 **Active Tracking Links:**\n\n";
    activeUsers[chatId].forEach((item, i) => { msg += `${i + 1}. ${item.url}\n\n`; });
    ctx.reply(msg, { parse_mode: 'Markdown', disable_web_page_preview: true });
});

// AAPKE MUTABIK FIXED: /stop_track command mapping
bot.command('stop_track', (ctx) => {
    if (!checkAmazonAccess(ctx)) return;
    const chatId = ctx.chat.id.toString();
    const args = ctx.message.text.split(' ').filter(arg => arg.trim() !== '');
    if (args.length < 2) return ctx.reply("⚠️ Format: `/stop_track <Amazon_URL>`");
    
    const targetUrl = args[1].trim();
    if (!activeUsers[chatId]) return ctx.reply("😴 Koyi active tracking nahi hai.");
    
    const index = activeUsers[chatId].findIndex(item => item.url === targetUrl);
    if (index > -1) {
        clearInterval(activeUsers[chatId][index].interval);
        activeUsers[chatId].splice(index, 1);
        ctx.reply("🛑 Is product ki tracking safely band kar di gayi hai.");
    } else {
        ctx.reply("⚠️ Yeh URL aapki active list mein nahi mila.");
    }
});

// AAPKE MUTABIK FIXED: /remove_all command mapping
bot.command('remove_all', (ctx) => {
    if (!checkAmazonAccess(ctx)) return;
    const chatId = ctx.chat.id.toString();
    if (activeUsers[chatId] && activeUsers[chatId].length > 0) {
        activeUsers[chatId].forEach(item => clearInterval(item.interval));
        delete activeUsers[chatId];
        ctx.reply("🛑 Saari active tracking links mita di gayi hain.");
    } else { 
        ctx.reply("⚠️ Koyi active tracking nahi mili."); 
    }
});

// --- CORE BLOCK-PROOF SCRAPING ENGINE ---
async function checkAmazonStock(ctx, chatId, targetUrl, itemConfig) {
    if (!activeUsers[chatId]) return;
    const itemIndex = activeUsers[chatId].findIndex(item => item.url === targetUrl);
    if (itemIndex === -1) return;

    const randomAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

    try {
        const response = await axios.get(targetUrl, { 
            headers: { 
                'User-Agent': randomAgent, 
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Connection': 'keep-alive'
            }, 
            timeout: 8000 
        });
        
        const $ = cheerio.load(response.data);
        const pageText = $('body').text().toLowerCase();
        
        // UNIVERSAL TEXT SCRAPING (Selectors par dependency khatam)
        const isUnavailable = pageText.includes('currently unavailable') || 
                             pageText.includes('out of stock') || 
                             pageText.includes('available from these sellers');
                             
        const hasStockButtons = pageText.includes('add to cart') || 
                                pageText.includes('buy now') || 
                                pageText.includes('pre-order now');
        
        // Agar unavailable shabd nahi hai, aur inme se koi khareedne wala shabd moujood hai
        if (!isUnavailable && hasStockButtons) {
            itemConfig.lastStatus = 'in_stock';
            await bot.telegram.sendMessage(chatId, `🚨 STOCK AAGYA 🚨\n\n🔥 bhai Amazon pr stock aagya jldi lga jake 🔥\n\nLink:\n${targetUrl}`,
                Markup.inlineKeyboard([[Markup.button.callback('Stop Tracking 🛑', `stop_url_${itemIndex}`)]])
            ).catch(e => console.log("Telegram Rate Limit handling."));
        } else {
            if (itemConfig.lastStatus === 'in_stock') {
                itemConfig.lastStatus = 'out_of_stock';
                await bot.telegram.sendMessage(chatId, `⚠️ **ALERT: Amazon Stock Over!**\n\nAmazon product ab wapas Out of Stock ho chuka hai.\nLink: ${targetUrl}`, { disable_web_page_preview: true });
            }
        }
    } catch (e) { console.log(`[Amazon Engine] Network fetch skipped, retrying next loop...`); }
}

bot.launch().then(() => console.log("Amazon Custom Pattern Engine Live..."));
