import { GoogleGenAI } from '@google/genai';
import * as dotenv from 'dotenv';
dotenv.config();

async function listModels() {
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_API_KEY });
  
  try {
    const response = await ai.models.list();
    // In the new SDK, ai.models.list() returns an iterable or array of models
    const models = [];
    for await (const model of response) {
      models.push(model.name);
    }
    console.log("Available Models:\n", models.join('\n'));
  } catch (e) {
    console.error("Error listing models:", e);
  }
}

listModels();
