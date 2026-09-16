// Regresi perilaku dashboard; DOM kecil tanpa browser/dependensi/provider nyata.
// Jalankan: node uji/ui-regresi.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const nodes = new Map();
const element = (attributes = {}) => ({
  attributes, id: attributes.id, dataset: Object.fromEntries(Object.entries(attributes).filter(([key]) => key.startsWith('data-')).map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value])),
  textContent: '', tabIndex: Number(attributes.tabindex ?? 0),
  classList: { toggle() {}, add() {}, remove() {} },
  setAttribute(key, value) { this.attributes[key] = String(value); },
  getAttribute(key) { return this.attributes[key] ?? null; },
  addEventListener(key, listener) { this[`on${key}`] = listener; },
  focus() { document.activeElement = this; },
  click() { return this.onclick?.({ target: this, preventDefault() {}, stopPropagation() {} }); },
  closest() { return null; },
});
let markup = '';
const app = element();
Object.defineProperty(app, 'innerHTML', {
  get: () => markup,
  set(value) {
    markup = value;
    nodes.clear();
    for (const match of value.matchAll(/<([a-z][\w-]*)([^>]*)(?:>([^<]*))?/g)) {
      const attributes = Object.fromEntries([...match[2].matchAll(/([\w-]+)="([^"]*)"/g)].map((attribute) => [attribute[1], attribute[2]]));
      const node = element(attributes);
      node.tagName = match[1].toUpperCase();
      node.textContent = match[3] || '';
      nodes.set(attributes.id || `node-${nodes.size}`, node);
    }
  },
});
const matches = (node, selector) => selector.startsWith('#') ? node.attributes.id === selector.slice(1)
  : selector === '.file-card:not(.folder)' ? matches(node, '.file-card') && !matches(node, '.folder')
  : selector.startsWith('.') ? (node.attributes.class || '').split(' ').includes(selector.slice(1))
  : selector.startsWith('[') ? Object.hasOwn(node.attributes, selector.slice(1, -1)) : false;
const toast = element();
globalThis.document = {
  querySelector: (selector) => selector === '#app' ? app : selector === '#toast' ? toast : [...nodes.values()].find((node) => matches(node, selector)) || null,
  querySelectorAll: (selector) => [...nodes.values()].filter((node) => matches(node, selector)),
  dispatchEvent() {}, activeElement: null,
};
globalThis.window = { matchMedia: () => ({ matches: true }) };
let requests = 0;
let data = {
  folderId: null, path: [], providers: [], trashCount: 0, stats: { bytes: 999999 },
  folders: [{ id: 'd1', name: 'Dokumen', created_at: null }],
  files: [
    { id: 'f1', name: 'catatan.txt', mime_type: 'text/plain', size: 1024, cdn_enabled: 0 },
    { id: 'f2', name: 'foto.png', mime_type: 'image/png', size: 2048, cdn_enabled: 1 },
  ],
};
globalThis.fetch = async () => { requests += 1; return { ok: true, status: 200, headers: new Map([['content-type', 'application/json']]), json: async () => data }; };
const { state } = await import('../assets/js/state.js');
const { rute } = await import('../assets/js/router.js');
const { renderDashboard, bindDashboard } = await import('../assets/js/views/files.js');
state.user = { username: 'uji', role: 'owner' };
const render = async () => { await renderDashboard(); bindDashboard(); };
rute.dashboard = render;

await render();
const panel = document.querySelector('.files-panel');
const fileTab = document.querySelector('#tab-file');
const cdnTab = document.querySelector('#tab-cdn');
await cdnTab.click();
assert.equal(fileTab.getAttribute('aria-selected'), 'false', 'tab File tidak boleh tetap terpilih setelah klik CDN');
assert.equal(cdnTab.getAttribute('aria-selected'), 'true');
assert.equal(fileTab.tabIndex, -1);
assert.equal(cdnTab.tabIndex, 0);
assert.equal(panel.getAttribute('data-tab'), 'cdn');
assert.equal(panel.getAttribute('role'), 'tabpanel');
assert.equal(panel.getAttribute('aria-labelledby'), 'tab-cdn');
assert.equal(cdnTab.getAttribute('aria-controls'), panel.getAttribute('id'));
assert.equal(document.querySelector('#files-heading').textContent, 'Berkas CDN');
assert.equal(document.querySelector('#files-summary').textContent, '1 item · 2 KB');
let prevented = false;
cdnTab.onkeydown({ key: 'ArrowRight', preventDefault() { prevented = true; } });
assert.equal(prevented, true);
assert.equal(state.tab, 'file', 'ArrowRight membungkus ke tab File');
assert.equal(document.activeElement, fileTab);
assert.equal(document.querySelector('#files-heading').textContent, 'Isi folder');
assert.equal(document.querySelector('#files-summary').textContent, '2 item · 1 KB');
fileTab.onkeydown({ key: 'End', preventDefault() {} });
assert.equal(document.activeElement, cdnTab);
cdnTab.onkeydown({ key: 'Home', preventDefault() {} });
assert.equal(document.activeElement, fileTab);
assert.equal(requests, 1, 'pergantian tab tidak meminta data lagi');
console.log('  ok  tab: heading, jumlah/ukuran, ARIA, fokus, Arrow/Home/End, tanpa fetch ulang');

const bukaFolder = document.querySelector('[data-open-folder]');
assert.equal(bukaFolder.tagName, 'BUTTON', 'folder harus tombol native: Enter/Space, bukan article klik saja');
assert.equal(bukaFolder.getAttribute('type'), 'button');
assert.match(bukaFolder.getAttribute('aria-label'), /Dokumen/);
const folderMarkup = markup.match(/<article class="file-card folder"[\s\S]*?<\/article>/)?.[0];
assert.ok(!/<button[^>]*data-open-folder[^>]*>(?:(?!<\/button>)[\s\S])*<button/.test(folderMarkup), 'aksi folder tidak bersarang dalam tombol buka');
data = { ...data, folderId: 'd1', path: [{ id: 'd1', name: 'Dokumen' }], folders: [], files: [] };
await bukaFolder.click();
assert.equal(state.folderId, 'd1');
assert.equal(document.activeElement, document.querySelector('.view-title'), 'fokus berpindah ke judul folder setelah render');
const crumbs = document.querySelectorAll('.crumb');
assert.ok(crumbs.every((node) => node.tagName === 'BUTTON'), 'breadcrumb harus terjangkau keyboard');
assert.equal(crumbs.at(-1).getAttribute('aria-current'), 'location');
data = { ...data, folderId: null, path: [] };
await crumbs[0].click();
assert.equal(state.folderId, null);
assert.equal(document.activeElement, document.querySelector('.view-title'));
const semuaFile = document.querySelectorAll('[data-folder]').find((node) => node.attributes.class === 'active');
assert.ok(semuaFile, 'menu Semua file harus dapat kembali ke akar');
console.log('  ok  folder/breadcrumb/menu akar: tombol native, navigasi, fokus judul');

const styles = readFileSync(new URL('../assets/styles/views.css', import.meta.url), 'utf8');
const components = readFileSync(new URL('../assets/styles/components.css', import.meta.url), 'utf8');
assert.match(styles, /\.file-list\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/, 'daftar file tidak boleh mewarisi grid kartu 180px');
assert.match(styles, /\.file-list\s*\{[^}]*container-type:\s*inline-size/);
assert.match(styles, /@container file-list \(max-width: 520px\)\s*\{[\s\S]*\.card-actions\s*\{[^}]*grid-column:\s*1 \/ -1[^}]*opacity:\s*1/, 'aksi mobile turun ke baris sendiri dan selalu terlihat');
assert.match(styles, /@container file-list \(max-width: 520px\)[\s\S]*\.icon-btn\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/, 'target sentuh minimal 44px');
assert.match(components, /\.file-card:focus-within \.card-actions\s*\{[^}]*opacity:\s*1/);
assert.match(components, /\.preview-actions\s*\{[^}]*flex-wrap:\s*wrap/, 'aksi modal membungkus di layar sempit');
assert.match(styles, /\.files-panel\s*\{[^}]*margin-bottom:\s*calc\(56px/, 'baris terakhir dapat digulir melewati FAB');
assert.ok(document.querySelector('.empty-file'), 'folder kosong memberi petunjuk unggah');
assert.ok(document.querySelector('.empty-cdn'), 'tab CDN kosong memberi petunjuk terpisah');
console.log('  ok  daftar satu kolom, aksi mobile/fokus, target sentuh, jarak FAB, keadaan kosong');

// Seret file lalu pilih pengganti: kirim pilihan terakhir, bukan FileList awal tersembunyi.
const { openUploadModal } = await import('../assets/js/views/files.js');
document.body = { insertAdjacentHTML(_position, html) { app.innerHTML = html; } };
const oldFile = new File(['lama'], 'lama.png', { type: 'image/png' });
const newFile = new File(['baru'], 'baru.png', { type: 'image/png' });
openUploadModal('cdn', [oldFile]);
const input = document.querySelector('#modal-file-input');
assert.ok(document.querySelector('#upload-selection'), 'file seretan harus terlihat sebelum unggah');
assert.match(document.querySelector('#upload-selection').textContent, /lama\.png/);
input.files = [newFile];
input.onchange();
assert.match(document.querySelector('#upload-selection').textContent, /baru\.png/);
assert.doesNotMatch(document.querySelector('#upload-selection').textContent, /lama\.png/);
let sent;
globalThis.fetch = async (_url, options) => { sent = options.body; return { ok: true, status: 200, headers: new Map([['content-type', 'application/json']]), json: async () => ({ cdnUrl: '/cdn/uji' }) }; };
rute.dashboard = async () => {};
const loading = element({ id: 'loading-overlay' });
loading.remove = () => {};
nodes.set('loading-overlay', loading);
document.querySelector('#upload-modal').remove = () => {};
document.querySelector('#modal-retention-type').value = 'forever';
document.querySelector('#modal-retention-value').value = '';
await document.querySelector('#upload-form').onsubmit({ preventDefault() {} });
assert.equal(sent.get('file').name, 'baru.png');
console.log('  ok  file seretan terlihat; pilihan baru menggantikan file awal saat unggah');

const { formatBytes } = await import('../assets/js/core.js');
for (const [bytes, expected] of [[0, '0 B'], [1, '1 B'], [1024, '1 KB'], [2048, '2 KB'], [1048576, '1.0 MB'], [1073741824, '1.0 GB'], [1099511627776, '1.0 TB']]) {
  assert.equal(formatBytes(bytes), expected, `satuan ukuran ${bytes}`);
}
console.log('  ok  satuan penyimpanan B/KB/MB/GB/TB');

// Jangan membuka iframe yang endpoint unduhnya sengaja mengirim attachment.
const { bindMediaPreview } = await import('../assets/js/views/files.js');
document.createElement = () => ({ canPlayType: () => 'probably' });
const previewTypes = [
  ['application/json', 'download'], ['application/javascript', 'download'],
  ['text/javascript', 'download'], ['application/xml', 'download'], ['text/xml', 'download'],
  ['text/html', 'download'], ['application/octet-stream', 'download'],
  ['image/svg+xml', 'img'], ['image/png', 'img'], ['audio/mpeg', 'audio'], ['video/mp4', 'video'],
  ['application/pdf', 'iframe'], ['Application/PDF; version=1.7', 'iframe'],
  ['text/plain', 'iframe'], ['Text/Plain; charset=utf-8', 'iframe'], ['text/plain-extra', 'download'],
];
const previews = [];
for (const cdn_enabled of [0, 1]) for (const [mime_type, expected] of previewTypes) {
  state.dashboard = { files: [{ id: 'preview', name: 'preview', mime_type, cdn_enabled, cdn_slug: 'preview-slug' }] };
  app.innerHTML = '<article class="file-card" data-file-id="preview"></article>';
  bindMediaPreview();
  await document.querySelector('.file-card').click();
  const rendered = markup.match(/<(img|video|audio|iframe)\b/)?.[1] || 'download';
  previews.push({ mime_type, cdn_enabled, rendered });
  const url = cdn_enabled ? '/cdn/preview-slug' : '/api/files/preview/download';
  assert.ok(markup.includes(`href="${url}"`), 'download tetap tersedia');
  if (expected === 'download' && rendered === 'download') assert.match(markup, /media-empty/);
}
assert.deepEqual(previews, [0, 1].flatMap(cdn_enabled => previewTypes.map(([mime_type, rendered]) => ({ mime_type, cdn_enabled, rendered }))));
console.log('  ok  preview cocok dengan allowlist server; JSON/JS/XML/HTML memakai download');
