import React, { useState } from 'react'
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
ReactDOM.createRoot(document.getElementById('root')).render(
  
  <BrowserRouter>
    <CedarCopilot
      llmProvider={{
        provider: 'custom',
        config: {
          baseURL: '/api/v1/agent/run',

          callLLM: async (messages) => {
            // #region agent log
            fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.jsx:16',message:'callLLM ENTRY - Non-streaming mode',data:{messagesType:typeof messages,isArray:Array.isArray(messages),messagesLength:Array.isArray(messages)?messages.length:null,functionType:'async function'},timestamp:Date.now(),sessionId:'debug-session',runId:'run12',hypothesisId:'A'})}).catch(()=>{});
            // #endregion
            console.log('🔵 callLLM called (non-streaming mode):', messages);
            console.log('🔵 Cedar callLLM called with streaming enabled:', messages);
            const sessionId = sessionStorage.getItem('sessionId');
            
            // Extract the last user message from the messages array
            // Cedar may send messages in various formats
            let userPrompt;
            
            // #region agent log
            fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.jsx:25',message:'BEFORE prompt extraction',data:{messagesType:typeof messages,isArray:Array.isArray(messages),messagesKeys:typeof messages==='object'&&messages?Object.keys(messages):null,messagesPreview:JSON.stringify(messages).substring(0,200)},timestamp:Date.now(),sessionId:'debug-session',runId:'run3',hypothesisId:'B'})}).catch(()=>{});
            // #endregion
            
            if (typeof messages === 'string') {
              userPrompt = messages;
            } else if (Array.isArray(messages)) {
              // Find the last user message in the array
              const lastUserMessage = messages
                .slice()
                .reverse()
                .find(msg => {
                  const role = msg?.role || msg?.message?.role;
                  return role === 'user' || !role; // Default to user if no role specified
                }) || messages[messages.length - 1];
              
              userPrompt = typeof lastUserMessage === 'string'
                ? lastUserMessage
                : (lastUserMessage?.content || lastUserMessage?.text || lastUserMessage?.message?.content || JSON.stringify(lastUserMessage));
            } else if (messages && typeof messages === 'object') {
              // Handle object format - Cedar sends {prompt: "...", additionalContext: {...}}
              userPrompt = messages.prompt || messages.content || messages.text || messages.message;
              
              // If still no prompt, try to stringify
              if (!userPrompt) {
                userPrompt = JSON.stringify(messages);
              }
            } else {
              // Fallback
              userPrompt = String(messages || '');
            }
            
            console.log('🔵 Extracted user prompt:', userPrompt);
            
            // #region agent log
            fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.jsx:44',message:'AFTER prompt extraction',data:{userPrompt:userPrompt?String(userPrompt).substring(0,100):null,hasPrompt:!!userPrompt},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
            // #endregion
            
            if (!userPrompt) {
              // #region agent log
              fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.jsx:48',message:'ERROR no prompt found',data:{messages:JSON.stringify(messages).substring(0,200)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
              // #endregion
              console.error('❌ No valid message content found in:', messages);
              throw new Error('No valid message content found');
            }

            try {
              // Use non-streaming mode
              console.log('🔵 Sending non-streaming request to backend');
              // #region agent log
              fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.jsx:68',message:'BEFORE fetch request (non-streaming)',data:{url:'/api/v1/agent/run',hasSessionId:!!sessionId,userPrompt:userPrompt?.substring(0,100)},timestamp:Date.now(),sessionId:'debug-session',runId:'run12',hypothesisId:'C'})}).catch(()=>{});
              // #endregion
              
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
                // #region agent log
                fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.jsx:79',message:'FETCH ERROR - network failure',data:{errorName:fetchError.name,errorMessage:fetchError.message,isNetworkError:true},timestamp:Date.now(),sessionId:'debug-session',runId:'run12',hypothesisId:'C'})}).catch(()=>{});
                // #endregion
                console.error('❌ Network error - is backend running?', fetchError);
                throw new Error(`Network error: ${fetchError.message}. Is the backend server running?`);
              }

              console.log('🔵 Response status:', response.status, response.statusText);
              // #region agent log
              fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.jsx:67',message:'AFTER fetch response',data:{status:response.status,statusText:response.statusText,ok:response.ok,contentType:response.headers.get('content-type')},timestamp:Date.now(),sessionId:'debug-session',runId:'run12',hypothesisId:'C'})}).catch(()=>{});
              // #endregion

              if (!response.ok) {
                const errorText = await response.text();
                // #region agent log
                fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.jsx:70',message:'ERROR response not ok',data:{status:response.status,errorText:errorText.substring(0,200)},timestamp:Date.now(),sessionId:'debug-session',runId:'run12',hypothesisId:'C'})}).catch(()=>{});
                // #endregion
                console.error('❌ Response error:', errorText);
                throw new Error(`HTTP error! status: ${response.status}: ${errorText}`);
              }

              // Parse JSON response (non-streaming)
              const data = await response.json();
              console.log('✅ Response received:', data);
              
              const content = data.result || data.content || data.choices?.[0]?.message?.content;
              
              if (!content) {
                console.error('❌ No content in response:', data);
                throw new Error('No content in response from server');
              }

              // #region agent log
              fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.jsx:107',message:'RETURNING non-streaming response',data:{contentLength:content.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run12',hypothesisId:'F'})}).catch(()=>{});
              // #endregion
              return {
                content: content,
                message: {
                  role: 'assistant',
                }
              };
            } catch (error) {
              // #region agent log
              fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.jsx:115',message:'ERROR caught in callLLM',data:{errorName:error.name,errorMessage:error.message,errorStack:error.stack?.substring(0,300)},timestamp:Date.now(),sessionId:'debug-session',runId:'run12',hypothesisId:'E'})}).catch(()=>{});
              // #endregion
              console.error('❌ Error in callLLM:', error);
              // Return error message
              // #region agent log
              fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.jsx:118',message:'RETURNING error message',data:{willReturnError:true},timestamp:Date.now(),sessionId:'debug-session',runId:'run12',hypothesisId:'E'})}).catch(()=>{});
              // #endregion
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