// Regresi unggah folder: modul frontend asli, hanya batas DOM/HTTP/XHR ditiru.
// Jalankan: node uji/upload-folder.mjs
import assert from 'node:assert/strict';

const nodes = new Map();
const element = () => ({ classList: { add() {}, remove() {} } });
const app = element();
const toast = element();
globalThis.document = {
  querySelector: (selector) => selector === '#app' ? app : selector === '#toast' ? toast : nodes.get(selector) || null,
  dispatchEvent() {},
};
const timer = globalThis.setTimeout;
globalThis.setTimeout = (fn, ms, ...args) => { const handle = timer(fn, ms, ...args); handle.unref(); return handle; };
const { state } = await import('../assets/js/state.js');
const { rute } = await import('../assets/js/router.js');
const { uploadFiles } = await import('../assets/js/views/files.js');
rute.dashboard = async () => {};
let folders, uploads, folderResponse, uploadResponse;
const reset = () => {
  folders = []; uploads = []; toast.textContent = '';
  state.folderId = 'destination';
  nodes.set('#upload-provider', { value: 'provider-1' });
  folderResponse = () => ({ ok: true, id: `folder-${folders.length}` });
  uploadResponse = () => ({ status: 201, body: { id: `file-${uploads.length}` } });
};
globalThis.fetch = async (url, options) => {
  assert.equal(url, '/api/folders');
  assert.equal(options.method, 'POST');
  const body = JSON.parse(options.body);
  folders.push(body);
  const response = folderResponse(body);
  return { ok: response.ok, status: response.ok ? 201 : 400, headers: new Map([['content-type', 'application/json']]), json: async () => response };
};
globalThis.XMLHttpRequest = class {
  upload = {};
  open(method, url) { assert.equal(method, 'POST'); assert.equal(url, '/api/files'); }
  send(body) {
    uploads.push(body);
    const response = uploadResponse(body);
    this.status = response.status;
    this.responseText = JSON.stringify(response.body);
    queueMicrotask(() => this.onload());
  }
};
const file = (name, relativePath = '', contents = name) => {
  const value = new File([contents], name);
  Object.defineProperty(value, 'webkitRelativePath', { value: relativePath });
  return value;
};

reset();
await uploadFiles([
  file('a.txt', 'Trip/a.txt', 'root bytes'),
  file('same.txt', 'Trip/day-1/same.txt', 'first bytes'),
  file('same.txt', 'Trip/day-2/same.txt', 'second bytes'),
  file('b.txt', 'Trip/day-1/b.txt'),
], 'days', '7', 'true');
assert.deepEqual(folders, [
  { name: 'Trip', parentId: 'destination' },
  { name: 'day-1', parentId: 'folder-1' },
  { name: 'day-2', parentId: 'folder-1' },
], 'akar pilihan dan subfolder dibuat sekali di tujuan aktif');
assert.deepEqual(uploads.map(body => body.get('folderId')), ['folder-1', 'folder-2', 'folder-3', 'folder-2']);
assert.deepEqual(await Promise.all(uploads.map(body => body.get('file').text())), ['root bytes', 'first bytes', 'second bytes', 'b.txt']);
for (const body of uploads) {
  assert.equal(body.get('providerId'), 'provider-1');
  assert.equal(body.get('retentionType'), 'days');
  assert.equal(body.get('retentionValue'), '7');
  assert.equal(body.get('encrypt'), 'true');
}
console.log('  ok  akar/subfolder, nama kembar, byte, provider, retensi, enkripsi');

for (const explicitPaths of [false, true]) {
  reset();
  const selection = [file(' report.txt '), file('same.txt', '', 'first'), file('same.txt', '', 'second')];
  await uploadFiles(selection, 'forever', '', 'false', explicitPaths ? selection.map(file => file.name) : null);
  assert.deepEqual(uploads.map(body => body.get('file').name), selection.map(file => file.name), 'file datar mempertahankan spasi dan nama kembar, termasuk path dari drop');
  assert.deepEqual(await Promise.all(uploads.map(body => body.get('file').text())), [' report.txt ', 'first', 'second']);
  assert.deepEqual(folders, []);
  assert.ok(uploads.every(body => body.get('folderId') === 'destination'));
}
console.log('  ok  nama file datar tetap utuh, nama kembar tidak ditolak');

