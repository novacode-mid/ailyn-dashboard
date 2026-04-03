const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

function timestamp(): string {
  return new Date().toLocaleTimeString("es-MX", { hour12: false });
}

export function log(msg: string): void {
  console.log(`${COLORS.gray}[${timestamp()}]${COLORS.reset} ${msg}`);
}

export function success(msg: string): void {
  console.log(`${COLORS.gray}[${timestamp()}]${COLORS.reset} ${COLORS.green}✓${COLORS.reset} ${msg}`);
}

export function warn(msg: string): void {
  console.log(`${COLORS.gray}[${timestamp()}]${COLORS.reset} ${COLORS.yellow}⚠${COLORS.reset} ${msg}`);
}

export function error(msg: string): void {
  console.log(`${COLORS.gray}[${timestamp()}]${COLORS.reset} ${COLORS.red}✗${COLORS.reset} ${msg}`);
}

export function info(msg: string): void {
  console.log(`${COLORS.gray}[${timestamp()}]${COLORS.reset} ${COLORS.cyan}→${COLORS.reset} ${msg}`);
}
