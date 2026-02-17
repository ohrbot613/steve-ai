import { useState, useCallback } from 'react';

const API_BASE = '/api/v2/agent';

/**
 * Hook for 2.0 agent threads: list conversations, create new chat, load thread messages.
 * All requests use credentials: 'include' for auth.
 */
export function useAgentThreads() {
  const [threads, setThreads] = useState([]);
  const [currentThreadId, setCurrentThreadId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchThreads = useCallback(async () => {
    setListLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/threads`, { credentials: 'include' });
      if (!res.ok) {
        if (res.status === 401) {
          setError('Please log in to see conversations.');
          return [];
        }
        throw new Error(res.statusText || 'Failed to load conversations');
      }
      const data = await res.json();
      if (data.success && Array.isArray(data.threads)) {
        setThreads(data.threads);
        return data.threads;
      }
      return [];
    } catch (err) {
      setError(err.message || 'Failed to load conversations');
      return [];
    } finally {
      setListLoading(false);
    }
  }, []);

  const createNewChat = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/new-chat`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        if (res.status === 401) throw new Error('Please log in to create a chat.');
        throw new Error((await res.json()).error || 'Failed to create chat');
      }
      const data = await res.json();
      if (data.success && data.threadId) {
        setThreads((prev) => [{ threadId: data.threadId, createdAt: new Date().toISOString() }, ...prev]);
        setCurrentThreadId(data.threadId);
        return data.threadId;
      }
      throw new Error('No threadId returned');
    } catch (err) {
      setError(err.message || 'Failed to create chat');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Load messages for a thread. Returns array of { id, role, content } for display.
   */
  const loadThreadMessages = useCallback(async (threadId) => {
    if (!threadId) return [];
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/threads/${encodeURIComponent(threadId)}/messages`, {
        credentials: 'include',
      });
      if (!res.ok) {
        if (res.status === 404) return [];
        throw new Error(res.statusText || 'Failed to load messages');
      }
      const data = await res.json();
      if (!data.success || !Array.isArray(data.messages)) return [];
      return data.messages.map((msg, i) => ({
        id: `msg-${threadId}-${msg.index ?? i}`,
        role: msg.type === 'agent' ? 'assistant' : msg.type || 'user',
        content: msg.content || '',
      }));
    } catch (err) {
      setError(err.message || 'Failed to load messages');
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    threads,
    currentThreadId,
    setCurrentThreadId,
    fetchThreads,
    createNewChat,
    loadThreadMessages,
    loading,
    listLoading,
    error,
    setError,
  };
}
