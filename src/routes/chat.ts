import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { supabaseAdmin } from '../config/supabase.js';
import { emitToThread } from '../services/socket.js';
import { generateChatToken, verifyChatToken } from '../middleware/auth.js';
import { assignAgentToThread, sendToTelegram } from '../services/telegram.js';
import { Server as SocketIOServer } from 'socket.io';

const router = Router();

// POST /api/v1/chat/start - Start a new chat thread
router.post('/start', async (req, res) => {
    try {
        console.log('[DEBUG] /chat/start body:', JSON.stringify(req.body, null, 2));
        const { username, site_origin, category_id, device_hash, user: userData } = req.body;

        if (!category_id) {
            return res.status(400).json({ error: 'category_id is required' });
        }

        // Determine user identity
        let user;
        const externalId = userData?.id || userData?.external_id;

        if (externalId) {
            // Real user integration
            let { data: existingUser } = await supabaseAdmin
                .from('users')
                .select('*')
                .eq('external_id', externalId)
                .eq('site_origin', site_origin || '')
                .single();

            if (existingUser) {
                // Update existing user info
                const { data: updatedUser, error: updateError } = await supabaseAdmin
                    .from('users')
                    .update({
                        full_name: userData.name || userData.full_name,
                        email: userData.email,
                        metadata: userData.metadata,
                        device_hash: device_hash || '',
                        last_seen_at: new Date().toISOString(),
                        username: username || existingUser.username // Update username if provided
                    })
                    .eq('id', existingUser.id)
                    .select('*')
                    .single();

                if (updateError) throw updateError;
                user = updatedUser;
            } else {
                // Create new real user
                const { data: newUser, error: createError } = await supabaseAdmin
                    .from('users')
                    .insert({
                        username: username || userData.name || 'Customer',
                        site_origin: site_origin || '',
                        device_hash: device_hash || '',
                        external_id: externalId,
                        full_name: userData.name || userData.full_name,
                        email: userData.email,
                        metadata: userData.metadata
                    })
                    .select('*')
                    .single();

                if (createError) throw createError;
                user = newUser;
            }
        } else {
            // Guest/Dummy flow (Fallback)
            if (!username) {
                return res.status(400).json({ error: 'username is required for guest users' });
            }

            let { data: existingUser } = await supabaseAdmin
                .from('users')
                .select('*')
                .eq('username', username)
                .eq('site_origin', site_origin || '')
                .is('external_id', null) // Ensure we don't pick up a real user by accident
                .single();

            if (existingUser) {
                user = existingUser;
            } else {
                const { data: newUser, error: createError } = await supabaseAdmin
                    .from('users')
                    .insert({
                        username,
                        site_origin: site_origin || '',
                        device_hash: device_hash || ''
                    })
                    .select('*')
                    .single();

                if (createError) throw createError;
                user = newUser;
            }
        }

        // Check for existing open thread
        let thread;
        const { data: existingThread } = await supabaseAdmin
            .from('chat_threads')
            .select('id, category_id')
            .eq('user_id', user!.id)
            .eq('category_id', category_id) // Isolate threads by category
            .eq('status', 'open')
            .order('created_at', { ascending: false })
            .limit(1)
            .single();

        if (existingThread) {
            thread = existingThread;
        } else {
            // Create new chat thread
            const { data: newThread, error: threadError } = await supabaseAdmin
                .from('chat_threads')
                .insert({
                    user_id: user!.id,
                    category_id,
                    channel: 'website',
                    status: 'open'
                })
                .select('id')
                .single();

            if (threadError) throw threadError;
            thread = newThread;
        }

        // Update/create analytics
        const { data: existingAnalytics } = await supabaseAdmin
            .from('analytics')
            .select('id, contact_count')
            .eq('user_id', user!.id)
            .eq('category_id', category_id)
            .single();

        if (existingAnalytics) {
            await supabaseAdmin
                .from('analytics')
                .update({
                    contact_count: existingAnalytics.contact_count + 1,
                    last_contacted_at: new Date().toISOString()
                })
                .eq('id', existingAnalytics.id);
        } else {
            await supabaseAdmin
                .from('analytics')
                .insert({
                    user_id: user!.id,
                    category_id,
                    contact_count: 1
                });
        }

        // Assign an agent to the thread
        const agentAssignment = await assignAgentToThread(thread!.id);

        // Generate chat token for WebSocket authentication
        const wsToken = generateChatToken({
            id: user!.id,
            threadId: thread!.id,
            username: user!.username || 'Customer'
        });

        res.status(201).json({
            thread_id: thread!.id,
            ws_token: wsToken,
            agent_status: agentAssignment.status,
            message: agentAssignment.message
        });
    } catch (error) {
        console.error('Error starting chat:', error);
        res.status(500).json({ error: 'Failed to start chat' });
    }
});

