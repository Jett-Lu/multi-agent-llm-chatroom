import type { NextFunction, Request, Response } from 'express';
import { maskIp } from '../utils/ip.js';
import { logger } from '../utils/logger.js';

export const requestLoggerMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  // Never log arbitrary URL paths or query strings supplied by callers.
  const route = /^\/api\/(chat|health|session|analytics)(\/|$)/.exec(req.path)?.[1] ?? 'unknown';
  res.on('finish', () => {
    logger.info('request_completed', {
      requestId: req.requestId,
      method: req.method,
      route,
      statusCode: res.statusCode,
      latencyMs: Date.now() - req.startTime,
      ip: maskIp(req.ip)
    });
  });

  next();
};
