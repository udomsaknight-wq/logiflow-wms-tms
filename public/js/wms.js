/* WMS pages: dashboard, inventory, movements, inbound, outbound, master data */

const expiryBadge = d => {
  if (!d) return '';
  const days = Math.floor((new Date(d) - new Date(today())) / 86400000);
  if (days < 0) return `<span class="badge b-err">หมดอายุ ${fdate(d)}</span>`;
  if (days <= 30) return `<span class="badge b-warn">${fdate(d)} (${days} วัน)</span>`;
  return fdate(d);
};
const LOC_TYPES = { receiving: 'รับสินค้า', storage: 'จัดเก็บ', picking: 'หยิบ', staging: 'พักสินค้า', shipping: 'จ่ายสินค้า' };

/* ---------- Product line editor (inbound / outbound) ---------- */
function linesEditorHtml() {
  return `<div class="full"><div class="row" style="margin-bottom:8px"><b>รายการสินค้า</b><span class="spacer"></span>
    <button type="button" class="btn sm" data-add-line>+ เพิ่มรายการ</button></div><div class="lines" id="lines"></div></div>`;
}
function initLinesEditor(body) {
  const box = $('#lines', body);
  const add = () => {
    const d = document.createElement('div');
    d.className = 'line';
    d.innerHTML = `<select required><option value="">เลือกสินค้า</option>${optionTags(optProducts())}</select>${scanBtn('product')}
      <input type="number" min="0.01" step="any" placeholder="จำนวน" required>
      <button type="button" class="btn sm ghost" title="ลบรายการ">✕</button>`;
    d.querySelector('button').onclick = () => d.remove();
    box.append(d);
  };
  $('[data-add-line]', body).onclick = add;
  add();
}
function readLines(form) {
  return $$('.line', form).map(d => ({ product_id: Number(d.querySelector('select').value), qty: Number(d.querySelector('input').value) }))
    .filter(l => l.product_id && l.qty > 0);
}

/* ================= DASHBOARD ================= */
Pages.dashboard = {
  title: 'ภาพรวม', group: 'ภาพรวม', icon: '◧',
  render: async el => {
    const [[d], low, ships, moves] = await Promise.all([
      q(sb.from('wt_v_dashboard').select('*')),
      q(sb.from('wt_v_stock').select('*').eq('below_min', true).order('sku')),
      q(sb.from('wt_shipments').select('id, doc_no, status, plan_date, vehicle:wt_vehicles(plate_no), driver:wt_drivers(name), stops:wt_shipment_stops(status)')
        .in('status', ['planned', 'in_transit']).order('plan_date')),
      q(sb.from('wt_stock_movements').select('created_at, move_type, qty, ref_doc, product:wt_products(sku, name)')
        .order('created_at', { ascending: false }).limit(8)),
    ]);
    const kpi = (label, value, href, alert) =>
      `<a class="kpi ${alert ? 'alert' : ''}" href="${href}"><div class="label">${label}</div><div class="value">${fmt(value, 0)}</div></a>`;
    el.innerHTML = `
      <div class="kpis">
        ${kpi('สินค้าทั้งหมด (SKU)', d.products, '#/products')}
        ${kpi('สต็อกรวม (หน่วย)', d.total_units, '#/inventory')}
        ${kpi('สต็อกต่ำกว่าขั้นต่ำ', d.low_stock, '#/inventory', d.low_stock > 0)}
        ${kpi('ใบรับสินค้าค้าง', d.inbound_open, '#/inbound')}
        ${kpi('ออเดอร์รอหยิบ', d.outbound_open, '#/outbound')}
        ${kpi('ออเดอร์รอจัดรถ', d.outbound_picked, '#/planning')}
        ${kpi('เที่ยวรถรอปล่อย', d.shipments_planned, '#/shipments')}
        ${kpi('รถกำลังวิ่ง', d.shipments_in_transit, '#/tracking')}
        ${kpi('ส่งสำเร็จวันนี้', d.delivered_today, '#/reports')}
        ${kpi('รถว่าง', d.vehicles_available, '#/vehicles')}
      </div>
      <div class="grid-2">
        <div class="card flush"><h3>เที่ยวรถที่กำลังดำเนินการ</h3>${tableHtml([
          { label: 'เลขที่', render: r => `<a href="#/shipments?id=${r.id}">${esc(r.doc_no)}</a>` },
          { label: 'วันที่', render: r => fdate(r.plan_date) },
          { label: 'รถ / คนขับ', render: r => `${esc(r.vehicle?.plate_no)}<br><span class="muted small">${esc(r.driver?.name)}</span>` },
          { label: 'จุดส่ง', num: true, render: r => `${r.stops.filter(s => s.status !== 'pending').length}/${r.stops.length}` },
          { label: 'สถานะ', render: r => badge(r.status) },
        ], ships, { empty: 'ไม่มีเที่ยวรถค้าง' })}</div>
        <div class="card flush"><h3>สินค้าต่ำกว่าจุดสั่งซื้อ</h3>${tableHtml([
          { label: 'SKU', key: 'sku' }, { label: 'สินค้า', key: 'name' },
          { label: 'คงเหลือ', num: true, render: r => `<b style="color:var(--err)">${fmt(r.on_hand)}</b>` },
          { label: 'ขั้นต่ำ', num: true, render: r => fmt(r.min_stock) },
        ], low, { empty: 'สต็อกเพียงพอทุกรายการ' })}</div>
      </div>
      <div class="card flush"><h3>ความเคลื่อนไหวล่าสุด</h3>${tableHtml([
        { label: 'เวลา', render: r => fdt(r.created_at) }, { label: 'ประเภท', render: r => badge(r.move_type) },
        { label: 'สินค้า', render: r => `${esc(r.product?.sku)} <span class="muted">${esc(r.product?.name)}</span>` },
        { label: 'จำนวน', num: true, render: r => fmt(r.qty) }, { label: 'อ้างอิง', key: 'ref_doc' },
      ], moves)}</div>`;
  },
};

