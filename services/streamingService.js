const { createSession } = require('better-sse');
const { v4: uuidv4 } = require('uuid');
const Message = require('../modals/messageModal');
const Thread = require('../modals/threadModal');

/**
 * Stream LangChain agent responses via SSE
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @param {Object} options - Streaming options
 * @param {Object} options.agent - The bound LLM with tools (llmWithTools)
 * @param {string} options.input - The user's message
 * @param {string|null} options.threadId - Optional thread ID for conversation continuity
 * @param {string} options.userId - User ID for thread ownership
 * @param {Array} options.systemMessages - LangChain message array (system + history + user)
 * @param {Object} options.context - Context from the current page
 */
async function streamAgentResponse(req, res, options) {
  const { agent, input, threadId: initialThreadId, userId, systemMessages, context } = options;

  // Create SSE session (automatically sets headers and manages keep-alive)
  const session = await createSession(req, res);

  // Token accumulation for buffer-then-save
  let fullResponse = '';
  let threadId = initialThreadId;
  let toolCallsUsed = [];

  // AbortController for client disconnect cleanup
  const abortController = new AbortController();
  req.on('close', () => {
    console.log('[Streaming] Client disconnected, aborting stream');
    abortController.abort();
  });

  try {
    console.log('[Streaming] Starting LLM stream...');

    // Stream from LangChain (same pattern as existing streaming code)
    const streamResponse = await agent.stream(systemMessages);

    for await (const chunk of streamResponse) {
      // Check if client disconnected
      if (abortController.signal.aborted) {
        console.log('[Streaming] Aborted due to client disconnect');
        break;
      }

      // Handle token content
      if (chunk.content) {
        fullResponse += chunk.content;
        await session.push({ token: chunk.content }, 'token');
      }

      // Handle tool calls
      if (chunk.tool_calls && chunk.tool_calls.length > 0) {
        for (const toolCall of chunk.tool_calls) {
          console.log(`[Streaming] Tool called: ${toolCall.name}`);
          toolCallsUsed.push(toolCall);
          await session.push({
            tool: toolCall.name,
            args: toolCall.args
          }, 'tool_start');
        }
      }
    }

    // Stream complete - save to MongoDB if not aborted
    if (!abortController.signal.aborted) {
      console.log(`[Streaming] Stream complete. Response length: ${fullResponse.length}`);

      // Create thread if needed
      if (!threadId) {
        const newThreadId = uuidv4();
        await Thread.create({ threadId: newThreadId, userId });
        threadId = newThreadId;
        console.log(`[Streaming] Created new thread: ${threadId}`);
      }

      // Save both user and assistant messages
      const messagesToSave = [
        { threadId, role: 'user', content: input },
        {
          threadId,
          role: 'assistant',
          content: fullResponse,
          metadata: toolCallsUsed.length > 0 ? { toolCalls: toolCallsUsed } : {}
        }
      ];

      await Message.insertMany(messagesToSave);
      console.log(`[Streaming] Saved ${messagesToSave.length} messages to thread ${threadId}`);

      // Send completion event
      await session.push({ done: true, threadId }, 'end');
    }
  } catch (error) {
    console.error('[Streaming] Error during stream:', error);

    // Send error event to client
    try {
      await session.push({ error: error.message }, 'error');
    } catch (pushError) {
      console.error('[Streaming] Failed to send error to client:', pushError);
    }
  } finally {
    // Cleanup
    console.log('[Streaming] Cleaning up resources');
  }
}

module.exports = { streamAgentResponse };