// POST /api/v1/chat/:threadId/message - Send a message
router.post('/:threadId/message', async (req, res) => {
    try {
        const { threadId } = req.params;
        const { content, media_url, media_type, sender_type = 'customer', sender_id } = req.body;

        if (!content && !media_url) {
            return res.status(400).json({ error: 'content or media_url is required' });
        }

        // Verify thread exists
        const { data: thread, error: threadError } = await supabaseAdmin
            .from('chat_threads')
            .select('id, user_id, category_id, assigned_agent_id')
            .eq('id', threadId)
            .single();

        if (threadError || !thread) {
            return res.status(404).json({ error: 'Thread not found' });
        }

        // Create message
        const { data: message, error: messageError } = await supabaseAdmin
            .from('messages')
            .insert({
                thread_id: threadId,
                sender_type,
                sender_id: sender_id || thread.user_id,
                content,
                media_url,
                media_type
            })
            .select('*')
            .single();

        if (messageError) throw messageError;

        // Update thread timestamp
        await supabaseAdmin
            .from('chat_threads')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', threadId);

        // Get io instance and emit to thread
        const io: SocketIOServer = req.app.get('io');
        emitToThread(io, threadId, 'message:new', message);

        // If customer message, forward to Telegram
        if (sender_type === 'customer' && thread.assigned_agent_id) {
            await sendToTelegram(thread, message);
        }

        res.status(201).json({ message });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'Failed to send message' });
    }
});

// GET /api/v1/chat/:threadId/messages - Get messages for a thread
router.get('/:threadId/messages', async (req, res) => {
    try {
        const { threadId } = req.params;

        // Authorization check: verify chat token
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Authorization required' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = verifyChatToken(token);

        if (!decoded || decoded.threadId !== threadId) {
            return res.status(403).json({ error: 'Access denied to this thread' });
        }

        const limit = parseInt(req.query.limit as string) || 50;
        const offset = parseInt(req.query.offset as string) || 0;

        const { data: messages, error } = await supabaseAdmin
            .from('messages')
            .select('*')
            .eq('thread_id', threadId)
            .order('created_at', { ascending: true })
            .range(offset, offset + limit - 1);

        if (error) throw error;

        res.json({ messages });
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

// GET /api/v1/chat/:threadId - Get thread details
router.get('/:threadId', async (req, res) => {
    try {
        const { threadId } = req.params;

        const { data: thread, error } = await supabaseAdmin
            .from('chat_threads')
            .select(`
        *,
        users (id, username),
        categories (id, title),
        agents (id, name)
      `)
            .eq('id', threadId)
            .single();

        if (error) throw error;
        if (!thread) {
            return res.status(404).json({ error: 'Thread not found' });
        }

        res.json({ thread });
    } catch (error) {
        console.error('Error fetching thread:', error);
        res.status(500).json({ error: 'Failed to fetch thread' });
    }
});

// POST /api/v1/chat/:threadId/close - Close a chat thread
router.post('/:threadId/close', async (req, res) => {
    try {
        const { threadId } = req.params;

        // Update thread status
        const { data: thread, error } = await supabaseAdmin
            .from('chat_threads')
            .update({ status: 'closed', updated_at: new Date().toISOString() })
            .eq('id', threadId)
            .select('assigned_agent_id')
            .single();

        if (error) throw error;

        // Emit to Liquid
        const io: SocketIOServer = req.app.get('io');
        emitToThread(io, threadId, 'chat:closed', { message: 'Chat closed' });

        // Decrease agent's handled count if assigned
        if (thread?.assigned_agent_id) {
            // We should ideally use a stored procedure or transaction for accuracy
            // But strict accuracy isn't critical here
            const { data: agent } = await supabaseAdmin
                .from('agents')
                .select('handled_chats_count')
                .eq('id', thread.assigned_agent_id)
                .single();

            if (agent && agent.handled_chats_count > 0) {
                await supabaseAdmin
                    .from('agents')
                    .update({ handled_chats_count: agent.handled_chats_count - 1 })
                    .eq('id', thread.assigned_agent_id);
            }
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error closing calling:', error);
        res.status(500).json({ error: 'Failed to close chat' });
    }
});

export default router;
