import { supabaseAdmin } from '../config/supabase.js';

const router = Router();

/**
 * Smart Agent Routing Service
 * 
 * Handles load-balanced distribution of chats to online agents
 */

// Get available online agents (sorted by workload)
export async function getAvailableAgents() {
    const { data: agents, error } = await supabaseAdmin
        .from('agents')
        .select('*')
        .eq('is_online', true)
        .order('handled_chats_count', { ascending: true });

    if (error) {
        console.error('Error fetching available agents:', error);
        return [];
    }

    return agents || [];
}

// Find the best agent for a new chat
export async function findBestAgent(): Promise<any | null> {
    const agents = await getAvailableAgents();

    if (agents.length === 0) {
        return null;
    }

    // Return agent with least workload
    return agents[0];
}

// Reassign chat if agent doesn't respond
export async function reassignChat(threadId: string, currentAgentId: string): Promise<boolean> {
    try {
        const agents = await getAvailableAgents();

        // Filter out current agent
        const otherAgents = agents.filter(a => a.id !== currentAgentId);

        if (otherAgents.length === 0) {
            return false;
        }

        // Assign to next available agent
        const newAgent = otherAgents[0];

        await supabaseAdmin
            .from('chat_threads')
            .update({ assigned_agent_id: newAgent.id })
            .eq('id', threadId);

        return true;
    } catch (error) {
        console.error('Error reassigning chat:', error);
        return false;
    }
}

// Get agent workload statistics
export async function getAgentWorkloadStats() {
    const { data: agents, error } = await supabaseAdmin
        .from('agents')
        .select(`
      id, name, is_online, handled_chats_count,
      chat_threads!assigned_agent_id(id, status)
    `);

    if (error) {
        console.error('Error fetching agent workload:', error);
        return [];
    }

    return agents?.map(agent => ({
        id: agent.id,
        name: agent.name,
        is_online: agent.is_online,
        total_handled: agent.handled_chats_count,
        active_chats: (agent.chat_threads as any[])?.filter((t: any) => t.status === 'open').length || 0
    })) || [];
}

import { Router } from 'express';

export default router;
