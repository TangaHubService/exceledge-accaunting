"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateStrongPassword = void 0;
const crypto_1 = __importDefault(require("crypto"));
const generateStrongPassword = (length = 8) => {
    const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const lower = "abcdefghijklmnopqrstuvwxyz";
    const numbers = "0123456789";
    const special = "!@#$%^&*()_+[]{}<>?/|";
    const allChars = upper + lower + numbers + special;
    let password = "";
    const randomBytes = crypto_1.default.randomBytes(length);
    for (let i = 0; i < length; i++) {
        password += allChars[randomBytes[i] % allChars.length];
    }
    return password;
};
exports.generateStrongPassword = generateStrongPassword;
