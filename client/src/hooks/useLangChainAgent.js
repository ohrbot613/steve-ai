import { useState, useCallback } from 'react';

const useLangChainAgent = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);

  const callLLM = useCallback(async ({ prompt, systemPrompt, ...customParams }) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/v1/agent/run', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: prompt,
          ...customParams
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return {
        content: data.content || data.result,
        choices: data.choices,
        success: data.success
      };
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const streamLLM = useCallback(async ({ prompt, systemPrompt, ...customParams }) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/v1/agent/run', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: prompt,
          ...customParams
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      
      return {
        async *[Symbol.asyncIterator]() {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              
              const chunk = decoder.decode(value);
              const lines = chunk.split('\n');
              
              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  const data = line.slice(6);
                  if (data === '[DONE]') return;
                  
                  try {
                    const parsed = JSON.parse(data);
                    yield parsed;
                  } catch (e) {
                    // Skip invalid JSON
                  }
                }
              }
            }
          } finally {
            reader.releaseLock();
          }
        }
      };
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const callLLMStructured = useCallback(async ({ prompt, systemPrompt, schema, ...customParams }) => {
    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/v1/agent/run', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: prompt,
          ...customParams
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return {
        object: data.object,
        raw: data.raw,
        success: data.success
      };
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    callLLM,
    streamLLM,
    callLLMStructured,
    isLoading,
    error
  };
};

export default useLangChainAgent;
