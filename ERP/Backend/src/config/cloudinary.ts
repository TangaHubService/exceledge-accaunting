// src/config/cloudinary.ts
import { v2 as cloudinary } from 'cloudinary';
import dotenv from 'dotenv';

dotenv.config();

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

export const uploadToCloudinary = async (file: Express.Multer.File) => {
    try {
        const result = await new Promise((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
                {
                    resource_type: 'auto',
                    folder: 'inventory-system',
                    allowed_formats: ['jpg', 'jpeg', 'png', 'gif'],
                    transformation: [
                        { width: 500, height: 500, crop: 'limit', quality: 'auto' }
                    ]
                },
                (error, result) => {
                    if (error) return reject(error);
                    resolve(result);
                }
            );
            uploadStream.end(file.buffer);
        });
        return result;
    } catch (error) {
        throw new Error('Failed to upload file to Cloudinary');
    }
};

export const deleteFromCloudinary = async (url: string) => {
    try {
        if (!url) return;
        const publicId = url.split('/').pop()?.split('.')[0];
        if (publicId) {
            await cloudinary.uploader.destroy(publicId);
        }
    } catch (error) {
        console.error('Error deleting from Cloudinary:', error);
    }
};