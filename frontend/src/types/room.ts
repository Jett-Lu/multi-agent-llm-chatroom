export interface Participant { name: string; role: string; model: string; apiKey: string }
export interface RoomConfig { models: string[]; rounds: number; maxOutputTokens: number; maxPromptChars: number; maxInterjections: number; maxMessages: number }
export interface RoomUsage { promptTokens?: number | null; completionTokens?: number | null; totalTokens?: number | null }
export interface RoomEntry { kind: 'agent' | 'user'; content: string; participantIndex?: number; phase?: string; round?: number; usage?: RoomUsage }
export interface RoomResponse { reply: string; participantIndex: number; phase: string; round: number; usage: RoomUsage; requestId: string }
export type RoomStatus = 'idle' | 'running' | 'paused' | 'stopped' | 'complete' | 'limit';
