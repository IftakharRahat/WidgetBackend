import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { supabaseAdmin } from '../config/supabase.js';
import { config } from '../config/index.js';

const router = Router();

// Configure multer for memory storage
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: config.maxFileSizeMB * 1024 * 1024 // Convert MB to bytes
    },
    fileFilter: (req, file, cb) => {
        // Allowed file types
        const allowedTypes = [
            'image/jpeg',
            'image/png',
            'image/gif',
            'image/webp',
            'video/mp4',
            'video/webm',
            'video/quicktime',
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        ];

        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`File type ${file.mimetype} not allowed`));
        }
    }
});

// POST /api/v1/upload - Upload a file to Supabase Storage or Cloudinary
router.post('/', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file provided' });
        }

        const file = req.file;
        const threadId = req.body.thread_id;

        // Generate unique filename
        const fileExt = file.originalname.split('.').pop();
        const fileName = `${threadId || 'general'}/${uuidv4()}.${fileExt}`;

        let mediaUrl = '';
        let mediaType = 'file';

        if (file.mimetype.startsWith('video/')) {
            mediaType = 'video';
            // Upload video to Cloudinary
            const { uploadToCloudinary } = await import('../services/cloudinary.js');
            mediaUrl = await uploadToCloudinary(file.buffer, fileName, 'video');

        } else {
            if (file.mimetype.startsWith('image/')) {
                mediaType = 'image';
            }

            // Upload others to Supabase Storage
            const { data, error } = await supabaseAdmin.storage
                .from('chat-media')
                .upload(fileName, file.buffer, {
                    contentType: file.mimetype,
                    cacheControl: '3600'
                });

            if (error) throw error;

            // Get public URL
            const { data: urlData } = supabaseAdmin.storage
                .from('chat-media')
                .getPublicUrl(fileName);

            mediaUrl = urlData.publicUrl;
        }

        res.json({
            success: true,
            url: mediaUrl,
            media_type: mediaType,
            file_name: file.originalname,
            file_size: file.size
        });
    } catch (error) {
        console.error('Error uploading file:', error);
        res.status(500).json({ error: 'Failed to upload file' });
    }
});

// Error handling for multer
router.use((err: Error, req: any, res: any, next: any) => {
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                error: `File too large. Maximum size is ${config.maxFileSizeMB}MB`
            });
        }
    }
    return res.status(400).json({ error: err.message });
});

export default router;
