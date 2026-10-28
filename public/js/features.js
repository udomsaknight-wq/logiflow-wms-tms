/* v2 pages: scan lookup, cycle count, driver app + POD, fleet, billing, users */

const getPos = (timeout = 5000) => new Promise(resolve => {
  if (!navigator.geolocation) return resolve(null);
  navigator.geolocation.getCurrentPosition(p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
    () => resolve(null), { enableHighAccuracy: true, timeout, maximumAge: 60000 });
});
const subtabs = (base, tabs, active) => `<nav class="subtabs">${Object.entries(tabs)
  .map(([k, label]) => `<a href="#/${base}?tab=${k}" class="${k === active ? 'active' : ''}">${esc(label)}</a>`).join('')}</nav>`;

/* ================= SCAN LOOKUP ================= */
Pages.scan = {
  title: 'สแกน / ค้นหา', group: 'WMS คลังสินค้า', icon: '▥',
  render: async (el, actions, params) => {
    await loadLookups('products', 'locations', 'warehouses');
    el.innerHTML = `<div class="card" style="display:grid;gap:12px">
        <button class="btn primary lg" data-act="scan">▥ สแกนบาร์โค้ด (กล้อง)</button>
        <form class="row" id="f" style="flex-wrap:nowrap"><input id="code" placeholder="หรือพิมพ์ / ยิงบาร์โค้ด: SKU, บาร์โค้ด, Location, เลขเอกสาร" autocomplete="off">
          <button class="btn">ค้นหา</button></form>
        <p class="muted small">รองรับเครื่องยิงบาร์โค้ด USB/Bluetooth — คลิกช่องด้านบนแล้วยิงได้เลย</p></div>
      <div id="result"></div>`;
    const out = $('#result', el);
    const lookup = async code => {
      code = (code || '').trim();
      if (!code) return;
      $('#code', el).value = code;
      const p = findProductByCode(code);
      const locs = LK.locations.filter(l => l.code.toLowerCase() === code.toLowerCase());
      if (p) {
        const inv = await q(sb.from('wt_inventory').select('*, location:wt_locations(code, warehouse_id)').eq('product_id', p.id).gt('qty', 0));
        out.innerHTML = `<div class="card flush"><h3>สินค้า ${esc(p.sku)} · ${esc(p.name)}</h3>
          <div class="info-grid" style="padding:0 16px 12px"><div><span>บาร์โค้ด</span>${esc(p.barcode || '-')}</div><div><span>หน่วย</span>${esc(p.uom)}</div>
          <div><span>คงเหลือรวม</span><b>${fmt(inv.reduce((s, r) => s + +r.qty, 0))}</b></div><div><span>ขั้นต่ำ</span>${fmt(p.min_stock)}</div></div>
          ${tableHtml([{ label: 'คลัง', render: r => esc(byId('warehouses', r.location.warehouse_id)?.code) },
            { label: 'Location', render: r => `<b>${esc(r.location.code)}</b>` }, { label: 'Lot', key: 'lot_no' },
            { label: 'หมดอายุ', render: r => expiryBadge(r.expiry_date) }, { label: 'จำนวน', num: true, render: r => fmt(r.qty) }], inv, { empty: 'ไม่มีสต็อก' })}
          <div style="padding:12px 16px"><a class="btn" href="#/inventory?q=${encodeURIComponent(p.sku)}">เปิดในหน้าสต็อก (ย้าย/ปรับ)</a></div></div>`;
        return;
      }
      if (locs.length) {
        const inv = await q(sb.from('wt_inventory').select('*, product:wt_products(sku, name, uom), location:wt_locations(code, warehouse_id, loc_type)')
          .in('location_id', locs.map(l => l.id)).gt('qty', 0));
        out.innerHTML = `<div class="card flush"><h3>Location ${esc(code)}</h3>${tableHtml([
          { label: 'คลัง', render: r => esc(byId('warehouses', r.location.warehouse_id)?.code) },
          { label: 'SKU', render: r => `<b>${esc(r.product.sku)}</b>` }, { label: 'สินค้า', render: r => esc(r.product.name) },
          { label: 'Lot', key: 'lot_no' }, { label: 'หมดอายุ', render: r => expiryBadge(r.expiry_date) },
          { label: 'จำนวน', num: true, render: r => `${fmt(r.qty)} ${esc(r.product.uom)}` }], inv, { empty: 'Location ว่าง' })}</div>`;
        return;
      }
      // document numbers
      const [ob, ib, sh] = await Promise.all([
        sb.from('wt_outbound_orders').select('id, doc_no, status').eq('doc_no', code).maybeSingle(),
        sb.from('wt_inbound_orders').select('id, doc_no, status').eq('doc_no', code).maybeSingle(),
        sb.from('wt_shipments').select('id, doc_no, status').eq('doc_no', code).maybeSingle(),
      ]);
      const doc = ob.data ? ['ออเดอร์ขาออก', '#/outbound', ob.data] : ib.data ? ['ใบรับสินค้า', '#/inbound', ib.data]
        : sh.data ? ['เที่ยวรถ', `#/shipments?id=${sh.data.id}`, sh.data] : null;
      out.innerHTML = doc
        ? `<div class="card row"><b>${doc[0]} ${esc(doc[2].doc_no)}</b> ${badge(doc[2].status)}<span class="spacer"></span><a class="btn primary" href="${doc[1]}">เปิด</a></div>`
        : `<div class="card empty">ไม่พบ "${esc(code)}" (ไม่ใช่ SKU / บาร์โค้ด / Location / เลขเอกสาร)</div>`;
    };
    $('#f', el).onsubmit = e => { e.preventDefault(); lookup($('#code', el).value); };
    bindActions(el, { scan: async () => lookup(await scanCode()) });
    $('#code', el).focus();
    if (params.get('q')) lookup(params.get('q'));
  },
};

