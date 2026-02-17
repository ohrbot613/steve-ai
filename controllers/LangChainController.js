const { ChatOpenAI } = require("@langchain/openai");
const { HumanMessage, AIMessage, ToolMessage } = require("@langchain/core/messages");
const { tryCatchAsync } = require("./ErrorController");
const axios = require("axios");
const { getToolsForAgent, textFormatterTool, setRequestContext, clearRequestContext } = require("../utils/agentTools");
const { evaluateQuestionIntent, evaluateToolResult, determineNextAction } = require("../utils/agentEvaluation");
const { streamAgentResponse } = require("../services/streamingService");

const langfuseModule = require("langfuse");
const { Langfuse } = langfuseModule;

// Initialize Langfuse client (only if keys are provided)
const langfuse = new Langfuse({
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  baseUrl: process.env.LANGFUSE_HOST,
});

// Helper function to fetch prompt from Langfuse - throws error if not available
async function getSinglePrompt(promptName) {
  try {
    const baseUrl = process.env.LANGFUSE_HOST || "https://cloud.langfuse.com";

    // Append ?version=latest or ?version=1 to the URL
    const apiUrl = `${baseUrl}/api/public/v2/prompts/${promptName}?version=latest`;

    const auth = Buffer.from(
      `${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`
    ).toString('base64');

    const response = await axios.get(apiUrl, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      }
    });

    // Langfuse returns the prompt object. 
    // The actual text is usually in response.data.prompt
    return response.data;
  } catch (error) {
    console.error(`Failed: ${error.message}`);
    return null;
  }
}

// Helper function to get all prompts from Langfuse using Public API
async function getAllPrompts() {
  if (!langfuse || !process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
    console.warn("Langfuse not configured. Cannot fetch prompts.");
    return [];
  }

  try {
    const baseUrl = process.env.LANGFUSE_HOST || "https://cloud.langfuse.com";
    const apiUrl = `${baseUrl}/api/public/v2/prompts`;

    // Use Basic Auth with public key and secret key
    const auth = Buffer.from(
      `${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`
    ).toString('base64');

    const response = await axios.get(apiUrl, {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      }
    });

    // Handle pagination if needed
    let prompts = response.data.data || response.data || [];

    // If there's pagination, fetch all pages
    if (response.data.pageInfo && response.data.pageInfo.hasNextPage) {
      let page = 1;
      while (response.data.pageInfo.hasNextPage) {
        page++;
        const nextResponse = await axios.get(apiUrl, {
          params: { page },
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json'
          }
        });
        prompts = prompts.concat(nextResponse.data.data || nextResponse.data || []);
        if (!nextResponse.data.pageInfo || !nextResponse.data.pageInfo.hasNextPage) {
          break;
        }
      }
    }

    return prompts;
  } catch (error) {
    console.error(`Failed to fetch all prompts from Langfuse: ${error.message}`);
    if (error.response) {
      console.error(`Status: ${error.response.status}, Data:`, error.response.data);
    }
    return [];
  }
}

async function getSystemPrompt(name, label = 'latest') {
  return langfuse.getPrompt(name, undefined, {
    label: label, // Use the 'latest' tag to get dev versions
    cacheTtlSeconds: parseInt(process.env.LANGFUSE_CACHE_TTL_SECONDS) || 60
  });
}

