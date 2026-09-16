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
  querySelector(selector) { return selector === 'h2' ? [...nodes.values()].find(node => node.tagName === 'H2') : null; },
  showModal() { this.open = true; },
  close() { this.open = false; },
  remove() { nodes.delete(this.id); },
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
assert.equal(typeof document.querySelector('#dropzone').onclick, 'function', 'dropzone juga membuka pemilih lewat keyboard/klik');
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

// Native dialogs: modal state, Escape, accessible name, focus returned to opener.
const core = await import('../assets/js/core.js');
assert.equal(typeof core.openDialog, 'function', 'dialog harus dibuka lewat helper native');
assert.equal(typeof core.closeDialog, 'function');
const opener = element(); opener.isConnected = true; opener.focus();
const heading = element();
const dialog = element({ id: 'dialog-test' });
dialog.querySelector = () => heading;
dialog.querySelectorAll = () => [];
dialog.showModal = () => { dialog.open = true; };
dialog.close = () => { dialog.open = false; };
dialog.remove = () => { nodes.delete('dialog-test'); };
nodes.set('dialog-test', dialog);
core.openDialog('dialog-test');
assert.equal(dialog.open, true);
assert.equal(dialog.getAttribute('aria-labelledby'), heading.id);
let cancelPrevented = false;
dialog.oncancel({ preventDefault() { cancelPrevented = true; } });
assert.equal(cancelPrevented, true);
assert.equal(nodes.has('dialog-test'), false);
assert.equal(document.activeElement, opener);
console.log('  ok  dialog native: modal, nama aksesibel, Escape, fokus kembali');

// Share configuration is a form, not blocking prompts; payload remains unchanged.
const { shareFile } = await import('../assets/js/views/files.js');
globalThis.prompt = () => { throw new Error('Share tidak boleh memakai prompt browser'); };
globalThis.location = { origin: 'http://localhost' };
const insert = document.body.insertAdjacentHTML;
document.body.insertAdjacentHTML = function (position, html) {
  insert(position, html);
  const contents = new Map(nodes);
  for (const node of nodes.values()) {
    node.querySelector = (selector) => selector === 'h2' ? [...contents.values()].find(item => item.tagName === 'H2') : [...contents.values()].find(item => matches(item, selector)) || null;
    node.showModal = () => { node.open = true; };
    node.close = () => { node.open = false; };
    node.remove = () => { if (node.tagName === 'DIALOG') for (const [id, item] of contents) { if (nodes.get(id) === item) nodes.delete(id); } };
    node.reportValidity = () => true;
    if (node.tagName === 'INPUT') node.value = node.attributes.value || '';
  }
};
await shareFile('f-share', '<private>.pdf', '');
assert.ok(document.querySelector('#share-form'));
assert.ok(markup.includes('&lt;private&gt;.pdf'));
const passwordField = document.querySelector('#share-password');
assert.equal(passwordField.getAttribute('type'), 'password');
passwordField.value = '  access-test  ';
document.querySelector('#share-days').value = '2';
let shareRequest;
globalThis.fetch = async (url, options) => { shareRequest = { url, body: JSON.parse(options.body) }; return { ok: true, status: 200, headers: new Map([['content-type', 'application/json']]), json: async () => ({ url: '/share/test', expiresAt: '2026-01-01T00:00:00Z' }) }; };
const beforeShare = Date.now();
await document.querySelector('#share-form').onsubmit({ preventDefault() {}, currentTarget: document.querySelector('#share-form') });
assert.equal(shareRequest.url, '/api/files/f-share/share');
assert.equal(shareRequest.body.password, 'access-test');
assert.ok(Math.abs(new Date(shareRequest.body.expiresAt).getTime() - beforeShare - 2 * 86400000) < 1000);
assert.match(document.querySelector('#share-link').value, /\?password=access-test$/);
await shareFile('f-share', 'private.pdf', '');
document.querySelector('#share-password').value = '';
document.querySelector('#share-days').value = '';
await document.querySelector('#share-form').onsubmit({ preventDefault() {}, currentTarget: document.querySelector('#share-form') });
assert.deepEqual(shareRequest.body, {}, 'tanpa sandi/masa berlaku tidak mengirim nilai buatan');
console.log('  ok  share: formulir, escaping, password/expiry payload, link, tanpa batas');

// Rename preserves both PATCH contracts and validates without closing on failure.
const { renameFile, renameFolder } = await import('../assets/js/views/files.js');
for (const [rename, kind] of [[renameFile, 'files'], [renameFolder, 'folders']]) {
  await rename('rename-id', 'Nama lama');
  assert.ok(document.querySelector('#rename-form'));
  assert.equal(document.querySelector('#rename-name').value, 'Nama lama');
  document.querySelector('#rename-name').value = ' ';
  const previousRequest = shareRequest;
  await document.querySelector('#rename-form').onsubmit({ preventDefault() {} });
  assert.equal(shareRequest, previousRequest);
  assert.match(document.querySelector('#rename-error').textContent, /kosong/);
  document.querySelector('#rename-name').value = '  Nama baru  ';
  await document.querySelector('#rename-form').onsubmit({ preventDefault() {} });
  assert.equal(shareRequest.url, `/api/${kind}/rename-id`);
  assert.deepEqual(shareRequest.body, { name: 'Nama baru' });
}
console.log('  ok  rename file/folder: modal, nama awal, PATCH sama, trim');

