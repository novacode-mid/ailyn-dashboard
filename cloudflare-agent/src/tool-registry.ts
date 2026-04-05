// ── Tool Registry: Define todas las herramientas como Anthropic tool schemas ──
// Sonnet decide que tools usar basandose en estos schemas.
// Los MCP skills se agregan dinamicamente desde D1.

import type { Env } from "./types";

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, { type: string; description: string; enum?: string[] }>;
    required?: string[];
  };
}

// ── Tools nativos (siempre disponibles) ──────────────────────────────────

const CORE_TOOLS: AnthropicTool[] = [
  {
    name: "send_email",
    description: "Enviar un email. Usa esto cuando el usuario quiere mandar un correo a alguien.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Email del destinatario" },
        subject: { type: "string", description: "Asunto del email" },
        body: { type: "string", description: "Cuerpo del email" },
      },
      required: ["to", "subject", "body"],
    },
  },
  {
    name: "gmail_read",
    description: "Leer emails recientes de Gmail. Usa esto cuando el usuario quiere ver sus correos, bandeja de entrada, o emails pendientes.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Filtro opcional (ej: 'from:pedro', 'is:unread')" },
      },
    },
  },
  {
    name: "calendar_read",
    description: "Ver eventos del calendario. Usa esto cuando el usuario pregunta por su agenda, reuniones, o disponibilidad.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "Fecha (YYYY-MM-DD) o 'today', 'tomorrow', 'this_week'" },
      },
    },
  },
  {
    name: "calendar_write",
    description: "Agendar una reunion, cita, llamada o evento en el calendario.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Titulo del evento" },
        date: { type: "string", description: "Fecha YYYY-MM-DD" },
        start_time: { type: "string", description: "Hora inicio HH:MM" },
        end_time: { type: "string", description: "Hora fin HH:MM" },
        attendees: { type: "string", description: "Emails de asistentes separados por coma" },
        description: { type: "string", description: "Descripcion del evento" },
      },
      required: ["title", "date", "start_time"],
    },
  },
  {
    name: "web_search",
    description: "Buscar informacion en internet. Usa esto cuando necesitas datos actualizados que no conoces.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Que buscar" },
      },
      required: ["query"],
    },
  },
  {
    name: "rag_search",
    description: "Buscar en la knowledge base y notas guardadas del usuario.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Que buscar en las notas" },
      },
      required: ["query"],
    },
  },
  {
    name: "save_note",
    description: "Guardar una nota o resumir contenido de una URL (video, articulo) para Obsidian.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL del contenido a guardar" },
        title: { type: "string", description: "Titulo de la nota (opcional)" },
      },
      required: ["url"],
    },
  },
  {
    name: "schedule_followup",
    description: "Programar un seguimiento/recordatorio para contactar a alguien en el futuro.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Email de la persona" },
        days: { type: "string", description: "En cuantos dias (numero)" },
        context: { type: "string", description: "Contexto del seguimiento" },
        subject: { type: "string", description: "Asunto del follow-up" },
      },
      required: ["to", "days"],
    },
  },
  {
    name: "crm_lookup",
    description: "Buscar informacion de un contacto o lead en el CRM.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Nombre del contacto a buscar" },
      },
      required: ["name"],
    },
  },
  {
    name: "desktop_action",
    description: "Ejecutar una accion en la computadora del usuario: tomar screenshot, llenar formulario, descargar archivo, crear archivo. Requiere Desktop Agent activo.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", description: "Tipo: screenshot, fill_form, download, scrape, fs_write, fs_read, fs_list", enum: ["screenshot", "fill_form", "download_file", "scrape_data", "fs_write", "fs_read", "fs_list"] },
        url: { type: "string", description: "URL para acciones de browser" },
        path: { type: "string", description: "Ruta de archivo para acciones de filesystem" },
        content: { type: "string", description: "Contenido para fs_write" },
        fields: { type: "string", description: "JSON de campos para fill_form: [{selector, value}]" },
        submit_selector: { type: "string", description: "Selector CSS del boton submit" },
      },
      required: ["action"],
    },
  },
];

// ── Tools de integraciones (solo si estan conectadas) ─────────────────────

const INTEGRATION_TOOLS: Record<string, AnthropicTool> = {
  slack: {
    name: "slack",
    description: "Enviar mensaje a un canal de Slack.",
    input_schema: {
      type: "object",
      properties: {
        channel: { type: "string", description: "Nombre del canal (ej: #general)" },
        message: { type: "string", description: "Mensaje a enviar" },
      },
      required: ["channel", "message"],
    },
  },
  notion: {
    name: "notion",
    description: "Crear pagina o buscar contenido en Notion.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", description: "crear o buscar", enum: ["create", "search"] },
        title: { type: "string", description: "Titulo de la pagina (para crear)" },
        content: { type: "string", description: "Contenido (para crear)" },
        query: { type: "string", description: "Texto a buscar (para buscar)" },
      },
      required: ["action"],
    },
  },
  hubspot: {
    name: "hubspot",
    description: "Gestionar contactos y deals en HubSpot CRM.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", description: "crear_contacto, buscar, crear_deal", enum: ["create_contact", "search", "create_deal"] },
        email: { type: "string", description: "Email del contacto" },
        first_name: { type: "string", description: "Nombre" },
        last_name: { type: "string", description: "Apellido" },
        query: { type: "string", description: "Texto a buscar" },
        deal_name: { type: "string", description: "Nombre del deal" },
        amount: { type: "string", description: "Monto del deal" },
      },
      required: ["action"],
    },
  },
  shopify: {
    name: "shopify",
    description: "Consultar pedidos y productos de la tienda Shopify.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", description: "orders o products", enum: ["orders", "products", "search_order"] },
        query: { type: "string", description: "Busqueda de pedido (opcional)" },
      },
      required: ["action"],
    },
  },
  make: {
    name: "make_trigger",
    description: "Disparar automatizacion en Make.com. Envia datos al webhook configurado.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", description: "Descripcion de la accion" },
        data: { type: "string", description: "Datos JSON a enviar al webhook" },
      },
      required: ["action"],
    },
  },
};

// ── Build tool schemas para una empresa ──────────────────────────────────

export async function buildToolSchemas(
  env: Env,
  companyId: number,
  connectedProviders: string[]
): Promise<AnthropicTool[]> {
  const tools: AnthropicTool[] = [...CORE_TOOLS];

  // Agregar tools de integraciones conectadas
  for (const provider of connectedProviders) {
    if (INTEGRATION_TOOLS[provider]) {
      tools.push(INTEGRATION_TOOLS[provider]);
    }
  }

  // Agregar MCP skills dinamicamente
  try {
    const rows = await env.DB.prepare(
      `SELECT skill_name, description, parameters_schema FROM mcp_skills WHERE company_id = ? AND is_active = 1 LIMIT 20`
    ).bind(companyId).all<{ skill_name: string; description: string; parameters_schema: string | null }>();

    for (const skill of rows.results ?? []) {
      let inputSchema: AnthropicTool["input_schema"] = {
        type: "object",
        properties: { message: { type: "string", description: "Mensaje o parametros del usuario" } },
      };

      // Usar el parameters_schema del MCP si existe
      if (skill.parameters_schema) {
        try {
          const parsed = JSON.parse(skill.parameters_schema);
          if (parsed.type === "object" && parsed.properties) {
            inputSchema = parsed;
          }
        } catch { /* usar default */ }
      }

      tools.push({
        name: skill.skill_name,
        description: skill.description,
        input_schema: inputSchema,
      });
    }
  } catch { /* D1 error — continue without MCP skills */ }

  return tools;
}