// Helper function to fetch conversation history from Langfuse by sessionId
async function getConversationHistory(sessionId, userId = null) {
  if (!langfuse || !sessionId || !process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
    return [];
  }

  try {
    const baseUrl = process.env.LANGFUSE_HOST || "https://cloud.langfuse.com";
    
    // Try using the SDK's fetchTraces method if available, otherwise use REST API
    // First, try the correct API endpoint structure
    const apiUrl = `${baseUrl}/api/public/traces`;

    const auth = Buffer.from(
      `${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`
    ).toString('base64');

    // Build query parameters - try different parameter formats
    const params = {
      sessionId: sessionId, // Try camelCase first
      limit: 50,
    };

    if (userId) {
      params.userId = userId;
    }

    let response;
    try {
      response = await axios.get(apiUrl, {
        params: params,
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json'
        }
      });
    } catch (firstError) {
      // If that fails, try with snake_case parameters
      if (firstError.response?.status === 404) {
        const paramsSnake = {
          session_id: sessionId,
          limit: 50,
        };
        if (userId) {
          paramsSnake.user_id = userId;
        }
        response = await axios.get(apiUrl, {
          params: paramsSnake,
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json'
          }
        });
      } else {
        throw firstError;
      }
    }

    const traces = response.data?.data || response.data?.traces || response.data || [];
    
    // Convert traces to conversation messages
    const conversationHistory = [];
    
    // Sort traces by timestamp (oldest first) to maintain conversation order
    const sortedTraces = traces.sort((a, b) => {
      const timeA = new Date(a.timestamp || a.createdAt || a.created_at || 0).getTime();
      const timeB = new Date(b.timestamp || b.createdAt || b.created_at || 0).getTime();
      return timeA - timeB;
    });
    
    for (const trace of sortedTraces) {
      // Extract user message from trace input
      if (trace.input) {
        let userInput = trace.input;
        if (typeof userInput === 'object') {
          // Try different possible fields
          userInput = userInput.prompt || userInput.message || userInput.content || 
                     (Array.isArray(userInput) ? userInput.map(m => m.content || m.text || m.message).join('\n') : JSON.stringify(userInput));
        }
        if (userInput && typeof userInput === 'string' && userInput.trim()) {
          // Remove context info if present (to avoid duplication)
          const cleanInput = userInput.replace(/\n\n\[Context from current page:.*?\]/g, '').trim();
          if (cleanInput) {
            conversationHistory.push(new HumanMessage(cleanInput));
          }
        }
      }

      // Extract assistant response from trace output
      if (trace.output) {
        let assistantOutput = trace.output;
        if (typeof assistantOutput === 'object') {
          assistantOutput = assistantOutput.content || assistantOutput.result || assistantOutput.text || 
                           (assistantOutput.choices?.[0]?.message?.content) || JSON.stringify(assistantOutput);
        }
        if (assistantOutput && typeof assistantOutput === 'string' && assistantOutput.trim()) {
          conversationHistory.push(new AIMessage(assistantOutput));
        }
      }
    }

    return conversationHistory;
  } catch (error) {
    // Silently fail - don't log errors for missing conversation history
    // This is expected if Langfuse is not properly configured or if it's a new session
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`Could not fetch conversation history from Langfuse (this is OK for new sessions): ${error.message}`);
    }
    // Return empty array on error so conversation can continue
    return [];
  }
}

