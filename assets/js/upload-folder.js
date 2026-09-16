// Validasi seluruh batch sebelum membuat folder atau mengirim file.
export function validateUploadPaths(files, paths = null) {
  const entries = Array.from(files, (file, index) => ({ file, path: paths ? paths[index] : file.webkitRelativePath || file.name }));
  const hierarchy = entries.filter(({ file, path }) => file.webkitRelativePath || path !== file.name || path.includes('/'));
  const seen = new Set();
  for (const { file, path } of hierarchy) {
    if (typeof path !== 'string' || path.split('/').some((name) => !name || name === '.' || name === '..' || name !== name.trim() || /[\\:\u0000-\u001f\u007f]/.test(name)) || path.split('/').at(-1) !== file.name || seen.has(path)) {
      throw new Error(`Path upload tidak valid: ${path}`);
    }
    seen.add(path);
  }
  for (const { path } of hierarchy) {
    const parts = path.split('/');
    while (parts.pop(), parts.length) {
      if (seen.has(parts.join('/'))) throw new Error(`Path upload tidak valid: ${path}`);
    }
  }
  return entries;
}

// Getter DataTransfer wajib ditangkap sinkron sebelum event drop selesai.
export async function readDroppedFiles(dataTransfer) {
  const items = Array.from(dataTransfer.items || []).filter((item) => item.kind === 'file');
  const roots = items.map((item) => item.webkitGetAsEntry?.());
  if (!items.length || roots.some((entry) => !entry)) throw new Error('Browser tidak dapat membaca seretan ini. Gunakan Upload file atau Upload folder.');
  const files = [];
  const paths = [];
  const visit = async (entry, parent = '') => {
    const path = parent ? `${parent}/${entry.name}` : entry.name;
    if (entry.isFile) {
      files.push(await new Promise((resolve, reject) => entry.file(resolve, reject)));
      paths.push(path);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const children = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        if (!children.length) break;
        for (const child of children) await visit(child, path);
      }
    } else throw new Error(`Tidak dapat membaca: ${path}`);
  };
  for (const root of roots) await visit(root);
  validateUploadPaths(files, paths);
  return { files, paths };
}
