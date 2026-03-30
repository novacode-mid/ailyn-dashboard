-- Fase 8: Arquitectura Database-Driven Agents (Multi-Tenant)

-- ── companies: tenants del sistema ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS companies (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  created_at TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ── agents: perfiles de agente por compañía ───────────────────────────────
CREATE TABLE IF NOT EXISTS agents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id  INTEGER NOT NULL REFERENCES companies(id),
  name        TEXT    NOT NULL,
  role_prompt TEXT    NOT NULL,
  model_id    TEXT    NOT NULL DEFAULT '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(company_id, name)
);

-- ── skills: catálogo de herramientas disponibles ──────────────────────────
CREATE TABLE IF NOT EXISTS skills (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL UNIQUE,
  description TEXT    NOT NULL,
  schema_json TEXT    NOT NULL  -- JSON string: definición completa de la tool para Workers AI
);

-- ── agent_skills: qué skills puede usar cada agente ──────────────────────
CREATE TABLE IF NOT EXISTS agent_skills (
  agent_id  INTEGER NOT NULL REFERENCES agents(id),
  skill_id  INTEGER NOT NULL REFERENCES skills(id),
  PRIMARY KEY (agent_id, skill_id)
);

-- ── Seed: compañía NovaCode ───────────────────────────────────────────────
INSERT OR IGNORE INTO companies (name) VALUES ('NovaCode');

-- ── Seed: Agente "Asistente Ejecutivo" para NovaCode ─────────────────────
INSERT OR IGNORE INTO agents (company_id, name, role_prompt, model_id)
VALUES (
  (SELECT id FROM companies WHERE name = 'NovaCode'),
  'Asistente Ejecutivo',
  'Eres un Asistente Ejecutivo corporativo de Ailyn para NovaCode.
Tu trabajo es ayudar al administrador a gestionar comunicaciones y tareas.

## Regla de oro
Cuando el usuario te pida realizar una acción (como enviar un correo), DEBES:
1. Generar primero un borrador claro con todos los detalles.
2. Pedir confirmación explícita: "¿Apruebas el envío? (Sí/No)".
3. Solo cuando el usuario confirme con Sí/Aprobar, ejecutar la herramienta correspondiente.

## Formato
- Respuestas concisas y ejecutivas.
- En borradores: muestra Para, Asunto y Cuerpo antes de pedir confirmación.',
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
);

-- ── Seed: Skill send_smartpasses_notification ─────────────────────────────
INSERT OR IGNORE INTO skills (name, description, schema_json)
VALUES (
  'send_smartpasses_notification',
  'Envía una notificación push al gerente vía Smart Passes.',
  '{"name":"send_smartpasses_notification","description":"Envía una notificación push al gerente vía Smart Passes. Usar para alertas informativas que no bloquean el flujo.","parameters":{"type":"object","properties":{"message":{"type":"string","description":"Mensaje de la notificación (máx 120 chars)"},"pass_id":{"type":"string","description":"ID del Smart Pass del destinatario"}},"required":["message","pass_id"]}}'
);

-- ── Vincular Asistente Ejecutivo con su skill ─────────────────────────────
INSERT OR IGNORE INTO agent_skills (agent_id, skill_id)
VALUES (
  (SELECT a.id FROM agents a JOIN companies c ON a.company_id = c.id WHERE c.name = 'NovaCode' AND a.name = 'Asistente Ejecutivo'),
  (SELECT id FROM skills WHERE name = 'send_smartpasses_notification')
);