for (const path of ['../bad.txt', 'Trip/../bad.txt', 'Trip/./bad.txt', '/Trip/bad.txt', 'Trip//bad.txt', 'Trip/bad.txt/', 'Trip\\bad.txt', 'C:/bad.txt', 'Trip/\u0000/bad.txt', 'Trip/ /bad.txt', ' Trip/bad.txt', 'Trip/other.txt']) {
  reset();
  await uploadFiles([file('good.txt', 'Trip/good.txt'), file('bad.txt', path)]);
  assert.deepEqual(folders, [], `path tidak aman ditolak sebelum folder pertama: ${JSON.stringify(path)}`);
  assert.deepEqual(uploads, []);
  assert.match(toast.textContent, /path.*tidak valid/i);
}
for (const selection of [
  [file('same.txt', 'Trip/same.txt'), file('same.txt', 'Trip/same.txt')],
  [file('sub', 'Trip/sub'), file('nested.txt', 'Trip/sub/nested.txt')],
]) {
  reset();
  await uploadFiles(selection);
  assert.deepEqual(folders, [], 'path duplikat atau file/folder bentrok ditolak sebelum side effect');
  assert.deepEqual(uploads, []);
  assert.match(toast.textContent, /path.*tidak valid/i);
}
console.log('  ok  seluruh path divalidasi sebelum permintaan, duplikat/bentrok ditolak');

reset();
folderResponse = ({ name }) => name === 'blocked' ? { ok: false, error: 'Folder ditolak' } : { ok: true, id: `folder-${folders.length}` };
await assert.doesNotReject(() => uploadFiles([
  file('saved.txt', 'Trip/saved.txt'),
  file('lost.txt', 'Trip/blocked/lost.txt'),
  file('dependent.txt', 'Trip/blocked/deep/dependent.txt'),
]));
assert.equal(uploads.length, 1, 'gagal membuat folder menghentikan batch tanpa fallback akar');
assert.equal(uploads[0].get('file').name, 'saved.txt', 'hasil berhasil tidak dihapus');
assert.deepEqual(folders.map(folder => folder.name), ['Trip', 'blocked'], 'tidak retry atau membuat keturunan setelah gagal');
assert.match(toast.textContent, /1 dari 3 file berhasil.*Folder ditolak/s);

reset();
folderResponse = () => ({ ok: true });
await assert.doesNotReject(() => uploadFiles([file('lost.txt', 'Trip/lost.txt')]));
assert.equal(uploads.length, 0, 'balasan folder tanpa ID tidak pernah mengunggah ke akar');
assert.match(toast.textContent, /0 dari 1 file berhasil/);

reset();
uploadResponse = () => uploads.length === 2 ? { status: 500, body: { error: 'Storage gagal' } } : { status: 201, body: { id: 'saved' } };
await uploadFiles([file('a.txt', 'Trip/a.txt'), file('b.txt', 'Trip/b.txt'), file('c.txt', 'Trip/c.txt')]);
assert.equal(uploads.length, 3, 'file gagal tidak dicoba ulang; file berikutnya tetap berjalan');
assert.match(toast.textContent, /2 dari 3 file berhasil/);
console.log('  ok  kegagalan folder berhenti aman; hasil parsial disimpan/dilaporkan tanpa retry');

reset();
uploadResponse = () => {
  state.folderId = 'navigated-away';
  nodes.get('#upload-provider').value = 'provider-2';
  return { status: 201, body: { id: 'saved' } };
};
await uploadFiles([file('a.txt'), file('b.txt', 'Trip/deep/b.txt'), file('c.txt')]);
assert.deepEqual(folders, [{ name: 'Trip', parentId: 'destination' }, { name: 'deep', parentId: 'folder-1' }]);
assert.deepEqual(uploads.map(body => body.get('folderId')), ['destination', 'folder-2', 'destination']);
assert.ok(uploads.every(body => body.get('providerId') === 'provider-1'));
assert.equal(state.folderId, 'navigated-away', 'refresh tidak mengubah tujuan navigasi user');
reset();
await uploadFiles([file('a.txt', 'Trip/a.txt')]);
await uploadFiles([file('b.txt', 'Trip/b.txt')]);
assert.deepEqual(folders, [{ name: 'Trip', parentId: 'destination' }, { name: 'Trip', parentId: 'destination' }], 'batch baru membuat pohon baru, bukan merge berdasarkan nama');
console.log('  ok  tujuan/provider terkunci selama batch; batch baru tidak merge folder lama');