let toastOpened = 0;
let toastClosed = 0;
toast.showPopover = () => { toastOpened += 1; };
toast.hidePopover = () => { toastClosed += 1; };
const originalTimer = globalThis.setTimeout;
globalThis.setTimeout = (fn) => { fn(); return 0; };
core.notify('Galat tetap terlihat di atas dialog');
globalThis.setTimeout = originalTimer;
assert.equal(toastOpened, 1, 'toast muncul di top layer agar tidak tertutup dialog');
assert.equal(toastClosed, 1);
console.log('  ok  notifikasi tampil di atas dialog native');

// Drawer follows the shell's CSS breakpoint, not the viewport's width.
const base = readFileSync(new URL('../assets/styles/base.css', import.meta.url), 'utf8');
const drawerBreakpoint = Number(base.match(/@container shell \(max-width: (\d+)px\)/)[1]);
const bodyClasses = new Set();
document.body.classList = { add: value => bodyClasses.add(value), remove: value => bodyClasses.delete(value), contains: value => bodyClasses.has(value) };
const drawerButton = element();
const drawerScrim = element();
const drawerNav = element();
const drawerSidebar = element();
drawerSidebar.querySelector = () => drawerNav;
const drawerTopbar = element();
let drawerInserted = false;
drawerTopbar.querySelector = () => drawerInserted ? drawerButton : null;
drawerTopbar.insertAdjacentHTML = () => { drawerInserted = true; };
const shell = element();
shell.isConnected = true;
shell.querySelector = selector => ({ '.topbar': drawerTopbar, '.sidebar': drawerSidebar, '#drawer-scrim': drawerScrim })[selector];
shell.insertAdjacentHTML = () => {};
app.querySelector = selector => selector === '.app-shell' ? shell : null;
let shellWidth = 700;
let viewportWidth = 700;
const mediaListeners = [];
const resizeObservers = [];
const drawerFrames = [];
globalThis.requestAnimationFrame = callback => drawerFrames.push(callback);
const flushDrawerFrame = () => { for (const callback of drawerFrames.splice(0)) callback(); };
globalThis.matchMedia = query => {
  const minimum = Number(query.match(/min-width:\s*(\d+)px/)[1]);
  return { addEventListener(_type, listener) { mediaListeners.push({ minimum, listener, matches: viewportWidth >= minimum }); } };
};
globalThis.getComputedStyle = node => {
  assert.equal(node, drawerButton);
  return { display: shellWidth <= drawerBreakpoint ? 'inline-flex' : 'none' };
};
globalThis.ResizeObserver = class {
  constructor(callback) { this.callback = callback; resizeObservers.push(this); }
  observe(target) { this.target = target; }
  disconnect() { this.target = null; }
};
const resizeDrawer = (width, viewport = width) => {
  shellWidth = width; viewportWidth = viewport;
  for (const media of mediaListeners) {
    const matches = viewportWidth >= media.minimum;
    if (matches !== media.matches) { media.matches = matches; media.listener({ matches }); }
  }
  for (const observer of resizeObservers) if (observer.target) observer.callback([{ target: observer.target, contentRect: { width } }]);
};
core.pasangDrawer();
await drawerButton.click();
assert.equal(bodyClasses.has('is-drawer'), true);
resizeDrawer(740);
assert.equal(bodyClasses.has('is-drawer'), true, 'ResizeObserver tidak boleh melepas scroll lock saat delivery');
assert.equal(drawerButton.getAttribute('aria-expanded'), 'true');
flushDrawerFrame();
assert.equal(bodyClasses.has('is-drawer'), false, '700→740: desktop tidak boleh menyisakan scroll lock');
assert.equal(drawerButton.getAttribute('aria-expanded'), 'false');
assert.equal(document.activeElement, drawerNav, 'resize tidak memfokuskan tombol tersembunyi');
resizeDrawer(700, 1000);
flushDrawerFrame();
assert.equal(bodyClasses.has('is-drawer'), false, 'kembali sempit tidak membuka drawer lama');
await drawerButton.click();
resizeDrawer(720, 1000);
flushDrawerFrame();
assert.equal(bodyClasses.has('is-drawer'), true, 'shell 720px tetap mobile meski viewport desktop');
resizeDrawer(721, 1000);
flushDrawerFrame();
assert.equal(bodyClasses.has('is-drawer'), false, 'perubahan container tanpa resize viewport mereset drawer');
assert.equal(drawerButton.getAttribute('aria-expanded'), 'false');
resizeDrawer(700);
flushDrawerFrame();
await drawerButton.click();
resizeDrawer(740);
shell.isConnected = false;
flushDrawerFrame();
assert.equal(bodyClasses.has('is-drawer'), true, 'callback tertunda dari shell lama tidak boleh mengubah body');
assert.equal(drawerButton.getAttribute('aria-expanded'), 'true');
resizeDrawer(740);
flushDrawerFrame();
assert.ok(resizeObservers.every(observer => observer.target === null), 'observer shell terlepas harus disconnect');
console.log('  ok  drawer: 700/740, batas container 720/721, buka ulang, ARIA, fokus, reset tertunda, cleanup');

