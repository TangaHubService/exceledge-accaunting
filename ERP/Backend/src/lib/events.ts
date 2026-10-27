import EventService from '../services/event.service';
import { prisma } from './prisma';

export const eventService = new EventService(prisma);
