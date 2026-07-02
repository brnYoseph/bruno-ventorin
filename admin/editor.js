/* ============================================================
   CMS Editor — bruno-ventorin
   Depends on: config.js (ADMIN_HASH, GITHUB_OWNER, GITHUB_REPO, POSTS_PATH)
              marked.js (CDN)
   ============================================================ */

const SESSION_KEY    = 'bv_cms_session';
const PAT_KEY        = 'bv_cms_pat';
const DRAFT_KEY      = 'bv_cms_drafts';
const SESSION_TTL     = 8 * 60 * 60 * 1000; // 8h
const AUTOSAVE_DELAY  = 1500; // ms de inatividade antes de autosalvar

const API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${POSTS_PATH}`;

// ---- state ----
let state = {
  posts: [],
  fileSha: null,
  currentId: null,
  published: true,
  tempId: null,    // id estável do rascunho enquanto o post ainda não foi publicado
  createdAt: null, // data de criação usada no título padrão do autosave
};

let autoSaveTimer = null;

// ---- helpers ----
function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin);
}

function fromBase64(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function generateSlug(title) {
  return title.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim().replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

function formatDate(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

function pad2(n) { return String(n).padStart(2, '0'); }

function formatAutoTitle(date) {
  const d  = pad2(date.getDate());
  const m  = pad2(date.getMonth() + 1);
  const y  = pad2(date.getFullYear() % 100);
  const hh = pad2(date.getHours());
  const mm = pad2(date.getMinutes());
  return `Sem Título - ${d}/${m}/${y} ${hh}:${mm}`;
}

function getPat() { return sessionStorage.getItem(PAT_KEY); }

function showToast(msg, type = '') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast' + (type ? ' ' + type : '');
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}

// ---- auth ----
async function hashPassword(plain) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plain));
  return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('');
}

function isSessionValid() {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return false;
  try {
    return Date.now() - JSON.parse(raw).ts < SESSION_TTL;
  } catch { return false; }
}

function createSession() {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ ts: Date.now() }));
}

function logout() {
  clearTimeout(autoSaveTimer);
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem(PAT_KEY);
  showScreen('login');
}

// ---- confirm modal (ações destrutivas) ----
let confirmResolve = null;
let confirmPrevFocus = null;

function openConfirmModal({ title, message, confirmLabel = 'Confirmar' }) {
  return new Promise(resolve => {
    confirmResolve = resolve;
    confirmPrevFocus = document.activeElement;
    document.getElementById('confirmModalTitle').textContent = title;
    document.getElementById('confirmModalMsg').textContent = message;
    document.getElementById('confirmModalConfirm').textContent = confirmLabel;
    document.getElementById('confirmModal').style.display = 'flex';
    // foco vai para o botão seguro (cancelar), evitando confirmação acidental por Enter
    document.getElementById('confirmModalCancel').focus();
  });
}

function closeConfirmModal(result) {
  document.getElementById('confirmModal').style.display = 'none';
  const resolve = confirmResolve;
  confirmResolve = null;
  if (confirmPrevFocus) confirmPrevFocus.focus();
  confirmPrevFocus = null;
  if (resolve) resolve(result);
}

// ---- screens ----
function showScreen(screen) {
  document.getElementById('screenLogin').style.display  = screen === 'login'  ? 'flex' : 'none';
  document.getElementById('screenPat').style.display    = screen === 'pat'    ? 'flex' : 'none';
  document.getElementById('screenCms').classList.toggle('visible', screen === 'cms');
}

// ---- GitHub API ----
async function ghFetch(method, body) {
  const pat = getPat();
  const res = await fetch(API, {
    method,
    headers: {
      Authorization: `Bearer ${pat}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github+json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub API error ${res.status}`);
  }
  return res.json();
}

async function loadPostsFromGitHub() {
  const data = await ghFetch('GET');
  state.fileSha = data.sha;
  const parsed = JSON.parse(fromBase64(data.content));
  state.posts = parsed.posts || [];
}

async function savePostsToGitHub(commitMsg) {
  const content = toBase64(JSON.stringify({ posts: state.posts }, null, 2));
  const res = await ghFetch('PUT', {
    message: commitMsg,
    content,
    sha: state.fileSha,
  });
  state.fileSha = res.content.sha;
}

// ---- sidebar ----
function renderSidebar() {
  const list = document.getElementById('sidebarList');
  if (!state.posts.length) {
    list.innerHTML = '<div class="sidebar-empty">Nenhum post ainda.<br>Clique em + para criar.</div>';
    return;
  }
  const sorted = [...state.posts].sort((a, b) => new Date(b.date) - new Date(a.date));
  list.innerHTML = sorted.map(p => {
    const active = p.id === state.currentId ? ' active' : '';
    const badge = `<span class="sidebar-badge ${p.type}">${p.type === 'video' ? 'Vídeo' : 'Artigo'}</span>`;
    const draftBadge = !p.published ? '<span class="sidebar-badge draft">Rascunho</span>' : '';
    return `<div class="sidebar-item${active}" data-id="${p.id}" onclick="selectPost('${p.id}')">
      <div class="sidebar-item-title">${escHtml(p.title || 'Sem título')}</div>
      <div class="sidebar-item-meta">${badge}${draftBadge}<span>${formatDate(p.date)}</span></div>
    </div>`;
  }).join('');
}

// ---- editor ----
function selectPost(id) {
  clearTimeout(autoSaveTimer);
  state.currentId = id;
  const post = state.posts.find(p => p.id === id);
  if (!post) return;
  populateForm(post);
  renderSidebar();
  showEditor();
}

function showEditor() {
  document.getElementById('editorPlaceholder').style.display = 'none';
  document.getElementById('editorForm').style.display = 'flex';
}

function hideEditor() {
  document.getElementById('editorPlaceholder').style.display = 'flex';
  document.getElementById('editorForm').style.display = 'none';
  state.currentId = null;
}

function populateForm(post) {
  document.getElementById('fieldTitle').value   = post.title   || '';
  document.getElementById('fieldType').value    = post.type    || 'article';
  document.getElementById('fieldDate').value    = post.date    || today();
  document.getElementById('fieldTags').value    = (post.tags   || []).join(', ');
  document.getElementById('fieldSummary').value = post.summary || '';
  document.getElementById('fieldContent').value = post.content || '';
  document.getElementById('fieldYtId').value    = post.youtube_id || '';
  state.published = post.published !== false;
  updateToggle();
  updateDraftButtonLabel();
  toggleYtField();
  updatePreview();
  setStatus('');
}

function getFormData() {
  const title = document.getElementById('fieldTitle').value.trim();
  const id = state.currentId || generateSlug(title) || ('post-' + Date.now());
  return {
    id,
    type:       document.getElementById('fieldType').value,
    title,
    date:       document.getElementById('fieldDate').value || today(),
    summary:    document.getElementById('fieldSummary').value.trim(),
    tags:       document.getElementById('fieldTags').value.split(',').map(t => t.trim()).filter(Boolean),
    content:    document.getElementById('fieldContent').value,
    youtube_id: document.getElementById('fieldYtId').value.trim() || null,
    published:  state.published,
  };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function newPost() {
  clearTimeout(autoSaveTimer);
  state.currentId = null;
  state.tempId = 'draft-' + Date.now();
  state.createdAt = new Date();
  const blank = {
    id: '', type: 'article', title: '', date: today(),
    summary: '', tags: [], content: '', youtube_id: null, published: false,
  };
  populateForm(blank);
  renderSidebar();
  showEditor();
  document.getElementById('fieldTitle').focus();
}

// ---- draft storage key (estável durante a edição, mesmo com título mudando) ----
function getDraftKey() {
  return state.currentId || state.tempId;
}

function removeDraft(key) {
  if (!key) return;
  const drafts = getDrafts();
  if (key in drafts) {
    delete drafts[key];
    localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts));
  }
}

// ---- status published/rascunho (automático — refletido pelas ações de Publicar / Reverter à rascunho) ----
function updateToggle() {
  const wrap = document.getElementById('publishedToggle');
  const sw = document.getElementById('toggleSwitch');
  const lb = document.getElementById('toggleLabel');
  wrap.classList.toggle('on', state.published);
  sw.classList.toggle('on', state.published);
  lb.textContent = state.published ? 'Publicado' : 'Rascunho';
}

// botão "Salvar rascunho" vira "Reverter à rascunho" quando o post exibido já está publicado
function updateDraftButtonLabel() {
  const btn = document.getElementById('btnDraft');
  const isLivePublished = !!state.currentId && state.published;
  btn.textContent = isLivePublished ? 'Reverter à rascunho' : 'Salvar rascunho';
}

// ---- youtube field visibility ----
function toggleYtField() {
  const type = document.getElementById('fieldType').value;
  document.getElementById('ytField').classList.toggle('show', type === 'video');
}

// ---- live preview ----
function updatePreview() {
  const md = document.getElementById('fieldContent').value;
  const preview = document.getElementById('editorPreview');
  if (typeof marked !== 'undefined') {
    preview.innerHTML = marked.parse(md || '*Escreva seu conteúdo à esquerda…*');
  }
}

// ---- status bar ----
function setStatus(msg) {
  document.getElementById('topbarStatus').textContent = msg;
}

// ---- save draft (localStorage) ----
function applyAutoTitleIfEmpty() {
  const titleInput = document.getElementById('fieldTitle');
  if (!state.currentId && !titleInput.value.trim() && document.activeElement !== titleInput) {
    titleInput.value = formatAutoTitle(state.createdAt || new Date());
  }
}

function saveDraft(silent = false) {
  applyAutoTitleIfEmpty();
  const post = getFormData();
  const drafts = getDrafts();
  drafts[getDraftKey()] = { ...post, savedAt: Date.now() };
  localStorage.setItem(DRAFT_KEY, JSON.stringify(drafts));
  if (silent) {
    setStatus('Salvo automaticamente às ' + new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }));
  } else {
    showToast('Rascunho salvo localmente.', 'success');
    setStatus('Rascunho salvo');
  }
}

function getDrafts() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}'); } catch { return {}; }
}

// ---- autosave (apenas na tela de nova publicação, ainda não publicada) ----
function scheduleAutoSave() {
  if (state.currentId) return;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => saveDraft(true), AUTOSAVE_DELAY);
}

// ---- publish to GitHub ----
async function publishPost() {
  const wasNew = !state.currentId;
  const tempKey = state.tempId;
  const prevPublished = state.published;
  state.published = true; // publicar sempre marca o artigo como publicado, automaticamente

  const post = getFormData();
  if (!post.title) {
    state.published = prevPublished;
    showToast('O título é obrigatório.', 'error');
    return;
  }
  if (!getPat()) {
    state.published = prevPublished;
    showToast('PAT do GitHub não encontrado. Faça login novamente.', 'error');
    return;
  }

  setStatus('Publicando…');
  document.getElementById('btnPublish').disabled = true;

  try {
    const idx = state.posts.findIndex(p => p.id === state.currentId);
    if (idx >= 0) {
      state.posts[idx] = post;
    } else {
      state.currentId = post.id;
      state.posts.push(post);
    }

    await savePostsToGitHub(`post: publish "${post.title}"`);
    if (wasNew) removeDraft(tempKey);
    updateToggle();
    updateDraftButtonLabel();
    renderSidebar();
    showToast('Publicado com sucesso! O site atualiza em ~60s.', 'success');
    setStatus('Publicado');
  } catch (err) {
    state.posts = state.posts.filter(p => p.id !== (state.currentId || post.id));
    state.published = prevPublished;
    updateToggle();
    updateDraftButtonLabel();
    showToast('Erro ao publicar: ' + err.message, 'error');
    setStatus('Erro');
  } finally {
    document.getElementById('btnPublish').disabled = false;
  }
}

// ---- revert a published post back to draft (retira do blog) ----
async function revertToDraft() {
  const idx = state.posts.findIndex(p => p.id === state.currentId);
  if (idx < 0) return;
  const post = state.posts[idx];

  const ok = await openConfirmModal({
    title: 'Reverter à rascunho?',
    message: `"${post.title}" será retirado do blog publicado e voltará a ser um rascunho. Você pode publicá-lo novamente quando quiser.`,
    confirmLabel: 'Reverter à rascunho',
  });
  if (!ok) return;
  if (!getPat()) { showToast('PAT não encontrado.', 'error'); return; }

  setStatus('Revertendo…');
  document.getElementById('btnDraft').disabled = true;
  try {
    state.posts[idx] = { ...post, published: false };
    await savePostsToGitHub(`post: revert to draft "${post.title}"`);
    state.published = false;
    updateToggle();
    updateDraftButtonLabel();
    renderSidebar();
    showToast('Publicação revertida para rascunho e retirada do blog.', 'success');
    setStatus('');
  } catch (err) {
    state.posts[idx] = post;
    showToast('Erro ao reverter: ' + err.message, 'error');
    setStatus('Erro');
  } finally {
    document.getElementById('btnDraft').disabled = false;
  }
}

// ---- delete post ----
async function deletePost() {
  clearTimeout(autoSaveTimer);

  // tela de nova publicação: não há post salvo no GitHub ainda (rascunho local ou texto não salvo)
  if (!state.currentId) {
    const ok = await openConfirmModal({
      title: 'Descartar rascunho?',
      message: 'Esta publicação ainda não foi salva no GitHub. Ao continuar, todo o conteúdo digitado e o autosave local serão apagados permanentemente.',
      confirmLabel: 'Descartar rascunho',
    });
    if (!ok) return;
    removeDraft(getDraftKey());
    newPost();
    showToast('Rascunho descartado.', 'success');
    return;
  }

  const post = state.posts.find(p => p.id === state.currentId);
  if (!post) return;
  const ok = await openConfirmModal({
    title: 'Excluir publicação?',
    message: `"${post.title}" será removida permanentemente do repositório. Esta ação não pode ser desfeita.`,
    confirmLabel: 'Excluir publicação',
  });
  if (!ok) return;
  if (!getPat()) { showToast('PAT não encontrado.', 'error'); return; }

  setStatus('Excluindo…');
  try {
    state.posts = state.posts.filter(p => p.id !== state.currentId);
    removeDraft(getDraftKey());
    await savePostsToGitHub(`post: delete "${post.title}"`);
    hideEditor();
    renderSidebar();
    showToast('Post excluído.', 'success');
    setStatus('');
  } catch (err) {
    showToast('Erro ao excluir: ' + err.message, 'error');
    setStatus('Erro');
  }
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ---- init ----
async function init() {
  // check existing session
  if (isSessionValid() && getPat()) {
    showScreen('cms');
    await loadCms();
  } else if (isSessionValid()) {
    showScreen('pat');
  } else {
    showScreen('login');
  }
}

async function loadCms() {
  setStatus('Carregando posts…');
  try {
    await loadPostsFromGitHub();
    renderSidebar();
    setStatus('');
  } catch (err) {
    showToast('Erro ao carregar posts: ' + err.message, 'error');
    setStatus('Erro de conexão');
  }
}

// ---- event wiring (called from HTML) ----
async function handlePasswordSubmit() {
  const input = document.getElementById('pwdInput').value;
  const err = document.getElementById('loginError');
  err.classList.remove('show');

  if (!input) return;
  const hash = await hashPassword(input);

  if (hash !== ADMIN_HASH) {
    err.textContent = 'Senha incorreta.';
    err.classList.add('show');
    document.getElementById('pwdInput').value = '';
    return;
  }

  createSession();
  showScreen('pat');
}

async function handlePatSubmit() {
  const pat = document.getElementById('patInput').value.trim();
  const err = document.getElementById('patError');
  err.classList.remove('show');

  if (!pat) return;
  sessionStorage.setItem(PAT_KEY, pat);

  showScreen('cms');
  await loadCms();
}

document.addEventListener('DOMContentLoaded', () => {
  // password form
  document.getElementById('pwdInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') handlePasswordSubmit();
  });
  document.getElementById('btnLogin').addEventListener('click', handlePasswordSubmit);

  // pat form
  document.getElementById('patInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') handlePatSubmit();
  });
  document.getElementById('btnPat').addEventListener('click', handlePatSubmit);

  // CMS actions
  document.getElementById('btnNewPost').addEventListener('click', newPost);
  document.getElementById('btnLogout').addEventListener('click', logout);
  document.getElementById('btnPublish').addEventListener('click', publishPost);
  document.getElementById('btnDraft').addEventListener('click', () => {
    // automático: se o post exibido já está publicado, este botão reverte à rascunho
    if (state.currentId && state.published) {
      revertToDraft();
    } else {
      saveDraft(false);
    }
  });
  document.getElementById('btnDelete').addEventListener('click', deletePost);

  // type change → show/hide youtube field
  document.getElementById('fieldType').addEventListener('change', toggleYtField);

  // live preview
  document.getElementById('fieldContent').addEventListener('input', updatePreview);

  // markdown help modal
  document.getElementById('btnMarkdownHelp').addEventListener('click', () => {
    document.getElementById('markdownHelpModal').style.display = 'flex';
  });
  document.getElementById('markdownHelpClose').addEventListener('click', () => {
    document.getElementById('markdownHelpModal').style.display = 'none';
  });
  document.getElementById('markdownHelpModal').addEventListener('mousedown', e => {
    if (e.target.id === 'markdownHelpModal') document.getElementById('markdownHelpModal').style.display = 'none';
  });

  // status publicado/rascunho: automático (definido por Publicar / Reverter à rascunho), não é mais clicável

  // autosave: qualquer alteração no formulário agenda um autosave (tela de nova publicação)
  ['fieldTitle', 'fieldType', 'fieldDate', 'fieldTags', 'fieldSummary', 'fieldContent', 'fieldYtId']
    .forEach(id => {
      const el = document.getElementById(id);
      el.addEventListener('input', scheduleAutoSave);
      el.addEventListener('change', scheduleAutoSave);
    });

  // confirm modal
  document.getElementById('confirmModalCancel').addEventListener('click', () => closeConfirmModal(false));
  document.getElementById('confirmModalConfirm').addEventListener('click', () => closeConfirmModal(true));
  document.getElementById('confirmModal').addEventListener('mousedown', e => {
    if (e.target.id === 'confirmModal') closeConfirmModal(false);
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (document.getElementById('confirmModal').style.display === 'flex') closeConfirmModal(false);
    if (document.getElementById('markdownHelpModal').style.display === 'flex') {
      document.getElementById('markdownHelpModal').style.display = 'none';
    }
  });

  init();
});
