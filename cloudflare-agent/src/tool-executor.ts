// ── Tool Executor ─────────────────────────────────────────────────────────
// Ejecuta las herramientas que el smart router decidió usar.

import type { Env } from "./types";
import type { AvailableTool } from "./llm-smart-router";
import { searchWeb } from "./web-search";
import { createDesktopTask } from "./desktop-tasks";

export interface ToolResult {
  tool: AvailableTool;
  success: boolean;
  data: unknown;
  error?: string;
}

export interface ExecutionContext {
  companyId: number;
  companyName: string;
  sessionId: string;
  userMessage: string;
  /** Google access token (si la empresa tiene OAuth conectado) */
  googleToken?: string | null;
  /** GitHub personal access token */
  githubToken?: string | null;
}

// ── Gmail ──────────────────────────────────────────────────────────────────

async function gmailRead(token: string, maxResults = 10): Promise<unknown> {
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&q=is:unread`;
  const listRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!listRes.ok) throw new Error(`Gmail list error ${listRes.status}`);
  const list = await listRes.json() as { messages?: { id: string }[] };

  if (!list.messages?.length) return { emails: [], count: 0 };

  // Fetch resumen de los primeros 5
  const emails = await Promise.all(
    list.messages.slice(0, 5).map(async (m) => {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!msgRes.ok) return null;
      const msg = await msgRes.json() as {
        id: string;
        snippet?: string;
        payload?: { headers?: { name: string; value: string }[] };
      };
      const headers = msg.payload?.headers ?? [];
      const get = (name: string) => headers.find(h => h.name === name)?.value ?? "";
      return {
        id: msg.id,
        from: get("From"),
        subject: get("Subject"),
        date: get("Date"),
        snippet: msg.snippet?.slice(0, 200),
      };
    })
  );

  return { emails: emails.filter(Boolean), count: list.messages.length };
}

// ── Google Calendar ────────────────────────────────────────────────────────

async function calendarRead(token: string): Promise<unknown> {
  const now = new Date();
  const endRange = new Date(now);
  endRange.setDate(endRange.getDate() + 7); // Próximos 7 días para detectar conflictos

  const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${now.toISOString()}&timeMax=${endRange.toISOString()}&singleEvents=true&orderBy=startTime&maxResults=20`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Calendar error ${res.status}`);
  const data = await res.json() as { items?: unknown[] };

  return {
    events: (data.items ?? []).map((e: unknown) => {
      const ev = e as { summary?: string; start?: { dateTime?: string; date?: string }; end?: { dateTime?: string; date?: string }; location?: string };
      return {
        title: ev.summary ?? "(Sin título)",
        start: ev.start?.dateTime ?? ev.start?.date ?? "",
        end: ev.end?.dateTime ?? ev.end?.date ?? "",
        location: ev.location ?? null,
      };
    }),
  };
}

// ── GitHub ─────────────────────────────────────────────────────────────────

async function githubRead(token: string): Promise<unknown> {
  const headers = { Authorization: `token ${token}`, Accept: "application/vnd.github.v3+json" };

  const [notifRes, reposRes] = await Promise.all([
    fetch("https://api.github.com/notifications?per_page=5", { headers }),
    fetch("https://api.github.com/user/repos?sort=pushed&per_page=5", { headers }),
  ]);

  const notifications = notifRes.ok
    ? (await notifRes.json() as { subject?: { title?: string; type?: string }; repository?: { full_name?: string } }[])
        .map(n => ({ title: n.subject?.title, type: n.subject?.type, repo: n.repository?.full_name }))
    : [];

  const repos = reposRes.ok
    ? (await reposRes.json() as { full_name?: string; pushed_at?: string; open_issues_count?: number }[])
        .map(r => ({ name: r.full_name, pushed: r.pushed_at, open_issues: r.open_issues_count }))
    : [];

  return { notifications, repos };
}

// ── RAG search ─────────────────────────────────────────────────────────────

async function ragSearch(message: string, companyId: number, env: Env): Promise<unknown> {
  const embedding = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text: [message] }) as { data: number[][] };
  const results = await env.KNOWLEDGE_BASE.query(embedding.data[0], { topK: 5, returnMetadata: "all" });
  const prefix = `${companyId}-`;
  const matches = (results.matches ?? [])
    .filter(m => m.id.startsWith(prefix) && m.score >= 0.5)
    .slice(0, 3)
    .map(m => {
      const meta = m.metadata as { title?: string; text?: string };
      return { title: meta.title ?? "Doc", text: (meta.text ?? "").slice(0, 500) };
    });
  return { matches };
}

// ── Tasks ──────────────────────────────────────────────────────────────────

async function tasksList(companyId: number, env: Env): Promise<unknown> {
  const rows = await env.DB.prepare(
    `SELECT id, title, priority, status, due_date FROM personal_tasks
     WHERE company_id = ? AND status != 'done'
     ORDER BY CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 ELSE 4 END
     LIMIT 10`
  ).bind(companyId).all();
  return { tasks: rows.results };
}

// ── Extrae URL del mensaje ─────────────────────────────────────────────────

function extractUrl(message: string): string | null {
  const match = message.match(/https?:\/\/[^\s]+/);
  return match ? match[0] : null;
}

// ── Función principal ──────────────────────────────────────────────────────

export async function executeTools(
  tools: AvailableTool[],
  ctx: ExecutionContext,
  env: Env
): Promise<ToolResult[]> {
  const results: ToolResult[] = [];

  for (const tool of tools) {
    if (tool === "none") continue;

    try {
      switch (tool) {
        case "gmail_read": {
          if (!ctx.googleToken) { results.push({ tool, success: false, data: null, error: "Gmail no conectado. Conecta tu cuenta Google en /settings." }); break; }
          const data = await gmailRead(ctx.googleToken);
          results.push({ tool, success: true, data });
          break;
        }

        case "gmail_send": {
          results.push({ tool, success: true, data: { action: "draft_ready", needs_approval: true, note: "Prepara el borrador en tu respuesta, pregunta al usuario si confirma." } });
          break;
        }

        case "send_email": {
          // Extraer destinatario del mensaje
          const emailMatch = ctx.userMessage.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
          const recipient = emailMatch ? emailMatch[0] : null;
          results.push({
            tool,
            success: true,
            data: {
              action: "send_email",
              to: recipient,
              needs_draft: true,
              note: recipient
                ? `Redacta el email profesional completo para ${recipient}. Usa el contexto que el usuario dio para el contenido. Formato:\nAsunto: [asunto]\n\n[cuerpo profesional]\n\nFirma: Equipo de ${ctx.companyName}\n\nAl final incluye exactamente: ---EMAIL_LISTO---`
                : "No encontré dirección de email. Pregunta al usuario a quién quiere enviar el email.",
            },
          });
          break;
        }

        case "calendar_read": {
          if (!ctx.googleToken) { results.push({ tool, success: false, data: null, error: "Calendar no conectado. Conecta tu cuenta Google en /settings." }); break; }
          const data = await calendarRead(ctx.googleToken);
          results.push({ tool, success: true, data });
          break;
        }

        case "calendar_write": {
          if (!ctx.googleToken) {
            results.push({ tool, success: false, data: null, error: "Google Calendar no conectado. Conecta tu cuenta Google en /settings." });
            break;
          }
          results.push({
            tool,
            success: true,
            data: {
              action: "calendar_write",
              needs_draft: true,
              note: `Extrae del mensaje del usuario los datos del evento y responde con EXACTAMENTE este formato JSON al final:
---EVENTO_LISTO---
{"title":"título del evento","date":"YYYY-MM-DD","startTime":"HH:MM","endTime":"HH:MM","description":"descripción breve","attendees":["email@ejemplo.com"]}

Reglas:
- Si no dice hora de fin, asume 1 hora después de la de inicio
- Si dice "mañana", calcula la fecha real
- Si menciona un email, agrégalo a attendees
- Si no menciona email, deja attendees vacío []
- Antes del JSON, confirma al usuario los detalles del evento en lenguaje natural`,
            },
          });
          break;
        }

        case "github": {
          if (!ctx.githubToken) { results.push({ tool, success: false, data: null, error: "GitHub no conectado. Agrega tu PAT en /settings." }); break; }
          const data = await githubRead(ctx.githubToken);
          results.push({ tool, success: true, data });
          break;
        }

        case "desktop_screenshot":
        case "desktop_scrape":
        case "desktop_download":
        case "desktop_fill_form": {
          const url = extractUrl(ctx.userMessage);
          if (!url) { results.push({ tool, success: false, data: null, error: "No se encontró URL en el mensaje." }); break; }
          const taskType = tool.replace("desktop_", "");
          const taskId = await createDesktopTask(env, ctx.companyId, taskType, { url }, ctx.userMessage);
          results.push({ tool, success: true, data: { action: "desktop_task_created", task_id: taskId, type: taskType, url } });
          break;
        }

        case "web_search": {
          const data = await searchWeb(ctx.userMessage, env);
          results.push({ tool, success: true, data });
          break;
        }

        case "rag_search": {
          const data = await ragSearch(ctx.userMessage, ctx.companyId, env);
          results.push({ tool, success: true, data });
          break;
        }

        case "prospect_research": {
          results.push({ tool, success: true, data: { action: "prospect_queued", note: "Investigación de prospecto encolada. Usa /investigar en Telegram para resultados detallados." } });
          break;
        }

        case "tasks_manage": {
          const data = await tasksList(ctx.companyId, env);
          results.push({ tool, success: true, data });
          break;
        }

        case "crm_lookup": {
          // Extraer nombre del contacto del mensaje
          const nameMatch = ctx.userMessage.match(/(?:de|con|sobre)\s+([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)/);
          const contactName = nameMatch ? nameMatch[1] : null;

          if (!contactName) {
            results.push({ tool, success: true, data: { note: "No encontré el nombre del contacto. Pregunta al usuario: '¿De quién quieres saber?'" } });
            break;
          }

          const searchTerm = `%${contactName}%`;

          // Buscar en todas las fuentes en paralelo
          const [emailActions, calendarActions, followupActions, leads, conversations] = await Promise.all([
            // Emails enviados a este contacto
            env.DB.prepare(
              `SELECT action_data, status, created_at, executed_at FROM pending_actions
               WHERE company_id = ? AND action_type = 'send_email' AND action_data LIKE ?
               ORDER BY created_at DESC LIMIT 5`
            ).bind(String(ctx.companyId), searchTerm).all(),

            // Reuniones con este contacto
            env.DB.prepare(
              `SELECT action_data, status, created_at, executed_at FROM pending_actions
               WHERE company_id = ? AND action_type = 'schedule_meeting' AND action_data LIKE ?
               ORDER BY created_at DESC LIMIT 5`
            ).bind(String(ctx.companyId), searchTerm).all(),

            // Follow-ups a este contacto
            env.DB.prepare(
              `SELECT action_data, status, followup_scheduled_at, executed_at FROM pending_actions
               WHERE company_id = ? AND action_type = 'send_followup' AND action_data LIKE ?
               ORDER BY created_at DESC LIMIT 5`
            ).bind(String(ctx.companyId), searchTerm).all(),

            // Leads
            env.DB.prepare(
              `SELECT contact_name, contact_email, contact_company, lead_score, urgency, status, brief_summary, created_at
               FROM leads WHERE company_id = ? AND (contact_name LIKE ? OR contact_company LIKE ? OR contact_email LIKE ?)
               ORDER BY created_at DESC LIMIT 3`
            ).bind(ctx.companyId, searchTerm, searchTerm, searchTerm).all(),

            // Conversaciones mencionando este contacto
            env.DB.prepare(
              `SELECT role, content, channel, created_at FROM conversation_history
               WHERE company_id = ? AND content LIKE ?
               ORDER BY created_at DESC LIMIT 5`
            ).bind(ctx.companyId, searchTerm).all(),
          ]);

          const timeline: { date: string; type: string; detail: string; status: string }[] = [];

          for (const r of (emailActions.results ?? []) as { action_data: string; status: string; created_at: string }[]) {
            try {
              const d = JSON.parse(r.action_data) as { to?: string; subject?: string };
              timeline.push({ date: r.created_at, type: "email", detail: `Email a ${d.to}: ${d.subject}`, status: r.status });
            } catch {}
          }

          for (const r of (calendarActions.results ?? []) as { action_data: string; status: string; created_at: string }[]) {
            try {
              const d = JSON.parse(r.action_data) as { title?: string; date?: string; startTime?: string };
              timeline.push({ date: r.created_at, type: "meeting", detail: `Reunión: ${d.title} (${d.date} ${d.startTime})`, status: r.status });
            } catch {}
          }

          for (const r of (followupActions.results ?? []) as { action_data: string; status: string; followup_scheduled_at: string | null }[]) {
            try {
              const d = JSON.parse(r.action_data) as { to?: string; subject?: string };
              timeline.push({ date: r.followup_scheduled_at ?? "", type: "followup", detail: `Follow-up a ${d.to}: ${d.subject}`, status: r.status });
            } catch {}
          }

          // Ordenar cronológicamente
          timeline.sort((a, b) => b.date.localeCompare(a.date));

          results.push({
            tool,
            success: true,
            data: {
              contact: contactName,
              leads: (leads.results ?? []).slice(0, 3),
              timeline: timeline.slice(0, 10),
              conversations_count: (conversations.results ?? []).length,
              note: `Presenta el historial de "${contactName}" como un CRM conversacional. Incluye:
1. Si hay un lead: score, urgencia, estado, resumen
2. Timeline de acciones: emails enviados, reuniones, follow-ups (con fechas y estado)
3. Resumen: cuántas interacciones, última acción, próximo paso sugerido
Formato: cronológico, claro, con emojis por tipo de acción (📧 email, 📅 reunión, 🔄 follow-up)`,
            },
          });
          break;
        }

        case "action_control": {
          // Find active follow-ups/actions for this company
          const activeActions = await env.DB.prepare(
            `SELECT id, action_type, action_data, status, followup_scheduled_at
             FROM pending_actions
             WHERE company_id = ? AND status IN ('pending', 'scheduled')
             ORDER BY created_at DESC LIMIT 10`
          ).bind(String(ctx.companyId)).all();

          // Extract name from user message to match
          const acNameMatch = ctx.userMessage.match(/(?:de|a|para)\s+([A-Z\u00C1\u00C9\u00CD\u00D3\u00DA\u00D1][a-z\u00E1\u00E9\u00ED\u00F3\u00FA\u00F1]+)/);
          const targetName = acNameMatch ? acNameMatch[1].toLowerCase() : null;

          const actions = (activeActions.results ?? []).map((a: Record<string, unknown>) => {
            try {
              const data = JSON.parse(a.action_data as string);
              return { id: a.id, type: a.action_type, to: data.to, subject: data.subject, status: a.status, scheduled: a.followup_scheduled_at };
            } catch { return null; }
          }).filter(Boolean);

          // If target name found, filter to matching actions
          const filtered = targetName
            ? actions.filter((a: unknown) => {
                const act = a as { to?: string; subject?: string };
                return act.to?.toLowerCase().includes(targetName) || act.subject?.toLowerCase().includes(targetName);
              })
            : actions;

          if (filtered.length === 0) {
            results.push({ tool, success: true, data: { note: "No hay acciones activas" + (targetName ? ` para "${targetName}"` : "") + ". No hay nada que cancelar." } });
          } else if (filtered.length === 1) {
            // Auto-cancel the single match
            const target = filtered[0] as { id: unknown; type: unknown; to?: string; subject?: string };
            await env.DB.prepare(
              `UPDATE pending_actions SET status = 'cancelled', decided_at = datetime('now') WHERE id = ? AND company_id = ?`
            ).bind(target.id, String(ctx.companyId)).run();
            // Also cancel any future chain items
            if (target.type === 'send_followup' && target.to) {
              await env.DB.prepare(
                `UPDATE pending_actions SET status = 'cancelled', decided_at = datetime('now')
                 WHERE company_id = ? AND action_type = 'send_followup' AND status IN ('pending','scheduled') AND action_data LIKE ?`
              ).bind(String(ctx.companyId), `%${target.to}%`).run();
            }
            results.push({ tool, success: true, data: { cancelled: target, note: `Cancel\u00E9 la acci\u00F3n: ${target.type === 'send_followup' ? 'Follow-up' : target.type === 'send_email' ? 'Email' : 'Reuni\u00F3n'} a ${target.to}. Confirma al usuario.` } });
          } else {
            // Multiple matches - list them for user to choose
            results.push({ tool, success: true, data: { actions: filtered, note: `Hay ${filtered.length} acciones activas. Lista las opciones al usuario y pregunta cu\u00E1l cancelar.` } });
          }
          break;
        }

        case "inbox_organized": {
          // Cargar inbox clasificado de D1
          const inbox = await env.DB.prepare(
            `SELECT from_name, subject, snippet, category, priority, action_suggested, created_at
             FROM email_inbox WHERE company_id = ?
             ORDER BY priority ASC, created_at DESC LIMIT 15`
          ).bind(ctx.companyId).all<{ from_name: string; subject: string; snippet: string; category: string; priority: number; action_suggested: string; created_at: string }>();

          const emails = inbox.results ?? [];
          const grouped: Record<string, typeof emails> = {};
          for (const e of emails) {
            if (!grouped[e.category]) grouped[e.category] = [];
            grouped[e.category].push(e);
          }

          results.push({
            tool,
            success: true,
            data: {
              total: emails.length,
              grouped,
              note: `Presenta el inbox organizado por categoría. Formato:

🔴 **Urgentes** (requieren acción inmediata)
- [remitente]: [asunto] → Acción: [sugerida]

🟡 **Requieren respuesta**
- [remitente]: [asunto] → Acción: [sugerida]

📄 **Informativos**
- [remitente]: [asunto]

🔕 **Social / Spam** (X emails filtrados)

Al final: "¿Quieres que responda alguno o archive los spam?"`,
            },
          });
          break;
        }

        case "get_suggestions": {
          // Cargar sugerencias proactivas desde KV
          const suggestionsRaw = await env.KV.get(`suggestions:${ctx.companyId}`);
          const suggestions = suggestionsRaw ? JSON.parse(suggestionsRaw) as { type: string; text: string; action?: string }[] : [];

          // También cargar acciones pendientes
          const pendingCount = await env.DB.prepare(
            `SELECT COUNT(*) as c FROM pending_actions WHERE company_id = ? AND status = 'pending'`
          ).bind(String(ctx.companyId)).first<{ c: number }>();

          // Cargar follow-ups programados
          const scheduledFollowups = await env.DB.prepare(
            `SELECT action_data, followup_scheduled_at FROM pending_actions WHERE company_id = ? AND action_type = 'send_followup' AND status = 'scheduled' ORDER BY followup_scheduled_at ASC LIMIT 5`
          ).bind(String(ctx.companyId)).all<{ action_data: string; followup_scheduled_at: string }>();

          const followups = (scheduledFollowups.results ?? []).map(r => {
            try { const d = JSON.parse(r.action_data) as { to?: string; subject?: string }; return `${d.to}: ${d.subject} (${r.followup_scheduled_at})`; }
            catch { return null; }
          }).filter(Boolean);

          results.push({
            tool,
            success: true,
            data: {
              suggestions,
              pending_approvals: pendingCount?.c ?? 0,
              scheduled_followups: followups,
              note: `Presenta las sugerencias y pendientes al usuario como un briefing ejecutivo:
1. Si hay sugerencias proactivas, preséntalas con emojis y acciones claras
2. Si hay acciones pendientes de aprobación, mencionarlas
3. Si hay follow-ups programados, listar próximos
4. Si no hay nada pendiente, decir "Todo al día 👍"
5. Para cada sugerencia con action, ofrece ejecutarla: "¿Quieres que [acción]?"`,
            },
          });
          break;
        }

        case "save_note": {
          // Extract URL from message
          const urlMatch = ctx.userMessage.match(/https?:\/\/[^\s]+/);
          const videoUrl = urlMatch ? urlMatch[0] : null;

          if (!videoUrl) {
            results.push({ tool, success: true, data: { note: "No encontré una URL en tu mensaje. Envíame el link del video." } });
            break;
          }

          let transcript = "";
          let title = "Nota sin título";

          try {
            // Step 1: Use Cobalt API to get audio download URL
            const cobaltRes = await fetch("https://api.cobalt.tools", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Accept": "application/json",
              },
              body: JSON.stringify({
                url: videoUrl,
                audioFormat: "mp3",
                isAudioOnly: true,
              }),
            });

            if (cobaltRes.ok) {
              const cobaltData = await cobaltRes.json() as { status?: string; url?: string; audio?: string };
              const audioUrl = cobaltData.url ?? cobaltData.audio;

              if (audioUrl) {
                // Step 2: Download audio
                const audioRes = await fetch(audioUrl);
                if (audioRes.ok) {
                  const audioBuffer = await audioRes.arrayBuffer();

                  // Step 3: Transcribe with Whisper (free on Cloudflare)
                  const transcription = await env.AI.run(
                    "@cf/openai/whisper" as Parameters<typeof env.AI.run>[0],
                    { audio: [...new Uint8Array(audioBuffer)] }
                  ) as { text?: string };

                  transcript = transcription.text?.trim() ?? "";
                }
              }
            }
          } catch (err) {
            console.error("[save_note] Cobalt/Whisper error:", String(err));
          }

          // Fallback: if no transcript, try web scraping the page for text
          if (!transcript) {
            try {
              const pageRes = await fetch(videoUrl, {
                headers: { "User-Agent": "Mozilla/5.0 (compatible; AilynBot/1.0)" },
                redirect: "follow",
              });
              if (pageRes.ok) {
                const html = await pageRes.text();
                // Extract title
                const titleMatch2 = html.match(/<title[^>]*>([^<]+)<\/title>/i);
                if (titleMatch2) title = titleMatch2[1].trim();
                // Extract og:description or meta description
                const descMatch = html.match(/(?:og:description|description)["'\s]*content=["']([^"']+)/i);
                if (descMatch) transcript = descMatch[1].trim();
              }
            } catch {
              // Page scraping failed, will use URL only
            }
          }

          if (!transcript && title === "Nota sin título") {
            transcript = "No se pudo extraer contenido del video. URL guardada para referencia.";
          }

          results.push({
            tool,
            success: true,
            data: {
              action: "save_note",
              url: videoUrl,
              transcript: transcript.slice(0, 3000),
              title,
              note: `Resume el siguiente contenido de un video/página web en una nota estructurada.

URL: ${videoUrl}
${title !== "Nota sin título" ? `Título: ${title}` : ""}
${transcript ? `Transcripción/Contenido:\n${transcript.slice(0, 2000)}` : "Solo URL disponible."}

Genera una nota con este formato EXACTO (es para Obsidian):

---NOTA_LISTA---
# [Título descriptivo del contenido]

**Fuente:** ${videoUrl}
**Fecha:** ${new Date().toISOString().split("T")[0]}
**Tags:** #video #[categoría]

## Resumen
[3-5 bullet points con lo más importante]

## Ideas clave
[Las ideas o conceptos más valiosos]

## Acción
[Qué puedo hacer con esta información]
---FIN_NOTA---`,
            },
          });
          break;
        }

        case "schedule_followup": {
          const emailMatch = ctx.userMessage.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/);
          const recipient = emailMatch ? emailMatch[0] : null;
          const daysMatch = ctx.userMessage.match(/(\d+)\s*d[íi]as?/i);
          const days = daysMatch ? parseInt(daysMatch[1], 10)
            : /hoy/i.test(ctx.userMessage) ? 0
            : /ma[ñn]ana/i.test(ctx.userMessage) ? 1
            : /semana/i.test(ctx.userMessage) ? 7
            : 3;

          // Extraer contexto del mensaje (todo lo que no sea el email ni la referencia de tiempo)
          const context = ctx.userMessage
            .replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/, "")
            .replace(/\b(dale?|darle|hazle|hacer)\s+(seguimiento|follow.?up)\b/i, "")
            .replace(/\b(hoy mismo|hoy|ma[ñn]ana|en \d+ d[íi]as?|la pr[óo]xima semana|mismo)\b/i, "")
            .replace(/\b(a|sobre|de|el|la|los|las|para|con|por)\b/gi, " ")
            .replace(/\s+/g, " ").trim() || "Seguimiento general";

          if (recipient) {
            results.push({
              tool,
              success: true,
              data: {
                action: "followup_ready",
                to: recipient,
                days,
                context,
                subject: `Seguimiento: ${context.slice(0, 50)}`,
                chain: [days, days + 4, days + 11], // day 3, 7, 14 (relative to now)
              },
            });
          } else {
            results.push({
              tool,
              success: true,
              data: {
                action: "followup_needs_email",
                note: "No encontré email. Pregunta al usuario a quién quiere dar seguimiento.",
              },
            });
          }
          break;
        }
      }
    } catch (err) {
      results.push({ tool, success: false, data: null, error: String(err) });
    }
  }

  return results;
}

/** Serializa los resultados de herramientas como contexto para el LLM */
export function formatToolResults(results: ToolResult[]): string {
  if (!results.length) return "";
  let out = "\n\n## Datos de herramientas\n";
  for (const r of results) {
    if (r.success) {
      out += `\n[${r.tool}]:\n${JSON.stringify(r.data, null, 2).slice(0, 1500)}\n`;
    } else {
      out += `\n[${r.tool}]: ⚠️ ${r.error}\n`;
    }
  }
  out += "\nUsa estos datos para responder al usuario. Si hay needs_approval=true, redacta el contenido y pregunta si confirma.";
  return out;
}
