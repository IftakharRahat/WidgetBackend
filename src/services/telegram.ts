import TelegramBot from 'node-telegram-bot-api';
import { supabaseAdmin } from '../config/supabase.js';
import { config } from '../config/index.js';

// Initialize bot (polling disabled - we use webhooks)
let bot: TelegramBot | null = null;

export function initializeTelegramBot() {
    if (!config.telegramBotToken) {
        console.warn('⚠️ Telegram bot token not configured');
        return null;
    }

    const isDev = config.nodeEnv === 'development';
    bot = new TelegramBot(config.telegramBotToken, { polling: isDev });
    console.log(`🤖 Telegram bot initialized (Polling: ${isDev})`);

    // Automatic Webhook Validation
    if (!isDev && config.telegramWebhookUrl) {
        bot.setWebhook(config.telegramWebhookUrl).then(() => {
            console.log(`🪝 Telegram Webhook set to: ${config.telegramWebhookUrl}`);
        }).catch(err => {
            console.error('❌ Failed to set Telegram Webhook:', err.message);
        });
    }

    if (isDev) {
        // Handle polling events for local dev
        bot.on('message', async (message) => {
            const telegramUserId = message.from?.id;
            if (!telegramUserId) return;

            const text = message.text || message.caption;
            const photo = message.photo;
            const video = message.video;
            const voice = message.voice;
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
                // We need to import io somehow or use an event bus
                // For now, we'll use a dynamic import or global
                // But circular dependency might be an issue if we import socket.ts here
                // A better way is to move processTelegramMessage logic to a controller that handles both
                // For quick fix:
                const { app } = await import('../index.js');
                const io = app.get('io');
                if (io) {
                    // We need to fetch the latest message to emit it
                    const { data: latestMessage } = await supabaseAdmin
                        .from('messages')
                        .select('*')
                        .eq('thread_id', result.threadId)
                        .order('created_at', { ascending: false })
                        .limit(1)
                        .single();

                    if (latestMessage) {
                        // Dynamically import emitToThread to avoid circular dep at top level if possible
                        // or just use io.emit
                        io.to(`thread:${result.threadId}`).emit('message:new', latestMessage);
                    }
                }
            }
        });

        bot.on('polling_error', (error: any) => {
            if (error.code !== 'EFATAL') {
                console.error('Telegram polling error:', error.code || error.message);
            }
        });
    }

    return bot;
}

export function getBot(): TelegramBot | null {
    return bot;
}

// Assign agent to thread using smart routing
export async function assignAgentToThread(threadId: string): Promise<{
    status: 'assigned' | 'no_agents';
    message: string;
    agent?: any;
}> {
    try {
        // Get online agents ordered by least handled chats
        const { data: onlineAgents, error } = await supabaseAdmin
            .from('agents')
            .select('*')
            .eq('is_online', true)
            .order('handled_chats_count', { ascending: true });

        if (error) throw error;

        if (!onlineAgents || onlineAgents.length === 0) {
            // No agents online - send auto-reply
            await supabaseAdmin
                .from('messages')
                .insert({
                    thread_id: threadId,
                    sender_type: 'system',
                    content: 'আমরা শীঘ্রই আপনার সাথে যোগাযোগ করব। দয়া করে অপেক্ষা করুন। (We will respond soon. Please wait.)'
                });

            return {
                status: 'no_agents',
                message: 'No agents currently online. We will respond soon.'
            };
        }

        // Select the agent with lowest handled_chats_count (load balancing)
        const selectedAgent = onlineAgents[0];

        // Assign agent to thread
        await supabaseAdmin
            .from('chat_threads')
            .update({ assigned_agent_id: selectedAgent.id })
            .eq('id', threadId);

        // Increment agent's handled chats count
        await supabaseAdmin
            .from('agents')
            .update({ handled_chats_count: selectedAgent.handled_chats_count + 1 })
            .eq('id', selectedAgent.id);

        // Emit to WebSocket
        const { app } = await import('../index.js');
        const io = app.get('io');
        if (io) {
            io.to(`thread:${threadId}`).emit('agent:assigned', {
                agent: {
                    name: selectedAgent.name,
                    id: selectedAgent.id
                }
            });
        }

        return {
            status: 'assigned',
            message: 'Agent assigned',
            agent: selectedAgent
        };
    } catch (error) {
        console.error('Error assigning agent:', error);
        return {
            status: 'no_agents',
            message: 'Failed to assign agent'
        };
    }
}

