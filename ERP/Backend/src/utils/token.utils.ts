import crypto from 'crypto';
import { addHours } from 'date-fns';

export const generateToken = (): string => {
    return crypto.randomBytes(32).toString('hex');
};

export const generateVerificationToken = () => {
    // Generate a 6-digit code
    const token = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = addHours(new Date(), 24); // Token expires in 24 hours
    return { token, expires };
};



export const generatePasswordResetToken = () => {
    // A cryptographically secure six-digit OTP that is easy to enter on mobile.
    // The stored value is still SHA-256 hashed by the controller.
    const token = crypto.randomInt(100000, 1000000).toString();
    const expires = addHours(new Date(), 1);
    return { token, expires };
};

export const isTokenExpired = (expiryDate: Date | null): boolean => {
    if (!expiryDate) return true;
    return new Date() > expiryDate;
};
