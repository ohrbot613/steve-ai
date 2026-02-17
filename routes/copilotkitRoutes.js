const express = require("express");
const router = express.Router();
// const authController = require("../controllers/AuthController");
// const copilotKitController = require("../controllers/CopilotKitController");
// const langGraphController = require("../controllers/LangGraphController");

// /**
//  * CopilotKit Routes
//  * 
//  * Following official CopilotKit.ai guidelines for self-hosted runtime.
//  * The /info endpoint must return agents in the format CopilotKit expects.
//  * 
//  * Routes:
//  * - GET/POST /api/v1/copilotkit/info - Runtime info endpoint (public, no auth)
//  * - POST /api/v1/copilotkit/chat - Main chat endpoint for AI conversations (requires auth)
//  */

// // Note: OPTIONS requests are handled by global CORS middleware in app.js

// // Handle requests to the base path - some CopilotKit versions POST to base path
// router.post("/", (req, res, next) => {
//   // #region agent log
//   fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'copilotkitRoutes.js:22',message:'POST to base path',data:{method:req.body?.method,bodyKeys:Object.keys(req.body || {})},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
//   // #endregion
//   // If the request has method: "info" in the body, route to info handler
//   if (req.body?.method === "info") {
//     return copilotKitController.copilotkitInfo(req, res, next);
//   }
//   // For other POST requests to base path without /chat, treat as info request
//   return copilotKitController.copilotkitInfo(req, res, next);
// });

// // Also handle GET requests to base path (some setups use this)
// router.get("/", (req, res, next) => {
//   // #region agent log
//   fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'copilotkitRoutes.js:34',message:'GET base path route hit',data:{path:req.path,url:req.url,query:Object.keys(req.query || {})},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'I'})}).catch(()=>{});
//   // #endregion
//   return copilotKitController.copilotkitInfo(req, res, next);
// });

// // Runtime info endpoint - GET request for agent configuration  
// // Why: CopilotKit frontend calls this to discover available agents
// // Note: CopilotKit adds /info to the runtimeUrl, so if runtimeUrl is /api/v1/copilotkit,
// // it will call /api/v1/copilotkit/info
// // Note: Info endpoint does not require auth - it's just metadata about available agents
// router.get("/info", (req, res, next) => {
//   // #region agent log
//   fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'copilotkitRoutes.js:41',message:'GET /info route hit',data:{path:req.path,url:req.url,headers:Object.keys(req.headers)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
//   // #endregion
//   return copilotKitController.copilotkitInfo(req, res, next);
// });

// // Also handle POST to /info (some CopilotKit versions use POST for info)
// router.post("/info", (req, res, next) => {
//   // #region agent log
//   fetch('http://127.0.0.1:7247/ingest/2dc7fe15-1c06-471a-9881-89688dd19a20',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'copilotkitRoutes.js:49',message:'POST /info route hit',data:{path:req.path,url:req.url,bodyMethod:req.body?.method,bodyKeys:Object.keys(req.body || {})},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H'})}).catch(()=>{});
//   // #endregion
//   return copilotKitController.copilotkitInfo(req, res, next);
// });

// // Main chat endpoint - handles POST requests with messages and context
// // Note: CopilotKit sends GraphQL-style requests (AG-UI protocol)
// router.post("/chat", authController.protect, copilotKitController.copilotkitChat);

// // Legacy route for backward compatibility (if runtimeUrl was set to /chat)
// router.get("/chat/info", authController.protect, copilotKitController.copilotkitInfo);
// router.post("/chat/info", authController.protect, copilotKitController.copilotkitInfo);

// // LangGraph agent endpoint
// router.post("/agent/langgraph", authController.protect, langGraphController.langGraphAgent);
// router.post("/agent/langgraph/stream", authController.protect, langGraphController.langGraphAgentStream);

module.exports = router;
