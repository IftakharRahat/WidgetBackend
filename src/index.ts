import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import dotenv from 'dotenv';

import { config } from './config/index.js';
import { initializeSocket } from './services/socket.js';

// Import routes
import categoriesRouter from './routes/categories.js';
import agentsRouter from './routes/agents.js';
import chatRouter from './routes/chat.js';
import uploadRouter from './routes/upload.js';
import adminRouter from './routes/admin.js';
import webhookRouter from './routes/webhook.js';

dotenv.config();

const app = express();
const httpServer = createServer(app);

// Helper to check allowed origins
const isOriginAllowed = (origin: string | undefined, allowedOrigins: string[]): boolean => {
    if (!origin) return true; // Allow requests with no origin
    if (origin.startsWith('http://localhost:')) return true; // Allow any localhost origin
    return allowedOrigins.indexOf(origin) !== -1;
};

// Initialize Socket.IO
const io = new SocketIOServer(httpServer, {
    cors: {
        origin: (origin, callback) => {
            if (isOriginAllowed(origin, config.allowedOrigins)) {
                callback(null, true);
            } else {
                callback(new Error('Not allowed by CORS'));
            }
        },
        methods: ['GET', 'POST'],
        credentials: true
    }
});

// Make io available to routes
app.set('io', io);

// Initialize socket handlers
initializeSocket(io);

// Middleware
app.use(helmet());
app.use(cors({
    origin: (origin, callback) => {
        if (isOriginAllowed(origin, config.allowedOrigins)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/v1/categories', categoriesRouter);
app.use('/api/v1/agents', agentsRouter);
app.use('/api/v1/chat', chatRouter);
app.use('/api/v1/upload', uploadRouter);
app.use('/api/v1/admin', adminRouter);
app.use('/api/v1/webhook', webhookRouter);

// Error handling middleware
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Error:', err);
    res.status(500).json({
        error: 'Internal Server Error',
        message: config.nodeEnv === 'development' ? err.message : undefined
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Not Found' });
});

// Initialize scheduled jobs
import { scheduleCleanup } from './jobs/cleanup.js';
// scheduleCleanup(); // Disabled as per user request (keep chat history forever)

// Start server
const PORT = config.port;
httpServer.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(`📡 WebSocket ready`);
    console.log(`🌍 Environment: ${config.nodeEnv}`);
});

export { app, io };
