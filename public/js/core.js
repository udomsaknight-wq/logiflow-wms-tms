/* Core helpers: Supabase client, formatting, modal, forms, tables, lookups, generic CRUD */
const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
const Pages = {};
const LK = {};

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n, d = 2) => n == null || n === '' ? '-' : Number(n).toLocaleString('th-TH', { maximumFractionDigits: d });
const fdate = d => d ? new Date(d).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' }) : '-';
const fdt = d => d ? new Date(d).toLocaleString('th-TH', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';
const today = () => new Date().toISOString().slice(0, 10);

const STATUS = {
  open: ['รอดำเนินการ', 'b-info'], receiving: ['กำลังรับ', 'b-warn'], completed: ['เสร็จสิ้น', 'b-ok'],
  cancelled: ['ยกเลิก', ''], picked: ['หยิบแล้ว', 'b-pri'], planned: ['จัดรถแล้ว', 'b-info'],
  shipped: ['กำลังจัดส่ง', 'b-warn'], delivered: ['ส่งสำเร็จ', 'b-ok'], failed: ['ส่งไม่สำเร็จ', 'b-err'],
  in_transit: ['กำลังวิ่ง', 'b-warn'], pending: ['รอส่ง', 'b-info'], available: ['ว่าง', 'b-ok'],
  on_trip: ['ออกวิ่ง', 'b-warn'], maintenance: ['ซ่อมบำรุง', 'b-err'], inactive: ['ไม่ใช้งาน', ''],
  off: ['หยุด', ''], receive: ['รับเข้า', 'b-ok'], transfer: ['ย้าย', 'b-info'], pick: ['หยิบออก', 'b-warn'],
  adjust: ['ปรับปรุง', 'b-pri'], return: ['รับคืน', 'b-info'], dispatched: ['ปล่อยรถ', 'b-info'],
  customer: ['ลูกค้า', 'b-info'], supplier: ['ผู้ขาย', 'b-pri'], both: ['ลูกค้า/ผู้ขาย', 'b-ok'],
  receiving_loc: ['รับสินค้า', 'b-info'], storage: ['จัดเก็บ', ''], picking: ['หยิบ', 'b-pri'],
  staging: ['พักสินค้า', 'b-warn'], shipping: ['จ่ายสินค้า', 'b-ok'], own: ['รถบริษัท', ''], subcontract: ['รถร่วม', 'b-warn'],
};
const badge = s => { const [t, c] = STATUS[s] || [s, '']; return `<span class="badge ${c}">${esc(t)}</span>`; };
const opts = (pairs) => Object.entries(pairs).map(([value, label]) => ({ value, label }));

/* ---------- Toast ---------- */
function toast(msg, type = '') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), type === 'err' ? 6000 : 3000);
}

/* Unwrap a Supabase response; show + throw on error */
async function q(promise) {
  const { data, error } = await promise;
  if (error) {
    toast(error.message || 'เกิดข้อผิดพลาด', 'err');
    throw error;
  }
  return data;
}

/* ---------- Modal ---------- */
let modalSubmit = null;
function openModal({ title, body, submitText = 'บันทึก', onSubmit, wide = false, onOpen, footer = '' }) {
  const dlg = $('#modal');
  dlg.classList.toggle('wide', wide);
  $('#modal-title').textContent = title;
  // fresh nodes so listeners from a previous modal never leak into this one
  for (const id of ['modal-body', 'modal-foot']) { const n = $('#' + id); n.replaceWith(n.cloneNode(false)); }
  $('#modal-body').innerHTML = body;
  $('#modal-foot').innerHTML = footer +
    `<button value="cancel" formnovalidate class="btn">${onSubmit ? 'ยกเลิก' : 'ปิด'}</button>` +
    (onSubmit ? `<button value="ok" class="btn primary">${esc(submitText)}</button>` : '');
  modalSubmit = onSubmit || null;
  if (!dlg.open) dlg.showModal();
  onOpen?.($('#modal-body'), $('#modal-foot'));
}
function closeModal() { $('#modal').close(); }

