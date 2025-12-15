
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load env vars
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase credentials in .env');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const resetPassword = async () => {
    try {
        const email = 'admin@local.com'; // We need to find the email first, or just update the first user found.
        const newPassword = 'password123';
        const password_hash = await bcrypt.hash(newPassword, 12);

        // First, get the admin user to know the email if we don't know it
        const { data: users, error: fetchError } = await supabase
            .from('admin_users')
            .select('email')
            .limit(1);

        if (fetchError || !users || users.length === 0) {
            console.log('No admin user found to reset.');
            // Fallback to register if none found (race condition with previous check?)
            return;
        }

        const targetEmail = users[0].email;
        console.log(`Resetting password for: ${targetEmail}`);

        const { error: updateError } = await supabase
            .from('admin_users')
            .update({ password_hash })
            .eq('email', targetEmail);

        if (updateError) {
            console.error('Failed to update password:', updateError);
        } else {
            console.log('SUCCESS: Password reset successfully.');
            console.log(`Email: ${targetEmail}`);
            console.log(`New Password: ${newPassword}`);
        }

    } catch (error) {
        console.error('Script error:', error);
    }
};

resetPassword();