/* ================= CYCLE COUNT ================= */
Pages.counts = {
  title: 'นับสต็อก (Cycle Count)', navTitle: 'นับสต็อก', group: 'WMS คลังสินค้า', icon: '☑',
  render: async (el, actions) => {
    await loadLookups('warehouses', 'locations', 'products');
    const writable = can('warehouse');
    let rows = [];
    actions.innerHTML = writable ? '<button class="btn primary" data-act="new">+ สร้างใบนับสต็อก</button>' : '';
    el.innerHTML = `<div class="card flush"><div id="tbl"></div></div>`;
    const load = async () => {
      rows = await q(sb.from('wt_counts').select('*, warehouse:wt_warehouses(code), lines:wt_count_lines(system_qty, counted_qty)').order('id', { ascending: false }));
      $('#tbl', el).innerHTML = tableHtml([
        { label: 'เลขที่', render: r => `<b>${esc(r.doc_no)}</b>` }, { label: 'คลัง', render: r => esc(r.warehouse?.code) },
        { label: 'โซน', render: r => esc(r.zone || 'ทั้งหมด') }, { label: 'วันที่', render: r => fdt(r.created_at) },
        { label: 'นับแล้ว', num: true, render: r => `${r.lines.filter(l => l.counted_qty != null).length}/${r.lines.length}` },
        { label: 'ส่วนต่าง', num: true, render: r => r.lines.filter(l => l.counted_qty != null && +l.counted_qty !== +l.system_qty).length || '' },
        { label: 'สถานะ', render: r => r.status === 'posted' ? '<span class="badge b-ok">ปรับยอดแล้ว</span>' : badge(r.status) },
      ], rows, { actions: r => `<button class="btn sm" data-act="open" data-id="${r.id}">เปิด</button>`, empty: 'ยังไม่มีใบนับสต็อก' });
    };

    const create = () => {
      const fields = [
        { name: 'wh', label: 'คลัง', type: 'select', options: optWarehouses(), required: true, numeric: true },
        { name: 'zone', label: 'โซน (เว้นว่าง = ทั้งคลัง)', type: 'select', options: [] },
        { name: 'note', label: 'หมายเหตุ', type: 'textarea' },
      ];
      openModal({
        title: 'สร้างใบนับสต็อก', body: fieldsHtml(fields), submitText: 'สร้าง',
        onOpen: body => {
          const wh = body.querySelector('[name=wh]'), zone = body.querySelector('[name=zone]');
          const fill = () => {
            const zones = [...new Set(LK.locations.filter(l => l.warehouse_id === Number(wh.value) && l.zone).map(l => l.zone))].sort();
            zone.innerHTML = '<option value="">ทุกโซน</option>' + zones.map(z => `<option>${esc(z)}</option>`).join('');
          };
          wh.onchange = fill; fill();
        },
        onSubmit: async form => {
          const v = readFields(form, fields);
          const id = await q(sb.rpc('wt_create_count', { p_warehouse_id: v.wh, p_zone: v.zone, p_note: v.note }));
          toast('สร้างใบนับสต็อกแล้ว — ยอดระบบถูกบันทึก ณ ตอนนี้', 'ok');
          await load();
          setTimeout(() => detail(id), 0);
        },
      });
    };

    const detail = async id => {
      const c = await q(sb.from('wt_counts').select('*, warehouse:wt_warehouses(code, name)').eq('id', id).single());
      const lines = await q(sb.from('wt_count_lines').select('*, product:wt_products(sku, name, uom, barcode), location:wt_locations(code)').eq('count_id', id));
      lines.sort((a, b) => a.location.code.localeCompare(b.location.code) || a.product.sku.localeCompare(b.product.sku));
      const open = writable && c.status === 'open';
      let showSys = !open;
      const rowsHtml = () => tableHtml([
        { label: 'Location', render: l => `<b>${esc(l.location.code)}</b>` }, { label: 'SKU', render: l => esc(l.product.sku) },
        { label: 'สินค้า', render: l => esc(l.product.name) }, { label: 'Lot', key: 'lot_no' },
        ...(showSys ? [{ label: 'ยอดระบบ', num: true, render: l => fmt(l.system_qty) }] : []),
        { label: 'นับได้', num: true, render: l => open
          ? `<input type="number" step="any" min="0" class="count-input" data-line="${l.id}" data-orig="${l.counted_qty ?? ''}" value="${l.counted_qty ?? ''}">`
          : fmt(l.counted_qty) },
        ...(showSys ? [{ label: 'ส่วนต่าง', num: true, render: l => l.counted_qty == null ? '' : (d => d ? `<b style="color:${d < 0 ? 'var(--err)' : 'var(--ok)'}">${d > 0 ? '+' : ''}${fmt(d)}</b>` : '0')(+l.counted_qty - +l.system_qty) }] : []),
      ], lines, { rowAttr: l => (showSys && l.counted_qty != null && +l.counted_qty !== +l.system_qty ? 'class="variance"' : ''), empty: 'ไม่มีรายการ — เพิ่มสินค้าที่พบได้ด้านล่าง' });

      const save = async body => {
        const changed = $$('[data-line]', body).filter(i => i.value !== i.dataset.orig);
        await Promise.all(changed.map(i => q(sb.from('wt_count_lines').update({ counted_qty: i.value === '' ? null : Number(i.value) }).eq('id', i.dataset.line))));
        changed.forEach(i => { const l = lines.find(x => x.id === Number(i.dataset.line)); l.counted_qty = i.value === '' ? null : Number(i.value); i.dataset.orig = i.value; });
        return changed.length;
      };
      const locOpts = optLocations(c.warehouse_id);
      openModal({
        title: `ใบนับสต็อก ${c.doc_no}`, wide: true,
        body: `<div class="info-grid"><div><span>คลัง</span>${esc(c.warehouse.code)} - ${esc(c.warehouse.name)}</div>
            <div><span>โซน</span>${esc(c.zone || 'ทั้งหมด')}</div><div><span>สถานะ</span>${badge(c.status)}</div><div><span>หมายเหตุ</span>${esc(c.note || '-')}</div></div>
          ${open ? `<div class="row"><button type="button" class="btn sm" data-act="scanFind">▥ สแกนหา Location/สินค้า</button>
            <label class="row small" style="display:flex"><input type="checkbox" id="sys"> แสดงยอดระบบ (ปิดไว้ = นับแบบ Blind count)</label></div>` : ''}
          <div id="lines">${rowsHtml()}</div>
          ${open ? `<details><summary class="small"><b>+ เพิ่มสินค้าที่พบแต่ไม่อยู่ในรายการ</b></summary>
            <div class="row" style="margin-top:8px"><select id="add-loc" style="width:160px">${optionTags(locOpts)}</select>${scanBtn('location')}
            <select id="add-prod" style="width:220px">${optionTags(optProducts())}</select>${scanBtn('product')}
            <input id="add-lot" placeholder="Lot" style="width:100px"><input id="add-qty" type="number" step="any" min="0" placeholder="จำนวน" style="width:100px">
            <button type="button" class="btn sm primary" data-act="addLine">เพิ่ม</button></div></details>` : ''}`,
        footer: `<button type="button" class="btn" data-act="export">⇩ Excel</button>
          ${open ? `<button type="button" class="btn danger" data-act="cancel">ยกเลิกใบนับ</button>
          <button type="button" class="btn" data-act="save">บันทึกผลนับ</button>
          <button type="button" class="btn primary" data-act="post">บันทึก + ปรับยอดสต็อก</button>` : ''}<span class="spacer"></span>`,
        onOpen: (body, foot) => {
          const redraw = () => { $('#lines', body).innerHTML = rowsHtml(); };
          $('#sys', body)?.addEventListener('change', async e => { await save(body); showSys = e.target.checked; redraw(); });
          bindActions(body, {
            scanFind: async () => {
              const code = await scanCode('สแกน Location หรือสินค้า');
              if (!code) return;
              const loc = findLocationByCode(code, c.warehouse_id), p = findProductByCode(code);
              const hit = lines.find(l => (loc && l.location_id === loc.id) || (p && l.product_id === p.id));
              if (!hit) return toast(`ไม่พบ ${code} ในใบนับนี้ — เพิ่มเป็นรายการใหม่ได้ด้านล่าง`, 'err');
              const input = body.querySelector(`[data-line="${hit.id}"]`);
              input.scrollIntoView({ block: 'center' }); input.focus(); input.select();
            },
            addLine: async () => {
              const loc = Number($('#add-loc', body).value), prod = Number($('#add-prod', body).value);
              const lot = $('#add-lot', body).value.trim(), qty = $('#add-qty', body).value;
              if (!loc || !prod || qty === '') return toast('เลือก Location, สินค้า และใส่จำนวน', 'err');
              const { data: inv } = await sb.from('wt_inventory').select('qty').eq('product_id', prod).eq('location_id', loc).eq('lot_no', lot).maybeSingle();
              await q(sb.from('wt_count_lines').insert({ count_id: c.id, location_id: loc, product_id: prod, lot_no: lot, system_qty: inv?.qty || 0, counted_qty: Number(qty) }));
              await save(body); toast('เพิ่มรายการแล้ว', 'ok'); await detail(id);
            },
          });
          bindActions(foot, {
            export: () => exportXlsx(c.doc_no, lines.map(l => ({ location: l.location.code, sku: l.product.sku, name: l.product.name,
              lot_no: l.lot_no, system_qty: +l.system_qty, counted_qty: l.counted_qty == null ? '' : +l.counted_qty,
              variance: l.counted_qty == null ? '' : +l.counted_qty - +l.system_qty }))),
            save: async () => { const n = await save(body); toast(`บันทึก ${n} รายการ`, 'ok'); await load(); },
            post: async () => {
              await save(body);
              const missing = lines.filter(l => l.counted_qty == null).length;
              if (!confirm(`${missing ? `ยังไม่ได้นับ ${missing} รายการ (จะไม่ถูกปรับยอด)\n` : ''}ปรับยอดสต็อกตามผลนับ? ทำแล้วย้อนกลับไม่ได้`)) return;
              const n = await q(sb.rpc('wt_post_count', { p_count_id: c.id }));
              toast(`ปรับยอดสต็อกแล้ว ${n} รายการ`, 'ok'); closeModal(); await load();
            },
            cancel: async () => {
              if (!confirm('ยกเลิกใบนับสต็อกนี้?')) return;
              await q(sb.from('wt_counts').update({ status: 'cancelled' }).eq('id', c.id));
              toast('ยกเลิกแล้ว', 'ok'); closeModal(); await load();
            },
          });
        },
      });
    };
    const handlers = { new: create, open: id => detail(Number(id)) };
    bindActions(el, handlers);
    bindActions(actions, handlers);
    await load();
  },
};

