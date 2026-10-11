import type { Express } from 'express';
import { roomRouter } from './room.js';
import { chatRouter } from './chat.js';
import { healthRouter } from './health.js';
import { sessionRouter } from './session.js';

export const registerRoutes = (app: Express): void => {
  app.use('/api/health', healthRouter);
  app.use('/api/chat', chatRouter);
  app.use('/api/room', roomRouter);
  app.use('/api/session', sessionRouter);
};
