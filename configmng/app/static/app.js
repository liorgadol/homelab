const $ = (id) => document.getElementById(id);

const state = {
  configs: [],
  current: null,   // { name, path, hash, writable, restart }
  original: "",
  editor: null,
  diffEditor: null,
  diffBackup: null,
};

const LANGS = {
  yaml: "yaml", yml: "yaml", json: "json", toml: "ini", ini: "ini", conf: "ini", cfg: "ini",
  env: "shell", sh: "shell", xml: "xml", properties: "ini", py: "python", js: "javascript",
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function langFor(path) {
  const base = path.split("/").pop().toLowerCase();
  if (base === "dockerfile") return "dockerfile";
  const ext = base.includes(".") ? base.split(".").pop() : "";
  return LANGS[ext] || "plaintext";
}

function toast(msg, kind = "") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $("toasts").appendChild(el);
  setTimeout(() => el.remove(), kind === "err" ? 6000 : 3000);
}

function status(msg, kind = "") {
  $("status-text").className = kind;
  $("status-text").textContent = msg;
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (res.status === 401 && url !== "/api/login") {
    showLogin();
    throw new Error("Session expired");
  }
  if (!res.ok) {
    const err = new Error((data && data.detail) || res.statusText);
    err.status = res.status;
    throw err;
  }
  return data;
}