/* ================= INVENTORY ================= */
Pages.inventory = {
  title: 'สต็อกสินค้า', group: 'WMS คลังสินค้า', icon: '▦',
  render: async (el, actions, params) => {
    await loadLookups('warehouses', 'locations', 'products');
    let rows = [], summary = [], view = 'loc', shown = [];
    const writable = can('warehouse');
    actions.innerHTML = `<button class="btn" data-act="export">⇩ Excel</button>
      ${writable ? '<button class="btn primary" data-act="adjustNew">± ปรับสต็อก</button>' : ''}`;
    el.innerHTML = `<div class="card flush">
      <div class="toolbar" style="padding:12px 16px">
        <div class="tabs" id="view"><button class="tab active" data-v="loc">ตาม Location / Lot</button><button class="tab" data-v="sku">สรุปตามสินค้า</button></div>
        <select id="wh"><option value="">ทุกคลัง</option>${optionTags(optWarehouses())}</select>
        <input type="search" id="search" placeholder="ค้นหา SKU / ชื่อ / Location / Lot" value="${esc(params.get('q') || '')}">${scanBtn()}
        <span class="muted small" id="count"></span>
      </div><div id="tbl"></div></div>`;

    const load = async () => {
      [rows, summary] = await Promise.all([
        q(sb.from('wt_inventory').select('*, product:wt_products(sku, name, uom, barcode), location:wt_locations(code, zone, warehouse_id)').gt('qty', 0)),
        q(sb.from('wt_v_stock').select('*').order('sku')),
      ]);
      rows.sort((a, b) => a.product.sku.localeCompare(b.product.sku) || a.location.code.localeCompare(b.location.code));
      draw();
    };
    const draw = () => {
      const wh = Number($('#wh', el).value) || null;
      const term = $('#search', el).value.trim().toLowerCase();
      $('#wh', el).disabled = view === 'sku';
      if (view === 'sku') {
        const list = summary.filter(r => !term || `${r.sku} ${r.name}`.toLowerCase().includes(term));
        shown = list.map(r => ({ sku: r.sku, name: r.name, uom: r.uom, on_hand: +r.on_hand, min_stock: +r.min_stock, below_min: r.below_min }));
        $('#count', el).textContent = `${list.length} SKU`;
        $('#tbl', el).innerHTML = tableHtml([
          { label: 'SKU', key: 'sku' }, { label: 'สินค้า', key: 'name' }, { label: 'หน่วย', key: 'uom' },
          { label: 'คงเหลือ', num: true, render: r => `<b>${fmt(r.on_hand)}</b>` },
          { label: 'ขั้นต่ำ', num: true, render: r => fmt(r.min_stock) },
          { label: 'สถานะ', render: r => r.below_min ? '<span class="badge b-err">ต่ำกว่าขั้นต่ำ</span>' : '<span class="badge b-ok">ปกติ</span>' },
        ], list);
        return;
      }
      const list = rows.filter(r => (!wh || r.location.warehouse_id === wh) &&
        (!term || `${r.product.sku} ${r.product.name} ${r.product.barcode || ''} ${r.location.code} ${r.lot_no}`.toLowerCase().includes(term)));
      shown = list.map(r => ({ warehouse: byId('warehouses', r.location.warehouse_id)?.code, location: r.location.code, sku: r.product.sku,
        name: r.product.name, lot_no: r.lot_no, expiry_date: r.expiry_date, qty: +r.qty, uom: r.product.uom }));
      $('#count', el).textContent = `${list.length} รายการ · รวม ${fmt(list.reduce((s, r) => s + Number(r.qty), 0))} หน่วย`;
      $('#tbl', el).innerHTML = tableHtml([
        { label: 'คลัง', render: r => esc(byId('warehouses', r.location.warehouse_id)?.code) },
        { label: 'Location', render: r => `<b>${esc(r.location.code)}</b>` },
        { label: 'SKU', render: r => esc(r.product.sku) }, { label: 'สินค้า', render: r => esc(r.product.name) },
        { label: 'Lot', key: 'lot_no' }, { label: 'วันหมดอายุ', render: r => expiryBadge(r.expiry_date) },
        { label: 'คงเหลือ', num: true, render: r => `<b>${fmt(r.qty)}</b> <span class="muted small">${esc(r.product.uom)}</span>` },
      ], list, {
        actions: writable ? r => `<button class="btn sm" data-act="move" data-id="${r.id}">ย้าย</button>
                       <button class="btn sm" data-act="adjust" data-id="${r.id}">ปรับ</button>` : null,
        empty: 'ไม่มีสต็อก',
      });
    };
    $('#view', el).addEventListener('click', e => {
      const t = e.target.closest('[data-v]'); if (!t) return;
      view = t.dataset.v; $$('#view .tab', el).forEach(b => b.classList.toggle('active', b === t)); draw();
    });
    $('#wh', el).addEventListener('change', draw);
    $('#search', el).addEventListener('input', draw);

    const adjust = inv => {
      const fields = inv ? [
        { name: 'delta', label: `จำนวนปรับ (+ เพิ่ม / - ลด) · คงเหลือ ${fmt(inv.qty)}`, type: 'number', required: true },
        { name: 'note', label: 'เหตุผล', type: 'textarea', required: true },
      ] : [
        { name: 'warehouse', label: 'คลัง', type: 'select', options: optWarehouses(), required: true, numeric: true },
        { name: 'location_id', label: 'Location', type: 'select', options: optLocations(), required: true, numeric: true },
        { name: 'product_id', label: 'สินค้า', type: 'select', options: optProducts(), required: true, numeric: true, full: true },
        { name: 'lot', label: 'Lot No.' }, { name: 'expiry', label: 'วันหมดอายุ', type: 'date' },
        { name: 'delta', label: 'จำนวนปรับ (+ เพิ่ม / - ลด)', type: 'number', required: true },
        { name: 'note', label: 'เหตุผล', type: 'textarea', required: true },
      ];
      openModal({
        title: inv ? `ปรับสต็อก ${inv.product.sku} @ ${inv.location.code}` : 'ปรับสต็อก / ยอดยกมา',
        body: fieldsHtml(fields),
        onOpen: body => {
          const whSel = body.querySelector('[name=warehouse]');
          if (whSel) whSel.onchange = () => { body.querySelector('[name=location_id]').innerHTML = optionTags(optLocations(whSel.value)); };
        },
        onSubmit: async form => {
          const v = readFields(form, fields);
          await q(sb.rpc('wt_adjust', inv
            ? { p_product_id: inv.product_id, p_location_id: inv.location_id, p_delta: v.delta, p_lot: inv.lot_no, p_note: v.note }
            : { p_product_id: v.product_id, p_location_id: v.location_id, p_delta: v.delta, p_lot: v.lot || '', p_expiry: v.expiry, p_note: v.note }));
          toast('ปรับสต็อกแล้ว', 'ok');
          await load();
        },
      });
    };
    const handlers = {
      export: () => exportXlsx(`stock-${view}-${today()}`, shown),
      adjustNew: () => adjust(null),
      adjust: id => adjust(rows.find(r => r.id === Number(id))),
      move: id => {
        const inv = rows.find(r => r.id === Number(id));
        const fields = [
          { name: 'to', label: 'ไปยัง Location', type: 'select', required: true, numeric: true,
            options: optLocations(inv.location.warehouse_id).filter(o => o.value !== inv.location_id) },
          { name: 'qty', label: `จำนวน (มี ${fmt(inv.qty)})`, type: 'number', required: true, default: inv.qty, min: 0 },
          { name: 'note', label: 'หมายเหตุ', type: 'textarea' },
        ];
        openModal({
          title: `ย้าย ${inv.product.sku} จาก ${inv.location.code}${inv.lot_no ? ' (Lot ' + inv.lot_no + ')' : ''}`,
          body: fieldsHtml(fields), submitText: 'ย้ายสินค้า',
          onSubmit: async form => {
            const v = readFields(form, fields);
            await q(sb.rpc('wt_transfer', { p_inventory_id: inv.id, p_to_location_id: v.to, p_qty: v.qty, p_note: v.note }));
            toast('ย้ายสินค้าแล้ว', 'ok');
            await load();
          },
        });
      },
    };
    bindActions(el, handlers);
    bindActions(actions, handlers);
    await load();
  },
};

