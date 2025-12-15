import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { supabaseAdmin } from '../config/supabase.js';
import { authMiddleware, generateToken, AuthRequest } from '../middleware/auth.js';

const router = Router();

// POST /api/v1/admin/login - Admin login
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const { data: admin, error } = await supabaseAdmin
            .from('admin_users')
            .select('id, email, password_hash, name')
            .eq('email', email)
            .single();

        if (error || !admin) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const isValidPassword = await bcrypt.compare(password, admin.password_hash);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = generateToken({
            id: admin.id,
            email: admin.email,
            role: 'admin'
        });

        res.json({
            token,
            user: {
                id: admin.id,
                email: admin.email,
                name: admin.name
            }
        });
    } catch (error) {
        console.error('Error logging in:', error);
        res.status(500).json({ error: 'Failed to login' });
    }
});

// POST /api/v1/admin/register - Create first admin (should be disabled in production)
router.post('/register', async (req, res) => {
    try {
        const { email, password, name } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        // Check if any admin exists
        const { count } = await supabaseAdmin
            .from('admin_users')
            .select('id', { count: 'exact', head: true });

        if (count && count > 0) {
            return res.status(403).json({ error: 'Admin registration is disabled' });
        }

        const password_hash = await bcrypt.hash(password, 12);

        const { data: admin, error } = await supabaseAdmin
            .from('admin_users')
            .insert({ email, password_hash, name })
            .select('id, email, name')
            .single();

        if (error) throw error;

        const token = generateToken({
            id: admin.id,
            email: admin.email,
            role: 'admin'
        });

        res.status(201).json({
            token,
            user: admin
        });
    } catch (error) {
        console.error('Error registering admin:', error);
        res.status(500).json({ error: 'Failed to register admin' });
    }
});

// Protected routes below
router.use(authMiddleware);

// GET /api/v1/admin/stats - Dashboard statistics
router.get('/stats', async (req: AuthRequest, res) => {
    try {
        // Get counts
        const [
            { count: totalThreads },
            { count: openThreads },
            { count: totalAgents },
            { data: onlineAgents }
        ] = await Promise.all([
            supabaseAdmin.from('chat_threads').select('id', { count: 'exact', head: true }),
            supabaseAdmin.from('chat_threads').select('id', { count: 'exact', head: true }).eq('status', 'open'),
            supabaseAdmin.from('agents').select('id', { count: 'exact', head: true }),
            supabaseAdmin.from('agents').select('id').eq('is_online', true)
        ]);

        // Get category stats
        const { data: categoryStats } = await supabaseAdmin
            .from('analytics')
            .select('category_id, contact_count, categories(title)')
            .order('contact_count', { ascending: false });

        // Get recent activity
        const { data: recentThreads } = await supabaseAdmin
            .from('chat_threads')
            .select(`
        id, status, created_at,
        users(username),
        categories(title)
      `)
            .order('created_at', { ascending: false })
            .limit(10);

        res.json({
            overview: {
                total_threads: totalThreads || 0,
                open_threads: openThreads || 0,
                total_agents: totalAgents || 0,
                online_agents: onlineAgents?.length || 0
            },
            category_stats: categoryStats || [],
            recent_activity: recentThreads || []
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// Category management (admin)
router.get('/categories', async (req: AuthRequest, res) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('categories')
            .select('*')
            .order('sort_order', { ascending: true });

        if (error) throw error;

        res.json({ categories: data });
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({ error: 'Failed to fetch categories' });
    }
});

router.post('/categories', async (req: AuthRequest, res) => {
    try {
        const { title, description, auto_answer, sort_order } = req.body;

        if (!title) {
            return res.status(400).json({ error: 'Title is required' });
        }

        const { data, error } = await supabaseAdmin
            .from('categories')
            .insert({
                title,
                description,
                auto_answer,
                sort_order: sort_order || 0,
                is_active: true
            })
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({ category: data });
    } catch (error) {
        console.error('Error creating category:', error);
        res.status(500).json({ error: 'Failed to create category' });
    }
});

router.put('/categories/:id', async (req: AuthRequest, res) => {
    try {
        const { id } = req.params;
        const { title, description, auto_answer, sort_order, is_active } = req.body;

        const { data, error } = await supabaseAdmin
            .from('categories')
            .update({ title, description, auto_answer, sort_order, is_active })
            .eq('id', id)
            .select()
            .single();

        if (error) throw error;

        res.json({ category: data });
    } catch (error) {
        console.error('Error updating category:', error);
        res.status(500).json({ error: 'Failed to update category' });
    }
});

router.delete('/categories/:id', async (req: AuthRequest, res) => {
    try {
        const { id } = req.params;

        const { error } = await supabaseAdmin
            .from('categories')
            .delete()
            .eq('id', id);

        if (error) throw error;

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting category:', error);
        res.status(500).json({ error: 'Failed to delete category' });
    }
});

// Customer history
router.get('/customers', async (req: AuthRequest, res) => {
    try {
        const { data, error } = await supabaseAdmin
            .from('users')
            .select(`
        id, username, site_origin, created_at, last_seen_at,
        analytics(category_id, contact_count, last_contacted_at, categories(title))
      `)
            .order('last_seen_at', { ascending: false })
            .limit(50);

        if (error) throw error;

        res.json({ customers: data });
    } catch (error) {
        console.error('Error fetching customers:', error);
        res.status(500).json({ error: 'Failed to fetch customers' });
    }
});

router.get('/customers/:id', async (req: AuthRequest, res) => {
    try {
        const { id } = req.params;

        const { data: customer, error: customerError } = await supabaseAdmin
            .from('users')
            .select(`
        *,
        analytics(category_id, contact_count, last_contacted_at, categories(title))
      `)
            .eq('id', id)
            .single();

        if (customerError) throw customerError;

        const { data: threads, error: threadsError } = await supabaseAdmin
            .from('chat_threads')
            .select(`
        id, status, created_at, updated_at,
        categories(title),
        agents(name)
      `)
            .eq('user_id', id)
            .order('created_at', { ascending: false });

        if (threadsError) throw threadsError;

        res.json({ customer, threads });
    } catch (error) {
        console.error('Error fetching customer:', error);
        res.status(500).json({ error: 'Failed to fetch customer' });
    }
});

export default router;