// DOM kecil menjalankan handler asli; browser native diverifikasi terpisah.
let markup = '';
const parse = (html) => {
  markup = html;
  for (const match of html.matchAll(/<([a-z][\w-]*)([^>]*)>/g)) {
    const attributes = Object.fromEntries([...match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(value => [value[1], value[2] ?? '']));
    if (!attributes.id) continue;
    const node = { ...element(), attributes, tagName: match[1].toUpperCase(), value: attributes.value || '',
      webkitdirectory: Object.hasOwn(attributes, 'webkitdirectory'),
      querySelector() { return null; }, setAttribute() {}, showModal() { this.open = true; }, close() { this.open = false; },
      remove() { nodes.delete(`#${attributes.id}`); },
      click() { return this.onclick?.({ preventDefault() {}, currentTarget: this }); },
      addEventListener(key, handler) { this[`on${key}`] = handler; },
    };
    nodes.set(`#${attributes.id}`, node);
  }
};
Object.defineProperty(app, 'innerHTML', { set(html) { nodes.clear(); parse(html); } });
document.querySelectorAll = () => [];
document.body = { insertAdjacentHTML(_position, html) { parse(html); } };
globalThis.window = { matchMedia: () => ({ matches: true }) };
const { renderDashboard, bindDashboard, openUploadModal } = await import('../assets/js/views/files.js');
const fetchFolders = globalThis.fetch;
reset();
state.user = { role: 'owner', username: 'uji' };
globalThis.fetch = async () => ({ ok: true, status: 200, headers: new Map([['content-type', 'application/json']]), json: async () => ({ folderId: 'destination', providers: [], folders: [], files: [], stats: { bytes: 0 } }) });
await renderDashboard();
bindDashboard();
const folderButton = nodes.get('#upload-folder-trigger');
assert.ok(folderButton, 'dashboard punya tombol Upload folder');
assert.equal(folderButton.tagName, 'BUTTON');
assert.equal(typeof folderButton.onclick, 'function');
await folderButton.click();
let input = nodes.get('#modal-file-input');
assert.equal(input.webkitdirectory, true, 'pemilih folder native, bukan file picker datar');
assert.match(markup, /Folder kosong tidak ikut diunggah/);
input.files = [file('old.txt', 'Old/old.txt')];
input.onchange();
assert.match(nodes.get('#upload-selection').textContent, /Old\/old.txt/);
input.files = [file('new.txt', 'New/nested/new.txt')];
input.onchange();
assert.match(nodes.get('#upload-selection').textContent, /New\/nested\/new.txt/);
assert.doesNotMatch(nodes.get('#upload-selection').textContent, /Old/);
nodes.get('#modal-retention-type').value = 'months';
nodes.get('#modal-retention-value').value = '2';
nodes.get('#modal-encrypt').checked = true;
globalThis.fetch = fetchFolders;
await nodes.get('#upload-form').onsubmit({ preventDefault() {} });
assert.deepEqual(folders, [{ name: 'New', parentId: 'destination' }, { name: 'nested', parentId: 'folder-1' }]);
assert.equal(uploads[0].get('file').name, 'new.txt');
assert.equal(uploads[0].get('retentionType'), 'months');
assert.equal(uploads[0].get('retentionValue'), '2');
assert.equal(uploads[0].get('encrypt'), 'true');

reset();
openUploadModal('folder');
input = nodes.get('#modal-file-input');
input.files = [file('missing-path.txt')];
input.onchange();
await nodes.get('#upload-form').onsubmit({ preventDefault() {} });
assert.equal(uploads.length, 0, 'pemilih folder tanpa relative path tidak boleh flatten');
assert.match(toast.textContent, /path.*tidak valid/i);
console.log('  ok  tombol folder native, petunjuk folder kosong, ganti pilihan, submit opsi lengkap');

for (const kind of ['file', 'folder']) {
  reset();
  nodes.get(kind === 'folder' ? '#upload-folder-trigger' : '#upload-trigger').click();
  input = nodes.get('#modal-file-input');
  state.folderId = 'picker-navigation';
  nodes.set('#upload-provider', { value: 'provider-2' });
  input.files = [file('picked.txt', kind === 'folder' ? 'Picked/picked.txt' : '')];
  input.onchange();
  await nodes.get('#upload-form').onsubmit({ preventDefault() {} });
  assert.deepEqual(folders, kind === 'folder' ? [{ name: 'Picked', parentId: 'destination' }] : [], `${kind}: tujuan terkunci saat membuka picker`);
  assert.equal(uploads[0].get('folderId'), kind === 'folder' ? 'folder-1' : 'destination');
  assert.equal(uploads[0].get('providerId'), 'provider-1');
}
console.log('  ok  picker file/folder mempertahankan tujuan/provider awal hingga submit');

const fileEntry = (name, contents = name) => ({ name, isFile: true, file(resolve) { queueMicrotask(() => resolve(file(name, '', contents))); } });
const directoryEntry = (name, batches) => ({ name, isDirectory: true, createReader() {
  let index = 0;
  return { readEntries(resolve) { queueMicrotask(() => resolve(batches[index++] || [])); } };
} });
reset();
let eventValid = true;
let captured = 0;
const entries = [
  directoryEntry('Drop', [Array.from({ length: 100 }, (_, i) => fileEntry(`${i}.txt`)), [directoryEntry('nested', [[fileEntry('100.txt')]])]]),
  fileEntry('loose.txt', 'loose bytes'),
];
const drop = nodes.get('#dropzone');
const pending = drop.ondrop({ preventDefault() {}, currentTarget: drop, dataTransfer: {
  files: [file('Drop'), file('loose.txt')],
  items: entries.map(entry => ({ kind: 'file', webkitGetAsEntry() { assert.ok(eventValid, 'getters dipanggil saat event drop masih valid'); captured += 1; return entry; } })),
} });
eventValid = false;
await pending;
assert.equal(captured, 2, 'ambil semua entry sebelum await pertama');
assert.match(nodes.get('#upload-selection').textContent, /102 file/);
assert.match(nodes.get('#upload-selection').textContent, /Drop\/nested\/100.txt/);
assert.match(markup, /Folder kosong tidak ikut diunggah/);
nodes.get('#modal-retention-type').value = 'forever';
await nodes.get('#upload-form').onsubmit({ preventDefault() {} });
assert.deepEqual(folders, [{ name: 'Drop', parentId: 'destination' }, { name: 'nested', parentId: 'folder-1' }]);
assert.equal(uploads.length, 102, 'readEntries dikuras sampai kosong, bukan batch pertama saja');
assert.equal(uploads[100].get('folderId'), 'folder-2');
assert.equal(uploads[101].get('folderId'), 'destination');
assert.equal(await uploads[101].get('file').text(), 'loose bytes');
console.log('  ok  drop campuran, tangkap entry sinkron, 100+ entry, pohon tetap utuh');

reset();
let finishReading;
const delayedDirectory = { name: 'Delayed', isDirectory: true, createReader() {
  let first = true;
  return { readEntries(resolve) {
    if (first) { first = false; finishReading = resolve; }
    else queueMicrotask(() => resolve([]));
  } };
} };
const scanning = drop.ondrop({ preventDefault() {}, currentTarget: drop, dataTransfer: {
  items: [delayedDirectory, fileEntry('loose.txt')].map(entry => ({ kind: 'file', webkitGetAsEntry: () => entry })),
} });
assert.equal(typeof finishReading, 'function', 'scan direktori tertahan sebelum callback pertama');
state.folderId = 'during-scan';
nodes.set('#upload-provider', { value: 'provider-2' });
finishReading([fileEntry('pinned.txt')]);
await scanning;
state.folderId = 'after-modal';
nodes.set('#upload-provider', { value: 'provider-3' });
await nodes.get('#upload-form').onsubmit({ preventDefault() {} });
assert.deepEqual(folders, [{ name: 'Delayed', parentId: 'destination' }], 'drop mengunci tujuan sebelum pembacaan entry asinkron');
assert.deepEqual(uploads.map(body => body.get('folderId')), ['folder-1', 'destination']);
assert.deepEqual(uploads.map(body => body.get('providerId')), ['provider-1', 'provider-1']);
assert.equal(state.folderId, 'after-modal');
console.log('  ok  tujuan/provider drop terkunci sebelum scan, tetap utuh hingga submit');

for (const entry of [
  { name: 'broken', isDirectory: true, createReader() { return { readEntries(_resolve, reject) { reject(new Error('Tidak dapat dibaca')); } }; } },
  { name: 'broken.txt', isFile: true, file(_resolve, reject) { reject(new Error('Tidak dapat dibaca')); } },
  null,
]) {
  reset();
  await assert.doesNotReject(() => drop.ondrop({ preventDefault() {}, currentTarget: drop, dataTransfer: {
    files: [file('flattened.txt')], items: [{ kind: 'file', webkitGetAsEntry: () => entry }],
  } }));
  assert.equal(nodes.has('#upload-modal'), false, 'pembacaan gagal tidak membuka pilihan file datar');
  assert.equal(uploads.length, 0);
  assert.match(toast.textContent, /tidak|gagal/i);
}
reset();
await drop.ondrop({ preventDefault() {}, currentTarget: drop, dataTransfer: {
  files: [file('Empty')], items: [{ kind: 'file', webkitGetAsEntry: () => directoryEntry('Empty', [[]]) }],
} });
assert.equal(nodes.has('#upload-modal'), false);
assert.match(toast.textContent, /Folder kosong tidak ikut diunggah/);
console.log('  ok  drop galat/tanpa entry tidak flatten; folder kosong dijelaskan');
