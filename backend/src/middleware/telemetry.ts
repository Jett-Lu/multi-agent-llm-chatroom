import type { RequestHandler } from 'express';
import type { AppConfig } from '../config/env.js';
import type { TelemetryService } from '../services/telemetry.js';
import type { TokenUsage } from '../types/analytics.js';

declare module 'express-serve-static-core' {
  interface Request { tokenUsage?: TokenUsage; errorCategory?: string }
}

export const telemetryMiddleware = (telemetry: TelemetryService, config: AppConfig): RequestHandler => (req, res, next) => {
  if (req.method !== 'POST' || !/^\/api\/chat\/?$/i.test(req.path)) return next();
  const started = performance.now();
  let recorded = false;
  const record = () => {
    if (recorded) return;
    recorded = true;
    const statusCode = res.writableFinished ? res.statusCode : 499;
    const outcome = statusCode >= 200 && statusCode < 300 ? 'success' : 'failure';
    const errorCategory = outcome === 'success' ? null : statusCode === 499 ? 'client_cancelled' :
      req.errorCategory ?? (statusCode === 429 ? 'rate_limit_error' : statusCode === 408 || statusCode === 504 ? 'timeout_error' : statusCode < 500 ? 'validation_error' : 'internal_error');
    telemetry.record({ requestId: req.requestId, timestamp: new Date(req.startTime), model: config.UPSTREAM_MODEL,
      durationMs: Math.min(2147483647, Math.max(0, Math.round(performance.now() - started))), statusCode, outcome, errorCategory,
      promptTokens: req.tokenUsage?.promptTokens ?? null, completionTokens: req.tokenUsage?.completionTokens ?? null, totalTokens: req.tokenUsage?.totalTokens ?? null });
  };
  res.once('finish', record);
  res.once('close', record);
  next();
};
