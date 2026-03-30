-- Fase 13: Skill send_telegram_message para el Agente Master Dev

INSERT OR IGNORE INTO skills (name, description, schema_json)
VALUES (
  'send_telegram_message',
  'Envía un mensaje de alerta o notificación al usuario vía Telegram.',
  '{"name":"send_telegram_message","description":"Envía un mensaje de alerta o notificación al usuario vía Telegram. Úsala para reportar resultados importantes, errores o confirmaciones de acciones.","parameters":{"type":"object","properties":{"message":{"type":"string","description":"El mensaje a enviar. Sé claro y conciso."}},"required":["message"]}}'
);

-- Vincular al Agente Master Dev
INSERT OR IGNORE INTO agent_skills (agent_id, skill_id)
VALUES (
  (SELECT a.id FROM agents a JOIN companies c ON a.company_id = c.id
   WHERE c.name = 'NovaCode' AND a.name = 'Agente Master Dev'),
  (SELECT id FROM skills WHERE name = 'send_telegram_message')
);
