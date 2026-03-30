-- Fase 12: God Mode — Skills de File System + Agente Master Dev

-- ── Skills de File System ──────────────────────────────────────────────────
INSERT OR IGNORE INTO skills (name, description, schema_json)
VALUES
  (
    'fs_list',
    'Lista archivos y carpetas de un directorio del sistema local del usuario.',
    '{"name":"fs_list","description":"Lista archivos y carpetas de un directorio. Devuelve nombre y tipo (file/directory) de cada entrada. Ignora node_modules y .git.","parameters":{"type":"object","properties":{"path":{"type":"string","description":"Ruta absoluta del directorio a explorar"}},"required":["path"]}}'
  ),
  (
    'fs_read',
    'Lee el contenido completo de un archivo del sistema de archivos local.',
    '{"name":"fs_read","description":"Lee el contenido completo de un archivo de texto. Devuelve el texto del archivo tal cual.","parameters":{"type":"object","properties":{"filePath":{"type":"string","description":"Ruta absoluta del archivo a leer"}},"required":["filePath"]}}'
  ),
  (
    'fs_write',
    'Escribe o sobreescribe el contenido de un archivo en el sistema de archivos local.',
    '{"name":"fs_write","description":"Escribe contenido en un archivo. Crea el archivo si no existe, sobreescribe si ya existe. Crea directorios intermedios si son necesarios.","parameters":{"type":"object","properties":{"filePath":{"type":"string","description":"Ruta absoluta del archivo a escribir"},"content":{"type":"string","description":"Contenido completo a escribir en el archivo"}},"required":["filePath","content"]}}'
  );

-- ── Agente Master Dev (God Mode) ──────────────────────────────────────────
INSERT OR IGNORE INTO agents (company_id, name, role_prompt, model_id)
VALUES (
  (SELECT id FROM companies WHERE name = 'NovaCode'),
  'Agente Master Dev',
  'Eres el Arquitecto de Software Master. Tienes acceso al sistema de archivos local del usuario. Usa fs_list para explorar, fs_read para leer código, y fs_write para modificarlo. Piensa paso a paso y sé preciso con las rutas.',
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
);

-- ── Vincular las 3 skills al Agente Master Dev ────────────────────────────
INSERT OR IGNORE INTO agent_skills (agent_id, skill_id)
SELECT
  (SELECT a.id FROM agents a JOIN companies c ON a.company_id = c.id
   WHERE c.name = 'NovaCode' AND a.name = 'Agente Master Dev'),
  s.id
FROM skills s
WHERE s.name IN ('fs_list', 'fs_read', 'fs_write');
