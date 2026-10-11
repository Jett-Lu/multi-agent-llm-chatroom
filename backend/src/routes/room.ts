import { Router } from 'express';
import { getConfig } from '../config/env.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { roomModels, roomSchema, ROOM_ROUNDS, ROOM_OUTPUT_TOKENS, type RoomInput } from '../validation/room.js';
import { prepareRoomTurn } from '../services/roundtable.js';
import { requestChatCompletion } from '../services/upstreamClient.js';
import { normalizeUsage } from '../services/usage.js';

export const roomRouter = Router();
roomRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
roomRouter.get('/config', (_req, res) => {
  const config = getConfig();
  res.json({ models: roomModels, rounds: ROOM_ROUNDS, maxOutputTokens: ROOM_OUTPUT_TOKENS, maxPromptChars: config.MAX_PROMPT_CHARS, maxInterjections: Math.min(20, config.MAX_TURNS), maxMessages: Math.min(config.MAX_MESSAGES, 30) });
});
roomRouter.post('/turn', validateRequest(roomSchema), async (req, res, next) => {
  try {
    const room = req.body as RoomInput;
    const turn = prepareRoomTurn(room);
    // Only values resolved through the server's allowlist enter analytics.
    req.telemetryModel = turn.model;
    const result = await requestChatCompletion(room.apiKey, turn.messages, req.requestSignal, { model: turn.model, maxTokens: Math.min(ROOM_OUTPUT_TOKENS, room.tokenBudget - room.tokensUsed) });
    if (req.requestSignal.aborted || res.headersSent) return;
    const usage = normalizeUsage(result.usage);
    req.tokenUsage = usage;
    res.json({ reply: result.reply, usage, participantIndex: turn.participantIndex, phase: turn.phase, round: turn.round, requestId: req.requestId });
  } catch (error) {
    if (req.requestSignal.aborted && !res.headersSent) return;
    next(error);
  }
});