/* ================= DRIVER (mobile) ================= */
async function compressImage(file, maxSide = 1280, quality = 0.75) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise(r => c.toBlob(r, 'image/jpeg', quality));
}
function signaturePad(canvas) {
  const ctx = canvas.getContext('2d');
  let drawing = false, signed = false;
  const fit = () => { canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.strokeStyle = '#111'; };
  fit();
  const pos = e => { const r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  canvas.addEventListener('pointerdown', e => { drawing = true; canvas.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pos(e)); });
  canvas.addEventListener('pointermove', e => { if (!drawing) return; ctx.lineTo(...pos(e)); ctx.stroke(); signed = true; });
  canvas.addEventListener('pointerup', () => { drawing = false; });
  return { clear: () => { ctx.clearRect(0, 0, canvas.width, canvas.height); signed = false; }, isSigned: () => signed,
    blob: () => new Promise(r => canvas.toBlob(r, 'image/png')) };
}
const mapsLink = (lat, lng) => `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;

Pages.driver = {
  title: 'งานของฉัน', navTitle: 'หน้าคนขับ', group: 'TMS ขนส่ง', icon: '☎', roles: ['driver', 'transport'],
  render: async (el, actions, params) => {
    await loadLookups('drivers', 'vehicles');
    const isDriver = ME.role === 'driver';
    const driverId = isDriver ? ME.driver_id : Number(params.get('driver')) || LK.drivers[0]?.id;
    if (!driverId) {
      el.innerHTML = '<div class="card empty">บัญชีนี้ยังไม่ได้ผูกกับพนักงานขับรถ — แจ้งผู้ดูแลระบบให้ผูกบัญชีที่หน้า "ผู้ใช้งาน"</div>';
      return;
    }
    const me = byId('drivers', driverId);
    actions.innerHTML = `${!isDriver ? `<select id="as">${optionTags(LK.drivers.map(d => ({ value: d.id, label: `ดูในมุมของ: ${d.name}` })), driverId)}</select>` : ''}
      <button class="btn" data-act="fuel">⛽ เติมน้ำมัน</button>`;
    $('#as', actions)?.addEventListener('change', e => { location.hash = `#/driver?driver=${e.target.value}`; });

    const ships = await q(sb.from('wt_shipments')
      .select('*, vehicle:wt_vehicles(id, plate_no, vehicle_type), warehouse:wt_warehouses(name, lat, lng), stops:wt_shipment_stops(*, order:wt_outbound_orders(id, doc_no, ship_address, lat, lng, total_weight_kg, customer:wt_partners(name, phone), lines:wt_outbound_lines(qty_ordered, product:wt_products(sku, name, uom))))')
      .eq('driver_id', driverId).in('status', ['planned', 'in_transit']).order('plan_date'));
    const done = await q(sb.from('wt_shipments').select('id, doc_no, completed_at, stops:wt_shipment_stops(status)')
      .eq('driver_id', driverId).eq('status', 'completed').gte('completed_at', today()).order('completed_at'));
    ships.forEach(s => s.stops.sort((a, b) => a.seq - b.seq));

    const routeLink = s => {
      const pts = s.stops.filter(x => x.status === 'pending' && x.order.lat != null).map(x => `${x.order.lat},${x.order.lng}`);
      if (!pts.length) return '';
      const dest = pts.pop();
      return `https://www.google.com/maps/dir/?api=1&destination=${dest}${pts.length ? `&waypoints=${encodeURIComponent(pts.join('|'))}` : ''}&travelmode=driving`;
    };
    el.innerHTML = `<div class="driver">
      <div class="card row"><div><b>${esc(me?.name || '')}</b><br><span class="muted small">${esc(me?.phone || '')} · ${badge(me?.status)}</span></div>
        <span class="spacer"></span><span class="muted small" id="gps-state"></span></div>
      ${ships.length ? ships.map(s => {
        const left = s.stops.filter(x => x.status === 'pending').length;
        return `<div class="card" style="display:grid;gap:10px">
          <div class="row"><div><b>${esc(s.doc_no)}</b> ${badge(s.status)}<br><span class="muted small">${esc(s.vehicle.plate_no)} · ${fdate(s.plan_date)} · ออกจาก ${esc(s.warehouse.name)}</span></div>
            <span class="spacer"></span><b>${s.stops.length - left}/${s.stops.length}</b></div>
          ${s.status === 'planned' ? `<button class="btn primary lg" data-act="start" data-id="${s.id}">🚚 เริ่มออกรถ</button>`
            : routeLink(s) ? `<a class="btn lg" target="_blank" rel="noopener" href="${routeLink(s)}">🗺 นำทางทุกจุดที่เหลือ (Google Maps)</a>` : ''}
          ${s.stops.map(x => `<div class="stop ${x.status !== 'pending' ? 'done' : ''}">
            <div class="stop-head"><span class="stop-no">${x.seq}</span><div style="flex:1"><b>${esc(x.order.customer?.name)}</b> ${badge(x.status)}<br>
              <span class="small muted">${esc(x.order.doc_no)} · ${esc(x.order.ship_address || '')} · ${fmt(x.order.total_weight_kg)} kg</span></div></div>
            <details class="small"><summary>รายการสินค้า (${x.order.lines.length})</summary>
              <ul>${x.order.lines.map(l => `<li>${esc(l.product.sku)} ${esc(l.product.name)} × <b>${fmt(l.qty_ordered)}</b> ${esc(l.product.uom)}</li>`).join('')}</ul></details>
            ${x.status === 'pending' ? `<div class="row">
              ${x.order.customer?.phone ? `<a class="btn" href="tel:${esc(x.order.customer.phone)}">📞 โทร</a>` : ''}
              ${x.order.lat != null ? `<a class="btn" target="_blank" rel="noopener" href="${mapsLink(x.order.lat, x.order.lng)}">🧭 นำทาง</a>` : ''}
              <span class="spacer"></span>
              ${s.status === 'in_transit' ? `<button class="btn ok" data-act="pod" data-id="${x.id}">✔ ส่งของ / POD</button>` : ''}</div>`
              : `<span class="small muted">${esc(x.pod_name || x.pod_note || '')} · ${fdt(x.delivered_at)}</span>`}
          </div>`).join('')}
        </div>`;
      }).join('') : '<div class="card empty">ไม่มีงานที่ได้รับมอบหมาย 👍</div>'}
      ${done.length ? `<div class="card"><h3>ปิดงานวันนี้</h3>${done.map(s => `<div class="row small">${esc(s.doc_no)}<span class="spacer"></span>
        ${s.stops.filter(x => x.status === 'delivered').length}/${s.stops.length} สำเร็จ · ${fdt(s.completed_at)}</div>`).join('')}</div>` : ''}
    </div>`;

    // Auto GPS while a trip is running (only on the driver's own device)
    const running = ships.find(s => s.status === 'in_transit');
    if (isDriver && running && navigator.geolocation) {
      let last = 0;
      const watch = navigator.geolocation.watchPosition(async p => {
        const now = Date.now();
        $('#gps-state', el).textContent = `GPS ✓ ${new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`;
        if (now - last < 120000) return;   // at most every 2 minutes
        last = now;
        await sb.from('wt_tracking_events').insert({ shipment_id: running.id, event: 'position', lat: p.coords.latitude, lng: p.coords.longitude, note: 'GPS อัตโนมัติ' });
      }, err => { $('#gps-state', el).textContent = `GPS ปิดอยู่ (${err.message})`; }, { enableHighAccuracy: true, maximumAge: 30000 });
      onLeave(() => navigator.geolocation.clearWatch(watch));
    }

    const stopById = id => ships.flatMap(s => s.stops.map(x => ({ ...x, ship: s }))).find(x => x.id === Number(id));
    const pod = stopId => {
      const st = stopById(stopId);
      let pad;
      openModal({
        title: `ส่งของ: ${st.order.customer?.name}`,
        body: `<p class="small muted">${esc(st.order.doc_no)} · ${esc(st.order.ship_address || '')}</p>
          <label>ชื่อผู้รับ *<input name="pod_name" autocomplete="name"></label>
          <label>ถ่ายรูปหลักฐาน<input type="file" name="photo" accept="image/*" capture="environment"></label>
          <div><div class="row small"><b>ลายเซ็นผู้รับ</b><span class="spacer"></span><button type="button" class="btn sm ghost" data-act="clear">ล้าง</button></div>
            <canvas class="sig" id="sig"></canvas></div>
          <label>หมายเหตุ / เหตุผลที่ส่งไม่สำเร็จ<textarea name="note" rows="2"></textarea></label>`,
        submitText: '✔ ส่งสำเร็จ',
        footer: '<button type="button" class="btn danger" data-act="fail">✖ ส่งไม่สำเร็จ</button><span class="spacer"></span>',
        onOpen: (body, foot) => {
          pad = signaturePad($('#sig', body));
          bindActions(body, { clear: () => pad.clear() });
          bindActions(foot, { fail: async (_, btn) => {
            const note = body.querySelector('[name=note]').value.trim();
            if (!note) return toast('กรุณาใส่เหตุผลที่ส่งไม่สำเร็จ', 'err');
            btn.disabled = true;
            try { await submit(body, false); closeModal(); } catch { btn.disabled = false; }
          } });
        },
        onSubmit: async form => {
          if (!form.elements.pod_name.value.trim()) { toast('กรุณาใส่ชื่อผู้รับ', 'err'); return false; }
          try { await submit(form, true); } catch { return false; }
        },
      });
      const upload = async (blob, kind, ext, type) => {
        const path = `${st.ship.id}/${st.id}-${kind}-${Date.now()}.${ext}`;
        await q(sb.storage.from('wt-pod').upload(path, blob, { contentType: type, upsert: false }));
        return path;
      };
      const submit = async (root, success) => {
        const file = root.querySelector('[name=photo]').files[0];
        const [photo, signature, gps] = await Promise.all([
          file ? compressImage(file).then(b => upload(b, 'photo', 'jpg', 'image/jpeg')) : null,
          pad.isSigned() ? pad.blob().then(b => upload(b, 'sign', 'png', 'image/png')) : null,
          getPos(),
        ]);
        await q(sb.rpc('wt_deliver_stop', { p_stop_id: st.id, p_success: success,
          p_pod_name: root.querySelector('[name=pod_name]').value.trim() || null, p_note: root.querySelector('[name=note]').value.trim() || null,
          p_photo: photo, p_signature: signature, p_lat: gps?.lat ?? null, p_lng: gps?.lng ?? null }));
        toast(success ? 'บันทึกส่งสำเร็จ' : 'บันทึกส่งไม่สำเร็จ', success ? 'ok' : '');
        setTimeout(route, 300);
      };
    };

    const fuel = () => {
      const fields = [
        { name: 'vehicle_id', label: 'รถ', type: 'select', required: true, numeric: true, default: (running || ships[0])?.vehicle.id,
          options: LK.vehicles.map(v => ({ value: v.id, label: `${v.plate_no} (${v.vehicle_type})` })) },
        { name: 'odometer_km', label: 'เลขไมล์ (km)', type: 'number' },
        { name: 'liters', label: 'จำนวนลิตร', type: 'number', required: true },
        { name: 'amount', label: 'จำนวนเงิน (บาท)', type: 'number', required: true },
        { name: 'station', label: 'ปั๊ม / สถานที่' },
      ];
      openModal({
        title: 'บันทึกเติมน้ำมัน', body: fieldsHtml(fields),
        onSubmit: async form => {
          await q(sb.from('wt_fuel_logs').insert({ ...readFields(form, fields), driver_id: driverId }));
          toast('บันทึกเติมน้ำมันแล้ว', 'ok');
        },
      });
    };
    const handlers = {
      start: async (id, btn) => {
        btn.disabled = true;
        try { await q(sb.rpc('wt_dispatch_shipment', { p_shipment_id: Number(id) })); toast('เริ่มออกรถแล้ว เดินทางปลอดภัย', 'ok'); route(); }
        catch { btn.disabled = false; }
      },
      pod, fuel,
    };
    bindActions(el, handlers);
    bindActions(actions, handlers);
  },
};

