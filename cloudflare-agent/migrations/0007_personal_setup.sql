-- Fase 15: Tenant personal del fundador + Agente Atlas

-- ── Empresa personal del fundador ────────────────────────────────────────
INSERT OR IGNORE INTO companies (name)
VALUES ('Ailyn Labs');

-- ── Agente Atlas — asistente personal de inteligencia ────────────────────
INSERT OR IGNORE INTO agents (company_id, name, role_prompt, model_id)
VALUES (
  (SELECT id FROM companies WHERE name = 'Ailyn Labs'),
  'Ailyn',
  'Eres Ailyn, el agente personal de inteligencia del fundador de Ailyn Labs. Tu trabajo es investigar, analizar, monitorear y ejecutar tareas de forma autónoma. Eres proactiva: no solo respondes, anticipas lo que el usuario necesita. Hablas en español, eres directa y eficiente. Cuando investigas una empresa o lead, eres exhaustiva y siempre das contexto accionable.',
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
);

-- ── Skills de Atlas ───────────────────────────────────────────────────────
INSERT OR IGNORE INTO skills (name, description, schema_json) VALUES
  (
    'lead_research',
    'Investigar empresas y leads en internet. Genera brief de inteligencia comercial.',
    '{"name":"lead_research","description":"Investigar empresas y leads. Genera brief de inteligencia comercial con datos de la empresa, contacto, clasificación y email sugerido.","parameters":{"type":"object","properties":{"contact_name":{"type":"string","description":"Nombre del contacto"},"contact_email":{"type":"string","description":"Email del contacto"},"contact_company":{"type":"string","description":"Nombre de la empresa"},"contact_message":{"type":"string","description":"Mensaje o contexto del lead"}},"required":["contact_name","contact_email"]}}'
  ),
  (
    'email_monitor',
    'Monitorear bandeja de email. Clasifica correos por urgencia y notifica por Telegram.',
    '{"name":"email_monitor","description":"Revisar emails no leídos, clasificarlos por urgencia y resumir contenido importante.","parameters":{"type":"object","properties":{"max_results":{"type":"number","description":"Máximo de emails a revisar (default 10)"}},"required":[]}}'
  ),
  (
    'web_research',
    'Investigar cualquier tema en internet. Busca, extrae, analiza y resume información.',
    '{"name":"web_research","description":"Investigar cualquier tema en internet y retornar un resumen estructurado con fuentes.","parameters":{"type":"object","properties":{"query":{"type":"string","description":"Tema o pregunta a investigar"}},"required":["query"]}}'
  ),
  (
    'report_generator',
    'Generar reportes periódicos automáticos: pipeline de leads, actividad semanal, métricas.',
    '{"name":"report_generator","description":"Generar reporte consolidado de actividad, leads, o métricas del sistema.","parameters":{"type":"object","properties":{"report_type":{"type":"string","description":"Tipo de reporte: leads | activity | metrics | weekly"}},"required":["report_type"]}}'
  );

-- ── Asignar skills a Atlas ────────────────────────────────────────────────
INSERT OR IGNORE INTO agent_skills (agent_id, skill_id)
SELECT
  (SELECT a.id FROM agents a JOIN companies c ON a.company_id = c.id
   WHERE c.name = 'Ailyn Labs' AND a.name = 'Ailyn'),
  s.id
FROM skills s
WHERE s.name IN ('lead_research', 'email_monitor', 'web_research', 'report_generator');