/* ================= MOVEMENTS ================= */
Pages.movements = {
  title: 'ประวัติเคลื่อนไหว', group: 'WMS คลังสินค้า', icon: '⇄',
  render: async (el, actions) => {
    let shown = [];
    actions.innerHTML = '<button class="btn" data-act="export">⇩ Excel</button>';
    bindActions(actions, { export: () => exportXlsx(`movements-${today()}`, shown.map(r => ({
      time: r.created_at, type: r.move_type, sku: r.product?.sku, name: r.product?.name, from: r.from?.code, to: r.to?.code,
      lot_no: r.lot_no, qty: +r.qty, ref_doc: r.ref_doc, note: r.note }))) });
    const rows = await q(sb.from('wt_stock_movements')
      .select('*, product:wt_products(sku, name), from:wt_locations!from_location_id(code), to:wt_locations!to_location_id(code)')
      .order('created_at', { ascending: false }).limit(500));
    el.innerHTML = `<div class="card flush"><div class="toolbar" style="padding:12px 16px">
      <select id="type"><option value="">ทุกประเภท</option>${['receive', 'transfer', 'pick', 'adjust'].map(t => `<option value="${t}">${STATUS[t][0]}</option>`).join('')}</select>
      <input type="search" id="search" placeholder="ค้นหา SKU / เอกสาร"><span class="muted small">แสดง 500 รายการล่าสุด</span></div><div id="tbl"></div></div>`;
    const draw = () => {
      const t = $('#type', el).value, term = $('#search', el).value.trim().toLowerCase();
      shown = rows.filter(r => (!t || r.move_type === t) && (!term || `${r.product?.sku} ${r.ref_doc}`.toLowerCase().includes(term)));
      $('#tbl', el).innerHTML = tableHtml([
        { label: 'เวลา', render: r => fdt(r.created_at) }, { label: 'ประเภท', render: r => badge(r.move_type) },
        { label: 'SKU', render: r => esc(r.product?.sku) }, { label: 'สินค้า', render: r => esc(r.product?.name) },
        { label: 'จาก', render: r => esc(r.from?.code) }, { label: 'ไป', render: r => esc(r.to?.code) },
        { label: 'Lot', key: 'lot_no' }, { label: 'จำนวน', num: true, render: r => fmt(r.qty) },
        { label: 'เอกสาร', key: 'ref_doc' }, { label: 'หมายเหตุ', key: 'note' },
      ], shown);
    };
    $('#type', el).onchange = draw;
    $('#search', el).oninput = draw;
    draw();
  },
};

