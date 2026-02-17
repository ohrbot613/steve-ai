const { ChatOpenAI } = require("@langchain/openai");
const { HumanMessage, SystemMessage } = require("@langchain/core/messages");

/**
 * Evaluation utilities for intelligent tool calling and result assessment
 */

// Create a lightweight LLM instance for evaluations
function createEvaluationLLM() {
  return new ChatOpenAI({
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
}

/**
 * Evaluate if a user question requires tool calls
 * @param {string} userQuestion - The user's question
 * @returns {Promise<{needsTools: boolean, reasoning: string, suggestedTools?: string[]}>}
 */
async function evaluateQuestionIntent(userQuestion) {
  try {
    const llm = createEvaluationLLM();
    
    const systemPrompt = `You are an AI assistant that analyzes user questions to determine if they require calling tools or can be answered directly.

IMPORTANT: The user may be asking about:
1. **Previous responses** - Questions like "what did you say about X?", "tell me more about that", "explain that again", "what was that supplier?", etc. These can be answered from conversation history WITHOUT calling tools.
2. **Current page context** - Questions about what's on the current page they're viewing, like "what supplier is this?", "what invoices are shown here?", etc. These may use context information provided in the message.
3. **New information** - Questions requiring fresh data from database or Xero, which DO require tools.

Available tools include:
- get_invoices: Get invoices from database
- get_suppliers: Get suppliers from database
- get_logs: Get processing logs
- get_supplier_details: Get detailed supplier information from database and Xero
- detect_upload_intent: Detect if user wants to upload documents
- text_formatter: Format text

Analyze the user question and determine:
1. Is this asking about a previous response or conversation? (needsTools: false)
2. Is this asking about the current page context? (may need tools only if context is insufficient)
3. Is this asking for new information? (needsTools: true)
4. If tools are needed, which tools might be needed?
5. Provide brief reasoning for your decision.

Respond with a JSON object in this exact format:
{
  "needsTools": true/false,
  "reasoning": "brief explanation",
  "suggestedTools": ["tool_name1", "tool_name2"] or []
}`;

    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(`User question: "${userQuestion}"\n\nAnalyze this question. If it's asking about a previous response or the current page context, set needsTools to false. Only set needsTools to true if new data from database/Xero is required.\n\nRespond with JSON.`),
    ];

    const response = await llm.invoke(messages);
    const content = response.content.trim();
    
    // Try to parse JSON from response
    let parsed;
    try {
      // Extract JSON from markdown code blocks if present
      const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/) || content.match(/(\{[\s\S]*\})/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1]);
      } else {
        parsed = JSON.parse(content);
      }
    } catch (e) {
      // If parsing fails, try to extract information from text
      const needsTools = /needsTools|requires.*tool|need.*tool/i.test(content);
      parsed = {
        needsTools: needsTools,
        reasoning: content.substring(0, 200),
        suggestedTools: [],
      };
    }

    return {
      needsTools: parsed.needsTools === true,
      reasoning: parsed.reasoning || "Unable to determine",
      suggestedTools: parsed.suggestedTools || [],
    };
  } catch (error) {
    console.error("Error in evaluateQuestionIntent:", error);
    // Fallback: assume tools might be needed if we can't determine
    return {
      needsTools: true,
      reasoning: `Evaluation error: ${error.message}`,
      suggestedTools: [],
    };
  }
}

/**
 * Evaluate if a tool result matches the user's question
 * @param {string} userQuestion - The original user question
 * @param {string} toolResult - The result from the tool execution
 * @param {string} toolName - Name of the tool that was called
 * @param {number} iterationCount - Current iteration number
 * @param {Array} previousToolCalls - Array of previously called tools
 * @returns {Promise<{matches: boolean, confidence: number, gaps: string[], shouldContinue: boolean, nextAction: 'tool' | 'ai' | 'done', reasoning: string}>}
 */