$('#modal-form').addEventListener('submit', async e => {
  if (!e.submitter || e.submitter.value !== 'ok' || !modalSubmit) return; // cancel / close
  e.preventDefault();
  const btn = e.submitter;
  btn.disabled = true;
  try {
    const keepOpen = await modalSubmit(e.target);
    if (keepOpen !== false) closeModal();
  } catch (err) {
    console.error(err);
  } finally {
    btn.disabled = false;
  }
});

function confirmBox(message, okText = 'ยืนยัน') {
  return new Promise(resolve => {
    openModal({
      title: 'ยืนยัน', body: `<p>${esc(message)}</p>`, submitText: okText,
      onSubmit: () => { resolve(true); },
    });
    $('#modal').addEventListener('close', () => resolve(false), { once: true });
  });
}

/* ---------- Forms ---------- */
// field: {name, label, type, options:[{value,label}], required, step, full, placeholder, numeric}
function fieldsHtml(fields, values = {}) {
  return `<div class="form-grid">${fields.map(f => {
    const v = values[f.name] ?? f.default ?? '';
    const req = f.required ? 'required' : '';
    const cls = f.full || f.type === 'textarea' ? 'full' : '';
    let input;
    if (f.type === 'select') {
      input = `<select name="${f.name}" ${req}>${f.required ? '' : '<option value="">-</option>'}${(f.options || []).map(o =>
        `<option value="${esc(o.value)}" ${String(o.value) === String(v) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    } else if (f.type === 'textarea') {
      input = `<textarea name="${f.name}" rows="2" ${req}>${esc(v)}</textarea>`;
    } else if (f.type === 'checkbox') {
      return `<label class="${cls} row"><input type="checkbox" name="${f.name}" ${v ? 'checked' : ''}> ${esc(f.label)}</label>`;
    } else {
      input = `<input name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}" ${req}
        ${f.step ? `step="${f.step}"` : f.type === 'number' ? 'step="any"' : ''} ${f.min != null ? `min="${f.min}"` : ''}
        placeholder="${esc(f.placeholder || '')}">`;
    }
    return `<label class="${cls}">${esc(f.label)}${f.required ? ' *' : ''}${input}</label>`;
  }).join('')}</div>`;
}

function readFields(form, fields) {
  const out = {};
  for (const f of fields) {
    const el = form.elements[f.name];
    if (!el) continue;
    if (f.type === 'checkbox') out[f.name] = el.checked;
    else if (el.value === '') out[f.name] = null;
    else if (f.type === 'number' || f.numeric) out[f.name] = Number(el.value);
    else out[f.name] = el.value.trim();
  }
  return out;
}

/* ---------- Tables ---------- */
// col: {label, key, render(row), num}
function tableHtml(cols, rows, { actions, empty = 'ไม่มีข้อมูล', rowAttr } = {}) {
  if (!rows.length) return `<div class="empty">${esc(empty)}</div>`;
  return `<div class="table-wrap"><table><thead><tr>${cols.map(c => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('')}${actions ? '<th></th>' : ''}</tr></thead>
  <tbody>${rows.map(r => `<tr ${rowAttr ? rowAttr(r) : ''}>${cols.map(c => {
    const v = c.render ? c.render(r) : esc(r[c.key] ?? '');
    return `<td class="${c.num ? 'num' : ''}">${v === '' ? '<span class="muted">-</span>' : v}</td>`;
  }).join('')}${actions ? `<td class="actions">${actions(r)}</td>` : ''}</tr>`).join('')}</tbody></table></div>`;
}

function bindActions(el, handlers) {
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b || !el.contains(b)) return;
    const fn = handlers[b.dataset.act];
    if (fn) { e.preventDefault(); fn(b.dataset.id, b, e); }
  });
}

