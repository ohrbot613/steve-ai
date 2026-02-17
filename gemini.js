 const { OpenRouter } = require('@openrouter/sdk');

const openRouter = new OpenRouter({
    apiKey: process.env.OPEN_ROUTER,
    defaultHeaders: {
        'HTTP-Referer': '<YOUR_SITE_URL>',
        'X-Title': 'Compro',
    },
});
async function geminiCall(userPrompt, sysPrompt, model = 'google/gemini-2.5-flash-lite') {
  const MAX_RETRIES = 2;
  let attempt = 0;
  while (attempt <= MAX_RETRIES) {
    try {
      const completion = await openRouter.chat.send({
        model,
        messages: [
          { role: 'system', content: sysPrompt || '' },
          { role: 'user', content: userPrompt || '' },
        ],
        stream: false,
      });

      const content =
        completion?.choices?.[0]?.message?.content ??
        completion?.output ??
        JSON.stringify(completion);

      return String(content);
    } catch (err) {
      attempt++;
      console.warn(`geminiCall attempt ${attempt} failed: ${err.message || err}`);
      if (attempt > MAX_RETRIES) throw err;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}
module.exports = { geminiCall };
