import { findBestAgent } from './routing.js';
import { supabaseAdmin } from '../config/supabase.js';

// Mock Supabase client
jest.mock('../config/supabase.js');

describe('Routing Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('findBestAgent', () => {
        it('should return the agent with the lowest workload', async () => {
            // Mock agents sorted by workload (handled_chats_count ASC)
            const mockAgents = [
                { id: 'agent-2', name: 'Agent B', is_online: true, handled_chats_count: 5 },
                { id: 'agent-1', name: 'Agent A', is_online: true, handled_chats_count: 10 },
            ];

            // Mock the Supabase query chain: .from().select().eq().order()
            (supabaseAdmin.from as jest.Mock).mockReturnValue({
                select: jest.fn().mockReturnValue({
                    eq: jest.fn().mockReturnValue({
                        order: jest.fn().mockResolvedValue({
                            data: mockAgents,
                            error: null
                        })
                    })
                })
            });

            const agent = await findBestAgent();

            expect(agent).toBeDefined();
            expect(agent.id).toBe('agent-2');
            expect(supabaseAdmin.from).toHaveBeenCalledWith('agents');
        });

        it('should return null if no agents are online', async () => {
            (supabaseAdmin.from as jest.Mock).mockReturnValue({
                select: jest.fn().mockReturnValue({
                    eq: jest.fn().mockReturnValue({
                        order: jest.fn().mockResolvedValue({
                            data: [],
                            error: null
                        })
                    })
                })
            });

            const agent = await findBestAgent();
            expect(agent).toBeNull();
        });
    });
});