/* ================= FLEET: fuel & maintenance ================= */
const SERVICE_TYPES = { service: 'เข้าศูนย์ตามระยะ', repair: 'ซ่อม', tire: 'ยาง', inspection: 'ตรวจสภาพ', other: 'อื่นๆ' };
const dueBadge = (d, label) => {
  if (!d) return '';
  const days = Math.floor((new Date(d) - new Date(today())) / 86400000);
  return `<span class="badge ${days < 0 ? 'b-err' : days <= 30 ? 'b-warn' : ''}">${label} ${fdate(d)}</span>`;
};
Pages.fleet = {
  title: 'ซ่อมบำรุง / น้ำมัน', navTitle: 'ซ่อมบำรุง/น้ำมัน', group: 'TMS ขนส่ง', icon: '⛽',
  render: async (el, actions, params) => {
    const tab = params.get('tab') || 'summary';
    el.innerHTML = subtabs('fleet', { summary: 'สรุปต้นทุนรถ', fuel: 'บันทึกน้ำมัน', maint: 'ประวัติซ่อมบำรุง' }, tab) + '<div id="sub" style="display:grid;gap:18px"></div>';
    const sub = $('#sub', el);
    if (tab === 'fuel') {
      return crudPage({
        table: 'wt_fuel_logs', noun: 'บันทึกน้ำมัน', select: '*, vehicle:wt_vehicles(plate_no), driver:wt_drivers(name)', order: 'fill_date',
        ascending: false, lookups: ['vehicles', 'drivers'], writeRoles: ['transport'], searchKeys: ['station', 'note'],
        cols: [{ label: 'วันที่', render: r => fdate(r.fill_date) }, { label: 'รถ', render: r => `<b>${esc(r.vehicle?.plate_no)}</b>` },
          { label: 'คนขับ', render: r => esc(r.driver?.name) }, { label: 'เลขไมล์', num: true, render: r => fmt(r.odometer_km, 0) },
          { label: 'ลิตร', num: true, render: r => fmt(r.liters) }, { label: 'บาท', num: true, render: r => fmt(r.amount) },
          { label: '฿/ลิตร', num: true, render: r => +r.liters ? fmt(r.amount / r.liters) : '' }, { label: 'ปั๊ม', key: 'station' }],
        fields: () => [
          { name: 'vehicle_id', label: 'รถ', type: 'select', required: true, numeric: true, options: LK.vehicles.map(v => ({ value: v.id, label: v.plate_no })) },
          { name: 'driver_id', label: 'คนขับ', type: 'select', numeric: true, options: LK.drivers.map(d => ({ value: d.id, label: d.name })) },
          { name: 'fill_date', label: 'วันที่', type: 'date', required: true, default: today() },
          { name: 'odometer_km', label: 'เลขไมล์ (km)', type: 'number' },
          { name: 'liters', label: 'ลิตร', type: 'number', required: true }, { name: 'amount', label: 'จำนวนเงิน (บาท)', type: 'number', required: true },
          { name: 'station', label: 'ปั๊ม' }, { name: 'note', label: 'หมายเหตุ', type: 'textarea' },
        ],
      })(sub, actions);
    }
    if (tab === 'maint') {
      return crudPage({
        table: 'wt_maintenance', noun: 'รายการซ่อมบำรุง', select: '*, vehicle:wt_vehicles(plate_no)', order: 'service_date', ascending: false,
        lookups: ['vehicles'], writeRoles: ['transport'], searchKeys: ['description', 'vendor', 'service_type'],
        cols: [{ label: 'วันที่', render: r => fdate(r.service_date) }, { label: 'รถ', render: r => `<b>${esc(r.vehicle?.plate_no)}</b>` },
          { label: 'ประเภท', render: r => esc(SERVICE_TYPES[r.service_type]) }, { label: 'รายละเอียด', key: 'description' },
          { label: 'เลขไมล์', num: true, render: r => fmt(r.odometer_km, 0) }, { label: 'ค่าใช้จ่าย', num: true, render: r => fmt(r.cost) },
          { label: 'อู่ / ร้าน', key: 'vendor' }, { label: 'ครั้งถัดไป', render: r => [r.next_service_km ? fmt(r.next_service_km, 0) + ' km' : '', r.next_service_date ? fdate(r.next_service_date) : ''].filter(Boolean).join(' / ') }],
        fields: () => [
          { name: 'vehicle_id', label: 'รถ', type: 'select', required: true, numeric: true, options: LK.vehicles.map(v => ({ value: v.id, label: v.plate_no })) },
          { name: 'service_date', label: 'วันที่', type: 'date', required: true, default: today() },
          { name: 'service_type', label: 'ประเภท', type: 'select', required: true, default: 'service', options: opts(SERVICE_TYPES) },
          { name: 'odometer_km', label: 'เลขไมล์ (km)', type: 'number' },
          { name: 'description', label: 'รายละเอียด', type: 'textarea' },
          { name: 'cost', label: 'ค่าใช้จ่าย (บาท)', type: 'number', default: 0 }, { name: 'vendor', label: 'อู่ / ร้าน' },
          { name: 'next_service_km', label: 'นัดครั้งถัดไป (km)', type: 'number' }, { name: 'next_service_date', label: 'นัดครั้งถัดไป (วันที่)', type: 'date' },
        ],
      })(sub, actions);
    }
    // summary
    const from = params.get('from') || new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10), to = params.get('to') || today();
    const [vehicles, fuel, maint] = await Promise.all([
      q(sb.from('wt_vehicles').select('*').neq('status', 'inactive').order('plate_no')),
      q(sb.from('wt_fuel_logs').select('*').gte('fill_date', from).lte('fill_date', to).order('fill_date')),
      q(sb.from('wt_maintenance').select('*').gte('service_date', from).lte('service_date', to)),
    ]);
    const stats = vehicles.map(v => {
      const f = fuel.filter(x => x.vehicle_id === v.id), m = maint.filter(x => x.vehicle_id === v.id);
      const odo = f.map(x => +x.odometer_km).filter(Boolean);
      const km = odo.length > 1 ? Math.max(...odo) - Math.min(...odo) : 0;
      const litersAfterFirst = f.slice(1).reduce((s, x) => s + +x.liters, 0);   // first fill only sets the baseline
      const fuelCost = f.reduce((s, x) => s + +x.amount, 0), maintCost = m.reduce((s, x) => s + +x.cost, 0);
      return { v, liters: f.reduce((s, x) => s + +x.liters, 0), fuelCost, maintCost, km,
        kmpl: km && litersAfterFirst ? km / litersAfterFirst : null, perKm: km ? (fuelCost + maintCost) / km : null };
    });
    actions.innerHTML = '<button class="btn" data-act="export">⇩ Excel</button>';
    bindActions(actions, { export: () => exportXlsx(`fleet-${from}_${to}`, stats.map(s => ({ plate_no: s.v.plate_no, type: s.v.vehicle_type,
      odometer_km: +s.v.odometer_km, km_in_period: s.km, liters: s.liters, fuel_cost: s.fuelCost, km_per_liter: s.kmpl && +s.kmpl.toFixed(2),
      maintenance_cost: s.maintCost, cost_per_km: s.perKm && +s.perKm.toFixed(2), tax_expiry: s.v.tax_expiry, insurance_expiry: s.v.insurance_expiry }))) });
    sub.innerHTML = `<div class="card"><form class="toolbar" id="rng"><label>ตั้งแต่<input type="date" name="from" value="${from}"></label>
        <label>ถึง<input type="date" name="to" value="${to}"></label><button class="btn">แสดง</button></form></div>
      <div class="kpis">
        <div class="kpi"><div class="label">ค่าน้ำมันรวม (฿)</div><div class="value">${fmt(stats.reduce((s, x) => s + x.fuelCost, 0), 0)}</div></div>
        <div class="kpi"><div class="label">ค่าซ่อมบำรุงรวม (฿)</div><div class="value">${fmt(stats.reduce((s, x) => s + x.maintCost, 0), 0)}</div></div>
        <div class="kpi"><div class="label">ระยะทาง (km)</div><div class="value">${fmt(stats.reduce((s, x) => s + x.km, 0), 0)}</div></div>
        <div class="kpi"><div class="label">น้ำมันรวม (ลิตร)</div><div class="value">${fmt(stats.reduce((s, x) => s + x.liters, 0), 0)}</div></div></div>
      <div class="card flush">${tableHtml([
        { label: 'รถ', render: s => `<b>${esc(s.v.plate_no)}</b> <span class="muted small">${esc(s.v.vehicle_type)}</span>` },
        { label: 'เลขไมล์', num: true, render: s => fmt(s.v.odometer_km, 0) },
        { label: 'km ในช่วง', num: true, render: s => fmt(s.km, 0) }, { label: 'ลิตร', num: true, render: s => fmt(s.liters) },
        { label: 'km/ลิตร', num: true, render: s => s.kmpl ? fmt(s.kmpl) : '' },
        { label: 'ค่าน้ำมัน', num: true, render: s => fmt(s.fuelCost) }, { label: 'ค่าซ่อม', num: true, render: s => fmt(s.maintCost) },
        { label: '฿/km', num: true, render: s => s.perKm ? fmt(s.perKm) : '' },
        { label: 'กำหนดการ', render: s => [dueBadge(s.v.tax_expiry, 'ภาษี'), dueBadge(s.v.insurance_expiry, 'ประกัน'),
          s.v.next_service_km ? `<span class="badge ${+s.v.odometer_km >= +s.v.next_service_km ? 'b-err' : ''}">ศูนย์ ${fmt(s.v.next_service_km, 0)} km</span>` : '',
          dueBadge(s.v.next_service_date, 'ศูนย์')].filter(Boolean).join(' ') },
      ], stats)}</div>`;
    $('#rng', sub).onsubmit = e => { e.preventDefault(); const f = e.target; location.hash = `#/fleet?tab=summary&from=${f.from.value}&to=${f.to.value}`; };
  },
};

