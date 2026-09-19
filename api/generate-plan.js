// Vercel serverless function: turns questionnaire answers into a weekly workout plan using Gemini.

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
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
    const response = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "x-goog-api-key": process.env.GEMINI_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gemini-3.8-flash",
        input: buildPrompt(answers),
        response_format: { type: "text", mime_type: "application/json", schema: PLAN_SCHEMA },
      }),
    });
    // CHANGED: include Gemini's own error body in the message. The status number alone doesn't
    // say whether it was a missing key, a bad model name or a quota limit.
    if (!response.ok) {
      const detail = await response.text();
      throw new Error("Gemini returned status " + response.status + ": " + detail.slice(0, 500));
    }

    const data = await response.json();

    // CHANGED: the reply is { interaction: { output_text, steps } }. The old code read data.steps,
    // which is undefined, so .find() threw a TypeError and the browser just saw a 500.
    const interaction = data.interaction || {};
    let text = interaction.output_text;

    // Fallback if output_text is absent: the first step can be a "thought", so find model_output.
    if (!text && Array.isArray(interaction.steps)) {
      const outputStep = interaction.steps.find((step) => step.type === "model_output");
      const part = outputStep && (outputStep.content || []).find((item) => item.type === "text");
      text = part && part.text;
    }
    if (!text) throw new Error("No output text in the Gemini reply: " + JSON.stringify(data).slice(0, 500));

    const plan = JSON.parse(text);
    if (!Array.isArray(plan.days) || plan.days.length === 0) throw new Error("Plan has no days");

    res.status(200).json(plan);
  } catch (err) {
    // Log the real reason on the server only; the browser gets a generic message.
    console.error("generate-plan failed:", err.message);
    res.status(500).json({ error: "Could not generate a plan. Please try again." });
  }
};