function fmtTime(ts) {
  return new Date(ts * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function fmtSize(n) {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}

// ---------- views ----------

function showLogin() {
  $("app-view").classList.add("hidden");
  $("login-view").classList.remove("hidden");
}

async function showApp() {
  $("login-view").classList.add("hidden");
  $("app-view").classList.remove("hidden");
  await loadConfigs();
}

function isDirty() {
  return state.editor && state.current && state.editor.getValue() !== state.original;
}

function updateDirty() {
  $("dirty-dot").classList.toggle("hidden", !isDirty());
  const canSave = state.current && state.current.writable && isDirty();
  $("save-btn").disabled = !canSave;
  $("save-restart-btn").disabled = !canSave;
}

// ---------- sidebar ----------

async function loadConfigs() {
  state.configs = await api("GET", "/api/configs");
  renderList();
}

function renderList() {
  const q = $("search").value.toLowerCase();
  const items = state.configs.filter((c) => c.name.toLowerCase().includes(q) || c.path.toLowerCase().includes(q));
  if (!state.configs.length) {
    $("config-list").innerHTML = `<div class="muted">No configs declared. Add <code>CONFIG_name</code> variables in docker-compose.yml.</div>`;
    return;
  }
  $("config-list").innerHTML = items.map((c) => {
    const tags = [];
    if (!c.exists) tags.push(`<span class="badge err">missing</span>`);
    else if (!c.writable) tags.push(`<span class="badge">read-only</span>`);
    if (c.restartable) tags.push(`<span class="badge restart">restart</span>`);
    const active = state.current && state.current.name === c.name ? " active" : "";
    return `<div class="config-item${active}" data-name="${esc(c.name)}">
      <div class="ci-name">${esc(c.name)}</div>
      <div class="ci-path" title="${esc(c.path)}">${esc(c.path)}</div>
      ${tags.length ? `<div class="ci-tags">${tags.join("")}</div>` : ""}
    </div>`;
  }).join("");
}

$("config-list").addEventListener("click", (e) => {
  const item = e.target.closest(".config-item");
  if (item) openConfig(item.dataset.name);
});
$("search").addEventListener("input", renderList);

// ---------- editor ----------

async function openConfig(name) {
  if (isDirty() && !confirm("You have unsaved changes. Discard them?")) return;
  let data;
  try {
    data = await api("GET", `/api/configs/${encodeURIComponent(name)}`);
  } catch (e) {
    toast(e.message, "err");
    return;
  }
  state.current = data;
  state.original = data.content;

  $("empty").classList.add("hidden");
  $("diff-pane").classList.add("hidden");
  $("editor-pane").classList.remove("hidden");
  $("history-panel").classList.add("hidden");

  $("file-name").textContent = data.name;
  $("file-path").textContent = data.path;
  $("ro-badge").classList.toggle("hidden", data.writable);
  $("restart-btn").classList.toggle("hidden", !data.restart);
  $("save-restart-btn").classList.toggle("hidden", !(data.restart && data.writable));
  $("restart-btn").title = data.restart || "";
  $("save-restart-btn").title = data.restart || "";

  const model = monaco.editor.createModel(data.content, langFor(data.path));
  const old = state.editor.getModel();
  state.editor.setModel(model);
  if (old) old.dispose();
  state.editor.updateOptions({ readOnly: !data.writable });
  state.editor.focus();

  status(data.writable ? "Ready" : "Read-only — mounted with :ro or no write permission");
  updateDirty();
  renderList();
  history.replaceState(null, "", `#${encodeURIComponent(name)}`);
}

async function save(restart = false) {
  if (!state.current || !isDirty()) return;
  const content = state.editor.getValue();
  const body = { content, hash: state.current.hash, restart };
  let res;
  try {
    res = await api("PUT", `/api/configs/${encodeURIComponent(state.current.name)}`, body);
  } catch (e) {
    if (e.status === 422) {
      status(`Invalid: ${e.message}`, "err");
      if (confirm(`Validation failed:\n\n${e.message}\n\nSave anyway?`)) {
        res = await api("PUT", `/api/configs/${encodeURIComponent(state.current.name)}`, { ...body, force: true })
          .catch((e2) => { toast(e2.message, "err"); });
        if (!res) return;
      } else return;
    } else if (e.status === 409) {
      toast(e.message, "err");
      status("Conflict — file changed on disk", "err");
      return;
    } else {
      toast(e.message, "err");
      return;
    }
  }
  state.current.hash = res.hash;
  state.original = content;
  updateDirty();
  status(`Saved at ${new Date().toLocaleTimeString()}`, "ok");
  toast("Saved", "ok");
  if (res.restart) showRestartResult(res.restart);
  loadConfigs();
}

async function restartService() {
  if (!state.current) return;
  if (!confirm(`Run on host?\n\n${state.current.restart}`)) return;
  status("Restarting…");
  try {
    showRestartResult(await api("POST", `/api/configs/${encodeURIComponent(state.current.name)}/restart`));
  } catch (e) {
    toast(e.message, "err");
  }
}

function showRestartResult(r) {
  status(r.ok ? "Restart succeeded" : "Restart failed", r.ok ? "ok" : "err");
  if (r.ok && !r.output) {
    toast("Restarted", "ok");
    return;
  }
  openModal(r.ok ? "Restart succeeded" : "Restart failed",
    `<div>Exit code: <code>${esc(r.code ?? "—")}</code></div><pre>${esc(r.output || "(no output)")}</pre>`);
}

async function validateNow() {
  if (!state.current) return;
  const res = await api("POST", `/api/configs/${encodeURIComponent(state.current.name)}/validate`, { content: state.editor.getValue() });
  if (res.ok) status("Valid ✓", "ok");
  else status(`Invalid: ${res.error}`, "err");
}

// ---------- history ----------

async function toggleHistory() {
  const panel = $("history-panel");
  if (!panel.classList.contains("hidden")) {
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");
  const items = await api("GET", `/api/configs/${encodeURIComponent(state.current.name)}/history`);
  $("history-list").innerHTML = items.length
    ? items.map((b) => `<div class="history-item" data-id="${esc(b.id)}" data-time="${b.time}">
        <span class="when">${esc(fmtTime(b.time))}</span><span class="size">${fmtSize(b.size)}</span></div>`).join("")
    : `<div class="muted">No backups yet. A backup is taken before every save.</div>`;
  state.editor.layout();
}

$("history-list").addEventListener("click", async (e) => {
  const item = e.target.closest(".history-item");
  if (!item) return;
  const { content } = await api("GET", `/api/configs/${encodeURIComponent(state.current.name)}/history/${item.dataset.id}`);
  state.diffBackup = item.dataset.id;
  $("diff-label").textContent = `Left: backup from ${fmtTime(+item.dataset.time)}   ·   Right: current editor`;
  $("editor-pane").classList.add("hidden");
  $("diff-pane").classList.remove("hidden");

  const lang = langFor(state.current.path);
  const prev = state.diffEditor.getModel();
  state.diffEditor.setModel({
    original: monaco.editor.createModel(content, lang),
    modified: monaco.editor.createModel(state.editor.getValue(), lang),
  });
  if (prev) { prev.original.dispose(); prev.modified.dispose(); }
});

function closeDiff() {
  $("diff-pane").classList.add("hidden");
  $("editor-pane").classList.remove("hidden");
  state.editor.layout();
}

async function restoreBackup() {
  if (!confirm("Restore this version? The current file will be backed up first.")) return;
  try {
    await api("POST", `/api/configs/${encodeURIComponent(state.current.name)}/history/${state.diffBackup}/restore`);
  } catch (e) {
    toast(e.message, "err");
    return;
  }
  toast("Restored", "ok");
  state.original = state.editor.getValue(); // skip the unsaved-changes prompt; reload below
  await openConfig(state.current.name);
  if (state.current.restart && confirm("Restart the service now?")) restartService();
}

// ---------- modal / audit ----------

function openModal(title, html) {
  $("modal-title").textContent = title;
  $("modal-body").innerHTML = html;
  $("modal").classList.remove("hidden");
}

function closeModal() { $("modal").classList.add("hidden"); }

async function showAudit() {
  const rows = await api("GET", "/api/audit");
  openModal("Activity log", rows.length
    ? `<table class="audit"><tr><th>Time</th><th>Action</th><th>Config</th><th>Detail</th></tr>${rows.map((r) =>
        `<tr><td>${esc(r.time.replace("T", " "))}</td><td>${esc(r.action)}</td><td>${esc(r.name)}</td><td>${esc(r.detail)}</td></tr>`).join("")}</table>`
    : `<div class="muted">Nothing yet.</div>`);
}

// ---------- wiring ----------

$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  $("login-error").textContent = "";
  const btn = e.target.querySelector("button");
  btn.disabled = true;
  try {
    await api("POST", "/api/login", { username: f.get("username"), password: f.get("password") });
    e.target.reset();
    await showApp();
  } catch (err) {
    $("login-error").textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

$("logout-btn").onclick = async () => {
  if (isDirty() && !confirm("Discard unsaved changes?")) return;
  await api("POST", "/api/logout");
  state.original = state.editor.getValue();
  location.hash = "";
  showLogin();
};
$("save-btn").onclick = () => save(false);
$("save-restart-btn").onclick = () => save(true);
$("restart-btn").onclick = restartService;
$("validate-btn").onclick = validateNow;
$("history-btn").onclick = toggleHistory;
$("history-close").onclick = toggleHistory;
$("diff-back").onclick = closeDiff;
$("diff-restore").onclick = restoreBackup;
$("audit-btn").onclick = showAudit;
$("modal-close").onclick = closeModal;
$("modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeModal(); });
window.addEventListener("beforeunload", (e) => { if (isDirty()) e.preventDefault(); });

// ---------- boot ----------

require.config({ paths: { vs: "/static/vs" } });
require(["vs/editor/editor.main"], async () => {
  const common = {
    theme: "vs-dark",
    automaticLayout: true,
    fontSize: 13,
    fontFamily: "'JetBrains Mono', ui-monospace, Menlo, monospace",
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    renderWhitespace: "boundary",
    padding: { top: 12 },
  };
  monaco.editor.defineTheme("cfg", {
    base: "vs-dark", inherit: true, rules: [],
    colors: { "editor.background": "#0f1117", "editorGutter.background": "#0f1117" },
  });
  common.theme = "cfg";

  state.editor = monaco.editor.create($("editor"), { ...common, tabSize: 2 });
  state.diffEditor = monaco.editor.createDiffEditor($("diff-editor"), { ...common, readOnly: true, renderSideBySide: true });

  state.editor.onDidChangeModelContent(updateDirty);
  state.editor.onDidChangeCursorPosition((e) => {
    $("cursor-pos").textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
  });
  state.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => save(false));

  try {
    await api("GET", "/api/me");
    await showApp();
    const wanted = decodeURIComponent(location.hash.slice(1));
    if (wanted && state.configs.some((c) => c.name === wanted)) openConfig(wanted);
  } catch {
    showLogin();
  }
});