/* ================= INBOUND ================= */
Pages.inbound = {
  title: 'รับสินค้า (Inbound)', group: 'WMS คลังสินค้า', icon: '⤓',
  render: async (el, actions) => {
    await loadLookups('warehouses', 'locations', 'products', 'partners');
    let rows = [];
    const writable = can('warehouse');
    actions.innerHTML = writable ? `<button class="btn primary" data-act="new">+ สร้างใบรับสินค้า</button>` : '';
    el.innerHTML = `<div class="card flush"><div class="toolbar" style="padding:12px 16px">
      <select id="st"><option value="active">ค้างรับ</option><option value="">ทั้งหมด</option><option value="completed">เสร็จสิ้น</option><option value="cancelled">ยกเลิก</option></select>
      <input type="search" id="search" placeholder="ค้นหาเลขที่ / PO / ผู้ขาย"></div><div id="tbl"></div></div>`;

    const load = async () => {
      rows = await q(sb.from('wt_inbound_orders')
        .select('*, supplier:wt_partners(name), warehouse:wt_warehouses(code), lines:wt_inbound_lines(qty_expected, qty_received)')
        .order('id', { ascending: false }));
      draw();
    };
    const draw = () => {
      const st = $('#st', el).value, term = $('#search', el).value.trim().toLowerCase();
      const list = rows.filter(r => (st === 'active' ? ['open', 'receiving'].includes(r.status) : !st || r.status === st) &&
        (!term || `${r.doc_no} ${r.ref_no} ${r.supplier?.name}`.toLowerCase().includes(term)));
      $('#tbl', el).innerHTML = tableHtml([
        { label: 'เลขที่', render: r => `<b>${esc(r.doc_no)}</b>` }, { label: 'PO / อ้างอิง', key: 'ref_no' },
        { label: 'ผู้ขาย', render: r => esc(r.supplier?.name) }, { label: 'คลัง', render: r => esc(r.warehouse?.code) },
        { label: 'กำหนดรับ', render: r => fdate(r.expected_date) },
        { label: 'รับแล้ว', num: true, render: r => {
          const e = r.lines.reduce((s, l) => s + +l.qty_expected, 0), g = r.lines.reduce((s, l) => s + +l.qty_received, 0);
          return `${fmt(g)} / ${fmt(e)}`;
        } },
        { label: 'สถานะ', render: r => badge(r.status) },
      ], list, { actions: r => `<button class="btn sm" data-act="open" data-id="${r.id}">เปิด</button>` });
    };
    $('#st', el).onchange = draw;
    $('#search', el).oninput = draw;

    const fields = [
      { name: 'supplier_id', label: 'ผู้ขาย', type: 'select', options: optPartners('supplier', 'both'), required: true, numeric: true },
      { name: 'warehouse_id', label: 'คลังที่รับ', type: 'select', options: optWarehouses(), required: true, numeric: true },
      { name: 'ref_no', label: 'เลขที่ PO / อ้างอิง' },
      { name: 'expected_date', label: 'วันที่คาดว่าจะรับ', type: 'date', default: today() },
      { name: 'note', label: 'หมายเหตุ', type: 'textarea' },
    ];
    const create = () => openModal({
      title: 'สร้างใบรับสินค้า (ASN)', wide: true,
      body: fieldsHtml(fields).replace(/<\/div>$/, linesEditorHtml() + '</div>'),
      onOpen: initLinesEditor,
      onSubmit: async form => {
        const lines = readLines(form);
        if (!lines.length) { toast('กรุณาเพิ่มรายการสินค้า', 'err'); return false; }
        const [h] = await q(sb.from('wt_inbound_orders').insert(readFields(form, fields)).select());
        const { error } = await sb.from('wt_inbound_lines').insert(lines.map(l => ({ inbound_id: h.id, product_id: l.product_id, qty_expected: l.qty })));
        if (error) { await sb.from('wt_inbound_orders').delete().eq('id', h.id); toast(error.message, 'err'); return false; }
        toast(`สร้าง ${h.doc_no} แล้ว`, 'ok');
        await load();
      },
    });

    const detail = async id => {
      const h = await q(sb.from('wt_inbound_orders')
        .select('*, supplier:wt_partners(name), warehouse:wt_warehouses(code, name), lines:wt_inbound_lines(*, product:wt_products(sku, name, uom))')
        .eq('id', id).single());
      h.lines.sort((a, b) => a.id - b.id);
      const editable = writable && ['open', 'receiving'].includes(h.status);
      const locs = optLocations(h.warehouse_id);
      const defLoc = LK.locations.find(l => l.warehouse_id === h.warehouse_id && l.loc_type === 'receiving')?.id;
      openModal({
        title: `ใบรับสินค้า ${h.doc_no}`, wide: true,
        body: `<div class="info-grid">
            <div><span>ผู้ขาย</span>${esc(h.supplier?.name)}</div><div><span>คลัง</span>${esc(h.warehouse.code)} - ${esc(h.warehouse.name)}</div>
            <div><span>PO / อ้างอิง</span>${esc(h.ref_no || '-')}</div><div><span>กำหนดรับ</span>${fdate(h.expected_date)}</div>
            <div><span>สถานะ</span>${badge(h.status)}</div><div><span>หมายเหตุ</span>${esc(h.note || '-')}</div></div>
          ${tableHtml([
            { label: 'สินค้า', render: l => `<b>${esc(l.product.sku)}</b><br><span class="muted small">${esc(l.product.name)}</span>` },
            { label: 'สั่ง', num: true, render: l => fmt(l.qty_expected) },
            { label: 'รับแล้ว', num: true, render: l => `<b style="color:${+l.qty_received >= +l.qty_expected ? 'var(--ok)' : 'inherit'}">${fmt(l.qty_received)}</b>` },
            ...(editable ? [{ label: 'รับเข้า (จำนวน / Location / Lot / หมดอายุ)', render: l => `<div class="row" data-line="${l.id}" style="flex-wrap:nowrap">
                <input type="number" step="any" min="0" style="width:90px" value="${Math.max(0, l.qty_expected - l.qty_received)}" data-f="qty">
                <select style="width:150px" data-f="loc">${optionTags(locs, defLoc)}</select>${scanBtn('location')}
                <input style="width:100px" placeholder="Lot" data-f="lot"><input type="date" style="width:140px" data-f="exp">
                <button type="button" class="btn sm primary" data-act="recv" data-id="${l.id}">รับ</button></div>` }] : []),
          ], h.lines)}`,
        footer: editable ? `<button type="button" class="btn" data-act="scanItem">▥ สแกนสินค้าที่มาถึง</button>
          <button type="button" class="btn danger" data-act="cancel">ยกเลิกเอกสาร</button>
          <button type="button" class="btn ok" data-act="close">ปิดใบรับ (รับครบ)</button><span class="spacer"></span>` : '',
        onOpen: (body, foot) => {
          bindActions(body, {
            recv: async (lineId, btn) => {
              const box = btn.closest('[data-line]');
              const val = f => box.querySelector(`[data-f=${f}]`).value;
              const line = h.lines.find(l => l.id === Number(lineId));
              const qty = Number(val('qty'));
              if (qty + +line.qty_received > +line.qty_expected && !confirm('รับเกินจำนวนที่สั่ง ต้องการดำเนินการต่อ?')) return;
              btn.disabled = true;
              try {
                await q(sb.rpc('wt_receive', { p_line_id: Number(lineId), p_qty: qty, p_location_id: Number(val('loc')), p_lot: val('lot'), p_expiry: val('exp') || null }));
                toast('รับสินค้าเข้าคลังแล้ว', 'ok');
                await load(); await detail(id);
              } finally { btn.disabled = false; }
            },
          });
          bindActions(foot, {
            // scan a product barcode -> jump to its line
            scanItem: async () => {
              const code = await scanCode('สแกนสินค้าที่รับ');
              if (!code) return;
              const p = findProductByCode(code);
              const line = p && h.lines.find(l => l.product_id === p.id);
              if (!line) return toast(`สินค้า ${code} ไม่อยู่ในใบรับนี้`, 'err');
              const box = body.querySelector(`[data-line="${line.id}"]`);
              box.scrollIntoView({ block: 'center' });
              box.querySelector('[data-f=qty]').select();
              box.closest('tr').style.outline = '2px solid var(--primary)';
            },
            close: async () => {
              if (!confirm('ปิดใบรับสินค้านี้?')) return;
              await q(sb.rpc('wt_close_inbound', { p_inbound_id: h.id }));
              toast('ปิดใบรับแล้ว', 'ok'); closeModal(); await load();
            },
            cancel: async () => {
              if (h.lines.some(l => +l.qty_received > 0)) { toast('มีการรับสินค้าแล้ว ยกเลิกไม่ได้ (ให้ปิดใบรับแทน)', 'err'); return; }
              if (!confirm('ยกเลิกใบรับสินค้านี้?')) return;
              await q(sb.from('wt_inbound_orders').update({ status: 'cancelled' }).eq('id', h.id));
              toast('ยกเลิกแล้ว', 'ok'); closeModal(); await load();
            },
          });
        },
      });
    };
    const handlers = { new: create, open: detail };
    bindActions(el, handlers);
    bindActions(actions, handlers);
    await load();
  },
};

