import { GoogleGenAI } from "@google/genai";
import { env, envOptional } from "./env.js";

let _ai: GoogleGenAI | null = null;
export function gemini(): GoogleGenAI {
  if (_ai) return _ai;
  _ai = new GoogleGenAI({ apiKey: env("GEMINI_API_KEY") });
  return _ai;
}

export function geminiModel(): string {
  return envOptional("GEMINI_MODEL") ?? "gemini-2.5-flash";
}

export function geminiEmbeddingModel(): string {
  return envOptional("GEMINI_EMBEDDING_MODEL") ?? "gemini-embedding-001";
}
