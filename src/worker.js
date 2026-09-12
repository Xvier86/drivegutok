const SESSION_TTL = 60 * 60 * 24 * 7;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();

async function hashPassword(password) {
  const bytes = new TextEncoder().encode(password);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cookie(name, value, maxAge = SESSION_TTL) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${maxAge}`;
}

async function getUser(request, env) {
  const token = request.headers.get("Cookie")?.match(/mydrive_session=([^;]+)/)?.[1];
  if (!token) return null;
  const userId = await env.SESSIONS.get(`session:${token}`);
  if (!userId) return null;
  return env.DB.prepare("SELECT id, email, username, role, status FROM users WHERE id = ? AND status = 'active'").bind(userId).first();
}

async function requireUser(request, env) {
  const user = await getUser(request, env);
  if (!user) throw new Response("Unauthorized", { status: 401 });
  return user;
}

async function log(env, actorId, action, targetType, targetId = null) {
  await env.DB.prepare("INSERT INTO audit_logs (id, actor_id, action, target_type, target_id, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id(), actorId, action, targetType, targetId, now()).run();
}

async function api(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  if (request.method === "GET" && path === "/api/setup") {
    const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM users").first();
    return json({ needsSetup: row.count === 0 });
  }
  if (request.method === "POST" && path === "/api/setup") {
    const body = await request.json();
    const count = await env.DB.prepare("SELECT COUNT(*) AS count FROM users").first();
    if (count.count > 0) return json({ error: "Owner sudah dibuat." }, 409);
    if (!body.email || !body.username || !body.password || body.password.length < 8) return json({ error: "Email, username, dan password minimal 8 karakter wajib diisi." }, 400);
    const user = { id: id(), email: body.email.trim().toLowerCase(), username: body.username.trim(), role: "owner", status: "active" };
    await env.DB.prepare("INSERT INTO users (id, email, username, password_hash, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(user.id, user.email, user.username, await hashPassword(body.password), user.role, user.status, now()).run();
    return json({ user });
  }
  if (request.method === "POST" && path === "/api/login") {
    const body = await request.json();
    const user = await env.DB.prepare("SELECT * FROM users WHERE (email = ? OR username = ?) AND status = 'active'").bind(body.identity?.trim().toLowerCase(), body.identity?.trim()).first();
    if (!user || user.password_hash !== await hashPassword(body.password || "")) return json({ error: "Identitas atau password salah." }, 401);
    const token = crypto.randomUUID();
    await env.SESSIONS.put(`session:${token}`, user.id, { expirationTtl: SESSION_TTL });
    return new Response(JSON.stringify({ user: { id: user.id, email: user.email, username: user.username, role: user.role } }), { headers: { "content-type": "application/json", "Set-Cookie": cookie("mydrive_session", token) } });
  }
  if (request.method === "POST" && path === "/api/logout") {
    const token = request.headers.get("Cookie")?.match(/mydrive_session=([^;]+)/)?.[1];
    if (token) await env.SESSIONS.delete(`session:${token}`);
    return new Response(null, { status: 204, headers: { "Set-Cookie": cookie("mydrive_session", "", 0) } });
  }
  const user = await requireUser(request, env);
  if (request.method === "GET" && path === "/api/me") return json({ user });
  if (request.method === "GET" && path === "/api/dashboard") {
    const folderId = url.searchParams.get("folderId") || null;
    const [folders, files, providers, stats] = await Promise.all([
      env.DB.prepare("SELECT id, name, parent_id, created_at FROM folders WHERE owner_id = ? AND parent_id IS ? AND deleted_at IS NULL ORDER BY name").bind(user.id, folderId).all(),
      env.DB.prepare("SELECT id, name, mime_type, size, provider, uploaded_by, uploaded_at, cdn_enabled FROM files WHERE owner_id = ? AND folder_id IS ? AND deleted_at IS NULL ORDER BY uploaded_at DESC").bind(user.id, folderId).all(),
      env.DB.prepare("SELECT id, name, kind, enabled, used_bytes, capacity_bytes FROM providers ORDER BY name").all(),
      env.DB.prepare("SELECT COUNT(*) AS files, COALESCE(SUM(size), 0) AS bytes FROM files WHERE owner_id = ? AND deleted_at IS NULL").bind(user.id).first()
    ]);
    return json({ folders: folders.results, files: files.results, providers: providers.results, stats, folderId });
  }
  if (request.method === "POST" && path === "/api/folders") {
    const body = await request.json();
    if (!body.name?.trim()) return json({ error: "Nama folder wajib diisi." }, 400);
    const folder = { id: id(), name: body.name.trim(), parent_id: body.parentId || null, owner_id: user.id, created_at: now() };
    await env.DB.prepare("INSERT INTO folders (id, owner_id, parent_id, name, created_at) VALUES (?, ?, ?, ?, ?)").bind(folder.id, folder.owner_id, folder.parent_id, folder.name, folder.created_at).run();
    await log(env, user.id, "create", "folder", folder.id);
    return json(folder, 201);
  }
  if (request.method === "POST" && path === "/api/files") {
    const body = await request.json();
    if (!body.name || !body.mimeType) return json({ error: "Metadata file tidak lengkap." }, 400);
    const provider = (await env.DB.prepare("SELECT id FROM providers WHERE enabled = 1 ORDER BY used_bytes ASC LIMIT 1").first())?.id;
    if (!provider) return json({ error: "Tidak ada provider aktif." }, 409);
    const file = { id: id(), owner_id: user.id, folder_id: body.folderId || null, name: body.name, mime_type: body.mimeType, size: Number(body.size || 0), provider, remote_file_id: body.remoteFileId || null, uploaded_by: user.id, uploaded_at: now() };
    await env.DB.prepare("INSERT INTO files (id, owner_id, folder_id, name, mime_type, size, provider, remote_file_id, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(file.id, file.owner_id, file.folder_id, file.name, file.mime_type, file.size, file.provider, file.remote_file_id, file.uploaded_by, file.uploaded_at).run();
    await env.DB.prepare("UPDATE providers SET used_bytes = used_bytes + ? WHERE id = ?").bind(file.size, provider).run();
    await log(env, user.id, "upload", "file", file.id);
    return json(file, 201);
  }
  if (request.method === "PATCH" && path.startsWith("/api/files/")) {
    const fileId = path.split("/").pop();
    const file = await env.DB.prepare("SELECT id FROM files WHERE id = ? AND owner_id = ? AND deleted_at IS NULL").bind(fileId, user.id).first();
    if (!file) return json({ error: "File tidak ditemukan." }, 404);
    const body = await request.json();
    if (!body.name?.trim()) return json({ error: "Nama file wajib diisi." }, 400);
    await env.DB.prepare("UPDATE files SET name = ? WHERE id = ?").bind(body.name.trim(), fileId).run();
    await log(env, user.id, "rename", "file", fileId);
    return json({ ok: true });
  }
  if (request.method === "DELETE" && path.startsWith("/api/files/")) {
    const fileId = path.split("/").pop();
    const file = await env.DB.prepare("SELECT size, provider FROM files WHERE id = ? AND owner_id = ? AND deleted_at IS NULL").bind(fileId, user.id).first();
    if (!file) return json({ error: "File tidak ditemukan." }, 404);
    // Catatan: target Cloudflare Worker ini (Fase 1) belum menyimpan kredensial provider di D1,
    // jadi penghapusan remote otomatis belum bisa dilakukan di sini seperti di server.js (VPS).
    // File tetap harus dihapus manual dari provider terkait sampai integrasi ini dibuat.
    await env.DB.prepare("UPDATE files SET deleted_at = ? WHERE id = ? AND owner_id = ?").bind(now(), fileId, user.id).run();
    await env.DB.prepare("UPDATE providers SET used_bytes = MAX(0, used_bytes - ?) WHERE id = ?").bind(file.size, file.provider).run();
    await log(env, user.id, "delete", "file", fileId);
    return new Response(null, { status: 204 });
  }
  if (request.method === "PATCH" && path.startsWith("/api/folders/")) {
    const folderId = path.split("/").pop();
    const folder = await env.DB.prepare("SELECT id FROM folders WHERE id = ? AND owner_id = ? AND deleted_at IS NULL").bind(folderId, user.id).first();
    if (!folder) return json({ error: "Folder tidak ditemukan." }, 404);
    const body = await request.json();
    if (!body.name?.trim() && body.parentId === undefined) return json({ error: "Nama atau folder tujuan wajib diisi." }, 400);
    if (body.name?.trim()) await env.DB.prepare("UPDATE folders SET name = ? WHERE id = ?").bind(body.name.trim(), folderId).run();
    if (body.parentId !== undefined) await env.DB.prepare("UPDATE folders SET parent_id = ? WHERE id = ?").bind(body.parentId || null, folderId).run();
    await log(env, user.id, "update", "folder", folderId);
    return json({ ok: true });
  }
  if (request.method === "DELETE" && path.startsWith("/api/folders/")) {
    const folderId = path.split("/").pop();
    const folder = await env.DB.prepare("SELECT id FROM folders WHERE id = ? AND owner_id = ? AND deleted_at IS NULL").bind(folderId, user.id).first();
    if (!folder) return json({ error: "Folder tidak ditemukan." }, 404);
    const deletedAt = now();
    const tree = await env.DB.prepare("WITH RECURSIVE tree(id) AS (SELECT id FROM folders WHERE id = ? UNION ALL SELECT folders.id FROM folders JOIN tree ON folders.parent_id = tree.id) SELECT id FROM tree").bind(folderId).all();
    const treeIds = tree.results.map((row) => row.id);
    const placeholders = treeIds.map(() => "?").join(",");
    const files = await env.DB.prepare(`SELECT id, size, provider FROM files WHERE owner_id = ? AND folder_id IN (${placeholders}) AND deleted_at IS NULL`).bind(user.id, ...treeIds).all();
    for (const file of files.results) {
      await env.DB.prepare("UPDATE providers SET used_bytes = MAX(0, used_bytes - ?) WHERE id = ?").bind(file.size, file.provider).run();
    }
    await env.DB.prepare(`UPDATE folders SET deleted_at = ? WHERE owner_id = ? AND id IN (${placeholders})`).bind(deletedAt, user.id, ...treeIds).run();
    await env.DB.prepare(`UPDATE files SET deleted_at = ? WHERE owner_id = ? AND folder_id IN (${placeholders})`).bind(deletedAt, user.id, ...treeIds).run();
    await log(env, user.id, "delete", "folder", folderId);
    return new Response(null, { status: 204 });
  }
  if (request.method === "GET" && path === "/api/admin/overview") {
    if (user.role !== "owner") return json({ error: "Forbidden" }, 403);
    const [users, files, providers, logs] = await Promise.all([
      env.DB.prepare("SELECT id, email, username, role, status, created_at FROM users ORDER BY created_at DESC").all(),
      env.DB.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(size), 0) AS bytes FROM files WHERE deleted_at IS NULL").first(),
      env.DB.prepare("SELECT * FROM providers ORDER BY name").all(),
      env.DB.prepare("SELECT audit_logs.*, users.username FROM audit_logs JOIN users ON users.id = audit_logs.actor_id ORDER BY audit_logs.created_at DESC LIMIT 8").all()
    ]);
    return json({ users: users.results, files, providers: providers.results, logs: logs.results });
  }
  if (request.method === "POST" && path === "/api/admin/users") {
    if (user.role !== "owner") return json({ error: "Forbidden" }, 403);
    const body = await request.json();
    if (!body.email || !body.username || !body.password || body.password.length < 8) return json({ error: "Data invite belum lengkap." }, 400);
    const invited = { id: id(), email: body.email.trim().toLowerCase(), username: body.username.trim(), password_hash: await hashPassword(body.password), role: "user", status: "active", created_at: now() };
    await env.DB.prepare("INSERT INTO users (id, email, username, password_hash, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(invited.id, invited.email, invited.username, invited.password_hash, invited.role, invited.status, invited.created_at).run();
    await log(env, user.id, "invite", "user", invited.id);
    return json({ id: invited.id, email: invited.email, username: invited.username, role: invited.role }, 201);
  }
  if (request.method === "PATCH" && path.startsWith("/api/admin/providers/")) {
    if (user.role !== "owner") return json({ error: "Forbidden" }, 403);
    const providerId = path.split("/").pop();
    const body = await request.json();
    await env.DB.prepare("UPDATE providers SET enabled = ? WHERE id = ?").bind(body.enabled ? 1 : 0, providerId).run();
    await log(env, user.id, body.enabled ? "enable" : "disable", "provider", providerId);
    return json({ ok: true });
  }
  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try { return await api(request, env); } catch (error) { if (error instanceof Response) return error; return json({ error: error.message }, 500); }
    }
    return env.ASSETS.fetch(request);
  }
};
