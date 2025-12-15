import { formatTelegramMessage } from './telegram.js';

describe('Telegram Service', () => {
    describe('formatTelegramMessage', () => {
        it('should format message with user and category info', () => {
            const user = { full_name: 'John Doe' };
            const category = { title: 'Support' };
            const threadId = '12345678-abcd-efgh';
            const content = 'Hello world';

            const output = formatTelegramMessage(user, category, threadId, content);

            expect(output).toContain('👤 From: John Doe');
            expect(output).toContain('📂 Category: Support');
            expect(output).toContain('🔗 Thread: #12345678');
            expect(output).toContain('Hello world');
        });

        it('should handle missing user and category', () => {
            const output = formatTelegramMessage(null, null, '12345678', 'Test');
            expect(output).toContain('👤 From: Unknown');
            expect(output).toContain('📂 Category: Unknown');
        });

        it('should handle null content', () => {
            const output = formatTelegramMessage({ username: 'user1' }, { title: 'Cat1' }, '123', null);
            expect(output).toContain('👤 From: user1');
            expect(output).not.toContain('null');
        });
    });
});