/* ---------- Lookups (master data cache, refreshed per page) ---------- */
const LOOKUP_SPEC = {
  warehouses: () => sb.from('wt_warehouses').select('*').order('code'),
  locations: () => sb.from('wt_locations').select('*, warehouse:wt_warehouses(code)').order('code'),
  products: () => sb.from('wt_products').select('*').order('sku'),
  partners: () => sb.from('wt_partners').select('*').order('code'),
  vehicles: () => sb.from('wt_vehicles').select('*').order('plate_no'),
  drivers: () => sb.from('wt_drivers').select('*').order('code'),
};
async function loadLookups(...names) {
  await Promise.all(names.map(async n => { LK[n] = await q(LOOKUP_SPEC[n]()); }));
}
const byId = (list, id) => (LK[list] || []).find(x => x.id === Number(id));
const optWarehouses = () => LK.warehouses.filter(w => w.active).map(w => ({ value: w.id, label: `${w.code} - ${w.name}` }));
const optProducts = () => LK.products.filter(p => p.active).map(p => ({ value: p.id, label: `${p.sku} - ${p.name}` }));
const optLocations = whId => LK.locations.filter(l => l.active && (!whId || l.warehouse_id === Number(whId)))
  .map(l => ({ value: l.id, label: `${l.warehouse?.code || ''} / ${l.code}${l.zone ? ' (' + l.zone + ')' : ''}` }));
const optPartners = (...types) => LK.partners.filter(p => p.active && types.includes(p.partner_type))
  .map(p => ({ value: p.id, label: `${p.code} - ${p.name}` }));
const optionTags = (list, sel) => list.map(o => `<option value="${esc(o.value)}" ${String(o.value) === String(sel) ? 'selected' : ''}>${esc(o.label)}</option>`).join('');

/* ---------- Generic CRUD page ---------- */
// importKey: unique column(s) used for Excel upsert; importMap: row => row (resolve codes to ids)
// labels: row => {code, title, sub} enables barcode label printing
function crudPage({ table, noun, select = '*', order = 'id', cols, fields, searchKeys = [], lookups = [], ascending = true,
  writeRoles = [], importKey, importMap, labels, exportMap }) {
  return async (el, actions) => {
    await loadLookups(...lookups);
    const fieldList = () => (typeof fields === 'function' ? fields() : fields);
    const writable = can(...writeRoles);
    let rows = [], list = [];
    const load = async () => { rows = await q(sb.from(table).select(select).order(order, { ascending })); draw(); };

    actions.innerHTML = `<button class="btn" data-act="export">⇩ Excel</button>
      ${writable && importKey ? `<button class="btn" data-act="import">⇧ นำเข้า Excel</button>` : ''}
      ${labels ? `<button class="btn" data-act="labels">▥ พิมพ์ป้ายบาร์โค้ด</button>` : ''}
      ${writable ? `<button class="btn primary" data-act="add">+ เพิ่ม${esc(noun)}</button>` : ''}`;
    el.innerHTML = `<div class="card flush">
      <div class="toolbar" style="padding:12px 16px"><input type="search" placeholder="ค้นหา..." id="search"><span class="muted small" id="count"></span></div>
      <div id="tbl"></div></div>`;
    const draw = () => {
      const term = $('#search', el).value.trim().toLowerCase();
      list = term ? rows.filter(r => searchKeys.some(k => String(r[k] ?? '').toLowerCase().includes(term))) : rows;
      $('#count', el).textContent = `${list.length} รายการ`;
      $('#tbl', el).innerHTML = tableHtml(cols, list, {
        actions: writable ? r => `<button class="btn sm" data-act="edit" data-id="${r.id}">แก้ไข</button>
                       <button class="btn sm danger" data-act="del" data-id="${r.id}">ลบ</button>` : null,
      });
    };
    const exportRows = () => list.map(r => {
      const o = {};
      for (const f of fieldList()) o[f.name] = r[f.name];
      return exportMap ? exportMap(o, r) : o;
    });
    $('#search', el).addEventListener('input', draw);

    const edit = row => openModal({
      title: `${row ? 'แก้ไข' : 'เพิ่ม'}${noun}`,
      body: fieldsHtml(fieldList(), row || {}),
      onSubmit: async form => {
        const data = readFields(form, fieldList());
        if (row) await q(sb.from(table).update(data).eq('id', row.id));
        else await q(sb.from(table).insert(data));
        toast('บันทึกแล้ว', 'ok');
        await load();
      },
    });
    const handlers = {
      add: () => edit(null),
      edit: id => edit(rows.find(r => r.id === Number(id))),
      del: async id => {
        if (!(await confirmBox(`ลบ${noun}นี้?`, 'ลบ'))) return;
        const { error } = await sb.from(table).delete().eq('id', id);
        if (error) toast(error.code === '23503' ? 'ลบไม่ได้: ข้อมูลนี้ถูกใช้งานอยู่ (ตั้งเป็นไม่ใช้งานแทน)' : error.message, 'err');
        else { toast('ลบแล้ว', 'ok'); await load(); }
      },
      export: () => exportXlsx(`${table.replace('wt_', '')}-${today()}`, exportRows()),
      labels: () => printLabels(list.map(labels)),
      import: () => importDialog({
        title: `นำเข้า${noun}จาก Excel`,
        templateName: `template-${table.replace('wt_', '')}`,
        templateRows: exportRows().slice(0, 3),
        columns: Object.keys(exportRows()[0] || Object.fromEntries(fieldList().map(f => [f.name, '']))),
        note: `ถ้า ${importKey} ซ้ำกับที่มีอยู่ ระบบจะอัปเดตข้อมูลเดิม`,
        onRows: async raw => {
          const data = raw.map(r => coerceRow(r, fieldList())).map(r => (importMap ? importMap(r) : r));
          await q(sb.from(table).upsert(data, { onConflict: importKey }));
          toast(`นำเข้า ${data.length} รายการแล้ว`, 'ok');
          await load();
        },
      }),
    };
    bindActions(el, handlers);
    bindActions(actions, handlers);
    await load();
  };
}

