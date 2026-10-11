import type { Participant, RoomConfig, RoomEntry, RoomResponse } from '../types/room';
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

export async function getRoomConfig(signal: AbortSignal): Promise<RoomConfig> {
  const response = await fetch(`${API_BASE_URL}/api/room/config`, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('Unable to load configured models. Check the backend and reload.');
  return response.json();
}

export async function sendRoomTurn(room: { topic: string; participants: Participant[]; transcript: RoomEntry[]; tokenBudget: number; tokensUsed: number }, signal: AbortSignal): Promise<RoomResponse> {
  const answers = room.transcript.filter(item => item.kind === 'agent').length;
  const speaker = answers === room.participants.length * 3 ? 0 : answers % room.participants.length;
  const response = await fetch(`${API_BASE_URL}/api/room/turn`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ ...room,
      apiKey: room.participants[speaker].apiKey.trim(),
      participants: room.participants.map(({ name, role, model }) => ({ name: name.trim(), role: role.trim(), model })),
      transcript: room.transcript.map(item => item.kind === 'user' ? { kind: item.kind, content: item.content } : { kind: item.kind, participantIndex: item.participantIndex, content: item.content })
    })
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error?.message ?? 'The turn failed. Start a new discussion to try again.');
  }
  return response.json();
}
