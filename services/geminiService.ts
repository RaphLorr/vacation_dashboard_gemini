import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

// Ensure API key is available
const apiKey = process.env.API_KEY || '';

if (!apiKey) {
  console.warn("API_KEY is missing from environment variables. Gemini features will not work.");
}

export const ai = new GoogleGenAI({ apiKey });

/**
 * Example function to generate content.
 * Can be used as a template for other service functions.
 */
export const generateText = async (prompt: string): Promise<string> => {
  try {
    const response: GenerateContentResponse = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
    });
    
    return response.text || "No response generated.";
  } catch (error) {
    console.error("Error generating content:", error);
    throw error;
  }
};