// Send message to agent's Telegram
export async function sendToTelegram(
    thread: { id: string; user_id: string; category_id: string; assigned_agent_id: string | null },
    message: { content: string | null; media_url: string | null; media_type: string | null }
): Promise<boolean> {
    if (!bot || !thread.assigned_agent_id) {
        return false;
    }

    try {
        // Get agent's Telegram ID
        const { data: agent } = await supabaseAdmin
            .from('agents')
            .select('telegram_user_id')
            .eq('id', thread.assigned_agent_id)
            .single();

        if (!agent) return false;

        // Get user and category info
        const [{ data: user }, { data: category }] = await Promise.all([
            supabaseAdmin.from('users').select('username, full_name, email').eq('id', thread.user_id).single(),
            supabaseAdmin.from('categories').select('title').eq('id', thread.category_id).single()
        ]);

        // Format message for Telegram
        const messageText = formatTelegramMessage(user, category, thread.id, message.content);

        const telegramUserId = agent.telegram_user_id;

        if (message.media_url && message.media_type) {
            // Send media message
            // Caption is just the formatted message
            const caption = messageText;

            if (message.media_type === 'image') {
                await bot.sendPhoto(telegramUserId, message.media_url, { caption });
            } else if (message.media_type === 'video') {
                await bot.sendVideo(telegramUserId, message.media_url, { caption });
            } else {
                await bot.sendDocument(telegramUserId, message.media_url, { caption });
            }
        } else if (message.content) {
            // Send text message
            await bot.sendMessage(telegramUserId, messageText, {
                reply_markup: {
                    inline_keyboard: [[
                        { text: '↩️ Reply', callback_data: `reply:${thread.id}` }
                    ]]
                }
            });
        }

        return true;
    } catch (error) {
        console.error('Error sending to Telegram:', error);
        return false;
    }
}

