import { ApiKeyPanel } from './components/ApiKeyPanel';
import { ChatWindow } from './components/ChatWindow';
import { Composer } from './components/Composer';
import { useChat } from './hooks/useChat';
import { useState } from 'react';
import { AnalyticsDashboard } from './components/AnalyticsDashboard';

function App() {
  const [showAnalytics, setShowAnalytics] = useState(false);
  const {
    apiKey,
    setApiKey,
    input,
    setInput,
    messages,
    isLoading,
    error,
    canSend,
    send,
    clearConversation,
    clearApiKey,
    chatLimits
  } = useChat();

  const userTurns = messages.filter((message) => message.role === 'user').length;
  const hasApiKey = Boolean(apiKey.trim());
  const hasConversation = messages.length > 0 || isLoading;
  const conversationState = isLoading ? 'Responding' : messages.length > 0 ? 'Active' : 'Idle';
  const featureItems = [
    {
      title: 'Runtime key handling',
      body: 'Provider secrets stay in memory only and can be cleared instantly from the interface.'
    },
    {
      title: 'Backend enforcement',
      body: 'Requests pass through validation, rate limiting, timeouts, and sanitized error handling.'
    },
    {
      title: 'Conversation limits',
      body: `Up to ${chatLimits.maxTurns} user turns, ${chatLimits.maxMessages} messages, and ${chatLimits.maxPromptChars} prompt characters.`
    }
  ];

  return (
    <main className="app-shell">
      <header className="page-header">
        <div>
          <h1>Secure AI API Gateway &amp; Chat System</h1>
          <p className="subtle-text">Security-first chat interface with runtime-only secrets and backend orchestration.</p>
        </div>
      </header>

      <section className="content-section compact-section">
        <div className="section-heading">
          <div>
            <h2>SESSION STATUS</h2>
          </div>
        </div>
        <div className="info-grid">
          <article className="info-card">
            <h3>Conversation</h3>
            <p>{conversationState}</p>
          </article>
          <article className="info-card">
            <h3>Key storage</h3>
            <p>{hasApiKey ? 'Loaded in memory' : 'Not loaded'}</p>
          </article>
          <article className="info-card">
            <h3>Limits</h3>
            <p>
              {userTurns}/{chatLimits.maxTurns} turns, {messages.length}/{chatLimits.maxMessages} messages
            </p>
          </article>
        </div>
      </section>

      <section className="workspace-grid">
        <div className="workspace-main">
          <div id="chat" className="surface-card chat-surface">
            <div className="section-heading">
              <div>
                <h2>CHAT LOG</h2>
              </div>
            </div>
            <ChatWindow messages={messages} isLoading={isLoading} />
          </div>

          <div className="surface-card composer-surface">
            <div className="section-heading">
              <div>
                <h2>INPUT</h2>
              </div>
            </div>
            <Composer
              input={input}
              maxPromptChars={chatLimits.maxPromptChars}
              isLoading={isLoading}
              canSend={canSend}
              onInputChange={setInput}
              onSend={send}
              onClearConversation={clearConversation}
            />
            <div className="meta-row">
              <span>{hasApiKey ? 'Key loaded in memory' : 'Add a provider key to begin'}</span>
              <span>{isLoading ? 'Generating response' : 'Ready to send'}</span>
            </div>
            {error ? <div className="app-error">{error}</div> : null}
          </div>
        </div>

        <aside className="workspace-sidebar">
          <div className="surface-card">
            <div className="section-heading">
              <div>
                <h2>AUTH</h2>
              </div>
            </div>
            <ApiKeyPanel apiKey={apiKey} onApiKeyChange={setApiKey} onClearApiKey={clearApiKey} />
          </div>

          <div id="details" className="surface-card">
            <div className="section-heading">
              <div>
                <h2>SYSTEM NOTES</h2>
              </div>
            </div>
            <div className="feature-list">
              {featureItems.map((item) => (
                <article key={item.title} className="feature-item">
                  <strong>{item.title}</strong>
                  <p>{item.body}</p>
                </article>
              ))}
            </div>
          </div>
        </aside>
      </section>

      <footer className="page-footer">
        <button className="button" aria-expanded={showAnalytics} onClick={() => setShowAnalytics(value => !value)}>{showAnalytics ? 'Hide analytics' : 'Usage analytics'}</button>
        {showAnalytics ? <AnalyticsDashboard /> : null}
        <p>Request path: browser to backend to upstream model.</p>
      </footer>
    </main>
  );
}

export default App;
