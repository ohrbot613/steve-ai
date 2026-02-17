const { StateGraph, END, START } = require("@langchain/langgraph");
const { ChatOpenAI } = require("@langchain/openai");
const { HumanMessage, AIMessage, SystemMessage, ToolMessage } = require("@langchain/core/messages");
const { tryCatchAsync } = require("./ErrorController");
const { getToolsForAgent } = require("../utils/agentTools");

/**
 * LangGraph Agent Controller
 * 
 * This controller implements a LangGraph agent that can be used with CopilotKit.
 * It uses a state graph to manage agent execution flow and tool calling.
 * 
 * Based on: https://docs.copilotkit.ai/langgraph/quickstart?agent=bring-your-own
 */

// Define the agent state
const AgentState = {
  messages: {
    value: (x, y) => x.concat(y),
    default: () => [],
  },
};

// Create the LLM with tools
function createLLM() {
  const apiKey = process.env.OPEN_ROUTER || process.env.OPENAI_API_KEY;
  const baseURL = process.env.OPEN_ROUTER 
    ? "https://openrouter.ai/api/v1"
    : undefined;

  const llm = new ChatOpenAI({
    modelName: process.env.COPILOTKIT_MODEL || "openai/gpt-3.5-turbo",
    temperature: 0.7,
    apiKey: apiKey,
    ...(baseURL && {
      configuration: {
        baseURL: baseURL,
        defaultHeaders: process.env.OPEN_ROUTER ? {
          "HTTP-Referer": process.env.SITE_URL || "<YOUR_SITE_URL>",
          "X-Title": "PDF Automation",
        } : undefined,
      },
    }),
  });

  const tools = getToolsForAgent("langgraph");
  return llm.bindTools(tools);
}

// Node: Call the model
async function callModel(state) {
  const llm = createLLM();
  const messages = state.messages;
  const response = await llm.invoke(messages);
  return { messages: [response] };
}

// Node: Execute tools
async function executeTools(state) {
  const lastMessage = state.messages[state.messages.length - 1];
  const toolCalls = lastMessage.tool_calls || [];
  
  const tools = getToolsForAgent("langgraph");
  const toolResults = [];

  for (const toolCall of toolCalls) {
    const tool = tools.find(t => t.name === toolCall.name);
    if (tool) {
      try {
        const result = await tool.invoke(toolCall.args);
        toolResults.push(
          new ToolMessage({
            content: String(result),
            tool_call_id: toolCall.id,
          })
        );
      } catch (error) {
        toolResults.push(
          new ToolMessage({
            content: `Error: ${error.message}`,
            tool_call_id: toolCall.id,
          })
        );
      }
    }
  }

  return { messages: toolResults };
}

// Conditional edge: Check if we should continue
function shouldContinue(state) {
  const lastMessage = state.messages[state.messages.length - 1];
  if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
    return "tools";
  }
  return END;
}

// Build the graph
function createAgentGraph() {
  const workflow = new StateGraph(AgentState)
    .addNode("agent", callModel)
    .addNode("tools", executeTools)
    .addEdge(START, "agent")
    .addConditionalEdges("agent", shouldContinue)
    .addEdge("tools", "agent");

  return workflow.compile();
}

// Main handler for LangGraph agent
exports.langGraphAgent = tryCatchAsync(async (req, res) => {
  const { messages, agentId } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({
      error: "Invalid request: messages array is required"
    });
  }

  try {
    // Get user information from authentication middleware
    const user = req.user;
    const userInfo = user ? {
      userId: user._id.toString(),
      userEmail: user.email,
    } : null;

    // Build system prompt
    let systemPrompt = `You are an AI assistant for a PDF automation and supplier reconciliation system.
Your role is to help users understand and work with suppliers, invoices, statements, and related data.

Application Context:
- This is a supplier reconciliation system for managing invoices and statements
- Users can view suppliers, invoices, statements, and activity logs
- The system helps match invoices between supplier statements and Xero accounting system

`;

    if (userInfo) {
      systemPrompt += `Current User: ${userInfo.userEmail} (ID: ${userInfo.userId})\n\n`;
    }

    // Convert messages to LangChain format
    const langchainMessages = [
      new SystemMessage(systemPrompt),
      ...messages.map(msg => {
        if (msg.role === "user") {
          return new HumanMessage(msg.content);
        } else if (msg.role === "assistant") {
          return new AIMessage(msg.content);
        }
        return new HumanMessage(msg.content);
      })
    ];

    // Create and run the agent graph
    const graph = createAgentGraph();
    const initialState = { messages: langchainMessages };
    const result = await graph.invoke(initialState);

    // Extract the final response
    const finalMessage = result.messages[result.messages.length - 1];
    const responseContent = finalMessage.content || "";

    // Return response in CopilotKit format
    return res.status(200).json({
      choices: [{
        message: {
          role: "assistant",
          content: responseContent
        },
        finish_reason: "stop"
      }]
    });

  } catch (error) {
    console.error("LangGraph agent error:", error);
    return res.status(500).json({
      error: "Failed to generate response",
      message: error.message
    });
  }
});

// Stream handler for LangGraph agent (for future streaming support)
exports.langGraphAgentStream = tryCatchAsync(async (req, res) => {
  // TODO: Implement streaming with Server-Sent Events
  // For now, redirect to non-streaming endpoint
  return exports.langGraphAgent(req, res);
});
