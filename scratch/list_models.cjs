const { GoogleGenerativeAI } = require("@google/generative-ai");
require("dotenv").config({ path: ".env.local" });

async function list() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const models = await genAI.listModels();
  for (const model of models.models) {
    console.log(model.name);
  }
}

list();
