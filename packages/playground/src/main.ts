import { loadPack, type EffectPack } from 'natsume';
import './style.css';
import { showPreview, clearPreview } from './preview.js';
import { log } from './console.js';

const status = document.getElementById('status')!;
const name = document.getElementById('pack-name')!;
const file = document.getElementById('file') as HTMLInputElement;
let pack: EffectPack | undefined;
let controller: AbortController | undefined;

async function openFile(selected: File): Promise<void> {
  controller?.abort();
  const active = new AbortController();
  controller = active;
  clearPreview();
  pack?.dispose();
  pack = undefined;
  name.textContent = selected.name;
  name.title = selected.name;
  status.classList.remove('error');
  status.textContent = '正在载入…';
  log(`载入 ${selected.name}`);
  try {
    if (selected.size > 64 * 1024 * 1024) throw new Error('文件超过 64 MiB 限制');
    const bytes = await selected.arrayBuffer();
    if (active.signal.aborted) return;
    const loaded = await loadPack(bytes, { signal: active.signal });
    if (active.signal.aborted) {
      loaded.dispose();
      return;
    }
    pack = loaded;
    await showPreview(loaded, active.signal);
    if (active.signal.aborted) return;
    status.textContent = '预览就绪';
    const counts = loaded.describe().counts;
    log(`${selected.name} · ${counts.nodes} 个节点 · ${counts.assets} 个资产 · 预览就绪`);
  } catch (error) {
    if (active.signal.aborted) return;
    clearPreview();
    pack?.dispose();
    pack = undefined;
    const message = error instanceof Error ? error.message : String(error);
    status.classList.add('error');
    status.textContent = '无法预览，请查看控制台';
    log(message, 'error');
  }
}

file.addEventListener('change', () => {
  const selected = file.files?.[0];
  file.value = '';
  if (selected) void openFile(selected);
});
window.addEventListener('pagehide', () => {
  controller?.abort();
  pack?.dispose();
});
log('等待选择 .noap 文件');