// A modal makes helpers appended outside it inert: select/copy must run inside it.
const { copyText } = await import('../assets/js/views/files.js');
const querySelector = document.querySelector;
let activeDialog = element();
let helper;
let selectedText = '';
let copyAllowed = true;
const appendHelper = function (node) { node.parentElement = this; };
document.body.appendChild = appendHelper;
activeDialog.appendChild = appendHelper;
document.querySelector = selector => selector === 'dialog[open]' ? activeDialog : querySelector(selector);
document.createElement = tag => {
  assert.equal(tag, 'textarea');
  helper = { select() { if (!activeDialog || this.parentElement === activeDialog) selectedText = this.value; }, remove() { this.removed = true; } };
  return helper;
};
document.execCommand = command => { assert.equal(command, 'copy'); return copyAllowed && selectedText !== ''; };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async () => { throw new Error('denied'); } } } });
assert.equal(await copyText('modal link'), true, 'fallback harus bisa memilih teks di dalam modal, bukan body inert');
assert.equal(selectedText, 'modal link');
assert.equal(helper.removed, true);
activeDialog = null; selectedText = '';
assert.equal(await copyText('body link'), true);
assert.equal(selectedText, 'body link');
assert.equal(helper.parentElement, document.body);
assert.equal(helper.removed, true);
copyAllowed = false;
assert.equal(await copyText('manual link'), false);
assert.equal(helper.removed, true);
navigator.clipboard = undefined;
copyAllowed = true;
assert.equal(await copyText('HTTP link'), true);
navigator.clipboard = { writeText: async text => { selectedText = text; } };
helper = null;
assert.equal(await copyText('native link'), true);
assert.equal(selectedText, 'native link');
assert.equal(helper, null, 'Clipboard API berhasil tidak membuat helper');
document.querySelector = querySelector;
console.log('  ok  clipboard: modal non-inert, body, API ditolak/tidak tersedia, gagal, cleanup');

// Late share responses belong only to the dialog instance that submitted them.
const staleShares = [];
for (const failure of [false, true]) for (const dismissal of ['cancel', 'cancel-reopen', 'escape-reopen', 'replace', 'close']) {
  await shareFile('file-a', 'A.pdf', '');
  const initiatingDialog = document.querySelector('#share-modal');
  document.querySelector('#share-days').value = '';
  let settle;
  let pendingRequest;
  globalThis.fetch = (url, options) => { pendingRequest = { url, options }; return new Promise(resolve => { settle = resolve; }); };
  const pending = document.querySelector('#share-form').onsubmit({ preventDefault() {} });
  assert.equal(pendingRequest.url, '/api/files/file-a/share');
  assert.equal(pendingRequest.options.method, 'POST');
  assert.equal(pendingRequest.options.body, '{}');
  if (dismissal.startsWith('cancel')) await document.querySelector('#close-share').click();
  else if (dismissal.startsWith('escape')) initiatingDialog.oncancel({ preventDefault() {} });
  else if (dismissal === 'close') initiatingDialog.close();
  else initiatingDialog.remove();
  if (dismissal.endsWith('reopen') || dismissal === 'replace') await shareFile('file-b', 'B.pdf', '');
  const currentDialog = document.querySelector('#share-modal');
  const currentError = document.querySelector('#share-error');
  const currentSubmit = document.querySelector('#create-share');
  const disabledBefore = currentSubmit?.disabled;
  const previousToast = toast.textContent;
  settle({ ok: !failure, status: failure ? 400 : 200, headers: new Map([['content-type', 'application/json']]), json: async () => ({ url: '/share/a', error: 'A failed' }) });
  await pending;
  staleShares.push({ failure, dismissal, sameDialog: document.querySelector('#share-modal') === currentDialog, error: currentError?.textContent || '', sameSubmit: currentSubmit?.disabled === disabledBefore, sameToast: toast.textContent === previousToast, aborted: pendingRequest.options.signal.aborted });
}
assert.deepEqual(staleShares, staleShares.map(({ failure, dismissal }) => ({ failure, dismissal, sameDialog: true, error: '', sameSubmit: true, sameToast: true, aborted: false })), 'respons A tidak boleh menutup/mengubah B atau membuka ulang dialog yang dibatalkan');
await shareFile('file-a', 'A.pdf', '');
globalThis.fetch = async () => ({ ok: false, status: 400, headers: new Map([['content-type', 'application/json']]), json: async () => ({ error: 'Current failure' }) });
await document.querySelector('#share-form').onsubmit({ preventDefault() {} });
assert.equal(document.querySelector('#share-error').textContent, 'Current failure');
assert.equal(document.querySelector('#create-share').disabled, false, 'galat aktif tetap mengizinkan coba ulang');
console.log('  ok  share async: sukses/galat usang diabaikan, B utuh, request tetap berjalan, galat aktif');
