import { loadPack, type EffectPack } from '@untitled-story/natsume';
import './style.css';
import { showPreview, clearPreview, readPreviewSortingLayers } from './preview.js';
import { log } from './console.js';
import { readBridgeDeclarations } from './bridge.js';

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
const bridgeFile = document.getElementById('bridge-file') as HTMLInputElement;
bridgeFile.addEventListener('change', () => {
  const selected = bridgeFile.files?.[0];
  bridgeFile.value = '';
  if (!selected) return;
  void (async () => {
    try {
      if (selected.size > 1024 * 1024) throw new Error('Bridge 声明超过 1 MiB');
      readBridgeDeclarations(await selected.text());
      log('Bridge 声明已载入；选择 .noap 生效，仅接收字段，不执行原游戏逻辑', 'warn');
    } catch (error) {
      log(error instanceof Error ? error.message : String(error), 'error');
    }
  })();
});
const sortingFile = document.getElementById('sorting-file') as HTMLInputElement;
sortingFile.addEventListener('change', () => {
  const selected = sortingFile.files?.[0];
  sortingFile.value = '';
  if (!selected) return;
  void (async () => {
    try {
      if (selected.size > 1024 * 1024) throw new Error('排序层配置超过 1 MiB');
      readPreviewSortingLayers(await selected.text());
      log('宿主排序层已更新');
    } catch (error) {
      log(error instanceof Error ? error.message : String(error), 'error');
    }
  })();
});
window.addEventListener('pagehide', () => {
  controller?.abort();
  pack?.dispose();
});
log('等待选择 .noap 文件');