// Process incoming Telegram message (from agent)
export async function processTelegramMessage(
    telegramUserId: number,
    text: string | undefined,
    photo: TelegramBot.PhotoSize[] | undefined,
    video: TelegramBot.Video | undefined,
    voice: TelegramBot.Voice | undefined,
    replyText?: string
): Promise<{ success: boolean; threadId?: string }> {
    try {
        // Find agent by Telegram ID
        const { data: agent } = await supabaseAdmin
            .from('agents')
            .select('id, name, handled_chats_count')
            .eq('telegram_user_id', telegramUserId)
            .single();

        if (!agent) {
            return { success: false };
        }

        // Handle /close command
        if (text?.trim().toLowerCase() === '/close') {
            // Find open thread for this agent
            const { data: thread } = await supabaseAdmin
                .from('chat_threads')
                .select('id')
                .eq('assigned_agent_id', agent.id)
                .eq('status', 'open')
                .order('updated_at', { ascending: false })
                .limit(1)
                .single();

            if (thread) {
                // Call close logic (reuse logic if possible, or just update DB)
                // For now, duplicate DB update for speed
                await supabaseAdmin
                    .from('chat_threads')
                    .update({ status: 'closed', updated_at: new Date().toISOString() })
                    .eq('id', thread.id);

                await supabaseAdmin
                    .from('agents')
                    .update({ handled_chats_count: agent.handled_chats_count - 1 })
                    .eq('id', agent.id);

                // Emit event
                const { app } = await import('../index.js');
                const io = app.get('io');
                if (io) {
                    io.to(`thread:${thread.id}`).emit('chat:closed', { message: 'Agent closed the chat' });
                }

                if (bot) {
                    await bot.sendMessage(telegramUserId, '✅ Chat closed.');
                }
                return { success: true, threadId: thread.id };
            } else {
                if (bot) {
                    await bot.sendMessage(telegramUserId, '⚠️ No active chat to close.');
                }
                return { success: false };
            }
        }

        // Find the most recent open thread assigned to this agent
        // In a real implementation, you'd parse the thread ID from the reply or use callback_data
        let threadId: string | undefined;

        // Try to extract thread ID from the message text (format: #thread_id)
        let threadMatch = text?.match(/#([a-f0-9-]+)/i);
        console.log(`[DEBUG] Telegram Text: "${text}" | Reply Text: "${replyText}"`);

        if (threadMatch) {
            threadId = threadMatch[1];
            console.log(`[DEBUG] Found Thread ID in text: ${threadId}`);
        }

        // If not found in text, check reply text (replying to bot message)
        if (!threadId && replyText) {
            threadMatch = replyText.match(/#([a-f0-9-]+)/i);
            if (threadMatch) {
                threadId = threadMatch[1];
                console.log(`[DEBUG] Found Thread ID in reply text: ${threadId}`);
            }
        }

        if (threadId && threadId.length < 36) {
            console.log(`[DEBUG] Partial ID found: ${threadId}. Looking up full UUID...`);
            // Partial ID, need to find full UUID
            const { data: thread } = await supabaseAdmin
                .from('chat_threads')
                .select('id')
                .like('id', `${threadId}%`)
                .limit(1)
                .single();
            if (thread) {
                threadId = thread.id;
                console.log(`[DEBUG] Full UUID found: ${threadId}`);
            } else {
                console.log(`[DEBUG] No thread found for partial ID: ${threadId}`);
            }
        }

        if (!threadId) {
            // Get most recent open thread for this agent
            const { data: thread } = await supabaseAdmin
                .from('chat_threads')
                .select('id')
                .eq('assigned_agent_id', agent.id)
                .eq('status', 'open')
                .order('updated_at', { ascending: false })
                .limit(1)
                .single();

            threadId = thread?.id;
        }

        if (!threadId) {
            return { success: false };
        }

        // Emit Agent Assignment Event to ensure UI updates
        const { app } = await import('../index.js');
        const io = app.get('io');
        if (io) {
            io.to(`thread:${threadId}`).emit('agent:assigned', {
                agent: {
                    name: agent.name,
                    id: agent.id
                }
            });
        }

        // Handle different message types
        let content = text;
        let mediaUrl: string | null = null;
        let mediaType: string | null = null;

        if (photo && photo.length > 0 && bot) {
            // Get the largest photo
            const largestPhoto = photo[photo.length - 1];
            const file = await bot.getFile(largestPhoto.file_id);
            mediaUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
            mediaType = 'image';
        } else if (video && bot) {
            const file = await bot.getFile(video.file_id);
            mediaUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
            mediaType = 'video';
        } else if (voice && bot) {
            const file = await bot.getFile(voice.file_id);
            mediaUrl = `https://api.telegram.org/file/bot${config.telegramBotToken}/${file.file_path}`;
            mediaType = 'voice';
        }

        // Save message to database
        await supabaseAdmin
            .from('messages')
            .insert({
                thread_id: threadId,
                sender_type: 'agent',
                sender_id: agent.id,
                content,
                media_url: mediaUrl,
                media_type: mediaType
            });

        // Log activity
        await supabaseAdmin
            .from('agent_activity_log')
            .insert({
                agent_id: agent.id,
                event_type: 'message_handled'
            });

        return { success: true, threadId };
    } catch (error) {
        console.error('Error processing Telegram message:', error);
        return { success: false };
    }
}

// Helper to format Telegram message
export function formatTelegramMessage(
    user: any,
    category: any,
    threadId: string,
    content: string | null
): string {
    const from = user?.full_name || user?.username || 'Unknown';
    const catTitle = category?.title || 'Unknown';
    const shortId = threadId.slice(0, 8);

    const header = `📩 New Message
━━━━━━━━━━━━━━━
👤 From: ${from}
📂 Category: ${catTitle}
🔗 Thread: #${shortId}
━━━━━━━━━━━━━━━`;

    if (content) {
        return `${header}\n\n${content}`;
    }
    return header;
}

// Initialize bot on module load
initializeTelegramBot();
