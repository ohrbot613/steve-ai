import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import * as Sentry from '@sentry/react'
import App from './App'
import { CedarCopilot, } from 'cedar-os'
import './index.css'

const sentryDsn = import.meta.env.VITE_SENTRY_DSN
if (sentryDsn) {
  const isDev = import.meta.env.MODE === 'development'
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE || 'development',
    sendDefaultPii: true,
    integrations: [Sentry.replayIntegration()],
    replaysSessionSampleRate: isDev ? 1.0 : 0.1,
    replaysOnErrorSampleRate: 1.0,
  })
}

const isDev = import.meta.env.MODE === 'development'
const debugChatLogging = import.meta.env.VITE_DEBUG_CHAT_LOGGING === 'true'

function logDev(...args) {
  if (isDev && debugChatLogging) {
    console.log(...args)
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <CedarCopilot
      llmProvider={{
        provider: 'custom',
        config: {
          baseURL: '/api/v1/agent/run',

          callLLM: async (messages) => {
            logDev('[Cedar] callLLM input:', messages)
            let userPrompt;

            if (typeof messages === 'string') {
              userPrompt = messages;
            } else if (Array.isArray(messages)) {
              const lastUserMessage = messages
                .slice()
                .reverse()
                .find(msg => {
                  const role = msg?.role || msg?.message?.role;
                  return role === 'user' || !role;
                }) || messages[messages.length - 1];

              userPrompt = typeof lastUserMessage === 'string'
                ? lastUserMessage
                : (lastUserMessage?.content || lastUserMessage?.text || lastUserMessage?.message?.content || JSON.stringify(lastUserMessage));
            } else if (messages && typeof messages === 'object') {
              userPrompt = messages.prompt || messages.content || messages.text || messages.message;
              if (!userPrompt) {
                userPrompt = JSON.stringify(messages);
              }
            } else {
              userPrompt = String(messages || '');
            }

            if (!userPrompt) {
              console.error('No valid message content found in:', messages);
              throw new Error('No valid message content found');
            }

            try {
              logDev('[Cedar] sending request to backend')
              let response;
              try {
                response = await fetch('/api/v1/agent/run', {
                  method: 'POST', 
                  credentials: 'include',
                  headers: { 
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ 
                    message: userPrompt
                  })
                });
              } catch (fetchError) {
                console.error('Network error - is backend running?', fetchError);
                throw new Error(`Network error: ${fetchError.message}. Is the backend server running?`);
              }

              logDev('[Cedar] response status:', response.status, response.statusText);

              if (!response.ok) {
                const errorText = await response.text();
                console.error('Response error:', errorText);
                throw new Error(`HTTP error! status: ${response.status}: ${errorText}`);
              }

              const data = await response.json();
              logDev('[Cedar] response received');
              
              const content = data.result || data.content || data.choices?.[0]?.message?.content;
              
              if (!content) {
                console.error('No content in response:', data);
                throw new Error('No content in response from server');
              }

              return {
                content: content,
                message: {
                  role: 'assistant',
                }
              };
            } catch (error) {
              console.error('Error in callLLM:', error);
              return {
                content: `Error: ${error.message}. Please check the console for details.`,
                message: {
                  role: 'assistant',
                }
              };
            }
          }
        }
      }}>
      <App />
    </CedarCopilot>
  </BrowserRouter>
)