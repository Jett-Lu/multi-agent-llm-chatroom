import { useEffect, useRef, useState } from 'react';
import { getRoomConfig, sendRoomTurn } from '../services/room';
import type { Participant, RoomConfig, RoomEntry, RoomStatus } from '../types/room';

const initialParticipants: Participant[] = [
  { name: 'Builder', role: 'Propose practical approaches and explain their tradeoffs.', model: '', apiKey: '' },
  { name: 'Skeptic', role: 'Challenge assumptions, identify risks, and ask what evidence is missing.', model: '', apiKey: '' }
];
interface RoomState { participants: Participant[]; topic: string; transcript: RoomEntry[]; status: RoomStatus; busy: boolean; tokenBudget: number; tokensUsed: number; auto: boolean; notice: string | null }
const initialState = (): RoomState => ({ participants: initialParticipants.map(p => ({ ...p })), topic: '', transcript: [], status: 'idle', busy: false, tokenBudget: 20000, tokensUsed: 0, auto: true, notice: null });

export function useRoom() {
  const [config, setConfig] = useState<RoomConfig | null>(null);
  const [state, setState] = useState<RoomState>(initialState);
  const current = useRef(state);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const update = (change: (previous: RoomState) => RoomState) => {
    current.current = change(current.current);
    setState(current.current);
  };
  useEffect(() => {
    const loading = new AbortController();
    getRoomConfig(loading.signal).then(value => {
      setConfig(value);
      update(s => ({ ...s, participants: s.participants.map((p, i) => ({ ...p, model: value.models[i % value.models.length] })) }));
    }).catch(error => { if (!loading.signal.aborted) update(s => ({ ...s, notice: error.message })); });
    return () => { loading.abort(); generation.current++; controller.current?.abort(); };
  }, []);

  const execute = async (automatic: boolean) => {
    const snapshot = current.current;
    if (snapshot.busy || !config || !['idle', 'paused', 'running'].includes(snapshot.status)) return;
    if (snapshot.tokensUsed >= snapshot.tokenBudget) { update(s => ({ ...s, status: 'limit' })); return; }
    const epoch = generation.current;
    const active = new AbortController(); controller.current = active;
    const timeout = setTimeout(() => active.abort(), 65000);
    update(s => ({ ...s, busy: true, status: automatic ? 'running' : 'paused', notice: null }));
    try {
      const response = await sendRoomTurn({ topic: snapshot.topic, participants: snapshot.participants, transcript: snapshot.transcript, tokenBudget: snapshot.tokenBudget, tokensUsed: snapshot.tokensUsed }, active.signal);
      if (generation.current !== epoch) return;
      update(s => {
        const total = response.usage.totalTokens;
        const known = typeof total === 'number' && Number.isSafeInteger(total) && total >= 0;
        const tokensUsed = s.tokensUsed + (known ? total : 0);
        return { ...s, busy: false, tokensUsed,
          transcript: [...s.transcript, { kind: 'agent', content: response.reply, participantIndex: response.participantIndex, phase: response.phase, round: response.round, usage: response.usage }],
          status: response.phase === 'summary' ? 'complete' : !known ? 'stopped' : tokensUsed >= s.tokenBudget ? 'limit' : s.status,
          notice: !known ? 'The provider did not report total token usage. Automatic turns have stopped because the room limit cannot be tracked.' : tokensUsed >= s.tokenBudget ? 'The reported token limit was reached. No further turns will run.' : null
        };
      });
    } catch (error) {
      if (generation.current !== epoch) return;
      update(s => ({ ...s, busy: false, status: 'stopped', notice: active.signal.aborted ? 'The turn timed out. The provider may have consumed tokens; no retry was sent.' : `${error instanceof Error ? error.message : 'Unable to reach the backend.'} No automatic retry was sent; usage for this turn may be unknown.` }));
    } finally { clearTimeout(timeout); if (controller.current === active) controller.current = null; }
  };

  useEffect(() => {
    if (state.status !== 'running' || state.busy) return;
    // A brief gap gives the user a chance to pause between billed calls.
    const timer = setTimeout(() => { if (current.current.status === 'running') void execute(true); }, 700);
    return () => clearTimeout(timer);
  }, [state.status, state.busy, state.transcript]);

  const cancel = () => { generation.current++; controller.current?.abort(); controller.current = null; };
  const insufficientCapacity = Boolean(config && config.maxMessages < state.participants.length * config.rounds);
  const valid = Boolean(config && !insufficientCapacity && state.topic.trim() && state.participants.every(p => p.name.trim() && p.role.trim() && p.model && /^[A-Za-z0-9._\-]{12,256}$/.test(p.apiKey.trim())) && new Set(state.participants.map(p => p.name.trim().toLowerCase())).size === state.participants.length && Number.isInteger(state.tokenBudget) && state.tokenBudget >= 100 && state.tokenBudget <= 100000);
  return {
    state, config, valid, insufficientCapacity,
    configure: (change: Partial<RoomState>) => { if (current.current.status === 'idle') update(s => ({ ...s, ...change })); },
    start: () => { if (valid && current.current.status === 'idle') void execute(state.auto); },
    next: () => { void execute(false); },
    resume: () => { if (current.current.status === 'paused' && !current.current.busy) update(s => ({ ...s, status: 'running' })); },
    pause: () => update(s => ({ ...s, status: 'paused' })),
    stop: () => { cancel(); update(s => ({ ...s, status: 'stopped', busy: false, notice: s.busy ? 'The active request was cancelled. Provider billing and token usage may still be incomplete.' : null })); },
    reset: (clearKeys = false) => { cancel(); update(s => ({ ...initialState(), participants: s.participants.map(p => ({ ...p, apiKey: clearKeys ? '' : p.apiKey })), tokenBudget: s.tokenBudget, auto: s.auto })); },
    addMessage: (content: string) => {
      const s = current.current;
      if (s.status !== 'paused' || s.busy || !config || !content.trim() || content.trim().length > config.maxPromptChars || s.transcript.filter(item => item.kind === 'user').length >= config.maxInterjections || s.transcript.length >= config.maxMessages - (s.participants.length * config.rounds - s.transcript.filter(item => item.kind === 'agent').length)) return false;
      update(previous => ({ ...previous, transcript: [...previous.transcript, { kind: 'user', content: content.trim() }] })); return true;
    }
  };
}
