import type { Env } from "./types";

export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

export interface SearchResponse {
  results: SearchResult[];
  rawText: string;
}

/**
 * Buscar en la web usando Tavily API.
 * Fallback a respuesta vacía si no hay API key.
 */
export async function searchWeb(
  query: string,
  env: Env,
  options?: { maxResults?: number; searchDepth?: "basic" | "advanced" }
): Promise<SearchResponse> {
  const maxResults = options?.maxResults ?? 5;
  const searchDepth = options?.searchDepth ?? "basic";

  if (env.TAVILY_API_KEY) {
    try {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: env.TAVILY_API_KEY,
          query,
          max_results: maxResults,
          search_depth: searchDepth,
          include_raw_content: false,
        }),
      });

      if (response.ok) {
        const data = await response.json() as { results?: Array<{ title?: string; url?: string; content?: string }> };
        const results: SearchResult[] = (data.results ?? []).map((r) => ({
          title: r.title ?? "",
          url: r.url ?? "",
          content: r.content ?? "",
        }));
        return {
          results,
          rawText: results.map((r) => `[${r.title}](${r.url})\n${r.content}`).join("\n\n"),
        };
      }
    } catch {
      // Tavily fallo — continuar con fallback
    }
  }

  return { results: [], rawText: "Búsqueda web no disponible. Configura TAVILY_API_KEY." };
}

/**
 * Extraer texto limpio de una URL (best-effort).
 */
export async function fetchPageContent(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AilynBot/1.0)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (!response.ok) return "";

    const html = await response.text();
    return html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 6000);
  } catch {
    return "";
  }
}
