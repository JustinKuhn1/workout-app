// Vercel serverless function: turns questionnaire answers into a weekly workout plan using Gemini.

// CHANGED: use Google's official SDK, as the Gemini quickstart recommends, instead of a hand-written fetch.
const { GoogleGenAI } = require("@google/genai");
const REQUIRED_FIELDS = ["goal", "experience", "daysPerWeek", "sessionMinutes", "equipment"];

// The JSON shape Gemini must reply with.
const PLAN_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string" },
    days: {
      type: "array",
      items: {
        type: "object",
        properties: {
          day: { type: "string" },
          focus: { type: "string" },
          exercises: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                sets: { type: "integer" },
                reps: { type: "string" },
                notes: { type: "string" },
              },
              required: ["name", "sets", "reps"],
            },
          },
        },
        required: ["day", "focus", "exercises"],
      },
    },
    tips: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "days"],
};

function buildPrompt(answers) {
  return `You are a certified personal trainer. Create a weekly workout plan for this client:

${JSON.stringify(answers, null, 2)}

Rules:
- Create exactly ${answers.daysPerWeek} workout days, each fitting within ${answers.sessionMinutes} minutes.
- Only use the equipment the client listed.
- Match the client's experience level and goal.
- Use common, simple exercise names.
- Avoid exercises that could aggravate any listed injuries.`;
}

function isMissing(value) {
  return !value || value.length === 0;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const answers = req.body || {};
  const missing = REQUIRED_FIELDS.filter((field) => isMissing(answers[field]));
  if (missing.length > 0) {
    return res.status(400).json({ error: "Missing fields: " + missing.join(", ") });
  }

  try {
    // CHANGED: the SDK sends the same request as before (same model, input and response_format),
    // and interaction.output_text gives the reply text directly, so we no longer parse the reply's steps by hand.
    // The client is created inside the try so a missing API key is reported instead of crashing the function.
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const interaction = await ai.interactions.create({
      model: "gemini-3.8-flash",
      input: buildPrompt(answers),
      response_format: { type: "text", mime_type: "application/json", schema: PLAN_SCHEMA },
    });

    if (!interaction.output_text) throw new Error("Gemini returned no text (status: " + interaction.status + ")");

    const plan = JSON.parse(interaction.output_text);
    if (!Array.isArray(plan.days) || plan.days.length === 0) throw new Error("Plan has no days");

    res.status(200).json(plan);
  } catch (err) {
    console.error("generate-plan failed:", err.message);
    // CHANGED: also send the real reason to the browser as "detail" so it shows in the console (F12),
    // instead of only in the Vercel logs. Remove "detail" once everything works if you'd rather not expose it.
    res.status(500).json({ error: "Could not generate a plan. Please try again.", detail: err.message });
  }
};