/* ---------- Roles ---------- */
let ME = null; // wt_profiles row of the signed-in user
const ROLE_TH = { admin: 'ผู้ดูแลระบบ', warehouse: 'พนักงานคลัง', transport: 'ฝ่ายขนส่ง', driver: 'พนักงานขับรถ', viewer: 'ดูอย่างเดียว', pending: 'รออนุมัติ' };
// admin can do everything; with no roles given, any signed-in role passes
const can = (...roles) => !!ME && (ME.role === 'admin' || !roles.length || roles.includes(ME.role));

/* ---------- Lazy third-party scripts ---------- */
const LIBS = {
  xlsx: 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  qr: 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js',
  barcode: 'https://cdnjs.cloudflare.com/ajax/libs/jsbarcode/3.11.6/JsBarcode.all.min.js',
};
const loaded = {};
function loadLib(name) {
  return loaded[name] ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = LIBS[name]; s.onload = resolve;
    s.onerror = () => { delete loaded[name]; reject(new Error('โหลดไลบรารีไม่สำเร็จ: ' + name)); };
    document.head.append(s);
  });
}

/* ---------- Excel ---------- */
async function exportXlsx(name, rows, sheet = 'data') {
  if (!rows.length) return toast('ไม่มีข้อมูลให้ export', 'err');
  await loadLib('xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheet);
  XLSX.writeFile(wb, `${name}.xlsx`);
}
async function readXlsx(file) {
  await loadLib('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { raw: false, dateNF: 'yyyy-mm-dd', defval: '' });
}
// Convert spreadsheet strings to the types the form fields expect
function coerceRow(r, fields) {
  const out = {};
  for (const [k, v0] of Object.entries(r)) {
    const v = typeof v0 === 'string' ? v0.trim() : v0;
    const f = fields.find(x => x.name === k);
    if (v === '' || v == null) out[k] = f?.type === 'checkbox' ? true : null;
    else if (f?.type === 'number' || f?.numeric) out[k] = Number(String(v).replace(/,/g, ''));
    else if (f?.type === 'checkbox') out[k] = !/^(false|0|no|n|ไม่)$/i.test(String(v));
    else out[k] = String(v);
  }
  return out;
}
function importDialog({ title, templateName, templateRows, columns, note, onRows }) {
  openModal({
    title, submitText: 'นำเข้า',
    body: `<p class="small muted">คอลัมน์ที่ใช้ (แถวแรกของไฟล์): <code>${columns.map(esc).join(', ')}</code><br>${esc(note || '')}</p>
      <button type="button" class="btn sm" data-act="tpl">⇩ ดาวน์โหลดไฟล์ตัวอย่าง</button>
      <label>ไฟล์ Excel / CSV<input type="file" name="file" accept=".xlsx,.xls,.csv" required></label>
      <div id="preview" class="small"></div>`,
    onOpen: body => {
      bindActions(body, {
        tpl: () => exportXlsx(templateName, templateRows.length ? templateRows : [Object.fromEntries(columns.map(c => [c, '']))]),
      });
      body.querySelector('[name=file]').onchange = async e => {
        const rows = await readXlsx(e.target.files[0]);
        $('#preview', body).innerHTML = `พบ ${rows.length} แถว` + tableHtml(Object.keys(rows[0] || {}).map(k => ({ label: k, key: k })), rows.slice(0, 5));
      };
    },
    onSubmit: async form => {
      const rows = (await readXlsx(form.elements.file.files[0])).filter(r => Object.values(r).some(v => String(v).trim() !== ''));
      if (!rows.length) { toast('ไฟล์ไม่มีข้อมูล', 'err'); return false; }
      try { await onRows(rows); } catch (e) { return false; }
    },
  });
}

/* ---------- Barcode labels ---------- */
async function printLabels(items) {
  if (!items.length) return toast('ไม่มีรายการ', 'err');
  await loadLib('barcode');
  const holder = document.createElement('div');
  const html = items.map(it => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    holder.append(svg);
    JsBarcode(svg, it.code, { format: 'CODE128', height: 48, fontSize: 14, margin: 4 });
    return `<div class="lbl"><b>${esc(it.title)}</b><span>${esc(it.sub || '')}</span>${svg.outerHTML}</div>`;
  }).join('');
  const w = window.open('', '_blank');
  if (!w) return toast('เบราว์เซอร์บล็อกหน้าต่างใหม่ กรุณาอนุญาต pop-up', 'err');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Labels</title><style>
    body{font-family:sans-serif;margin:8px;display:grid;grid-template-columns:repeat(auto-fill,62mm);gap:4mm}
    .lbl{border:1px dashed #999;padding:3mm;display:grid;justify-items:center;font-size:12px;break-inside:avoid}
    .lbl b{font-size:13px}.lbl svg{max-width:100%}</style></head><body>${html}
    <script>onload=()=>print()<\/script></body></html>`);
  w.document.close();
}

/* ---------- Barcode / QR scanning (camera, with manual fallback) ---------- */
async function scanCode(title = 'สแกนบาร์โค้ด') {
  const dlg = $('#scan-dialog');
  $('#scan-title').textContent = title;
  $('#scan-manual').value = '';
  $('#scan-msg').textContent = 'กำลังเปิดกล้อง...';
  dlg.showModal();
  let scanner = null;
  const result = new Promise(resolve => {
    const done = v => { resolve(v); if (dlg.open) dlg.close(); };
    $('#scan-form').onsubmit = e => { e.preventDefault(); done($('#scan-manual').value.trim() || null); };
    dlg.onclose = () => done(null);
    loadLib('qr').then(() => {
      if (!dlg.open) return;
      scanner = new Html5Qrcode('scan-reader');
      return scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 260, height: 160 } },
        text => { if (navigator.vibrate) navigator.vibrate(80); done(text); }, () => {})
        .then(() => { $('#scan-msg').textContent = 'เล็งกล้องไปที่บาร์โค้ด หรือพิมพ์/ใช้เครื่องสแกน USB ด้านล่าง'; });
    }).catch(err => { $('#scan-msg').textContent = `เปิดกล้องไม่ได้ (${err?.message || err}) — พิมพ์รหัสด้านล่างแทน`; });
    setTimeout(() => $('#scan-manual').focus(), 100);
  });
  const code = await result;
  if (scanner) { try { if (scanner.isScanning) await scanner.stop(); scanner.clear(); } catch { /* already stopped */ } }
  return code;
}
const findProductByCode = c => LK.products?.find(p => p.barcode === c || p.sku.toLowerCase() === c.toLowerCase());
const findLocationByCode = (c, whId) => LK.locations?.find(l => l.code.toLowerCase() === c.toLowerCase() && (!whId || l.warehouse_id === Number(whId)));
const scanBtn = (kind = '') => `<button type="button" class="btn sm" data-scan="${kind}" title="สแกนบาร์โค้ด">▥</button>`;

// Any [data-scan] button fills the input/select right before it.
document.addEventListener('click', async e => {
  const btn = e.target.closest('[data-scan]');
  if (!btn) return;
  e.preventDefault();
  const target = btn.previousElementSibling;
  const code = await scanCode();
  if (!code || !target) return;
  if (target.tagName === 'SELECT') {
    const kind = btn.dataset.scan;
    const hit = kind === 'location' ? findLocationByCode(code) : findProductByCode(code);
    const opt = hit && [...target.options].find(o => Number(o.value) === hit.id);
    if (!opt) return toast(`ไม่พบรหัส ${code} ในรายการ`, 'err');
    target.value = opt.value;
  } else target.value = code;
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.dispatchEvent(new Event('change', { bubbles: true }));
});

/* ---------- Geo ---------- */
function haversineKm(a, b) {
  const R = 6371, toRad = x => x * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// Nearest-neighbour ordering from origin; returns {order, km} with a road-distance factor, round trip
function planRoute(origin, stops, roadFactor = 1.3) {
  const left = stops.filter(s => s.lat != null && s.lng != null);
  const noGeo = stops.filter(s => s.lat == null || s.lng == null);
  const order = [];
  let cur = origin, km = 0;
  while (left.length) {
    let bi = 0, bd = Infinity;
    left.forEach((s, i) => { const d = haversineKm(cur, s); if (d < bd) { bd = d; bi = i; } });
    km += bd; cur = left[bi]; order.push(left.splice(bi, 1)[0]);
  }
  if (order.length) km += haversineKm(cur, origin);
  return { order: [...order, ...noGeo], km: Math.round(km * roadFactor * 10) / 10 };
}

function makeMap(el, points, { route = true } = {}) {
  const map = L.map(el);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap',
  }).addTo(map);
  const pts = points.filter(p => p.lat != null && p.lng != null);
  pts.forEach(p => {
    L.circleMarker([p.lat, p.lng], { radius: p.kind === 'wh' ? 10 : 8, color: '#fff', weight: 2, fillOpacity: 1, fillColor: p.color || '#0f6e6a' })
      .addTo(map).bindTooltip(p.label, { permanent: !!p.permanent, direction: 'top' });
  });
  if (route && pts.length > 1) L.polyline(pts.map(p => [p.lat, p.lng]), { color: '#d97a1e', weight: 3, dashArray: '6 6' }).addTo(map);
  if (pts.length) map.fitBounds(L.latLngBounds(pts.map(p => [p.lat, p.lng])).pad(0.2));
  else map.setView([13.75, 100.55], 10);
  setTimeout(() => map.invalidateSize(), 50);
  return map;
}
