import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface AgentConfig {
  apiUrl: string;
  token: string;
  pollInterval: number;
  headless: boolean;
}

const CONFIG_DIR = path.join(os.homedir(), ".openclaw");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

const DEFAULTS: AgentConfig = {
  apiUrl: "https://ailyn-agent.novacodepro.workers.dev",
  token: "",
  pollInterval: 3000,
  headless: true,
};

export function loadConfig(): AgentConfig {
  if (!fs.existsSync(CONFIG_FILE)) return DEFAULTS;
  try {
    const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

export function saveConfig(config: Partial<AgentConfig>): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  const current = loadConfig();
  const merged = { ...current, ...config };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), "utf-8");
}

export function isConfigured(): boolean {
  const config = loadConfig();
  return !!config.token;
}
