# LangGraph Integration with CopilotKit

This document describes the LangGraph agent integration with CopilotKit, following the guide at: https://docs.copilotkit.ai/langgraph/quickstart?agent=bring-your-own

## Overview

The integration adds a LangGraph agent that can be used alongside the default CopilotKit agent. The LangGraph agent provides tool calling capabilities and state management through a graph-based execution flow.

## Implementation Details

### Backend

1. **LangGraphController.js** (`controllers/LangGraphController.js`)
   - Implements a LangGraph agent with state graph
   - Uses StateGraph to manage agent execution flow
   - Includes tools: calculator and get_logs
   - Handles tool calling and message flow

2. **CopilotKitController.js** (updated)
   - Updated to support multiple agents (default and langgraph-agent)
   - Routes requests to LangGraph agent when `agentId: "langgraph-agent"` is specified
   - Returns both agents in the `/info` endpoint

3. **Routes** (`routes/copilotkitRoutes.js`)
   - Added `/api/v1/copilotkit/agent/langgraph` endpoint
   - Supports both streaming and non-streaming requests

4. **App Configuration** (`app.js`)
   - Registered CopilotKit routes at `/api/v1/copilotkit`

### Frontend

1. **main.jsx** (updated)
   - Re-enabled CopilotKit provider
   - Configured with runtime URL: `/api/v1/copilotkit`

2. **LangGraphAgentDemo.jsx** (new component)
   - Demonstrates use of `useAgent` hook
   - Provides direct access to LangGraph agent
   - Shows agent state, messages, and execution status
   - Currently commented out in CopilotPopup component (can be enabled for testing)

3. **CopilotPopup.jsx** (updated)
   - Re-enabled CopilotKit popup
   - Includes optional LangGraph agent demo (commented out)

## Usage

### Using the Default Agent

The default CopilotKit agent works as before through the CopilotPopup component.

### Using the LangGraph Agent

#### Option 1: Via useAgent Hook (Direct Access)

```jsx
import { useAgent } from "@copilotkit/react-core/v2";

function MyComponent() {
  const { agent } = useAgent({ agentId: "langgraph-agent" });
  
  // Access agent state
  const messages = agent.messages;
  const isRunning = agent.isRunning;
  
  // Add a message and run the agent
  agent.addMessage({
    id: crypto.randomUUID(),
    role: "user",
    content: "Hello, LangGraph agent!"
  });
  
  await agent.runAgent();
}
```

#### Option 2: Via CopilotKit Chat

The LangGraph agent can be selected in the CopilotKit UI if multiple agents are available.

### Available Tools

1. **calculator**: Adds two numbers
   - Parameters: `a` (number), `b` (number)
   - Returns: Sum as string

2. **get_logs**: Retrieves processing logs from database
   - Parameters: 
     - `logId` (optional): Specific log ID
     - `supplierId` (optional): Filter by supplier
     - `status` (optional): Filter by status (started, completed, failed)
     - `page` (optional): Page number
     - `limit` (optional): Results per page (max 20)
   - Returns: JSON string with logs data

## Agent State Graph

The LangGraph agent uses a state graph with the following flow:

1. **START** → **agent** (callModel)
   - Invokes the LLM with current messages
   - LLM may return tool calls

2. **agent** → **shouldContinue** (conditional)
   - If tool calls exist → **tools**
   - Otherwise → **END**

3. **tools** → **agent**
   - Executes tool calls
   - Returns tool results
   - Loops back to agent for final response

## Environment Variables

Required environment variables:
- `OPEN_ROUTER` or `OPENAI_API_KEY`: API key for LLM
- `COPILOTKIT_MODEL` (optional): Model name (default: "openai/gpt-3.5-turbo")
- `SITE_URL` (optional): Site URL for OpenRouter headers
- `VITE_COPILOTKIT_PUBLIC_API_KEY` (optional): Public API key for CopilotKit frontend

## Testing

1. Start the backend server:
   ```bash
   npm start
   ```

2. Start the frontend dev server:
   ```bash
   cd client
   npm run dev
   ```

3. Test the default agent:
   - Open the CopilotKit popup
   - Send a message
   - Verify response

4. Test the LangGraph agent:
   - Uncomment `<LangGraphAgentDemo />` in `CopilotPopup.jsx`
   - Use the demo component to interact with the LangGraph agent
   - Try tool calls like "What is 5 + 3?" or "Get logs"

## Next Steps

1. **Add More Tools**: Extend the agent with additional tools from `LangChainController.js`
2. **Streaming Support**: Implement Server-Sent Events for streaming responses
3. **Human-in-the-Loop**: Add interrupt support for user input during agent execution
4. **Shared State**: Implement shared state between frontend and agent
5. **Error Handling**: Enhance error handling and retry logic

## References

- [CopilotKit LangGraph Quickstart](https://docs.copilotkit.ai/langgraph/quickstart?agent=bring-your-own)
- [useAgent Hook Documentation](https://docs.copilotkit.ai/langgraph/use-agent-hook)
- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/)
