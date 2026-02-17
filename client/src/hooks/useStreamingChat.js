import { useState, useRef, useEffect } from 'react';

export function useStreamingChat(endpoint) {
  const [messages, setMessages] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [threadId, setThreadId] = useState(null);
  const [error, setError] = useState(null);
  const [activeTool, setActiveTool] = useState(null);

  const eventSourceRef = useRef(null);

  // Load threadId from sessionStorage on mount
  useEffect(() => {
    const savedThreadId = sessionStorage.getItem('askSteve_threadId');
    if (savedThreadId) {
      setThreadId(savedThreadId);
    }
  }, []);

  const sendMessage = async (content, context) => {
    setIsStreaming(true);
    setError(null);

    // Create unique assistant message ID
    const assistantMsgId = 'assistant-' + Date.now() + '-' + Math.random();

    // Add user message and empty assistant placeholder to messages
    setMessages(prev => [...prev,
      { id: 'user-' + Date.now(), role: 'user', content },
      { id: assistantMsgId, role: 'assistant', content: '', streaming: true }
    ]);

    // Build SSE URL
    const url = new URL(endpoint, window.location.origin);
    url.searchParams.set('message', content);
    if (threadId) url.searchParams.set('threadId', threadId);
    if (context) url.searchParams.set('context', JSON.stringify(context));

    try {
      // Create EventSource with credentials for cookie-based auth
      const eventSource = new EventSource(url.toString(), { withCredentials: true });
      eventSourceRef.current = eventSource;

      // Handle token events
      eventSource.addEventListener('token', (event) => {
        try {
          const data = JSON.parse(event.data);
          const token = data.token;

          setMessages(prev => prev.map(msg =>
            msg.id === assistantMsgId
              ? { ...msg, content: msg.content + token }
              : msg
          ));
        } catch (err) {
          console.error('Error parsing token event:', err);
        }
      });

      // Handle tool_start events
      eventSource.addEventListener('tool_start', (event) => {
        try {
          const data = JSON.parse(event.data);
          const toolName = data.tool;
          setActiveTool(toolName);

          // Optionally update assistant message toolStatus
          setMessages(prev => prev.map(msg =>
            msg.id === assistantMsgId
              ? { ...msg, toolStatus: `Using tool: ${toolName}` }
              : msg
          ));
        } catch (err) {
          console.error('Error parsing tool_start event:', err);
        }
      });

      // Handle tool_end events
      eventSource.addEventListener('tool_end', (event) => {
        setActiveTool(null);
      });

      // Handle end events
      eventSource.addEventListener('end', (event) => {
        try {
          const data = JSON.parse(event.data);
          const newThreadId = data.threadId;

          // Update threadId and persist to sessionStorage
          if (newThreadId) {
            setThreadId(newThreadId);
            sessionStorage.setItem('askSteve_threadId', newThreadId);
          }

          // Mark assistant message as not streaming
          setMessages(prev => prev.map(msg =>
            msg.id === assistantMsgId
              ? { ...msg, streaming: false }
              : msg
          ));

          setIsStreaming(false);
          eventSource.close();
          eventSourceRef.current = null;
        } catch (err) {
          console.error('Error parsing end event:', err);
          setIsStreaming(false);
          eventSource.close();
          eventSourceRef.current = null;
        }
      });

      // Handle errors
      eventSource.onerror = (err) => {
        console.error('EventSource error:', err);
        setError('Connection error. Please try again.');
        setIsStreaming(false);
        eventSource.close();
        eventSourceRef.current = null;
      };

    } catch (err) {
      console.error('Error creating EventSource:', err);
      setError(err.message || 'Failed to connect');
      setIsStreaming(false);
    }
  };

  const clearThread = () => {
    // Reset messages
    setMessages([]);

    // Clear threadId
    setThreadId(null);
    sessionStorage.removeItem('askSteve_threadId');

    // Close any active EventSource
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    // Reset streaming state
    setIsStreaming(false);
    setActiveTool(null);
    setError(null);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  return {
    messages,
    isStreaming,
    error,
    activeTool,
    threadId,
    sendMessage,
    clearThread
  };
}