/* ================= OUTBOUND ================= */
Pages.outbound = {
  title: 'ออเดอร์ขาออก (Outbound)', group: 'WMS คลังสินค้า', icon: '⤒',
  render: async (el, actions) => {
    await loadLookups('warehouses', 'products', 'partners');
    let rows = [], shown = [];
    const writable = can('warehouse');
    actions.innerHTML = `<button class="btn" data-act="export">⇩ Excel</button>
      ${writable ? `<button class="btn" data-act="import">⇧ นำเข้าออเดอร์</button>
      <button class="btn primary" data-act="new">+ สร้างออเดอร์</button>` : ''}`;
    el.innerHTML = `<div class="card flush"><div class="toolbar" style="padding:12px 16px">
      <select id="st"><option value="active">กำลังดำเนินการ</option><option value="">ทั้งหมด</option>
        ${['open', 'picked', 'planned', 'shipped', 'delivered', 'failed', 'cancelled'].map(s => `<option value="${s}">${STATUS[s][0]}</option>`).join('')}</select>
      <input type="search" id="search" placeholder="ค้นหาเลขที่ / ลูกค้า"><span class="spacer"></span>
      ${writable ? '<button class="btn sm" data-act="pickAll">หยิบสินค้าทุกออเดอร์ที่รอ</button>' : ''}</div><div id="tbl"></div></div>`;

    const load = async () => {
      rows = await q(sb.from('wt_outbound_orders')
        .select('*, customer:wt_partners(name), warehouse:wt_warehouses(code), lines:wt_outbound_lines(qty_ordered)')
        .order('id', { ascending: false }));
      draw();
    };
    const draw = () => {
      const st = $('#st', el).value, term = $('#search', el).value.trim().toLowerCase();
      const list = shown = rows.filter(r => (st === 'active' ? !['delivered', 'cancelled'].includes(r.status) : !st || r.status === st) &&
        (!term || `${r.doc_no} ${r.ref_no} ${r.customer?.name}`.toLowerCase().includes(term)));
      $('#tbl', el).innerHTML = tableHtml([
        { label: 'เลขที่', render: r => `<b>${esc(r.doc_no)}</b>` }, { label: 'ลูกค้า', render: r => esc(r.customer?.name) },
        { label: 'คลัง', render: r => esc(r.warehouse?.code) }, { label: 'ต้องส่ง', render: r => fdate(r.required_date) },
        { label: 'ด่วน', render: r => r.priority <= 2 ? `<span class="badge b-err">P${r.priority}</span>` : `P${r.priority}` },
        { label: 'รายการ', num: true, render: r => r.lines.length },
        { label: 'น้ำหนัก (kg)', num: true, render: r => +r.total_weight_kg ? fmt(r.total_weight_kg) : '' },
        { label: 'สถานะ', render: r => badge(r.status) },
      ], list, {
        actions: r => `${writable && r.status === 'open' ? `<button class="btn sm primary" data-act="pick" data-id="${r.id}">หยิบสินค้า</button>` : ''}
          <button class="btn sm" data-act="open" data-id="${r.id}">เปิด</button>`,
      });
    };
    $('#st', el).onchange = draw;
    $('#search', el).oninput = draw;

    const fields = [
      { name: 'customer_id', label: 'ลูกค้า', type: 'select', options: optPartners('customer', 'both'), required: true, numeric: true },
      { name: 'warehouse_id', label: 'คลังที่จ่าย', type: 'select', options: optWarehouses(), required: true, numeric: true },
      { name: 'ref_no', label: 'เลขที่ SO / อ้างอิง' },
      { name: 'required_date', label: 'วันที่ต้องส่ง', type: 'date', default: today() },
      { name: 'priority', label: 'ความเร่งด่วน', type: 'select', numeric: true, required: true, default: 3,
        options: [1, 2, 3, 4, 5].map(p => ({ value: p, label: `P${p}${p === 1 ? ' (ด่วนที่สุด)' : p === 5 ? ' (ไม่ด่วน)' : ''}` })) },
      { name: 'ship_address', label: 'ที่อยู่จัดส่ง', full: true },
      { name: 'lat', label: 'ละติจูด', type: 'number' }, { name: 'lng', label: 'ลองจิจูด', type: 'number' },
      { name: 'note', label: 'หมายเหตุ', type: 'textarea' },
    ];
    const create = () => openModal({
      title: 'สร้างออเดอร์ขาออก', wide: true,
      body: fieldsHtml(fields).replace(/<\/div>$/, linesEditorHtml() + '</div>'),
      onOpen: body => {
        initLinesEditor(body);
        body.querySelector('[name=customer_id]').onchange = e => {
          const c = byId('partners', e.target.value); if (!c) return;
          body.querySelector('[name=ship_address]').value = c.address || '';
          body.querySelector('[name=lat]').value = c.lat ?? '';
          body.querySelector('[name=lng]').value = c.lng ?? '';
        };
      },
      onSubmit: async form => {
        const lines = readLines(form);
        if (!lines.length) { toast('กรุณาเพิ่มรายการสินค้า', 'err'); return false; }
        const [h] = await q(sb.from('wt_outbound_orders').insert(readFields(form, fields)).select());
        const { error } = await sb.from('wt_outbound_lines').insert(lines.map(l => ({ outbound_id: h.id, product_id: l.product_id, qty_ordered: l.qty })));
        if (error) { await sb.from('wt_outbound_orders').delete().eq('id', h.id); toast(error.message, 'err'); return false; }
        toast(`สร้าง ${h.doc_no} แล้ว`, 'ok');
        await load();
      },
    });

    const pick = async id => {
      await q(sb.rpc('wt_pick', { p_outbound_id: Number(id) }));
      toast('หยิบสินค้าแล้ว (FEFO) พร้อมจัดรถ', 'ok');
    };
    const detail = async id => {
      const h = await q(sb.from('wt_outbound_orders')
        .select('*, customer:wt_partners(name, phone), warehouse:wt_warehouses(code, name), lines:wt_outbound_lines(*, product:wt_products(sku, name, uom))')
        .eq('id', id).single());
      const picks = await q(sb.from('wt_stock_movements').select('qty, lot_no, product:wt_products(sku), from:wt_locations!from_location_id(code)')
        .eq('ref_doc', h.doc_no).eq('move_type', 'pick').order('id'));
      openModal({
        title: `ออเดอร์ ${h.doc_no}`, wide: true,
        body: `<div class="info-grid">
            <div><span>ลูกค้า</span>${esc(h.customer?.name)}</div><div><span>โทร</span>${esc(h.customer?.phone || '-')}</div>
            <div><span>คลัง</span>${esc(h.warehouse.code)}</div><div><span>ต้องส่ง</span>${fdate(h.required_date)}</div>
            <div><span>สถานะ</span>${badge(h.status)}</div><div><span>น้ำหนัก / ปริมาตร</span>${fmt(h.total_weight_kg)} kg / ${fmt(h.total_volume_cbm, 3)} cbm</div>
            <div style="grid-column:1/-1"><span>ที่อยู่จัดส่ง</span>${esc(h.ship_address || '-')}</div></div>
          <h3>รายการสินค้า</h3>${tableHtml([
            { label: 'SKU', render: l => esc(l.product.sku) }, { label: 'สินค้า', render: l => esc(l.product.name) },
            { label: 'สั่ง', num: true, render: l => `${fmt(l.qty_ordered)} ${esc(l.product.uom)}` },
            { label: 'หยิบแล้ว', num: true, render: l => fmt(l.qty_picked) },
          ], h.lines)}
          ${picks.length ? `<h3>ใบหยิบสินค้า (Pick list)</h3>${tableHtml([
            { label: 'Location', render: p => `<b>${esc(p.from?.code)}</b>` }, { label: 'SKU', render: p => esc(p.product.sku) },
            { label: 'Lot', key: 'lot_no' }, { label: 'จำนวน', num: true, render: p => fmt(p.qty) },
          ], picks)}` : ''}`,
        footer: `${writable && h.status === 'open' ? `<button type="button" class="btn danger" data-act="cancel">ยกเลิกออเดอร์</button>
            <button type="button" class="btn primary" data-act="pick">หยิบสินค้า</button>` : ''}
          <button type="button" class="btn" data-act="print">พิมพ์</button><span class="spacer"></span>`,
        onOpen: (body, foot) => bindActions(foot, {
          print: () => window.print(),
          pick: async () => { await pick(h.id); await load(); await detail(h.id); },
          cancel: async () => {
            if (!confirm('ยกเลิกออเดอร์นี้?')) return;
            await q(sb.from('wt_outbound_orders').update({ status: 'cancelled' }).eq('id', h.id).eq('status', 'open'));
            toast('ยกเลิกแล้ว', 'ok'); closeModal(); await load();
          },
        }),
      });
    };
    // Excel rows: one row per product line; rows sharing ref_no + customer_code become one order
    const importOrders = () => importDialog({
      title: 'นำเข้าออเดอร์จาก Excel', templateName: 'template-outbound-orders',
      columns: ['ref_no', 'customer_code', 'warehouse_code', 'required_date', 'priority', 'sku', 'qty', 'note'],
      templateRows: [
        { ref_no: 'SO-001', customer_code: 'CUS-01', warehouse_code: 'BKK1', required_date: today(), priority: 3, sku: 'SKU-1001', qty: 10, note: '' },
        { ref_no: 'SO-001', customer_code: 'CUS-01', warehouse_code: 'BKK1', required_date: today(), priority: 3, sku: 'SKU-2001', qty: 5, note: '' },
      ],
      note: 'หนึ่งแถว = หนึ่งรายการสินค้า, แถวที่ ref_no + customer_code เหมือนกันจะรวมเป็นออเดอร์เดียว',
      onRows: async raw => {
        const groups = new Map(), errs = [];
        raw.forEach((r, i) => {
          const c = LK.partners.find(p => p.code === String(r.customer_code).trim());
          const w = LK.warehouses.find(x => x.code === String(r.warehouse_code).trim());
          const p = findProductByCode(String(r.sku).trim());
          const qty = Number(String(r.qty).replace(/,/g, ''));
          if (!c || !w || !p || !(qty > 0)) { errs.push(`แถว ${i + 2}: ${!c ? 'ไม่พบลูกค้า ' : ''}${!w ? 'ไม่พบคลัง ' : ''}${!p ? 'ไม่พบ SKU ' : ''}${!(qty > 0) ? 'จำนวนผิด' : ''}`); return; }
          const key = `${r.ref_no}|${c.id}|${w.id}`;
          if (!groups.has(key)) groups.set(key, { head: { customer_id: c.id, warehouse_id: w.id, ref_no: r.ref_no || null,
            required_date: r.required_date || null, priority: Number(r.priority) || 3, note: r.note || null,
            ship_address: c.address, lat: c.lat, lng: c.lng }, lines: [] });
          groups.get(key).lines.push({ product_id: p.id, qty_ordered: qty });
        });
        if (errs.length) { toast(errs.slice(0, 3).join(' | '), 'err'); throw new Error('invalid'); }
        const heads = await q(sb.from('wt_outbound_orders').insert([...groups.values()].map(g => g.head)).select('id'));
        const lines = [...groups.values()].flatMap((g, i) => g.lines.map(l => ({ ...l, outbound_id: heads[i].id })));
        const { error } = await sb.from('wt_outbound_lines').insert(lines);
        if (error) { await sb.from('wt_outbound_orders').delete().in('id', heads.map(h => h.id)); toast(error.message, 'err'); throw error; }
        toast(`นำเข้า ${heads.length} ออเดอร์ (${lines.length} รายการ)`, 'ok');
        await load();
      },
    });
    const handlers = {
      new: create, open: detail, import: importOrders,
      export: () => exportXlsx(`outbound-${today()}`, shown.map(r => ({ doc_no: r.doc_no, ref_no: r.ref_no, customer: r.customer?.name,
        warehouse: r.warehouse?.code, required_date: r.required_date, priority: r.priority, lines: r.lines.length,
        weight_kg: +r.total_weight_kg, status: r.status }))),
      pick: async id => { await pick(id); await load(); },
      pickAll: async () => {
        const open = rows.filter(r => r.status === 'open').sort((a, b) => a.priority - b.priority || a.id - b.id);
        let ok = 0;
        for (const r of open) {
          const { error } = await sb.rpc('wt_pick', { p_outbound_id: r.id });
          if (error) toast(`${r.doc_no}: ${error.message}`, 'err'); else ok++;
        }
        toast(`หยิบสำเร็จ ${ok}/${open.length} ออเดอร์`, ok ? 'ok' : '');
        await load();
      },
    };
    bindActions(el, handlers);
    bindActions(actions, handlers);
    await load();
  },
};

