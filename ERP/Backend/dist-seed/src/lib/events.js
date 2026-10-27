"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventService = void 0;
const event_service_1 = __importDefault(require("../services/event.service"));
const prisma_1 = require("./prisma");
exports.eventService = new event_service_1.default(prisma_1.prisma);
