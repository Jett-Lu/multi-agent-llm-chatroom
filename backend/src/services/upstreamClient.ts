import { getConfig } from '../config/env.js';
import type { ChatMessage } from '../types/chat.js';
import { AppError } from '../types/errors.js';
import { normalizeUsage } from './usage.js';

interface UpstreamChoice {
  message?: {
    content?: string;
  };
}

interface UpstreamUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

interface UpstreamResponse {
  choices?: UpstreamChoice[];
  usage?: UpstreamUsage;
}

const config = getConfig();

export const requestChatCompletion = async (
  apiKey: string,
  messages: ChatMessage[],
  requestSignal?: AbortSignal
): Promise<{ reply: string; usage?: UpstreamUsage }> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('upstream_timeout'), config.UPSTREAM_TIMEOUT_MS);
  const forwardAbort = () => controller.abort(requestSignal?.reason ?? 'request_aborted');

  if (requestSignal) {
    if (requestSignal.aborted) {
      controller.abort(requestSignal.reason ?? 'request_aborted');
    } else {
      requestSignal.addEventListener('abort', forwardAbort, { once: true });
    }
  }

  try {
    const response = await fetch(config.UPSTREAM_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: config.UPSTREAM_MODEL,
        messages,
        temperature: 0.7
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      throw new AppError('Upstream model request failed.', 502, 'upstream_error');
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.toLowerCase().includes('application/json')) {
      throw new AppError('Upstream returned unsupported content type.', 502, 'upstream_error');
    }

    const data = (await response.json()) as UpstreamResponse | null;
    const content = data?.choices?.[0]?.message?.content;
    const reply = typeof content === 'string' ? content.trim() : undefined;

    if (!reply) {
      throw new AppError('Upstream response was empty.', 502, 'upstream_error');
    }

    if (reply.length > config.MAX_MESSAGE_CHARS) {
      throw new AppError('Upstream response exceeded message limits.', 502, 'upstream_error');
    }

    const usage = normalizeUsage(data?.usage);
    return { reply, usage: { prompt_tokens: usage.promptTokens ?? undefined,
      completion_tokens: usage.completionTokens ?? undefined, total_tokens: usage.totalTokens ?? undefined } };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    if (controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
      if (requestSignal?.aborted && requestSignal.reason !== 'request_timeout') {
        throw new AppError('Request was cancelled.', 499, 'timeout_error', false);
      }

      throw new AppError('Upstream request timed out.', 504, 'timeout_error');
    }

    throw new AppError('Unable to reach upstream service.', 502, 'upstream_error');
  } finally {
    clearTimeout(timeout);
    requestSignal?.removeEventListener('abort', forwardAbort);
  }
};