/* ================= BILLING ================= */
const INV_STATUS = { draft: ['ร่าง', ''], issued: ['ออกบิลแล้ว', 'b-info'], paid: ['ชำระแล้ว', 'b-ok'], cancelled: ['ยกเลิก', 'b-err'] };
const invBadge = s => `<span class="badge ${INV_STATUS[s][1]}">${INV_STATUS[s][0]}</span>`;
Pages.billing = {
  title: 'วางบิลค่าขนส่ง', navTitle: 'วางบิลค่าขนส่ง', group: 'TMS ขนส่ง', icon: '฿',
  render: async (el, actions, params) => {
    await loadLookups('partners');
    const tab = params.get('tab') || 'invoices';
    el.innerHTML = subtabs('billing', { invoices: 'ใบแจ้งหนี้', rates: 'เรทค่าขนส่ง' }, tab) + '<div id="sub" style="display:grid;gap:18px"></div>';
    const sub = $('#sub', el);
    if (tab === 'rates') {
      return crudPage({
        table: 'wt_freight_rates', noun: 'เรทค่าขนส่ง', select: '*, customer:wt_partners(name)', order: 'id', lookups: ['partners'],
        writeRoles: ['transport'], searchKeys: ['name', 'vehicle_type'],
        cols: [{ label: 'ชื่อเรท', render: r => `<b>${esc(r.name)}</b>` }, { label: 'ลูกค้า', render: r => esc(r.customer?.name || 'ทุกลูกค้า') },
          { label: 'ประเภทรถ', render: r => esc(r.vehicle_type || 'ทุกประเภท') }, { label: 'ค่าเริ่มต้น', num: true, render: r => fmt(r.base_charge) },
          { label: '/จุด', num: true, render: r => fmt(r.per_drop) }, { label: '/kg', num: true, render: r => fmt(r.per_kg) },
          { label: '/km', num: true, render: r => fmt(r.per_km) }, { label: 'ขั้นต่ำ', num: true, render: r => fmt(r.min_charge) }, activeCol],
        fields: () => [
          { name: 'name', label: 'ชื่อเรท', required: true, full: true },
          { name: 'customer_id', label: 'ลูกค้า (ว่าง = ทุกลูกค้า)', type: 'select', numeric: true, options: optPartners('customer', 'both') },
          { name: 'vehicle_type', label: 'ประเภทรถ (ว่าง = ทุกประเภท)', type: 'select', options: opts({ '4W': '4 ล้อ', '4WJ': '4 ล้อจัมโบ้', '6W': '6 ล้อ', '10W': '10 ล้อ', TRAILER: 'รถพ่วง', MC: 'มอเตอร์ไซค์' }) },
          { name: 'base_charge', label: 'ค่าเริ่มต้น/ออเดอร์ (฿)', type: 'number', default: 0 },
          { name: 'per_drop', label: 'ค่าลงจุด (฿)', type: 'number', default: 0 },
          { name: 'per_kg', label: 'ต่อ kg (฿)', type: 'number', default: 0 },
          { name: 'per_km', label: 'ต่อ km (เฉลี่ยตามจำนวนจุดในเที่ยว)', type: 'number', default: 0 },
          { name: 'min_charge', label: 'ขั้นต่ำ/ออเดอร์ (฿)', type: 'number', default: 0 }, activeField,
        ],
      })(sub, actions);
    }

    const writable = can('transport');
    let rows = [];
    actions.innerHTML = `<button class="btn" data-act="export">⇩ Excel</button>${writable ? '<button class="btn primary" data-act="new">+ สร้างใบแจ้งหนี้</button>' : ''}`;
    sub.innerHTML = `<div class="card small muted">ระบบคำนวณจากออเดอร์ที่<b>ส่งสำเร็จ</b>ในช่วงวันที่ และยังไม่เคยวางบิล โดยใช้เรทที่ตรงที่สุด (ลูกค้า+ประเภทรถ → ลูกค้า → ประเภทรถ → ทั่วไป):
      ยอด = max(ขั้นต่ำ, ค่าเริ่มต้น + ค่าลงจุด + kg × เรท/kg + km เที่ยว ÷ จำนวนจุด × เรท/km) + VAT 7%</div>
      <div class="card flush"><div id="tbl"></div></div>`;
    const load = async () => {
      rows = await q(sb.from('wt_invoices').select('*, customer:wt_partners(name)').order('id', { ascending: false }));
      $('#tbl', sub).innerHTML = tableHtml([
        { label: 'เลขที่', render: r => `<b>${esc(r.doc_no)}</b>` }, { label: 'ลูกค้า', render: r => esc(r.customer?.name) },
        { label: 'รอบบิล', render: r => `${fdate(r.period_from)} – ${fdate(r.period_to)}` }, { label: 'ครบกำหนด', render: r => fdate(r.due_date) },
        { label: 'ยอดรวม (฿)', num: true, render: r => `<b>${fmt(r.total)}</b>` }, { label: 'สถานะ', render: r => invBadge(r.status) },
      ], rows, { actions: r => `<button class="btn sm" data-act="open" data-id="${r.id}">เปิด</button>`, empty: 'ยังไม่มีใบแจ้งหนี้' });
    };
    const create = () => {
      const d = new Date(), first = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
      const fields = [
        { name: 'customer', label: 'ลูกค้า', type: 'select', required: true, numeric: true, options: optPartners('customer', 'both'), full: true },
        { name: 'from', label: 'ส่งสำเร็จตั้งแต่', type: 'date', required: true, default: first },
        { name: 'to', label: 'ถึง', type: 'date', required: true, default: today() },
        { name: 'due', label: 'เครดิต (วัน)', type: 'number', default: 30 },
      ];
      openModal({
        title: 'สร้างใบแจ้งหนี้ค่าขนส่ง', body: fieldsHtml(fields), submitText: 'คำนวณและสร้าง',
        onSubmit: async form => {
          const v = readFields(form, fields);
          const id = await q(sb.rpc('wt_create_invoice', { p_customer_id: v.customer, p_from: v.from, p_to: v.to, p_due_days: v.due ?? 30 }));
          toast('สร้างใบแจ้งหนี้แล้ว', 'ok');
          await load();
          setTimeout(() => detail(id), 0);
        },
      });
    };
    const detail = async id => {
      const inv = await q(sb.from('wt_invoices').select('*, customer:wt_partners(*), lines:wt_invoice_lines(*, order:wt_outbound_orders(doc_no, delivered_at))').eq('id', id).single());
      inv.lines.sort((a, b) => a.id - b.id);
      const act = (s, label, cls = '') => `<button type="button" class="btn ${cls}" data-act="st" data-id="${s}">${label}</button>`;
      openModal({
        title: `ใบแจ้งหนี้ ${inv.doc_no}`, wide: true,
        body: `<div class="invoice">
          <div class="row" style="align-items:flex-start"><div><h2>LogiFlow Transport</h2><span class="muted small">ใบแจ้งหนี้ค่าบริการขนส่ง / Invoice</span></div>
            <span class="spacer"></span><div style="text-align:right"><b>${esc(inv.doc_no)}</b><br>${invBadge(inv.status)}<br>
            <span class="small">วันที่ ${fdate(inv.issued_at || inv.created_at)} · ครบกำหนด ${fdate(inv.due_date)}</span></div></div>
          <div class="info-grid"><div><span>ลูกค้า</span><b>${esc(inv.customer.name)}</b> (${esc(inv.customer.code)})</div>
            <div><span>ที่อยู่</span>${esc(inv.customer.address || '-')}</div><div><span>รอบบิล</span>${fdate(inv.period_from)} – ${fdate(inv.period_to)}</div></div>
          ${tableHtml([{ label: '#', render: l => inv.lines.indexOf(l) + 1 }, { label: 'รายการ', key: 'description' },
            { label: 'ส่งสำเร็จ', render: l => fdate(l.order?.delivered_at) }, { label: 'น้ำหนัก (kg)', num: true, render: l => fmt(l.weight_kg) },
            { label: 'จำนวนเงิน (฿)', num: true, render: l => fmt(l.amount) }], inv.lines, { empty: 'ไม่มีรายการ (ยกเลิกแล้ว)' })}
          <div class="totals"><div><span>รวมเป็นเงิน</span><b>${fmt(inv.subtotal)}</b></div><div><span>VAT ${fmt(inv.vat_rate)}%</span><b>${fmt(inv.vat)}</b></div>
            <div style="font-size:16px"><span>ยอดสุทธิ</span><b>${fmt(inv.total)}</b></div></div></div>`,
        footer: `${writable && inv.status === 'draft' ? act('issued', 'ออกบิล', 'primary') : ''}${writable && inv.status === 'issued' ? act('paid', 'บันทึกรับชำระ', 'ok') : ''}
          ${writable && ['draft', 'issued'].includes(inv.status) ? act('cancelled', 'ยกเลิก', 'danger') : ''}
          <button type="button" class="btn" data-act="xls">⇩ Excel</button><button type="button" class="btn" data-act="print">พิมพ์</button><span class="spacer"></span>`,
        onOpen: (body, foot) => bindActions(foot, {
          print: () => window.print(),
          xls: () => exportXlsx(inv.doc_no, inv.lines.map(l => ({ description: l.description, delivered: l.order?.delivered_at, weight_kg: +l.weight_kg, amount: +l.amount }))),
          st: async s => {
            if (s === 'cancelled' && !confirm('ยกเลิกใบแจ้งหนี้? ออเดอร์จะกลับมาวางบิลได้อีกครั้ง')) return;
            await q(sb.rpc('wt_set_invoice_status', { p_invoice_id: inv.id, p_status: s }));
            toast('อัปเดตสถานะแล้ว', 'ok'); await load(); await detail(inv.id);
          },
        }),
      });
    };
    const handlers = { new: create, open: id => detail(Number(id)),
      export: () => exportXlsx(`invoices-${today()}`, rows.map(r => ({ doc_no: r.doc_no, customer: r.customer?.name, period_from: r.period_from,
        period_to: r.period_to, due_date: r.due_date, subtotal: +r.subtotal, vat: +r.vat, total: +r.total, status: r.status }))) };
    bindActions(sub, handlers);
    bindActions(actions, handlers);
    await load();
  },
};

