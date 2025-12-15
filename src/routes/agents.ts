import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

// All agent routes require admin authentication
router.use(authMiddleware);

// GET /api/v1/agents - List all agents
router.get('/', async (req, res) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('agents')
            .select('id, telegram_user_id, name, email, is_online, handled_chats_count, avg_response_time_ms, created_at')
            .order('created_at', { ascending: false });

        if (error) throw error;

        res.json({ agents: data });
    } catch (error) {
        console.error('Error fetching agents:', error);
        res.status(500).json({ error: 'Failed to fetch agents' });
    }
});

// POST /api/v1/agents - Create new agent
router.post('/', async (req, res) => {
    try {
        const { telegram_user_id, name, email } = req.body;

        if (!telegram_user_id || !name) {
            return res.status(400).json({ error: 'telegram_user_id and name are required' });
        }

        const { data, error } = await supabaseAdmin
            .from('agents')
            .insert({
                telegram_user_id,
                name,
                email,
                is_online: false
            })
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({ agent: data });
    } catch (error) {
        console.error('Error creating agent:', error);
        res.status(500).json({ error: 'Failed to create agent' });
    }
});

// PUT /api/v1/agents/:id - Update agent
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, email, telegram_user_id } = req.body;

        const { data, error } = await supabaseAdmin
            .from('agents')
            .update({ name, email, telegram_user_id })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        res.json({ agent: data });
    } catch (error) {
        console.error('Error updating agent:', error);
        res.status(500).json({ error: 'Failed to update agent' });
    }
});

// POST /api/v1/agents/:id/toggle - Toggle agent online/offline status
router.post('/:id/toggle', async (req, res) => {
    try {
        const { id } = req.params;

        // Get current status
        const { data: agent, error: fetchError } = await supabaseAdmin
            .from('agents')
            .select('is_online')
            .eq('id', id)
            .single();

        if (fetchError) throw fetchError;
        if (!agent) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        // Toggle status
        const newStatus = !agent.is_online;
        const { data, error } = await supabaseAdmin
            .from('agents')
            .update({ is_online: newStatus })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        // Log activity
        await supabaseAdmin.from('agent_activity_log').insert({
            agent_id: id,
            event_type: newStatus ? 'online' : 'offline'
        });

        res.json({ agent: data });
    } catch (error) {
        console.error('Error toggling agent status:', error);
        res.status(500).json({ error: 'Failed to toggle agent status' });
    }
});

// DELETE /api/v1/agents/:id - Delete agent
router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const { error } = await supabaseAdmin
            .from('agents')
            .delete()
            .eq('id', id);

        if (error) throw error;

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting agent:', error);
        res.status(500).json({ error: 'Failed to delete agent' });
    }
});

export default router;