/* ================= MASTER DATA ================= */
const activeCol = { label: 'สถานะ', render: r => r.active ? '<span class="badge b-ok">ใช้งาน</span>' : '<span class="badge">ปิด</span>' };
const activeField = { name: 'active', label: 'ใช้งาน', type: 'checkbox', default: true };

Pages.products = {
  title: 'สินค้า', group: 'ข้อมูลหลัก', icon: '◫',
  render: crudPage({
    table: 'wt_products', noun: 'สินค้า', order: 'sku', searchKeys: ['sku', 'name', 'barcode', 'category'],
    writeRoles: ['warehouse'], importKey: 'sku',
    labels: r => ({ code: r.barcode || r.sku, title: r.sku, sub: r.name }),
    cols: [
      { label: 'SKU', render: r => `<b>${esc(r.sku)}</b>` }, { label: 'ชื่อสินค้า', key: 'name' }, { label: 'บาร์โค้ด', key: 'barcode' },
      { label: 'หมวด', key: 'category' }, { label: 'หน่วย', key: 'uom' },
      { label: 'น้ำหนัก (kg)', num: true, render: r => fmt(r.weight_kg) }, { label: 'ปริมาตร (cbm)', num: true, render: r => fmt(r.volume_cbm, 4) },
      { label: 'ขั้นต่ำ', num: true, render: r => fmt(r.min_stock) }, activeCol,
    ],
    fields: [
      { name: 'sku', label: 'SKU', required: true }, { name: 'name', label: 'ชื่อสินค้า', required: true },
      { name: 'barcode', label: 'บาร์โค้ด' }, { name: 'category', label: 'หมวดหมู่' },
      { name: 'uom', label: 'หน่วยนับ', required: true, default: 'EA' }, { name: 'min_stock', label: 'สต็อกขั้นต่ำ', type: 'number', default: 0 },
      { name: 'weight_kg', label: 'น้ำหนัก/หน่วย (kg)', type: 'number', default: 0 },
      { name: 'volume_cbm', label: 'ปริมาตร/หน่วย (cbm)', type: 'number', default: 0 }, activeField,
    ],
  }),
};