exports.langchainAgent = tryCatchAsync(async (req, res) => {
  const { prompt, message, stream, schema, headers, context, conversationHistory, ...customParams } = req.body;

  const systemPrompt = await getSystemPrompt("langchain-agent-system-prompt");


  const systemInstructions = systemPrompt.compile();
  
  // Handle both string and array message formats (for Cedar compatibility)
  let userMessage = prompt || message;
  if (Array.isArray(userMessage)) {
    // Extract the last user message from the array
    const lastMsg = userMessage[userMessage.length - 1];
    userMessage = typeof lastMsg === 'string' 
      ? lastMsg 
      : (lastMsg?.content || lastMsg?.text || lastMsg?.message || JSON.stringify(lastMsg));
  }
  
  // Extract context and include in system message or user message
  let contextInfo = '';
  if (context) {
    const contextParts = [];
    if (context.supplierId) {
      contextParts.push(`You are viewing a supplier page (Supplier ID: ${context.supplierId})`);
    }
    if (context.logId) {
      contextParts.push(`You are viewing a statement/log page (Log ID: ${context.logId})`);
    }
    if (context.currentPage) {
      // Make page context more descriptive
      const pageDescriptions = {
        '/suppliers': 'suppliers list page',
        '/supplier/': 'supplier details page',
        '/logs': 'statements/logs page',
        '/log/': 'statement/log details page',
        '/invoices': 'invoices page',
      };
      let pageDesc = context.currentPage;
      for (const [path, desc] of Object.entries(pageDescriptions)) {
        if (context.currentPage.includes(path)) {
          pageDesc = desc;
          break;
        }
      }
      contextParts.push(`Current page: ${pageDesc}`);
    }
    if (contextParts.length > 0) {
      contextInfo = `\n\n[Context from current page: ${contextParts.join('. ')}. If the user asks about "this supplier", "this page", "what's shown here", or similar, they're referring to the current page context.]`;
    }
  }
  
  // Store context and Xero credentials in req for tools to access
  req.context = context || {};
  // Xero credentials are already in req.xeroAccessToken and req.xeroTenantId from middleware
  
console.log("userMessage", userMessage);
console.log("context", context);
const sessionId = req.body.sessionId;
  if (!userMessage) {
    return res.status(400).json({
      success: false,
      error: "Please provide a 'prompt' or 'message' in the request body",
    });
  }

  // Handle streaming requests
  if (stream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // CORS headers for streaming - use request origin (not wildcard) when credentials are included
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    try {
      // Set request context for tools to access
      setRequestContext({
        supplierId: context?.supplierId || null,
        logId: context?.logId || null,
        currentPage: context?.currentPage || null,
        xeroAccessToken: req.xeroAccessToken || null,
        xeroTenantId: req.xeroTenantId || null
      });

      const llm = new ChatOpenAI({
        modelName: "openai/gpt-3.5-turbo",
        temperature: 0,
        apiKey: process.env.OPEN_ROUTER,
        configuration: {
          baseURL: "https://openrouter.ai/api/v1",
          defaultHeaders: {
            "HTTP-Referer": process.env.SITE_URL || "<YOUR_SITE_URL>",
            "X-Title": "PDF Automation",
          },
        },
        streaming: true,
      });

      const tools = getToolsForAgent("langchain");
      const llmWithTools = llm.bindTools(tools);

      // Convert conversation history from frontend to LangChain message format
      const langchainHistory = [];
      if (conversationHistory && Array.isArray(conversationHistory)) {
        for (const msg of conversationHistory) {
          if (msg.role === 'user' && msg.content) {
            // Remove context info if present (to avoid duplication)
            const cleanContent = msg.content.replace(/\n\n\[Context from current page:.*?\]/g, '').trim();
            if (cleanContent) {
              langchainHistory.push(new HumanMessage(cleanContent));
            }
          } else if (msg.role === 'assistant' && msg.content) {
            langchainHistory.push(new AIMessage(msg.content));
          }
        }
      }
      console.log(`Using ${langchainHistory.length} previous messages from frontend conversation history (streaming)`);

      const fullUserMessage = userMessage + (contextInfo || '');
      const messages = [
        new HumanMessage(systemInstructions),
        ...langchainHistory, // Include conversation history from frontend
        new HumanMessage(fullUserMessage), // Current user message
      ].filter(Boolean);

      const streamResponse = await llmWithTools.stream(messages);

      for await (const chunk of streamResponse) {
        // Only send content chunks that have actual content
        // Cedar expects plain text chunks (not JSON wrapped) for text content
        if (chunk.content) {
          // Send as plain text chunk (Cedar format: data: text\n\n)
          const escaped = chunk.content.replace(/\n/g, '\\n');
          res.write(`data: ${escaped}\n\n`);
        }
      }

      res.write('data: [DONE]\n\n');
      res.end();
    } catch (error) {
      clearRequestContext();
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
    return;
  }

  // Handle structured response requests
  if (schema) {
    try {
      const llm = new ChatOpenAI({
        modelName: "openai/gpt-3.5-turbo",
        temperature: 0,
        apiKey: process.env.OPEN_ROUTER,
        configuration: {
          baseURL: "https://openrouter.ai/api/v1",
          defaultHeaders: {
            "HTTP-Referer": process.env.SITE_URL || "<YOUR_SITE_URL>",
            "X-Title": "PDF Automation",
          },
        },
      });

      const messages = [
        systemPrompt ? new HumanMessage(systemPrompt) : null,
        new HumanMessage(`${userMessage}\n\nPlease respond with valid JSON that matches this schema: ${JSON.stringify(schema)}`),
      ].filter(Boolean);

      const response = await llm.invoke(messages);

      try {
        const parsedContent = JSON.parse(response.content);
        res.json({
          success: true,
          object: parsedContent,
          raw: response.content,
        });
      } catch (parseError) {
        // If parsing fails, return the raw content
        res.json({
          success: true,
          object: { content: response.content },
          raw: response.content,
          parseError: parseError.message,
        });
      }
    } catch (error) {
      throw error;
    }
    return;
  }

  console.log(req.user)
  // Create a Langfuse trace for this request (if Langfuse is configured)
  const trace = langfuse ? langfuse.trace({
    name: "Main agent (Brain)",
    userId: req.user._id ,
    sessionId,
    input: typeof userMessage === 'string' ? userMessage : (userMessage?.prompt || userMessage?.content || userMessage?.text || JSON.stringify(userMessage)),
    environment: process.env.ENVIRONMENT,
    metadata: {
      endpoint: "/api/v1/langchain/langchain-agent",
    },
  }) : null;

  // trace.update({
  //   input: userMessage.prompt,
  // });

  console.log(systemPrompt)


  // Create a generation span for the LLM call
  const generation = trace ? trace.generation({
    name: "llm-call",
    model: "openai/gpt-3.5-turbo",
    modelParameters: {
      temperature: 0,
    },
    input: typeof userMessage === 'string' ? userMessage : (userMessage?.prompt || userMessage?.content || userMessage?.text || JSON.stringify(userMessage)),
  }) : null;

  try {
    // Set request context for tools to access
    setRequestContext({
      supplierId: context?.supplierId || null,
      logId: context?.logId || null,
      currentPage: context?.currentPage || null,
      xeroAccessToken: req.xeroAccessToken || null,
      xeroTenantId: req.xeroTenantId || null
    });

    const llm = new ChatOpenAI({
      modelName: "openai/gpt-3.5-turbo",
      temperature: 0,
      apiKey: process.env.OPEN_ROUTER,
      configuration: {
        baseURL: "https://openrouter.ai/api/v1",
        defaultHeaders: {
          "HTTP-Referer": process.env.SITE_URL || "<YOUR_SITE_URL>",
          "X-Title": "PDF Automation",
          ...headers, // Include custom headers
        },
      },
    });

    // Create the tools array
    const tools = getToolsForAgent("langchain");

    // Bind tools to the LLM
    const llmWithTools = llm.bindTools(tools);
    console.log('test', userMessage)
    
    // Convert conversation history from frontend to LangChain message format
    const langchainHistory = [];
    if (conversationHistory && Array.isArray(conversationHistory)) {
      for (const msg of conversationHistory) {
        if (msg.role === 'user' && msg.content) {
          // Remove context info if present (to avoid duplication)
          const cleanContent = msg.content.replace(/\n\n\[Context from current page:.*?\]/g, '').trim();
          if (cleanContent) {
            langchainHistory.push(new HumanMessage(cleanContent));
          }
        } else if (msg.role === 'assistant' && msg.content) {
          langchainHistory.push(new AIMessage(msg.content));
        }
      }
    }
    console.log(`Using ${langchainHistory.length} previous messages from frontend conversation history`);
    
    // Create messages with context
    const fullUserMessage = typeof userMessage === 'string' 
      ? userMessage + contextInfo
      : (userMessage?.prompt || userMessage?.content || userMessage?.text || JSON.stringify(userMessage)) + contextInfo;
    
    // Build messages array: system prompt, conversation history, then current message
    // Add explicit instruction about using conversation history and context
    const contextInstruction = contextInfo 
      ? `\n\n[IMPORTANT: You have access to conversation history above and context from the current page. If the user is asking about something mentioned in a previous response or about the current page they're viewing, use that information directly without calling tools unless you need fresh data.]`
      : `\n\n[IMPORTANT: You have access to conversation history above. If the user is asking about something mentioned in a previous response, use that information directly without calling tools unless you need fresh data.]`;
    
    const messages = [
      new HumanMessage(systemInstructions + contextInstruction),
      ...langchainHistory, // Include conversation history from frontend
      new HumanMessage(fullUserMessage), // Current user message
    ];

    // Log input to Langfuse
    if (generation) {
      generation.update({
        input: messages.map(m => m.content).join("\n"),
      });
    }

    // ===== ITERATIVE AI TOOL CALLING SYSTEM =====
    const MAX_ITERATIONS = 10;
    let iterationCount = 0;
    let currentMessages = [...messages];
    let result = "";
    let uploadIntent = null;
    let toolCallHistory = []; // Track called tools to avoid infinite loops
    let allToolResults = []; // Accumulate all tool results
    let allToolCalls = []; // Accumulate all tool calls for response
    const availableToolNames = tools.map(t => t.name);

    // Step 1: Evaluate if question needs tools
    // Include conversation history context in evaluation to help recognize references to previous responses
    const evaluationContext = langchainHistory.length > 0 
      ? `\n\n[Note: There are ${langchainHistory.length} previous messages in the conversation history. The user may be referring to something mentioned earlier.]`
      : '';
    
    let questionEvaluation;
    try {
      questionEvaluation = await evaluateQuestionIntent(fullUserMessage + evaluationContext);
      console.log(`[Iteration ${iterationCount}] Question evaluation:`, questionEvaluation);
    } catch (evalError) {
      console.error("Error evaluating question intent, proceeding with default behavior:", evalError);
      questionEvaluation = { needsTools: true, reasoning: "Evaluation failed, assuming tools needed" };
    }

    // If question doesn't need tools, get direct AI response
    if (!questionEvaluation.needsTools) {
      try {
        const directResponse = await llmWithTools.invoke(currentMessages);
        result = directResponse.content || directResponse.text || "";
        
        // If response has tool calls even though we thought it didn't need tools, handle them
        if (directResponse.tool_calls && directResponse.tool_calls.length > 0) {
          console.log(`[Direct Response] Unexpected tool calls detected, switching to tool execution mode`);
          // Fall through to tool execution logic
          questionEvaluation.needsTools = true;
        } else {
          // No tools needed, we have the result
          console.log(`[Direct Response] No tools needed, result length: ${result ? result.length : 0}`);
          
          // Ensure we have a result
          if (!result || result.trim() === "") {
            result = "I understand your question, but I need more information to provide a helpful answer. Could you please provide more details?";
            console.log(`[Direct Response] Empty result, using fallback message`);
          }
          
          if (generation) {
            generation.update({
              output: result,
            });
          }
          
          // Update trace and return immediately
          if (trace) {
            trace.update({
              output: result,
            });
          }
          
          clearRequestContext();
          
          const responseData = {
            success: true,
            content: result,
            choices: [{
              message: {
                content: result,
                role: 'assistant'
              }
            }],
            result: result,
            toolCalls: undefined,
          };
          
          console.log(`[Direct Response] Returning response with content length: ${result.length}`);
          return res.json(responseData);
        }
      } catch (error) {
        console.error("Error in direct response:", error);
        throw error;
      }
    }
    
    // If we reach here, either tools are needed or we detected tool calls in direct response
    if (questionEvaluation.needsTools) {
      // Iterative loop for tool calling and evaluation
      let shouldContinue = true;
      let lastEvaluation = null;

      while (shouldContinue && iterationCount < MAX_ITERATIONS) {
        iterationCount++;
        console.log(`[Iteration ${iterationCount}] Starting iteration...`);

        try {
          // Invoke the LLM with tools
          const response = await llmWithTools.invoke(currentMessages);
          const toolCalls = response.tool_calls || [];
          
          // Accumulate tool calls for final response
          if (toolCalls && toolCalls.length > 0) {
            allToolCalls = allToolCalls.concat(toolCalls);
          }

          // If no tool calls and we have content, evaluate if we should continue
          if (!toolCalls || toolCalls.length === 0) {
            if (response.content) {
              // If we have previous tool results, evaluate them
              if (allToolResults.length > 0 && lastEvaluation) {
                // Use the last evaluation to decide
                if (lastEvaluation.matches || lastEvaluation.confidence >= 70) {
                  result = response.content;
                  shouldContinue = false;
                  break;
                }
              } else {
                // No tools were called, use the response
                result = response.content;
                shouldContinue = false;
                break;
              }
            } else {
              // No content and no tool calls - something went wrong
              shouldContinue = false;
              break;
            }
          }

          // Execute tool calls
          if (toolCalls && toolCalls.length > 0) {
            // Log tool calls to Langfuse
            if (generation && iterationCount === 1) {
              generation.update({
                output: response.content,
              });
            }

            const toolResults = [];
            
            for (const toolCall of toolCalls) {
              const tool = tools.find(t => t.name === toolCall.name);
              if (tool) {
                // Track tool call
                toolCallHistory.push(toolCall.name);

                // Create a span for each tool call
                const toolSpan = trace ? trace.span({
                  name: `tool-${toolCall.name}-iter${iterationCount}`,
                  input: toolCall.args,
                }) : null;

                // For get_supplier_details, inject context if supplierId not provided
                let toolArgs = { ...toolCall.args };
                if (toolCall.name === 'get_supplier_details' && !toolArgs.supplierId && !toolArgs.supplierName && context?.supplierId) {
                  toolArgs.supplierId = context.supplierId;
                }

                const toolResult = await tool.invoke(toolArgs);

                if (toolSpan) {
                  toolSpan.update({
                    output: String(toolResult),
                  });
                }

                // Check if this is the upload intent tool
                if (toolCall.name === 'detect_upload_intent') {
                  try {
                    const parsed = JSON.parse(toolResult);
                    if (parsed.action === 'show_upload_widget') {
                      uploadIntent = parsed;
                    }
                  } catch (e) {
                    // Not JSON, ignore
                  }
                }


                const toolMessage = new ToolMessage({
                  content: String(toolResult),
                  tool_call_id: toolCall.id,
                });

                toolResults.push(toolMessage);
                allToolResults.push({
                  toolName: toolCall.name,
                  result: String(toolResult),
                });

                // Evaluate tool result after each tool execution
                try {
                  lastEvaluation = await evaluateToolResult(
                    fullUserMessage,
                    toolResult,
                    toolCall.name,
                    iterationCount,
                    toolCallHistory
                  );
                  
                  console.log(`[Iteration ${iterationCount}] Tool ${toolCall.name} evaluation:`, {
                    matches: lastEvaluation.matches,
                    confidence: lastEvaluation.confidence,
                    gaps: lastEvaluation.gaps,
                    nextAction: lastEvaluation.nextAction,
                  });

                  // If result matches, we can proceed to final response
                  if (lastEvaluation.matches || lastEvaluation.confidence >= 80) {
                    // Continue to get final AI response with all tool results
                    shouldContinue = false;
                  } else if (!lastEvaluation.shouldContinue || lastEvaluation.nextAction === 'done') {
                    // Evaluation says we should stop
                    shouldContinue = false;
                  } else if (lastEvaluation.nextAction === 'ai') {
                    // Evaluation suggests AI response instead of more tools
                    shouldContinue = false;
                  }
                  // If nextAction is 'tool', continue the loop
                } catch (evalError) {
                  console.error(`Error evaluating tool result for ${toolCall.name}:`, evalError);
                  // Continue with default behavior if evaluation fails
                  lastEvaluation = {
                    matches: false,
                    confidence: 50,
                    gaps: [`Evaluation error: ${evalError.message}`],
                    shouldContinue: iterationCount < 5,
                    nextAction: 'tool',
                    reasoning: "Evaluation failed, continuing",
                  };
                }
              }
            }

            // Add tool results to message history
            currentMessages = [
              ...currentMessages,
              response,
              ...toolResults,
            ];

            // If we should continue, the loop will iterate again
            // If not, we'll break and generate final response
          }
        } catch (iterationError) {
          console.error(`Error in iteration ${iterationCount}:`, iterationError);
          // If it's a critical error, break the loop
          if (iterationError.message.includes('rate limit') || iterationError.message.includes('timeout')) {
            shouldContinue = false;
          }
          // For other errors, try to continue or break based on iteration count
          if (iterationCount >= 3) {
            shouldContinue = false;
          }
        }

        // Safety check: if we've called the same tool multiple times, stop
        if (toolCallHistory.length > 0) {
          const toolCallCounts = {};
          toolCallHistory.forEach(tool => {
            toolCallCounts[tool] = (toolCallCounts[tool] || 0) + 1;
          });
          const maxCalls = Math.max(...Object.values(toolCallCounts));
          if (maxCalls >= 3) {
            console.log(`[Iteration ${iterationCount}] Same tool called ${maxCalls} times, stopping to prevent loop`);
            shouldContinue = false;
          }
        }
      }

      // Generate final response with all accumulated tool results
      if (allToolResults.length > 0) {
        const finalGeneration = trace ? trace.generation({
          name: "llm-final-response",
          model: "openai/gpt-3.5-turbo",
          modelParameters: {
            temperature: 0,
          },
          input: currentMessages.map(m => m.content).join("\n"),
        }) : null;

        try {
          const finalResponse = await llmWithTools.invoke(currentMessages);
          result = finalResponse.content;

          if (finalGeneration) {
            finalGeneration.update({
              output: result,
            });
          }

          // Log iteration summary
          console.log(`[Final] Completed ${iterationCount} iterations, called tools: ${toolCallHistory.join(', ')}`);
        } catch (finalError) {
          console.error("Error generating final response:", finalError);
          // If final response fails, use the last tool result or a fallback message
          if (allToolResults.length > 0) {
            result = `I've gathered the following information: ${allToolResults.map(tr => `${tr.toolName}: ${tr.result.substring(0, 200)}`).join('; ')}`;
          } else {
            throw finalError;
          }
        }
      } else {
        // No tool results but we tried - use the last response
        if (result) {
          // result already set
        } else {
          result = "I wasn't able to gather the necessary information to answer your question. Please try rephrasing or providing more context.";
        }
      }
    }

    // Update generation with output if no tool calls were made in first iteration
    if (generation && iterationCount === 0 && !questionEvaluation.needsTools) {
      generation.update({
        output: result,
      });
    }

    // Update the trace with final output
    if (trace) {
      trace.update({
        output: result,
      });
    }

    // Clear request context
    clearRequestContext();

    // Return in Cedar Copilot compatible format
    const responseData = {
      success: true,
      content: result,
      choices: [{
        message: {
          content: result,
          role: 'assistant'
        }
      }],
      // Also include the original format for backward compatibility
      result: result,
      toolCalls: allToolCalls && allToolCalls.length > 0 ? allToolCalls : undefined,
    };

    // Include upload intent if detected
    if (uploadIntent) {
      responseData.uploadIntent = uploadIntent;
    }

    res.json(responseData);
  } catch (error) {
    // Clear request context on error
    clearRequestContext();

    try {
      if (generation) {
        generation.update({
          level: "ERROR",
          statusMessage: error.message,
        });
      }

      if (trace) {
        trace.update({
          level: "ERROR",
          statusMessage: error.message,
        });
      }
    } catch (langfuseError) {
      // Silently fail Langfuse error logging to prevent cascading errors
      if (process.env.NODE_ENV !== 'production') {
        console.error('Langfuse error logging failed:', langfuseError);
      }
    }

    throw error; // Let errorHandler catch it
  }
});

// SSE streaming endpoint for real-time token delivery
exports.streamingAgent = tryCatchAsync(async (req, res) => {
  // Extract parameters from query (GET request for SSE)
  const { message, threadId, sessionId } = req.query;

  // Parse context from query parameter (JSON-encoded string)
  let context = {};
  try {
    context = JSON.parse(req.query.context || '{}');
  } catch (parseError) {
    console.warn('[Streaming] Failed to parse context from query:', parseError.message);
  }

  // Get userId from auth middleware
  const userId = req.user._id;

  // Validate required parameters
  if (!message) {
    return res.status(400).json({
      success: false,
      error: "Please provide a 'message' query parameter"
    });
  }

  console.log('[Streaming] Request received:', {
    messageLength: message.length,
    threadId: threadId || 'new',
    userId,
    hasContext: Object.keys(context).length > 0
  });

  try {
    // Set request context for tools to access
    setRequestContext({
      supplierId: context?.supplierId || null,
      logId: context?.logId || null,
      currentPage: context?.currentPage || null,
      xeroAccessToken: req.xeroAccessToken || null,
      xeroTenantId: req.xeroTenantId || null
    });

    // Get system prompt from Langfuse
    const systemPrompt = await getSystemPrompt("langchain-agent-system-prompt");
    const systemInstructions = systemPrompt.compile();

    // Set up LLM with OpenRouter (same config as existing endpoint)
    const llm = new ChatOpenAI({
      modelName: "openai/gpt-3.5-turbo",
      temperature: 0,
      apiKey: process.env.OPEN_ROUTER,
      configuration: {
        baseURL: "https://openrouter.ai/api/v1",
        defaultHeaders: {
          "HTTP-Referer": process.env.SITE_URL || "<YOUR_SITE_URL>",
          "X-Title": "PDF Automation",
        },
      },
      streaming: true,
    });

    // Get tools and bind to LLM
    const tools = getToolsForAgent("langchain");
    const llmWithTools = llm.bindTools(tools);

    // Build context info for the message
    let contextInfo = '';
    if (context) {
      const contextParts = [];
      if (context.supplierId) {
        contextParts.push(`You are viewing a supplier page (Supplier ID: ${context.supplierId})`);
      }
      if (context.logId) {
        contextParts.push(`You are viewing a statement/log page (Log ID: ${context.logId})`);
      }
      if (context.currentPage) {
        const pageDescriptions = {
          '/suppliers': 'suppliers list page',
          '/supplier/': 'supplier details page',
          '/logs': 'statements/logs page',
          '/log/': 'statement/log details page',
          '/invoices': 'invoices page',
        };
        let pageDesc = context.currentPage;
        for (const [path, desc] of Object.entries(pageDescriptions)) {
          if (context.currentPage.includes(path)) {
            pageDesc = desc;
            break;
          }
        }
        contextParts.push(`Current page: ${pageDesc}`);
      }
      if (contextParts.length > 0) {
        contextInfo = `\n\n[Context from current page: ${contextParts.join('. ')}. If the user asks about "this supplier", "this page", "what's shown here", or similar, they're referring to the current page context.]`;
      }
    }

    // Build messages array (system + user message with context)
    const fullUserMessage = message + contextInfo;
    const messages = [
      new HumanMessage(systemInstructions),
      new HumanMessage(fullUserMessage),
    ];

    console.log('[Streaming] Invoking streaming service...');

    // Call the streaming service
    await streamAgentResponse(req, res, {
      agent: llmWithTools,
      input: message,
      threadId: threadId || null,
      userId: userId,
      systemMessages: messages,
      context: context
    });

    // Clear request context after streaming completes
    clearRequestContext();
  } catch (error) {
    // Clear request context on error
    clearRequestContext();
    console.error('[Streaming] Error in streamingAgent:', error);
    throw error;
  }
});

// Simple test route to verify tools work
exports.testTools = tryCatchAsync(async (req, res) => {
  // Test text formatter tool
  const textResult = await textFormatterTool.invoke({ text: "hello world" });

  res.json({
    success: true,
    tools: {
      textFormatter: textResult,
    },
  });
});

// Route handler to get all prompts from Langfuse
exports.getAllPrompts = tryCatchAsync(async (req, res) => {
  const prompts = await getAllPrompts();

  res.json({
    success: true,
    count: prompts.length,
    prompts: prompts,
  });
});

