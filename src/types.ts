export interface Memory {
  id: string;
  content: string;
  tags: string[];
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
}

export interface Config {
  embeddings?: {
    provider?: "ollama" | "openai";
    model?: string;
    ollamaUrl?: string;
    openaiApiKey?: string;
    openaiBaseUrl?: string;
  };
}

export interface SearchResult {
  memory: Memory;
  score: number;
}

export interface EmbeddingMeta {
  dimension: number;
  entries: EmbeddingEntry[];
}

export interface EmbeddingEntry {
  pos: number;
  id: string;
  deleted?: boolean;
}

export interface BatchResult {
  id: string;
  status: "ok" | "error";
  error?: string;
}