Pages.warehouses = {
  title: 'คลังสินค้า', group: 'ข้อมูลหลัก', icon: '⌂',
  render: crudPage({
    table: 'wt_warehouses', noun: 'คลังสินค้า', order: 'code', searchKeys: ['code', 'name', 'address'],
    writeRoles: ['warehouse'], importKey: 'code',
    cols: [
      { label: 'รหัส', render: r => `<b>${esc(r.code)}</b>` }, { label: 'ชื่อ', key: 'name' }, { label: 'ที่อยู่', key: 'address' },
      { label: 'พิกัด', render: r => r.lat != null ? `${r.lat}, ${r.lng}` : '' }, activeCol,
    ],
    fields: [
      { name: 'code', label: 'รหัสคลัง', required: true }, { name: 'name', label: 'ชื่อคลัง', required: true },
      { name: 'address', label: 'ที่อยู่', full: true },
      { name: 'lat', label: 'ละติจูด', type: 'number' }, { name: 'lng', label: 'ลองจิจูด', type: 'number' }, activeField,
    ],
  }),
};

Pages.locations = {
  title: 'Location / ตำแหน่งจัดเก็บ', group: 'ข้อมูลหลัก', icon: '⊞',
  render: crudPage({
    table: 'wt_locations', noun: 'Location', select: '*, warehouse:wt_warehouses(code)', order: 'code',
    lookups: ['warehouses'], searchKeys: ['code', 'zone', 'loc_type'],
    writeRoles: ['warehouse'], importKey: 'warehouse_id,code',
    labels: r => ({ code: r.code, title: r.code, sub: `${r.warehouse?.code} · ${LOC_TYPES[r.loc_type]}${r.zone ? ' · โซน ' + r.zone : ''}` }),
    exportMap: ({ warehouse_id, ...rest }, r) => ({ warehouse_code: r.warehouse?.code, ...rest }),
    importMap: ({ warehouse_code, ...rest }) => {
      const w = LK.warehouses.find(x => x.code === warehouse_code);
      if (!w) { toast(`ไม่พบคลัง ${warehouse_code}`, 'err'); throw new Error('bad warehouse'); }
      return { ...rest, warehouse_id: w.id };
    },
    cols: [
      { label: 'คลัง', render: r => esc(r.warehouse?.code) }, { label: 'Location', render: r => `<b>${esc(r.code)}</b>` },
      { label: 'โซน', key: 'zone' }, { label: 'ประเภท', render: r => esc(LOC_TYPES[r.loc_type]) },
      { label: 'ความจุ', num: true, render: r => fmt(r.max_qty) }, activeCol,
    ],
    fields: () => [
      { name: 'warehouse_id', label: 'คลัง', type: 'select', options: optWarehouses(), required: true, numeric: true },
      { name: 'code', label: 'รหัส Location', required: true, placeholder: 'เช่น A-01-01' },
      { name: 'zone', label: 'โซน' },
      { name: 'loc_type', label: 'ประเภท', type: 'select', options: opts(LOC_TYPES), required: true, default: 'storage' },
      { name: 'max_qty', label: 'ความจุสูงสุด (หน่วย)', type: 'number' }, activeField,
    ],
  }),
};

