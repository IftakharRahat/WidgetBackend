/**
 * Message Cleanup Job
 * Runs daily to delete messages older than 25 days
 * while preserving analytics data
 */

import { supabaseAdmin } from '../config/supabase.js';
import { config } from '../config/index.js';

export async function runCleanupJob() {
    console.log('🧹 Starting message cleanup job...');

    const retentionDays = config.messageRetentionDays || 25;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    try {
        // 1. Find messages older than retention period
        const { data: oldMessages, error: fetchError } = await supabaseAdmin
            .from('messages')
            .select('id, thread_id, media_url, created_at')
            .lt('created_at', cutoffDate.toISOString());

        if (fetchError) {
            console.error('Error fetching old messages:', fetchError);
            return { success: false, error: fetchError };
        }

        if (!oldMessages || oldMessages.length === 0) {
            console.log('✅ No messages to clean up');
            return { success: true, deleted: 0 };
        }

        console.log(`Found ${oldMessages.length} messages to delete`);

        // 2. Delete media files from storage
        const mediaUrls = oldMessages
            .filter(m => m.media_url)
            .map(m => {
                // Extract file path from URL
                const url = new URL(m.media_url);
                return url.pathname.split('/').slice(-2).join('/');
            });

        if (mediaUrls.length > 0) {
            console.log(`Deleting ${mediaUrls.length} media files...`);

            const { error: storageError } = await supabaseAdmin.storage
                .from('chat-media')
                .remove(mediaUrls);

            if (storageError) {
                console.error('Error deleting media:', storageError);
                // Continue with message deletion anyway
            }
        }

        // 3. Delete message records
        const messageIds = oldMessages.map(m => m.id);
        const { error: deleteError } = await supabaseAdmin
            .from('messages')
            .delete()
            .in('id', messageIds);

        if (deleteError) {
            console.error('Error deleting messages:', deleteError);
            return { success: false, error: deleteError };
        }

        // 4. Close old threads with no recent activity
        const { error: threadError } = await supabaseAdmin
            .from('chat_threads')
            .update({ status: 'closed' })
            .lt('updated_at', cutoffDate.toISOString())
            .eq('status', 'open');

        if (threadError) {
            console.error('Error closing old threads:', threadError);
        }

        console.log(`✅ Cleanup complete: deleted ${oldMessages.length} messages`);

        return {
            success: true,
            deleted: oldMessages.length,
            mediaDeleted: mediaUrls.length
        };
    } catch (error) {
        console.error('Cleanup job failed:', error);
        return { success: false, error };
    }
}

// Run cleanup on schedule (call this from a cron job or scheduler)
export async function scheduleCleanup() {
    // Run every 24 hours
    const CLEANUP_INTERVAL = 24 * 60 * 60 * 1000;

    // Initial run
    await runCleanupJob();

    // Schedule recurring runs
    setInterval(async () => {
        await runCleanupJob();
    }, CLEANUP_INTERVAL);

    console.log('📅 Cleanup job scheduled to run every 24 hours');
}
