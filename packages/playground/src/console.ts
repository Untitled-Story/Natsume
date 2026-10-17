export type LogLevel = 'info' | 'warn' | 'error';
const output = document.getElementById('console')!;
const panel = document.getElementById('console-panel')!;
const toggle = document.getElementById('toggle-console')!;
function setOpen(open: boolean): void {
  panel.hidden = !open;
  toggle.setAttribute('aria-expanded', String(open));
  if (open) output.scrollTop = output.scrollHeight;
}
toggle.addEventListener('click', () => setOpen(panel.hidden === true));

export function log(message: string, level: LogLevel = 'info'): void {
  const stickToBottom = output.scrollHeight - output.scrollTop - output.clientHeight < 24;
  const row = document.createElement('div');
  row.className = `log-row ${level}`;
  const time = document.createElement('time');
  const now = new Date();
  time.dateTime = now.toISOString();
  time.textContent = now.toLocaleTimeString('zh-CN', { hour12: false });
  const label = document.createElement('span');
  label.className = 'log-level';
  label.textContent = { info: '信息', warn: '提示', error: '错误' }[level];
  const text = document.createElement('span');
  text.className = 'log-message';
  text.textContent = message;
  row.append(time, label, text);
  output.append(row);
  while (output.childElementCount > 200) output.firstElementChild?.remove();
  if (stickToBottom) output.scrollTop = output.scrollHeight;
  if (level === 'error') setOpen(true);
}

document.getElementById('clear-console')!.addEventListener('click', () => output.replaceChildren());