Pages.partners = {
  title: 'ลูกค้า / ผู้ขาย', group: 'ข้อมูลหลัก', icon: '☺',
  render: crudPage({
    table: 'wt_partners', noun: 'คู่ค้า', order: 'code', searchKeys: ['code', 'name', 'phone', 'address'],
    writeRoles: ['warehouse', 'transport'], importKey: 'code',
    cols: [
      { label: 'รหัส', render: r => `<b>${esc(r.code)}</b>` }, { label: 'ชื่อ', key: 'name' },
      { label: 'ประเภท', render: r => badge(r.partner_type) }, { label: 'ผู้ติดต่อ', key: 'contact' }, { label: 'โทร', key: 'phone' },
      { label: 'ที่อยู่', key: 'address' }, { label: 'พิกัด', render: r => r.lat != null ? '✓' : '' }, activeCol,
    ],
    fields: [
      { name: 'code', label: 'รหัส', required: true }, { name: 'name', label: 'ชื่อ', required: true },
      { name: 'partner_type', label: 'ประเภท', type: 'select', required: true, default: 'customer',
        options: opts({ customer: 'ลูกค้า', supplier: 'ผู้ขาย', both: 'ลูกค้า/ผู้ขาย' }) },
      { name: 'contact', label: 'ผู้ติดต่อ' }, { name: 'phone', label: 'โทรศัพท์' },
      { name: 'address', label: 'ที่อยู่', full: true },
      { name: 'lat', label: 'ละติจูด', type: 'number' }, { name: 'lng', label: 'ลองจิจูด', type: 'number' }, activeField,
    ],
  }),
};
