import { useState } from 'react';
import { AnalyticsDashboard } from './components/AnalyticsDashboard';
import { useRoom } from './hooks/useRoom';

const statusLabels = { idle: 'Ready to begin', running: 'Discussion in progress', paused: 'Paused', stopped: 'Stopped', complete: 'Discussion complete', limit: 'Token limit reached' };

function App() {
  const room = useRoom();
  const { state, config } = room;
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [message, setMessage] = useState('');
  const editable = state.status === 'idle';
  const active = state.status === 'running' || state.status === 'paused';
  const answers = state.transcript.filter(entry => entry.kind === 'agent').length;
  const nextSpeaker = state.participants[answers === state.participants.length * 3 ? 0 : answers % state.participants.length];
  const updateParticipant = (index: number, patch: Partial<typeof nextSpeaker>) => room.configure({ participants: state.participants.map((p, i) => i === index ? { ...p, ...patch } : p) });
  const clear = (keys: boolean) => { room.reset(keys); setMessage(''); };

  return (
    <main className="app-shell">
      <header className="page-header roundtable-header">
        <div><p className="eyebrow">MULTI-AGENT LLM CHATROOM</p><h1>Agent Roundtable</h1>
          <p className="subtle-text">Different perspectives. A shared question. Room for disagreement.</p></div>
        <span className="room-badge">BYOK · MEMORY ONLY</span>
      </header>

      <section className="info-grid compact-section" aria-label="Discussion status">
        <article className="info-card"><h2 className="eyebrow">Room status</h2><p role="status">{statusLabels[state.status]}</p></article>
        <article className="info-card"><h2 className="eyebrow">Protocol</h2><p>Independent answers → critique → refinement → summary</p></article>
        <article className="info-card"><h2 className="eyebrow">Reported usage</h2><p>{state.tokensUsed} / {state.tokenBudget} reported tokens</p></article>
      </section>

      <section className="surface-card compact-section" aria-labelledby="participants-heading">
        <div className="section-heading meta-row"><h2 id="participants-heading">Participants</h2>
          <button className="button secondary" disabled={!editable} onClick={() => room.configure({ participants: state.participants.length === 3 ? state.participants.slice(0, 2) : [...state.participants, { name: 'Explorer', role: 'Offer alternative perspectives and overlooked possibilities.', model: config?.models[0] ?? '', apiKey: '' }] })}>{state.participants.length === 3 ? 'Remove third participant' : 'Add third participant'}</button></div>
        <p className="credential-meta">Each participant uses its own key with the server-configured OpenAI-compatible endpoint. Choose an enabled model that your key can access. Native provider-specific APIs are not supported.</p>
        <div className="participant-grid">
          {state.participants.map((participant, index) => {
            const turns = state.transcript.filter(entry => entry.kind === 'agent' && entry.participantIndex === index);
            const knownTokens = turns.reduce((total, entry) => total + (entry.usage?.totalTokens ?? 0), 0);
            const unknown = turns.some(entry => entry.usage?.totalTokens == null);
            return <fieldset className="participant-card" key={index} disabled={!editable}>
              <legend>{index + 1}. {participant.name || 'Participant'}{index === 0 ? ' · moderator' : ''}</legend>
              <label><span className="field-label">Name</span><input className="text-input" aria-label={`Participant ${index + 1} name`} value={participant.name} maxLength={40} onChange={event => updateParticipant(index, { name: event.target.value })} /></label>
              <label><span className="field-label">Model</span><select className="text-input" aria-label={`${participant.name} model`} value={participant.model} onChange={event => updateParticipant(index, { model: event.target.value })}>{config ? config.models.map(model => <option key={model}>{model}</option>) : <option value="">Loading configured models…</option>}</select></label>
              <label><span className="field-label">Role</span><textarea className="text-input" rows={3} aria-label={`${participant.name} role`} value={participant.role} maxLength={500} onChange={event => updateParticipant(index, { role: event.target.value })} /></label>
              <label><span className="field-label">API key</span><input className="text-input" type="password" aria-label={`${participant.name} API key`} autoComplete="off" spellCheck={false} value={participant.apiKey} maxLength={256} onChange={event => updateParticipant(index, { apiKey: event.target.value })} /></label>
              <p className="credential-meta">{turns.length} turns · {knownTokens} reported tokens{unknown ? ' · some usage unknown' : ''}</p>
            </fieldset>;
          })}
        </div>
      </section>

      <section className="surface-card compact-section" aria-labelledby="topic-heading">
        <div className="section-heading"><h2 id="topic-heading">The question on the table</h2></div>
        <label><span className="field-label">Discussion topic</span><textarea className="chat-textarea" value={state.topic} disabled={!editable} maxLength={config?.maxPromptChars ?? 2000} placeholder="What should these perspectives help you think through?" onChange={event => room.configure({ topic: event.target.value })} /></label>
        <div className="room-settings">
          <label><span className="field-label">Total reported token limit</span><input type="number" className="text-input" min={100} max={100000} step={100} value={state.tokenBudget} disabled={!editable} onChange={event => room.configure({ tokenBudget: Number(event.target.value) })} /></label>
          <label className="checkbox-label"><input type="checkbox" checked={state.auto} disabled={!editable} onChange={event => room.configure({ auto: event.target.checked })} /> Run turns automatically</label>
        </div>
        <p className="credential-meta">Three rounds, then a summary by the first participant. The room stops after a completed turn reaches the reported limit. This is not a billing cap: input tokens and cancelled requests may still be billed. Missing usage stops further turns.</p>
        <div className="action-group room-controls">
          {editable ? <button className="button primary" disabled={!room.valid} onClick={room.start}>Start discussion</button> : null}
          {state.status === 'running' ? <button className="button primary" onClick={room.pause}>Pause after current turn</button> : null}
          {state.status === 'paused' ? <><button className="button primary" disabled={state.busy} onClick={room.next}>Next turn</button><button className="button" disabled={state.busy} onClick={room.resume}>Resume automatically</button></> : null}
          {active ? <button className="button" onClick={room.stop}>Stop discussion</button> : null}
          {!editable ? <button className="button" onClick={() => clear(false)}>New discussion</button> : null}
          <button className="button secondary" onClick={() => clear(true)}>Clear keys and room</button>
        </div>
        {room.insufficientCapacity ? <p role="alert" className="app-error">The server message limit is too small for this room. Increase MAX_MESSAGES or use fewer participants before starting.</p> : null}
        {state.notice ? <p role="alert" className="app-error">{state.notice}</p> : null}
      </section>

      <section className="surface-card compact-section" aria-labelledby="discussion-heading">
        <div className="section-heading"><h2 id="discussion-heading">Discussion</h2></div>
        <div className="room-transcript" role="log" aria-live="polite" aria-label="Discussion transcript">
          {!state.transcript.length && !state.busy ? <div className="chat-empty-state"><div><h3>Bring a question. Invite a second perspective.</h3><p>Opening answers are independent. Later rounds can build on and challenge what others said.</p></div></div> : null}
          {state.transcript.map((entry, index) => <article className={`message-card ${entry.kind === 'user' ? 'user' : ''}`} key={index}>
            <h3 className="message-role">{entry.kind === 'user' ? 'You' : entry.phase === 'summary' ? 'Moderator summary' : `${state.participants[entry.participantIndex!]?.name} · Round ${entry.round} · ${entry.phase}`}</h3>
            <div className="message-content">{entry.content}</div>
            {entry.kind === 'agent' ? <span className="credential-meta">{state.participants[entry.participantIndex!]?.model} · {entry.usage?.totalTokens == null ? 'Token usage unknown' : `${entry.usage.totalTokens} tokens`}</span> : null}
          </article>)}
          {state.busy ? <p className="chat-status" role="status">{nextSpeaker.name} is thinking…{state.status === 'paused' ? ' The room will pause after this turn.' : ''}</p> : null}
        </div>
        {active ? <form className="composer-form room-interjection" onSubmit={event => { event.preventDefault(); if (room.addMessage(message)) setMessage(''); }}>
          <label><span className="field-label">Message to the room</span><textarea className="text-input" rows={2} value={message} maxLength={config?.maxPromptChars ?? 2000} disabled={state.status !== 'paused' || state.busy} onChange={event => setMessage(event.target.value)} placeholder="Pause between turns to add context or redirect the discussion." /></label>
          <button className="button" disabled={state.status !== 'paused' || state.busy || !message.trim()} type="submit">Add message</button>
        </form> : null}
      </section>

      <footer className="page-footer">
        <p>Keys and discussion stay in this tab's memory and are sent to the configured provider as needed. Refreshing clears the room. Only allowlisted request metadata can be saved by the gateway; your provider has its own data policies.</p>
        <button className="button" aria-expanded={showAnalytics} onClick={() => setShowAnalytics(value => !value)}>{showAnalytics ? 'Hide analytics' : 'Usage analytics'}</button>
        {showAnalytics ? <AnalyticsDashboard /> : null}
      </footer>
    </main>
  );
}
export default App;
