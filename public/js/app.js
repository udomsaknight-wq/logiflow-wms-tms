/* App shell: auth, roles, navigation, hash router, alerts, realtime */
const ROUTES = ['dashboard', 'scan', 'inventory', 'inbound', 'outbound', 'counts', 'movements',
  'planning', 'shipments', 'tracking', 'driver', 'fleet', 'billing', 'reports', 'vehicles', 'drivers',
  'products', 'warehouses', 'locations', 'partners', 'users'];
const STAFF = ['warehouse', 'transport', 'viewer'];
const pageRoles = name => Pages[name].roles || STAFF;
const allowed = name => can(...pageRoles(name));
const homeRoute = () => (ME?.role === 'driver' ? 'driver' : 'dashboard');

function buildNav() {
  let html = '', group = '';
  for (const r of ROUTES.filter(allowed)) {
    const p = Pages[r];
    if (p.group !== group) { group = p.group; html += `<div class="nav-group">${esc(group)}</div>`; }
    html += `<a class="nav-link" href="#/${r}" data-route="${r}"><span class="ico">${p.icon}</span>${esc(p.navTitle || p.title)}</a>`;
  }
  $('#nav').innerHTML = html;
}

let renderSeq = 0;
let pageCleanup = [];          // pages push teardown fns (timers, GPS watchers)
const onLeave = fn => pageCleanup.push(fn);
async function route() {
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
  const name = ROUTES.includes(path) && allowed(path) ? path : homeRoute();
  if (name !== path) history.replaceState(null, '', `#/${name}`);
  const page = Pages[name];
  const seq = ++renderSeq;
  pageCleanup.forEach(fn => { try { fn(); } catch { /* ignore */ } });
  pageCleanup = [];
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

/* ---------- Alerts bell ---------- */
let alerts = [];
async function loadAlerts() {
  if (!can(...STAFF)) return;
  const { data, error } = await sb.from('wt_v_alerts').select('*');
  if (error) return;
  alerts = data;
  const n = alerts.length;
  $('#bell').hidden = false;
  $('#bell-count').hidden = !n;
  $('#bell-count').textContent = n > 99 ? '99+' : n;
}
$('#bell').onclick = () => {
  const order = { err: 0, warn: 1 };
  const list = [...alerts].sort((a, b) => order[a.level] - order[b.level]);
  openModal({
    title: `การแจ้งเตือน (${list.length})`,
    body: list.length ? `<ul class="alert-list">${list.map(a => `<li><a href="${esc(a.link)}" data-close>
        <span class="badge ${a.level === 'err' ? 'b-err' : 'b-warn'}">${a.level === 'err' ? 'ด่วน' : 'เตือน'}</span>
        <span>${esc(a.message)}</span><span class="spacer"></span><span class="muted small">${a.ref_date ? fdate(a.ref_date) : ''}</span></a></li>`).join('')}</ul>`
      : '<div class="empty">ไม่มีการแจ้งเตือน 🎉</div>',
    footer: 'Notification' in window && Notification.permission === 'default'
      ? '<button type="button" class="btn" data-act="notify">เปิดแจ้งเตือนบนเครื่อง</button><span class="spacer"></span>' : '',
    onOpen: (body, foot) => {
      body.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeModal(); });
      bindActions(foot, { notify: async () => { await Notification.requestPermission(); closeModal(); } });
    },
  });
};

/* ---------- Realtime ---------- */
let channel = null, refreshTimer = null;
const LIVE_PAGES = { wt_shipments: ['dashboard', 'shipments', 'tracking', 'driver', 'planning'],
  wt_shipment_stops: ['shipments', 'tracking', 'driver', 'dashboard'], wt_outbound_orders: ['outbound', 'planning', 'dashboard'],
  wt_inbound_orders: ['inbound', 'dashboard'], wt_inventory: ['inventory', 'dashboard'], wt_tracking_events: ['tracking'] };

function notify(msg, type = '') {
  toast(msg, type);
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') new Notification('LogiFlow', { body: msg });
}
function onChange(p) {
  const n = p.new || {}, o = p.old || {};
  if (p.table === 'wt_outbound_orders' && p.eventType === 'INSERT') notify(`ออเดอร์ใหม่ ${n.doc_no}`);
  if (p.table === 'wt_shipments' && n.status && n.status !== o.status && o.status) {
    notify(`เที่ยวรถ ${n.doc_no}: ${STATUS[n.status]?.[0] || n.status}`, n.status === 'completed' ? 'ok' : '');
  }
  if (p.table === 'wt_shipment_stops' && n.status === 'failed' && o.status !== 'failed') notify('มีจุดส่งที่ส่งไม่สำเร็จ', 'err');
  if (p.table === 'wt_shipment_stops' && n.status === 'delivered' && o.status !== 'delivered') notify('ส่งสินค้าสำเร็จ 1 จุด', 'ok');

  const current = location.hash.replace(/^#\/?/, '').split('?')[0] || homeRoute();
  if (!(LIVE_PAGES[p.table] || []).includes(current)) return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    const busy = $('#modal').open || $('#scan-dialog').open || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if (busy) return;  // don't yank the page out from under someone typing
    route();
    loadAlerts();
  }, 1500);
}
function startRealtime() {
  if (channel) return;
  channel = sb.channel('wt-live');
  for (const t of Object.keys(LIVE_PAGES)) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table: t }, p => onChange({ ...p, table: t }));
  }
  channel.subscribe(status => $('#live-dot').classList.toggle('on', status === 'SUBSCRIBED'));
}
function stopRealtime() {
  if (channel) sb.removeChannel(channel);
  channel = null;
  $('#live-dot').classList.remove('on');
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
$('#pending-logout').onclick = () => sb.auth.signOut();
$('#pending-retry').onclick = () => enterApp();
$('#menu-btn').onclick = () => $('#sidebar').classList.toggle('open');
$('#sidebar').addEventListener('click', e => { if (e.target === $('#sidebar')) $('#sidebar').classList.remove('open'); });

function show(view) {
  for (const v of ['auth-view', 'pending-view', 'app-view']) $('#' + v).hidden = v !== view;
}
async function enterApp() {
  const { data, error } = await sb.rpc('wt_me');
  if (error) { toast(error.message, 'err'); return; }
  ME = data;
  if (ME.role === 'pending' || !ME.active) {
    $('#pending-email').textContent = ME.email;
    show('pending-view');
    return;
  }
  $('#user-email').textContent = ME.email;
  $('#user-role').textContent = ROLE_TH[ME.role];
  show('app-view');
  buildNav();
  await route();
  loadAlerts();
  startRealtime();
}

let sessionUser = null;
sb.auth.onAuthStateChange((_event, session) => {
  const uid = session?.user?.id || null;
  if (uid === sessionUser) return;   // token refresh etc.
  sessionUser = uid;
  if (!uid) { ME = null; stopRealtime(); show('auth-view'); return; }
  setTimeout(enterApp, 0);          // don't call Supabase inside the auth callback
});
window.addEventListener('hashchange', () => { if (ME && ME.role !== 'pending') route(); });
setInterval(() => { if (ME) loadAlerts(); }, 5 * 60 * 1000);
