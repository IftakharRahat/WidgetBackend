import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

interface AuthenticatedSocket extends Socket {
    userId?: string;
    threadId?: string;
}

export function initializeSocket(io: SocketIOServer) {
    // Middleware for authentication
    io.use((socket: AuthenticatedSocket, next) => {
        const token = socket.handshake.auth.token;

        if (!token) {
            // Allow unauthenticated connections for widget (they'll authenticate later)
            return next();
        }

        try {
            const decoded = jwt.verify(token, config.jwtSecret) as { id: string; threadId?: string };
            socket.userId = decoded.id;
            socket.threadId = decoded.threadId;
            next();
        } catch (err) {
            next(new Error('Authentication error'));
        }
    });

    io.on('connection', (socket: AuthenticatedSocket) => {
        console.log(`🔌 Client connected: ${socket.id}`);

        // Join a chat thread room
        socket.on('join:thread', (threadId: string) => {
            socket.join(`thread:${threadId}`);
            socket.threadId = threadId;
            console.log(`📢 Socket ${socket.id} joined thread:${threadId}`);
        });

        // Leave a chat thread room
        socket.on('leave:thread', (threadId: string) => {
            socket.leave(`thread:${threadId}`);
            console.log(`📤 Socket ${socket.id} left thread:${threadId}`);
        });

        // Typing indicator
        socket.on('typing:start', (threadId: string) => {
            socket.to(`thread:${threadId}`).emit('typing:start', {
                threadId,
                userId: socket.userId
            });
        });

        socket.on('typing:stop', (threadId: string) => {
            socket.to(`thread:${threadId}`).emit('typing:stop', {
                threadId,
                userId: socket.userId
            });
        });

        // Disconnect
        socket.on('disconnect', () => {
            console.log(`❌ Client disconnected: ${socket.id}`);
        });
    });

    return io;
}

// Helper function to emit message to a thread
export function emitToThread(io: SocketIOServer, threadId: string, event: string, data: any) {
    io.to(`thread:${threadId}`).emit(event, data);
}
