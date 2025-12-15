import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

export interface AuthRequest extends Request {
    user?: {
        id: string;
        email: string;
        role: 'admin' | 'agent';
    };
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, config.jwtSecret) as {
            id: string;
            email: string;
            role: 'admin' | 'agent';
        };

        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid token' });
    }
}

export function generateToken(payload: { id: string; email: string; role: 'admin' | 'agent' }): string {
    return jwt.sign(payload, config.jwtSecret, {
        expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn']
    });
}

// Generate a short-lived token for widget/chat sessions
export function generateChatToken(payload: { id: string; threadId: string; username: string }): string {
    return jwt.sign(payload, config.jwtSecret, {
        expiresIn: '24h'
    });
}
