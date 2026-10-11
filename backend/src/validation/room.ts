import { z } from 'zod';
import { getConfig } from '../config/env.js';
import { apiKeySchema } from './chat.js';

const config = getConfig();
export const roomModels = [...new Set([config.UPSTREAM_MODEL, ...(config.UPSTREAM_MODELS?.split(',').map(model => model.trim()) ?? [])])];
export const ROOM_ROUNDS = 3;
export const ROOM_OUTPUT_TOKENS = 800;
export const roomSchema = z.object({
  apiKey: apiKeySchema,
  topic: z.string().trim().min(1).max(config.MAX_PROMPT_CHARS),
  participants: z.array(z.object({
    name: z.string().trim().min(1).max(40),
    model: z.string().refine(model => roomModels.includes(model), 'Select a configured model'),
    role: z.string().trim().min(1).max(500)
  }).strict()).min(2).max(3),
  transcript: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('agent'), participantIndex: z.number().int().min(0).max(2), content: z.string().trim().min(1).max(config.MAX_MESSAGE_CHARS) }).strict(),
    z.object({ kind: z.literal('user'), content: z.string().trim().min(1).max(config.MAX_PROMPT_CHARS) }).strict()
  ])).max(Math.min(config.MAX_MESSAGES, 30)),
  tokenBudget: z.number().int().min(100).max(100000),
  tokensUsed: z.number().int().min(0).max(2147483647)
}).strict().superRefine((room, ctx) => {
  const answers = room.transcript.filter(item => item.kind === 'agent');
  const invalid = Math.min(config.MAX_MESSAGES, 30) < room.participants.length * ROOM_ROUNDS || answers.length > room.participants.length * ROOM_ROUNDS ||
    answers.some((answer, i) => answer.participantIndex !== i % room.participants.length) ||
    room.transcript.filter(item => item.kind === 'user').length > Math.min(20, config.MAX_TURNS) ||
    new Set(room.participants.map(p => p.name.toLowerCase())).size !== room.participants.length ||
    room.tokensUsed >= room.tokenBudget;
  if (invalid) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid turn sequence, duplicate participant names, or exhausted room limit.' });
});
export type RoomInput = z.infer<typeof roomSchema>;
