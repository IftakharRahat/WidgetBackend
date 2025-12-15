import { Router } from 'express';
import { processTelegramMessage, getBot } from '../services/telegram.js';
import { emitToThread } from '../services/socket.js';
import { Server as SocketIOServer } from 'socket.io';
import { supabaseAdmin } from '../config/supabase.js';

const router = Router();

// POST /api/v1/webhook/telegram - Telegram webhook handler
router.post('/telegram', async (req, res) => {
    try {
        const update = req.body;
        console.log('📨 Received Telegram update:', JSON.stringify(update, null, 2));

        // Handle callback queries (button clicks)
        if (update.callback_query) {
            const callbackData = update.callback_query.data;
            const chatId = update.callback_query.message.chat.id;

            if (callbackData.startsWith('reply:')) {
                const threadId = callbackData.replace('reply:', '');
                const bot = getBot();
                if (bot) {
                    await bot.sendMessage(chatId, `💬 To reply to thread #${threadId.slice(0, 8)}, simply send your message.\n\nInclude #${threadId.slice(0, 8)} in your message to specify the thread.`);
                    await bot.answerCallbackQuery(update.callback_query.id);
                }
            }
            return res.json({ ok: true });
        }

        // Handle regular messages
        if (update.message) {
            const message = update.message;
            const telegramUserId = message.from.id;
            const text = message.text || message.caption;
            const photo = message.photo;
            const video = message.video;
            const voice = message.voice;

            // Check if this is from a registered agent
            const { data: agent } = await supabaseAdmin
                .from('agents')
                .select('id')
                .eq('telegram_user_id', telegramUserId)
                .single();

            if (agent) {
                // This is an agent reply
                const replyToMessage = message.reply_to_message;
                const replyText = replyToMessage?.text || replyToMessage?.caption;

                const result = await processTelegramMessage(
                    telegramUserId,
                    text,
                    photo,
                    video,
                    voice,
                    replyText
                );

                if (result.success && result.threadId) {
                    // Emit to WebSocket
                    const io: SocketIOServer = req.app.get('io');

                    // Get the newly created message
                    const { data: latestMessage } = await supabaseAdmin
                        .from('messages')
                        .select('*')
                        .eq('thread_id', result.threadId)
                        .order('created_at', { ascending: false })
                        .limit(1)
                        .single();

                    if (latestMessage) {
                        emitToThread(io, result.threadId, 'message:new', latestMessage);
                    }
                }
            } else {
                // This might be a customer messaging through Telegram directly
                // Handle direct Telegram customer support
                const bot = getBot();
                if (bot) {
                    await bot.sendMessage(telegramUserId,
                        '👋 Welcome! Please use our website chat for support, or register as an agent with your admin.\n\nআমাদের ওয়েবসাইট চ্যাট ব্যবহার করুন অথবা অ্যাডমিনের সাথে যোগাযোগ করুন।'
                    );
                }
            }
        }

        res.json({ ok: true });
    } catch (error) {
        console.error('Error processing webhook:', error);
        res.status(500).json({ error: 'Webhook processing failed' });
    }
});

// GET /api/v1/webhook/telegram - Verify webhook (optional)
router.get('/telegram', (req, res) => {
    res.json({ status: 'Telegram webhook endpoint ready' });
});

export default router;
