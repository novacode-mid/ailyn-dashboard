/**
 * agent-brain.ts — Evalúa mensajes en lenguaje natural y decide si necesita
 * ejecutar acciones en Ailyn Desktop o responder solo con RAG/LLM.
 *
 * Retorna:
 *   { type: 'desktop_actions', thinking, actions }  → crear tareas desktop
 *   { type: 'text_response' }                        → continuar con RAG normal
 */

import type { Env } from "./types";
import { runLLM } from "./llm-router";

// ── System prompt ──────────────────────────────────────────────────────────

const AGENT_SYSTEM_PROMPT = `Eres Ailyn, un agente autónomo que puede ejecutar acciones en la computadora del usuario vía Ailyn Desktop.

Tienes acceso a estas herramientas del desktop:

FILESYSTEM:
- fs_write: Crear o escribir un archivo. Config: { "path": "~/Desktop/archivo.txt", "content": "texto del archivo" }
- fs_read: Leer el contenido de un archivo. Config: { "path": "~/Desktop/archivo.txt" }
- fs_list: Listar archivos de una carpeta. Config: { "path": "~/Desktop" }
- fs_delete: Eliminar un archivo o carpeta. Config: { "path": "ruta/al/archivo.txt" }

WEB / BROWSER:
- screenshot: Tomar captura de pantalla de una URL. Config: { "url": "https://..." }
- scrape_data: Extraer texto/datos de un sitio web. Config: { "url": "https://...", "selectors": { "campo": ".css-selector" } }
- download_file: Descargar un archivo. Config: { "url": "https://...", "selector": ".download-btn" }
- fill_form: Llenar un formulario web. Config: { "url": "https://...", "fields": [{"selector": "#input", "value": "texto"}], "submitSelector": "button[type=submit]" }

RUTAS CONOCIDAS DEL USUARIO:
- Escritorio: escritorio del usuario (ruta se resolverá automáticamente)
- Documentos: carpeta de documentos del usuario
- Si necesitas una ruta específica, pregunta al usuario

INSTRUCCIONES CRÍTICAS:
Analiza si el mensaje del usuario requiere acciones en la computadora (crear archivos, leer archivos, listar carpetas, visitar webs).
Si SÍ necesitas desktop, responde ÚNICAMENTE con JSON válido:

{
  "thinking": "breve explicación de lo que vas a hacer",
  "actions": [
    { "tool": "fs_write", "config": { "path": "~/Desktop/hola.txt", "content": "hola pedro" } }
  ]
}

Si NO necesitas desktop (preguntas generales, saludos, consultas de información), responde solo con:
NO_DESKTOP

REGLAS:
- Máximo 3 acciones por respuesta
- Para fs_write/fs_read/fs_list usar rutas del escritorio o documentos del usuario
- Para URLs siempre incluir https:// o http://
- Si el usuario pide "crear un archivo en el escritorio", usar fs_write con path ~/Desktop/nombre.ext
- NO uses desktop para preguntas de conocimiento general
- NO uses desktop para preguntas sobre servicios de la empresa`;

// ── Types ──────────────────────────────────────────────────────────────────

export interface DesktopAction {
  tool: string;
  config: Record<string, unknown>;
}

export type AgentBrainResult =
  | { type: "desktop_actions"; thinking: string; actions: DesktopAction[] }
  | { type: "text_response" };

// ── Main function ──────────────────────────────────────────────────────────

export async function processMessage(
  text: string,
  env: Env,
  companyId: number
): Promise<AgentBrainResult> {
  // Mensajes que deben ir al orchestrator, NO al desktop
  const lower = text.toLowerCase();

  // Emails → orchestrator
  const isEmailIntent = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/.test(text)
    || /\b(email|correo|e-mail|mail)\b/.test(lower);
  if (isEmailIntent) return { type: "text_response" };

  // URLs de video/redes sociales → orchestrator (save_note)
  const isVideoUrl = /\b(facebook\.com|fb\.watch|instagram\.com|tiktok\.com|youtube\.com|youtu\.be|reel|shorts|\/share\/r\/)\b/i.test(text);
  if (isVideoUrl) return { type: "text_response" };

  // Consultas de conocimiento/notas/búsqueda → orchestrator (RAG)
  const isKnowledgeQuery = /\b(notas?|apuntes?|knowledge|obsidian|guard[ée]|qu[ée] tengo|qu[ée] sab|busca|encuentra|informaci[óo]n sobre|cu[ée]ntame|hist[óo]rial|resum)\b/i.test(lower);
  if (isKnowledgeQuery) return { type: "text_response" };

  // Integraciones (Make, Slack, Notion, HubSpot, Shopify) → orchestrator
  const isIntegrationIntent = /\b(make|zapier|n8n|automatiza|escenario|trigger|webhook|registra|anota|guarda.*dato|log[gu]ea|slack|notion|hubspot|shopify|pedido|contacto|deal|canal)\b/i.test(lower);
  if (isIntegrationIntent) return { type: "text_response" };

  try {
    const result = await runLLM(
      env,
      "chat_response",
      AGENT_SYSTEM_PROMPT,
      text,
      companyId
    );

    const raw = result.text.trim();

    // Si responde NO_DESKTOP → texto normal
    if (raw.startsWith("NO_DESKTOP") || raw === "NO_DESKTOP") {
      return { type: "text_response" };
    }

    // Intentar extraer JSON (el modelo puede envolverlo en ```json ... ```)
    const jsonMatch =
      raw.match(/```json\s*([\s\S]*?)```/) ??
      raw.match(/```\s*([\s\S]*?)```/) ??
      raw.match(/(\{[\s\S]*\})/);

    const jsonStr = jsonMatch ? jsonMatch[1].trim() : raw;

    try {
      const parsed = JSON.parse(jsonStr) as {
        thinking?: string;
        actions?: Array<{ tool?: string; config?: Record<string, unknown> }>;
      };

      if (parsed.actions && Array.isArray(parsed.actions) && parsed.actions.length > 0) {
        const actions = parsed.actions
          .filter(
            (a): a is DesktopAction =>
              typeof a.tool === "string" &&
              typeof a.config === "object" &&
              a.config !== null
          )
          .slice(0, 3);

        if (actions.length > 0) {
          return {
            type: "desktop_actions",
            thinking: parsed.thinking ?? "Procesando tu solicitud...",
            actions,
          };
        }
      }
    } catch {
      // JSON inválido → texto normal
    }

    return { type: "text_response" };
  } catch (e) {
    console.error("[agent-brain] processMessage error:", String(e));
    return { type: "text_response" };
  }
}
