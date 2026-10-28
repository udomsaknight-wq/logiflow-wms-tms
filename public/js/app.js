/* App shell: auth, navigation, hash router */
const ROUTES = ['dashboard', 'inventory', 'inbound', 'outbound', 'movements',
  'planning', 'shipments', 'tracking', 'reports', 'vehicles', 'drivers',
  'products', 'warehouses', 'locations', 'partners'];

function buildNav() {
  let html = '', group = '';
  for (const r of ROUTES) {
    const p = Pages[r];
    if (p.group !== group) { group = p.group; html += `<div class="nav-group">${esc(group)}</div>`; }
    html += `<a class="nav-link" href="#/${r}" data-route="${r}"><span class="ico">${p.icon}</span>${esc(p.title)}</a>`;
  }
  $('#nav').innerHTML = html;
}

let renderSeq = 0;
async function route() {
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
  const name = ROUTES.includes(path) ? path : 'dashboard';
  const page = Pages[name];
  const seq = ++renderSeq;
  $('#page-title').textContent = page.title;
  document.title = `${page.title} · LogiFlow`;
  $$('.nav-link').forEach(a => a.classList.toggle('active', a.dataset.route === name));
  $('#sidebar').classList.remove('open');
  if ($('#modal').open) closeModal();

  // fresh containers so old listeners never stack up
  const el = document.createElement('div'); el.className = 'page'; el.id = 'page';
  el.innerHTML = '<div class="empty">กำลังโหลด...</div>';
  $('#page').replaceWith(el);
  const actions = document.createElement('div'); actions.className = 'topbar-actions'; actions.id = 'page-actions';
  $('#page-actions').replaceWith(actions);
  try {
    await page.render(el, actions, new URLSearchParams(query || ''));
  } catch (err) {
    console.error(err);
    if (seq === renderSeq) el.innerHTML = `<div class="card empty">โหลดข้อมูลไม่สำเร็จ: ${esc(err.message || err)}</div>`;
  }
}

/* ---------- Auth ---------- */
let authMode = 'login';
$('#auth-tabs').addEventListener('click', e => {
  const t = e.target.closest('[data-mode]'); if (!t) return;
  authMode = t.dataset.mode;
  $$('#auth-tabs .tab').forEach(b => b.classList.toggle('active', b === t));
  $('#auth-submit').textContent = authMode === 'login' ? 'เข้าสู่ระบบ' : 'สมัครใช้งาน';
  $('#auth-msg').textContent = '';
});
$('#auth-form').addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, btn = $('#auth-submit'), msg = $('#auth-msg');
  const email = f.email.value.trim(), password = f.password.value;
  btn.disabled = true; msg.textContent = '';
  try {
    if (authMode === 'login') {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) msg.textContent = error.message === 'Invalid login credentials' ? 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' : error.message;
    } else {
      const redirect = location.protocol.startsWith('http') ? location.origin + location.pathname : undefined;
      const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: redirect } });
      if (error) msg.textContent = error.message;
      else if (!data.session) msg.textContent = 'สมัครสำเร็จ กรุณายืนยันอีเมลจากกล่องจดหมาย แล้วกลับมาเข้าสู่ระบบ';
    }
  } finally { btn.disabled = false; }
});
$('#logout').onclick = () => sb.auth.signOut();
$('#menu-btn').onclick = () => $('#sidebar').classList.toggle('open');
$('#sidebar').addEventListener('click', e => { if (e.target === $('#sidebar')) $('#sidebar').classList.remove('open'); });

let signedIn = null;
function applySession(session) {
  const now = !!session;
  $('#auth-view').hidden = now;
  $('#app-view').hidden = !now;
  if (now) $('#user-email').textContent = session.user.email;
  if (now && signedIn !== true) route();
  signedIn = now;
}

buildNav();
window.addEventListener('hashchange', () => { if (signedIn) route(); });
sb.auth.onAuthStateChange((_event, session) => applySession(session));