/* ================= USERS & ROLES (admin) ================= */
Pages.users = {
  title: 'ผู้ใช้งานและสิทธิ์', navTitle: 'ผู้ใช้งาน', group: 'ข้อมูลหลัก', icon: '⚙', roles: ['admin'],
  render: async el => {
    await loadLookups('drivers');
    let rows = [];
    el.innerHTML = `<div class="card small">
        <b>วิธีเพิ่มผู้ใช้:</b> ให้พนักงานเปิดเว็บแล้วกด "สมัครใช้งาน" → จะขึ้นในรายการนี้เป็น <span class="badge">รออนุมัติ</span> → กด "แก้ไข" เพื่อกำหนดสิทธิ์
        <ul class="muted" style="margin:6px 0 0">
          <li><b>ผู้ดูแลระบบ</b> ทำได้ทุกอย่าง + จัดการผู้ใช้</li>
          <li><b>พนักงานคลัง</b> รับสินค้า, หยิบ, ย้าย/ปรับ/นับสต็อก, ข้อมูลสินค้า/Location</li>
          <li><b>ฝ่ายขนส่ง</b> จัดรถ, ปล่อยรถ, POD, รถ/คนขับ, ซ่อมบำรุง/น้ำมัน, วางบิล</li>
          <li><b>พนักงานขับรถ</b> เห็นเฉพาะงานของตัวเองในหน้าคนขับ (ต้องผูกกับรายชื่อพนักงานขับรถ)</li>
          <li><b>ดูอย่างเดียว</b> เห็นทุกหน้าแต่แก้ไขไม่ได้</li></ul></div>
      <div class="card flush"><div id="tbl"></div></div>`;
    const load = async () => {
      rows = await q(sb.from('wt_profiles').select('*, driver:wt_drivers(name)').order('created_at'));
      $('#tbl', el).innerHTML = tableHtml([
        { label: 'อีเมล', render: r => `<b>${esc(r.email)}</b>${r.user_id === ME.user_id ? ' <span class="muted small">(คุณ)</span>' : ''}` },
        { label: 'ชื่อ', key: 'full_name' },
        { label: 'สิทธิ์', render: r => `<span class="badge ${r.role === 'pending' ? 'b-warn' : r.role === 'admin' ? 'b-pri' : 'b-info'}">${ROLE_TH[r.role]}</span>` },
        { label: 'ผูกกับคนขับ', render: r => esc(r.driver?.name || '') },
        { label: 'สถานะ', render: r => r.active ? '<span class="badge b-ok">ใช้งาน</span>' : '<span class="badge">ระงับ</span>' },
        { label: 'สมัครเมื่อ', render: r => fdate(r.created_at) },
      ], rows, { actions: r => `<button class="btn sm" data-act="edit" data-id="${r.user_id}">แก้ไข</button>` });
    };
    bindActions(el, {
      edit: uid => {
        const r = rows.find(x => x.user_id === uid);
        const fields = [
          { name: 'full_name', label: 'ชื่อ-นามสกุล', full: true },
          { name: 'role', label: 'สิทธิ์', type: 'select', required: true, options: opts(ROLE_TH) },
          { name: 'driver_id', label: 'ผูกกับพนักงานขับรถ (สำหรับสิทธิ์คนขับ)', type: 'select', numeric: true,
            options: LK.drivers.map(d => ({ value: d.id, label: `${d.code} - ${d.name}` })) },
          { name: 'active', label: 'เปิดใช้งาน', type: 'checkbox' },
        ];
        openModal({
          title: `แก้ไขผู้ใช้ ${r.email}`, body: fieldsHtml(fields, r),
          onSubmit: async form => {
            const v = readFields(form, fields);
            if (uid === ME.user_id && (v.role !== 'admin' || !v.active)) { toast('ลดสิทธิ์หรือระงับบัญชีตัวเองไม่ได้', 'err'); return false; }
            if (v.role === 'driver' && !v.driver_id) { toast('สิทธิ์คนขับต้องผูกกับรายชื่อพนักงานขับรถ', 'err'); return false; }
            await q(sb.from('wt_profiles').update(v).eq('user_id', uid));
            toast('บันทึกแล้ว', 'ok');
            await load();
          },
        });
      },
    });
    await load();
  },
};
