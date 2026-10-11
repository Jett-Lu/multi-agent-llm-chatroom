import { z } from 'zod';
import { getConfig } from '../config/env.js';

const config = getConfig();

const apiKeySchema = z
  .string()
  .trim()
  .min(12)
  .max(256)
  .regex(/^[A-Za-z0-9._\-]+$/, 'API key contains invalid characters');

const messageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().trim().min(1).max(config.MAX_MESSAGE_CHARS)
}).strict();

export const chatSchema = z
  .object({
    apiKey: apiKeySchema,
    messages: z.array(messageSchema).min(1).max(config.MAX_MESSAGES)
  })
  .strict()
  .superRefine((payload, ctx) => {
    const userMessages = payload.messages.filter((m) => m.role === 'user');
    if (userMessages.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['messages'],
        message: 'At least one user message is required.'
      });
    }

    if (userMessages.length > config.MAX_TURNS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['messages'],
        message: `Conversation exceeds max turns (${config.MAX_TURNS}).`
      });
    }

    const latest = payload.messages[payload.messages.length - 1];
    if (!latest || latest.role !== 'user') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['messages'],
        message: 'Last message must be from the user.'
      });
    }

    if (latest?.content.trim().length > config.MAX_PROMPT_CHARS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['messages', payload.messages.length - 1, 'content'],
        message: `Prompt exceeds max length (${config.MAX_PROMPT_CHARS} chars).`
      });
    }
  });

export type ChatSchemaInput = z.infer<typeof chatSchema>;
