import crypto from "crypto";

export const generateStrongPassword = (length = 8) => {
    const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const lower = "abcdefghijklmnopqrstuvwxyz";
    const numbers = "0123456789";
    const special = "!@#$%^&*()_+[]{}<>?/|";
    const allChars = upper + lower + numbers + special;

    let password = "";
    const randomBytes = crypto.randomBytes(length);

    for (let i = 0; i < length; i++) {
        password += allChars[randomBytes[i] % allChars.length];
    }

    return password;
}