async function evaluateToolResult(userQuestion, toolResult, toolName, iterationCount = 1, previousToolCalls = []) {
  try {
    const llm = createEvaluationLLM();
    
    const systemPrompt = `You are an AI assistant that evaluates whether tool results adequately answer user questions.

Your task is to:
1. Determine if the tool result fully answers the user's question
2. Provide a confidence score (0-100) indicating how well the result matches the question
3. Identify any gaps or missing information
4. Decide if another tool call is needed or if an AI response should be generated
5. Consider iteration count and previous tool calls to avoid infinite loops

Evaluation criteria:
- Does the result contain the information needed to answer the question?
- Is the information complete and accurate?
- Are there any obvious gaps that another tool could fill?
- Has the same tool been called multiple times unnecessarily?

Respond with a JSON object in this exact format:
{
  "matches": true/false,
  "confidence": 0-100,
  "gaps": ["gap1", "gap2"],
  "shouldContinue": true/false,
  "nextAction": "tool" | "ai" | "done",
  "reasoning": "detailed explanation"
}

Where:
- matches: true if result fully answers the question, false otherwise
- confidence: 0-100 score (0 = no match, 100 = perfect match)
- gaps: array of missing information or issues
- shouldContinue: true if another iteration is needed, false if we should stop
- nextAction: "tool" if another tool should be called, "ai" if AI should generate response, "done" if complete
- reasoning: detailed explanation of your evaluation`;

    const previousCallsInfo = previousToolCalls.length > 0 
      ? `\n\nPreviously called tools: ${previousToolCalls.join(', ')}`
      : '';
    
    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(`User Question: "${userQuestion}"

Tool Called: ${toolName}
Iteration: ${iterationCount}${previousCallsInfo}

Tool Result:
${typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult, null, 2)}

Evaluate if this result answers the user's question. Respond with JSON.`),
    ];

    const response = await llm.invoke(messages);
    const content = response.content.trim();
    
    // Try to parse JSON from response
    let parsed;
    try {
      // Extract JSON from markdown code blocks if present
      const jsonMatch = content.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/) || content.match(/(\{[\s\S]*\})/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1]);
      } else {
        parsed = JSON.parse(content);
      }
    } catch (e) {
      // If parsing fails, try to extract information from text
      const matches = /matches|fully.*answer|complete/i.test(content);
      const confidenceMatch = content.match(/confidence[:\s]*(\d+)/i);
      const confidence = confidenceMatch ? parseInt(confidenceMatch[1]) : (matches ? 70 : 30);
      
      parsed = {
        matches: matches,
        confidence: Math.max(0, Math.min(100, confidence)),
        gaps: content.includes('missing') || content.includes('gap') ? ['Unable to parse detailed gaps'] : [],
        shouldContinue: !matches && iterationCount < 10,
        nextAction: matches ? 'done' : (iterationCount < 5 ? 'tool' : 'ai'),
        reasoning: content.substring(0, 300),
      };
    }

    // Ensure confidence is between 0-100
    parsed.confidence = Math.max(0, Math.min(100, parsed.confidence || 50));
    
    // If confidence is very high (>= 80), consider it a match
    if (parsed.confidence >= 80 && !parsed.matches) {
      parsed.matches = true;
      parsed.shouldContinue = false;
      parsed.nextAction = 'done';
    }
    
    // If we've done many iterations, be more lenient
    if (iterationCount >= 8) {
      if (parsed.confidence >= 60) {
        parsed.matches = true;
        parsed.shouldContinue = false;
        parsed.nextAction = 'done';
      }
    }

    return {
      matches: parsed.matches === true,
      confidence: parsed.confidence,
      gaps: Array.isArray(parsed.gaps) ? parsed.gaps : [],
      shouldContinue: parsed.shouldContinue === true && iterationCount < 10,
      nextAction: ['tool', 'ai', 'done'].includes(parsed.nextAction) ? parsed.nextAction : 'ai',
      reasoning: parsed.reasoning || "Evaluation completed",
    };
  } catch (error) {
    console.error("Error in evaluateToolResult:", error);
    // Fallback: assume result is good enough if we can't evaluate
    return {
      matches: iterationCount >= 3, // After 3 iterations, assume it's good enough
      confidence: 60,
      gaps: [`Evaluation error: ${error.message}`],
      shouldContinue: iterationCount < 5,
      nextAction: iterationCount >= 5 ? 'ai' : 'tool',
      reasoning: `Evaluation failed: ${error.message}`,
    };
  }
}

/**
 * Determine next action based on evaluation result
 * @param {Object} evaluation - Result from evaluateToolResult
 * @param {Array} availableTools - List of available tool names
 * @param {Array} previousToolCalls - Previously called tools
 * @returns {Promise<{action: 'tool' | 'ai' | 'done', toolName?: string, reasoning: string}>}
 */
async function determineNextAction(evaluation, availableTools = [], previousToolCalls = []) {
  if (evaluation.nextAction === 'done' || !evaluation.shouldContinue) {
    return {
      action: 'done',
      reasoning: evaluation.reasoning,
    };
  }

  if (evaluation.nextAction === 'ai') {
    return {
      action: 'ai',
      reasoning: evaluation.reasoning,
    };
  }

  // If nextAction is 'tool', try to suggest which tool to call next
  // This is a simple heuristic - in a more advanced system, we could use AI here too
  const unusedTools = availableTools.filter(t => !previousToolCalls.includes(t));
  
  return {
    action: 'tool',
    toolName: unusedTools[0] || availableTools[0],
    reasoning: evaluation.reasoning,
  };
}

module.exports = {
  evaluateQuestionIntent,
  evaluateToolResult,
  determineNextAction,
};
