import { z } from "zod";

// ---- Map pass: per-chunk analysis ----
export const ChunkAnalysisSchema = z.object({
  chunk_summary: z.string(),
  chapter_candidates: z.array(
    z.object({
      start_seconds: z.number(),
      title: z.string(),
      summary: z.string(),
    }),
  ),
  highlight_candidates: z.array(
    z.object({
      timestamp_seconds: z.number(),
      description: z.string(),
      reason: z.string(),
    }),
  ),
  keywords: z.array(z.string()),
  key_quotes: z.array(
    z.object({
      timestamp_seconds: z.number(),
      text: z.string(),
      speaker: z.string().optional(),
    }),
  ),
  entities: z.array(
    z.object({
      name: z.string(),
      type: z.enum(["person", "org", "place", "product", "other"]),
      mentions: z.number().int().nonnegative(),
    }),
  ),
  energy_score: z.number().min(0).max(10),
});
export type ChunkAnalysis = z.infer<typeof ChunkAnalysisSchema>;

// ---- Reduce pass: global analysis ----
export const GlobalAnalysisSchema = z.object({
  title: z.string(),
  chapters: z
    .array(
      z.object({
        start_seconds: z.number(),
        title: z.string(),
        summary: z.string(),
      }),
    )
    .max(12),
  highlights: z
    .array(
      z.object({
        timestamp_seconds: z.number(),
        description: z.string(),
        reason: z.string(),
      }),
    )
    .min(1)
    .max(10),
  entities: z.array(
    z.object({
      name: z.string(),
      type: z.enum(["person", "org", "place", "product", "other"]),
      mentions: z.number().int().nonnegative(),
    }),
  ),
  keywords: z.array(z.string()).max(30),
  key_quotes: z
    .array(
      z.object({
        timestamp_seconds: z.number(),
        text: z.string(),
        speaker: z.string().optional(),
      }),
    )
    .max(15),
});
export type GlobalAnalysis = z.infer<typeof GlobalAnalysisSchema>;

// ---- Gemini response_schema (Type.OBJECT format) ----
// The @google/genai SDK accepts a JSON-schema-like shape. We hand-author it
// to mirror the zod schemas above so Gemini returns valid JSON on the first try.
export const geminiChunkResponseSchema = {
  type: "object",
  properties: {
    chunk_summary: { type: "string" },
    chapter_candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          start_seconds: { type: "number" },
          title: { type: "string" },
          summary: { type: "string" },
        },
        required: ["start_seconds", "title", "summary"],
      },
    },
    highlight_candidates: {
      type: "array",
      items: {
        type: "object",
        properties: {
          timestamp_seconds: { type: "number" },
          description: { type: "string" },
          reason: { type: "string" },
        },
        required: ["timestamp_seconds", "description", "reason"],
      },
    },
    keywords: { type: "array", items: { type: "string" } },
    key_quotes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          timestamp_seconds: { type: "number" },
          text: { type: "string" },
          speaker: { type: "string" },
        },
        required: ["timestamp_seconds", "text"],
      },
    },
    entities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          type: {
            type: "string",
            enum: ["person", "org", "place", "product", "other"],
          },
          mentions: { type: "integer" },
        },
        required: ["name", "type", "mentions"],
      },
    },
    energy_score: { type: "number" },
  },
  required: [
    "chunk_summary",
    "chapter_candidates",
    "highlight_candidates",
    "keywords",
    "key_quotes",
    "entities",
    "energy_score",
  ],
} as const;

export const geminiGlobalResponseSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    chapters: {
      type: "array",
      items: {
        type: "object",
        properties: {
          start_seconds: { type: "number" },
          title: { type: "string" },
          summary: { type: "string" },
        },
        required: ["start_seconds", "title", "summary"],
      },
    },
    highlights: {
      type: "array",
      items: {
        type: "object",
        properties: {
          timestamp_seconds: { type: "number" },
          description: { type: "string" },
          reason: { type: "string" },
        },
        required: ["timestamp_seconds", "description", "reason"],
      },
    },
    entities: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          type: {
            type: "string",
            enum: ["person", "org", "place", "product", "other"],
          },
          mentions: { type: "integer" },
        },
        required: ["name", "type", "mentions"],
      },
    },
    keywords: { type: "array", items: { type: "string" } },
    key_quotes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          timestamp_seconds: { type: "number" },
          text: { type: "string" },
          speaker: { type: "string" },
        },
        required: ["timestamp_seconds", "text"],
      },
    },
  },
  required: [
    "title",
    "chapters",
    "highlights",
    "entities",
    "keywords",
    "key_quotes",
  ],
} as const;
