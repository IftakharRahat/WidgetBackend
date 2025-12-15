import { v2 as cloudinary } from 'cloudinary';
import { config } from '../config/index.js';

// Configure Cloudinary
if (config.cloudinary.cloudName) {
    cloudinary.config({
        cloud_name: config.cloudinary.cloudName,
        api_key: config.cloudinary.apiKey,
        api_secret: config.cloudinary.apiSecret
    });
} else {
    console.warn('⚠️ Cloudinary not configured');
}

export async function uploadToCloudinary(
    fileBuffer: Buffer,
    fileName: string,
    resourceType: 'video' | 'image' | 'auto' = 'auto'
): Promise<string> {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                resource_type: resourceType,
                public_id: fileName.split('.')[0], // Cloudinary doesn't strictly need extensions in public_id
                folder: 'chat-media',
            },
            (error, result) => {
                if (error) {
                    console.error('Cloudinary upload error:', error);
                    reject(error);
                } else {
                    resolve(result?.secure_url || '');
                }
            }
        );

        uploadStream.end(fileBuffer);
    });
}
