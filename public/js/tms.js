/* TMS pages: load planning, shipments + POD, tracking map, reports, vehicles, drivers */

const STOP_COLOR = { pending: '#2c6db5', delivered: '#1f8a4c', failed: '#c0392b' };
const capBar = (used, cap, unit, d = 0) => {
  const pct = cap > 0 ? used / cap * 100 : 0;
  return `<div class="row small"><span>${fmt(used, d)} / ${cap > 0 ? fmt(cap, d) : '∞'} ${unit}</span><span class="spacer"></span><b>${cap > 0 ? Math.round(pct) + '%' : ''}</b></div>
    <div class="bar ${pct > 100 ? 'over' : pct > 85 ? 'high' : ''}"><i style="width:${Math.min(100, pct)}%"></i></div>`;
};

/* ================= LOAD PLANNING ================= */
Pages.planning = {
  title: 'วางแผนจัดรถ', group: 'TMS ขนส่ง', icon: '⚑',
  render: async el => {
    await loadLookups('warehouses', 'vehicles', 'drivers');
    let orders = [], selected = [], map = null, kmTouched = false;
    const load = async () => {
      orders = await q(sb.from('wt_outbound_orders').select('*, customer:wt_partners(name)')
        .in('status', ['picked', 'failed']).order('priority').order('required_date'));
      selected = selected.filter(id => orders.some(o => o.id === id));
      draw();
    };
    const vehOpts = LK.vehicles.filter(v => !['maintenance', 'inactive'].includes(v.status))
      .map(v => ({ value: v.id, label: `${v.plate_no} · ${v.vehicle_type} · ${fmt(v.capacity_kg, 0)}kg${v.status === 'on_trip' ? ' (ออกวิ่ง)' : ''}` }));
    const drvOpts = LK.drivers.filter(d => !['off', 'inactive'].includes(d.status))
      .map(d => ({ value: d.id, label: `${d.name}${d.status === 'on_trip' ? ' (ออกวิ่ง)' : ''}` }));

    el.innerHTML = `<div class="grid-2">
      <div class="card flush"><div class="toolbar" style="padding:12px 16px">
          <b>ออเดอร์พร้อมจัดส่ง</b><span class="spacer"></span>
          <select id="wh">${optionTags(optWarehouses())}</select></div>
        <div id="orders"></div></div>
      <div class="card" style="display:grid;gap:12px;align-content:start">
        <h3 style="margin:0">เที่ยวรถใหม่</h3>
        <div class="form-grid">
          <label>รถ *<select id="veh">${optionTags(vehOpts)}</select></label>
          <label>พนักงานขับรถ *<select id="drv">${optionTags(drvOpts)}</select></label>
          <label>วันที่วิ่ง<input type="date" id="date" value="${today()}"></label>
          <label>ระยะทางรวม (km)<input type="number" step="any" id="km" value="0"></label>
          <label class="full">หมายเหตุ<input id="note"></label>
        </div>
        <div id="cap"></div>
        <div class="row"><button class="btn" id="suggest">แนะนำรถที่เหมาะสม</button><span class="spacer"></span>
          <span class="muted small" id="cost"></span><button class="btn primary" id="create" ${can('transport') ? '' : 'disabled title="เฉพาะฝ่ายขนส่ง"'}>สร้างเที่ยวรถ</button></div>
        <div id="seq" class="small"></div>
      </div></div>
      <div class="card"><h3>เส้นทาง (จัดลำดับอัตโนมัติแบบ Nearest-neighbour)</h3><div id="map" class="map"></div></div>`;

    const wh = () => byId('warehouses', $('#wh', el).value);
    const veh = () => byId('vehicles', $('#veh', el).value);
    const sel = () => selected.map(id => orders.find(o => o.id === id)).filter(Boolean);

    const draw = () => {
      const list = orders.filter(o => o.warehouse_id === wh()?.id);
      $('#orders', el).innerHTML = tableHtml([
        { label: '', render: o => `<input type="checkbox" data-pick="${o.id}" ${selected.includes(o.id) ? 'checked' : ''}>` },
        { label: 'เลขที่', render: o => `<b>${esc(o.doc_no)}</b>${o.status === 'failed' ? ' ' + badge('failed') : ''}` },
        { label: 'ลูกค้า', render: o => `${esc(o.customer?.name)}<br><span class="muted small">${esc(o.ship_address || '')}</span>` },
        { label: 'ต้องส่ง', render: o => fdate(o.required_date) }, { label: 'P', render: o => o.priority },
        { label: 'kg', num: true, render: o => fmt(o.total_weight_kg) },
      ], list, { empty: 'ไม่มีออเดอร์ที่หยิบแล้วรอจัดรถ' });
      recalc();
    };
    const recalc = () => {
      const s = sel(), v = veh(), w = wh();
      const kg = s.reduce((a, o) => a + +o.total_weight_kg, 0), cbm = s.reduce((a, o) => a + +o.total_volume_cbm, 0);
      const route = w?.lat != null ? planRoute(w, s) : { order: s, km: 0 };
      selected = route.order.map(o => o.id);
      if (!kmTouched) $('#km', el).value = route.km;
      $('#cap', el).innerHTML = v ? `<div style="display:grid;gap:8px"><div><b class="small">น้ำหนัก</b>${capBar(kg, +v.capacity_kg, 'kg')}</div>
        <div><b class="small">ปริมาตร</b>${capBar(cbm, +v.capacity_cbm, 'cbm', 3)}</div></div>` : '<p class="muted">ยังไม่มีรถพร้อมใช้งาน</p>';
      $('#cost', el).textContent = v ? `ค่าขนส่งประมาณ ฿${fmt(Number($('#km', el).value) * v.cost_per_km)}` : '';
      $('#seq', el).innerHTML = route.order.length
        ? `<b>ลำดับจุดส่ง:</b> ${esc(w?.code)} → ${route.order.map((o, i) => `${i + 1}. ${esc(o.customer?.name)}`).join(' → ')} → ${esc(w?.code)}` : '';
      if (map) map.remove();
      map = makeMap($('#map', el), [
        { lat: w?.lat, lng: w?.lng, label: w?.name || '', kind: 'wh', color: '#d97a1e', permanent: true },
        ...route.order.map((o, i) => ({ lat: o.lat, lng: o.lng, label: `${i + 1}. ${o.customer?.name}`, permanent: true })),
        ...(route.order.length ? [{ lat: w?.lat, lng: w?.lng, label: '', kind: 'wh', color: '#d97a1e' }] : []),
      ]);
    };

    el.addEventListener('change', e => {
      const id = e.target.dataset?.pick;
      if (id) {
        const n = Number(id);
        selected = e.target.checked ? [...selected, n] : selected.filter(x => x !== n);
        recalc();
      }
    });
    $('#wh', el).onchange = () => { selected = []; draw(); };
    $('#veh', el).onchange = recalc;
    $('#km', el).oninput = () => { kmTouched = true; const v = veh(); $('#cost', el).textContent = v ? `ค่าขนส่งประมาณ ฿${fmt(Number($('#km', el).value) * v.cost_per_km)}` : ''; };
    $('#suggest', el).onclick = () => {
      const s = sel();
      const kg = s.reduce((a, o) => a + +o.total_weight_kg, 0), cbm = s.reduce((a, o) => a + +o.total_volume_cbm, 0);
      const fit = LK.vehicles.filter(v => v.status === 'available' && (!+v.capacity_kg || +v.capacity_kg >= kg) && (!+v.capacity_cbm || +v.capacity_cbm >= cbm))
        .sort((a, b) => a.capacity_kg - b.capacity_kg)[0];
      if (!fit) return toast('ไม่มีรถว่างที่บรรทุกได้พอ', 'err');
      $('#veh', el).value = fit.id; recalc();
      toast(`แนะนำ ${fit.plate_no} (${fit.vehicle_type})`, 'ok');
    };
    $('#create', el).onclick = async e => {
      if (!selected.length) return toast('เลือกออเดอร์อย่างน้อย 1 รายการ', 'err');
      e.target.disabled = true;
      try {
        const id = await q(sb.rpc('wt_create_shipment', {
          p_vehicle_id: Number($('#veh', el).value), p_driver_id: Number($('#drv', el).value), p_outbound_ids: selected,
          p_plan_date: $('#date', el).value || today(), p_distance_km: Number($('#km', el).value) || 0, p_note: $('#note', el).value || null,
        }));
        toast('สร้างเที่ยวรถแล้ว', 'ok');
        location.hash = `#/shipments?id=${id}`;
      } finally { e.target.disabled = false; }
    };
    await load();
  },
};

/* ================= SHIPMENTS ================= */
async function shipmentDetail(id, onChange) {
  const [s, stops, events] = await Promise.all([
    q(sb.from('wt_shipments').select('*, vehicle:wt_vehicles(*), driver:wt_drivers(*), warehouse:wt_warehouses(*)').eq('id', id).single()),
    q(sb.from('wt_shipment_stops').select('*, order:wt_outbound_orders(id, doc_no, ship_address, lat, lng, total_weight_kg, customer:wt_partners(name, phone))')
      .eq('shipment_id', id).order('seq')),
    q(sb.from('wt_tracking_events').select('*').eq('shipment_id', id).order('created_at')),
  ]);
  const w = s.warehouse;
  const manage = can('transport');
  // POD photos/signatures live in a private bucket -> short-lived signed URLs
  const paths = stops.flatMap(r => [r.pod_photo, r.pod_signature]).filter(Boolean);
  const signed = {};
  if (paths.length) {
    const { data } = await sb.storage.from('wt-pod').createSignedUrls(paths, 3600);
    (data || []).forEach(d => { if (d.signedUrl) signed[d.path] = d.signedUrl; });
  }
  const podImgs = r => [r.pod_photo, r.pod_signature].filter(p => signed[p])
    .map(p => `<a href="${esc(signed[p])}" target="_blank" rel="noopener"><img src="${esc(signed[p])}" alt="POD" style="height:48px;border-radius:4px;border:1px solid var(--border);background:#fff"></a>`).join(' ');
  openModal({
    title: `เที่ยวรถ ${s.doc_no}`, wide: true,
    body: `<div class="info-grid">
        <div><span>สถานะ</span>${badge(s.status)}</div><div><span>วันที่วิ่ง</span>${fdate(s.plan_date)}</div>
        <div><span>รถ</span>${esc(s.vehicle.plate_no)} (${esc(s.vehicle.vehicle_type)})</div>
        <div><span>พนักงานขับรถ</span>${esc(s.driver.name)} · ${esc(s.driver.phone || '')}</div>
        <div><span>คลังต้นทาง</span>${esc(w.code)} - ${esc(w.name)}</div>
        <div><span>น้ำหนัก / ปริมาตร</span>${fmt(s.total_weight_kg)} kg / ${fmt(s.total_volume_cbm, 3)} cbm</div>
        <div><span>ระยะทาง / ค่าขนส่ง</span>${fmt(s.distance_km)} km / ฿${fmt(s.freight_cost)}</div>
        <div><span>ปล่อยรถ / ปิดงาน</span>${fdt(s.dispatched_at)} / ${fdt(s.completed_at)}</div></div>
      <h3>จุดส่งสินค้า</h3>
      ${tableHtml([
        { label: '#', render: r => r.seq },
        { label: 'ออเดอร์ / ลูกค้า', render: r => `<b>${esc(r.order.doc_no)}</b> ${esc(r.order.customer?.name)}<br><span class="muted small">${esc(r.order.ship_address || '')} ${esc(r.order.customer?.phone || '')}</span>` },
        { label: 'kg', num: true, render: r => fmt(r.order.total_weight_kg) },
        { label: 'สถานะ', render: r => badge(r.status) },
        { label: 'POD', render: r => r.status === 'pending'
          ? (manage && s.status === 'in_transit' ? `<div class="row" data-stop="${r.id}" style="flex-wrap:nowrap">
              <input placeholder="ชื่อผู้รับ / เหตุผล" style="width:160px">
              <button type="button" class="btn sm ok" data-act="ok" data-id="${r.id}">ส่งสำเร็จ</button>
              <button type="button" class="btn sm danger" data-act="fail" data-id="${r.id}">ไม่สำเร็จ</button></div>` : '')
          : `${esc(r.pod_name || '')} <span class="muted small">${fdt(r.delivered_at)} ${esc(r.pod_note || '')}</span> ${podImgs(r)}` },
      ], stops)}
      <div id="ship-map" class="map sm"></div>
      ${events.length ? `<h3>Timeline</h3><ul class="timeline">${events.map(e => `<li><div>${badge(e.event)} <span class="muted small">${fdt(e.created_at)}</span><br>${esc(e.note || '')}</div></li>`).join('')}</ul>` : ''}`,
    footer: `${manage && s.status === 'planned' ? `<button type="button" class="btn danger" data-act="cancel">ยกเลิกเที่ยว</button>
        <button type="button" class="btn primary" data-act="dispatch">ปล่อยรถ</button>` : ''}
      ${manage && s.status === 'in_transit' ? `<button type="button" class="btn" data-act="gps">บันทึกตำแหน่ง GPS</button>` : ''}
      <button type="button" class="btn" data-act="print">พิมพ์ใบคุมรถ</button><span class="spacer"></span>`,
    onOpen: (body, foot) => {
      makeMap($('#ship-map', body), [
        { lat: w.lat, lng: w.lng, label: w.name, kind: 'wh', color: '#d97a1e', permanent: true },
        ...stops.map(r => ({ lat: r.order.lat, lng: r.order.lng, label: `${r.seq}. ${r.order.customer?.name}`, color: STOP_COLOR[r.status], permanent: true })),
      ]);
      const refresh = async () => { await onChange?.(); await shipmentDetail(id, onChange); };
      const pod = async (stopId, success) => {
        const input = body.querySelector(`[data-stop="${stopId}"] input`);
        if (!input.value.trim()) { input.focus(); return toast(success ? 'กรุณาใส่ชื่อผู้รับ' : 'กรุณาใส่เหตุผล', 'err'); }
        await q(sb.rpc('wt_deliver_stop', success
          ? { p_stop_id: Number(stopId), p_success: true, p_pod_name: input.value.trim() }
          : { p_stop_id: Number(stopId), p_success: false, p_note: input.value.trim() }));
        toast(success ? 'บันทึกส่งสำเร็จ' : 'บันทึกส่งไม่สำเร็จ', success ? 'ok' : '');
        await refresh();
      };
      bindActions(body, { ok: id2 => pod(id2, true), fail: id2 => pod(id2, false) });
      bindActions(foot, {
        print: () => window.print(),
        dispatch: async () => { await q(sb.rpc('wt_dispatch_shipment', { p_shipment_id: s.id })); toast('ปล่อยรถแล้ว', 'ok'); await refresh(); },
        cancel: async () => {
          if (!confirm('ยกเลิกเที่ยวรถนี้? ออเดอร์จะกลับไปรอจัดรถ')) return;
          await q(sb.rpc('wt_cancel_shipment', { p_shipment_id: s.id })); toast('ยกเลิกแล้ว', 'ok'); closeModal(); await onChange?.();
        },
        gps: () => {
          if (!navigator.geolocation) return toast('อุปกรณ์ไม่รองรับ GPS', 'err');
          navigator.geolocation.getCurrentPosition(async p => {
            await q(sb.from('wt_tracking_events').insert({ shipment_id: s.id, event: 'position', lat: p.coords.latitude, lng: p.coords.longitude, note: 'อัปเดตตำแหน่งรถ' }));
            toast('บันทึกตำแหน่งแล้ว', 'ok'); await refresh();
          }, err => toast(`อ่านตำแหน่งไม่ได้: ${err.message}`, 'err'), { enableHighAccuracy: true, timeout: 10000 });
        },
      });
    },
  });
}

Pages.shipments = {
  title: 'เที่ยวรถ / จัดส่ง', group: 'TMS ขนส่ง', icon: '⛟',
  render: async (el, actions, params) => {
    let rows = [];
    actions.innerHTML = '<button class="btn" data-act="export">⇩ Excel</button>';
    bindActions(actions, { export: () => exportXlsx(`shipments-${today()}`, rows.map(r => ({ doc_no: r.doc_no, plan_date: r.plan_date,
      warehouse: r.warehouse?.code, vehicle: r.vehicle?.plate_no, driver: r.driver?.name, stops: r.stops.length,
      delivered: r.stops.filter(x => x.status === 'delivered').length, weight_kg: +r.total_weight_kg, km: +r.distance_km,
      freight_cost: +r.freight_cost, status: r.status }))) });
    el.innerHTML = `<div class="card flush"><div class="toolbar" style="padding:12px 16px">
      <select id="st"><option value="active">กำลังดำเนินการ</option><option value="">ทั้งหมด</option>
      ${['planned', 'in_transit', 'completed', 'cancelled'].map(s => `<option value="${s}">${STATUS[s][0]}</option>`).join('')}</select>
      <input type="search" id="search" placeholder="ค้นหาเลขที่ / ทะเบียน / คนขับ"></div><div id="tbl"></div></div>`;
    const load = async () => {
      rows = await q(sb.from('wt_shipments')
        .select('*, vehicle:wt_vehicles(plate_no, vehicle_type), driver:wt_drivers(name), warehouse:wt_warehouses(code), stops:wt_shipment_stops(status)')
        .order('id', { ascending: false }).limit(300));
      draw();
    };
    const draw = () => {
      const st = $('#st', el).value, term = $('#search', el).value.trim().toLowerCase();
      $('#tbl', el).innerHTML = tableHtml([
        { label: 'เลขที่', render: r => `<b>${esc(r.doc_no)}</b>` }, { label: 'วันที่', render: r => fdate(r.plan_date) },
        { label: 'คลัง', render: r => esc(r.warehouse?.code) },
        { label: 'รถ', render: r => `${esc(r.vehicle?.plate_no)} <span class="muted small">${esc(r.vehicle?.vehicle_type)}</span>` },
        { label: 'คนขับ', render: r => esc(r.driver?.name) },
        { label: 'จุดส่ง', num: true, render: r => `${r.stops.filter(x => x.status !== 'pending').length}/${r.stops.length}` },
        { label: 'kg', num: true, render: r => fmt(r.total_weight_kg) }, { label: 'km', num: true, render: r => fmt(r.distance_km) },
        { label: 'ค่าขนส่ง', num: true, render: r => fmt(r.freight_cost) }, { label: 'สถานะ', render: r => badge(r.status) },
      ], rows.filter(r => (st === 'active' ? ['planned', 'in_transit'].includes(r.status) : !st || r.status === st) &&
        (!term || `${r.doc_no} ${r.vehicle?.plate_no} ${r.driver?.name}`.toLowerCase().includes(term))),
      { actions: r => `<button class="btn sm" data-act="open" data-id="${r.id}">เปิด</button>` });
    };
    $('#st', el).onchange = draw;
    $('#search', el).oninput = draw;
    bindActions(el, { open: id => shipmentDetail(Number(id), load) });
    await load();
    if (params.get('id')) shipmentDetail(Number(params.get('id')), load);
  },
};

/* ================= TRACKING ================= */
Pages.tracking = {
  title: 'ติดตามรถ', group: 'TMS ขนส่ง', icon: '◎',
  render: async (el, actions) => {
    actions.innerHTML = `<button class="btn" data-act="reload">รีเฟรช</button>`;
    const [ships, whs] = await Promise.all([
      q(sb.from('wt_shipments').select('*, vehicle:wt_vehicles(plate_no), driver:wt_drivers(name, phone), events:wt_tracking_events(lat, lng, created_at), stops:wt_shipment_stops(seq, status, order:wt_outbound_orders(doc_no, lat, lng, customer:wt_partners(name)))')
        .eq('status', 'in_transit').order('dispatched_at')),
      q(sb.from('wt_warehouses').select('*').eq('active', true)),
    ]);
    el.innerHTML = `<div class="card"><div id="map" class="map"></div>
      <p class="muted small" style="margin:8px 0 0">● ส้ม = คลัง / รถ (ตำแหน่งล่าสุด) · ● น้ำเงิน = รอส่ง · ● เขียว = ส่งสำเร็จ · ● แดง = ไม่สำเร็จ</p></div>
      <div class="card flush"><h3>รถที่กำลังวิ่ง</h3>${tableHtml([
        { label: 'เที่ยวรถ', render: s => `<a href="#/shipments?id=${s.id}">${esc(s.doc_no)}</a>` },
        { label: 'รถ', render: s => esc(s.vehicle?.plate_no) }, { label: 'คนขับ', render: s => `${esc(s.driver?.name)} <span class="muted small">${esc(s.driver?.phone || '')}</span>` },
        { label: 'ออกเมื่อ', render: s => fdt(s.dispatched_at) },
        { label: 'ความคืบหน้า', render: s => { const done = s.stops.filter(x => x.status !== 'pending').length;
          return `<div style="min-width:120px">${capBar(done, s.stops.length, 'จุด')}</div>`; } },
      ], ships, { empty: 'ไม่มีรถที่กำลังวิ่ง' })}</div>`;
    const pts = whs.map(w => ({ lat: w.lat, lng: w.lng, label: w.name, kind: 'wh', color: '#d97a1e' }));
    for (const s of ships) {
      s.stops.forEach(st => pts.push({ lat: st.order.lat, lng: st.order.lng, color: STOP_COLOR[st.status], label: `${s.doc_no} #${st.seq} ${st.order.customer?.name}` }));
      const last = s.events.filter(e => e.lat != null).sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      if (last) pts.push({ lat: last.lat, lng: last.lng, kind: 'wh', color: '#d97a1e', label: `🚚 ${s.vehicle?.plate_no}`, permanent: true });
    }
    makeMap($('#map', el), pts, { route: false });
    bindActions(actions, { reload: () => Pages.tracking.render(el, actions) });
  },
};

/* ================= REPORTS ================= */
Pages.reports = {
  title: 'รายงานขนส่ง', group: 'TMS ขนส่ง', icon: '▤',
  render: async (el, actions) => {
    let byVehicle = [], byDriver = [];
    actions.innerHTML = '<button class="btn" data-act="export">⇩ Excel</button>';
    bindActions(actions, { export: async () => {
      await loadLib('xlsx');
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(byVehicle), 'by-vehicle');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(byDriver), 'by-driver');
      XLSX.writeFile(wb, `transport-report-${$('#from', el).value}_${$('#to', el).value}.xlsx`);
    } });
    const d = new Date(), first = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
    el.innerHTML = `<div class="card"><div class="toolbar"><label>ตั้งแต่<input type="date" id="from" value="${first}"></label>
      <label>ถึง<input type="date" id="to" value="${today()}"></label></div></div><div id="out" style="display:grid;gap:18px"></div>`;
    const run = async () => {
      const ships = await q(sb.from('wt_shipments')
        .select('*, vehicle:wt_vehicles(plate_no, vehicle_type), driver:wt_drivers(name), stops:wt_shipment_stops(status, delivered_at, order:wt_outbound_orders(required_date))')
        .neq('status', 'cancelled').gte('plan_date', $('#from', el).value).lte('plan_date', $('#to', el).value));
      const stops = ships.flatMap(s => s.stops);
      const done = stops.filter(s => s.status !== 'pending');
      const ok = stops.filter(s => s.status === 'delivered');
      const onTime = ok.filter(s => !s.order?.required_date || s.delivered_at.slice(0, 10) <= s.order.required_date);
      const km = ships.reduce((a, s) => a + +s.distance_km, 0), cost = ships.reduce((a, s) => a + +s.freight_cost, 0);
      const pct = (a, b) => b ? `${Math.round(a / b * 100)}%` : '-';
      const group = key => Object.values(ships.reduce((m, s) => {
        const k = key(s); m[k] ??= { name: k, trips: 0, drops: 0, ok: 0, km: 0, cost: 0, kg: 0 };
        const g = m[k]; g.trips++; g.drops += s.stops.length; g.ok += s.stops.filter(x => x.status === 'delivered').length;
        g.km += +s.distance_km; g.cost += +s.freight_cost; g.kg += +s.total_weight_kg; return m;
      }, {})).sort((a, b) => b.trips - a.trips);
      const gcols = label => [
        { label, key: 'name' }, { label: 'เที่ยว', num: true, key: 'trips' }, { label: 'จุดส่ง', num: true, key: 'drops' },
        { label: 'สำเร็จ', num: true, render: g => pct(g.ok, g.drops) }, { label: 'น้ำหนัก (kg)', num: true, render: g => fmt(g.kg, 0) },
        { label: 'km', num: true, render: g => fmt(g.km, 0) }, { label: 'ค่าขนส่ง', num: true, render: g => fmt(g.cost) },
      ];
      byVehicle = group(s => s.vehicle?.plate_no || '-');
      byDriver = group(s => s.driver?.name || '-');
      const kpi = (l, v) => `<div class="kpi"><div class="label">${l}</div><div class="value">${v}</div></div>`;
      $('#out', el).innerHTML = `<div class="kpis">
          ${kpi('เที่ยวรถ', fmt(ships.length, 0))}${kpi('จุดส่งทั้งหมด', fmt(stops.length, 0))}
          ${kpi('ส่งสำเร็จ', pct(ok.length, done.length))}${kpi('ส่งตรงเวลา (OTD)', pct(onTime.length, ok.length))}
          ${kpi('ระยะทางรวม (km)', fmt(km, 0))}${kpi('ค่าขนส่งรวม (฿)', fmt(cost, 0))}
          ${kpi('ต้นทุน/จุดส่ง (฿)', stops.length ? fmt(cost / stops.length, 0) : '-')}${kpi('ต้นทุน/km (฿)', km ? fmt(cost / km) : '-')}</div>
        <div class="grid-2"><div class="card flush"><h3>ตามรถ</h3>${tableHtml(gcols('ทะเบียนรถ'), byVehicle)}</div>
        <div class="card flush"><h3>ตามพนักงานขับรถ</h3>${tableHtml(gcols('พนักงานขับรถ'), byDriver)}</div></div>`;
    };
    $('#from', el).onchange = run;
    $('#to', el).onchange = run;
    await run();
  },
};

/* ================= VEHICLES / DRIVERS ================= */
Pages.vehicles = {
  title: 'รถขนส่ง', group: 'TMS ขนส่ง', icon: '⛍',
  render: crudPage({
    table: 'wt_vehicles', noun: 'รถ', order: 'plate_no', searchKeys: ['plate_no', 'vehicle_type', 'carrier_name'],
    writeRoles: ['transport'], importKey: 'plate_no',
    cols: [
      { label: 'ทะเบียน', render: r => `<b>${esc(r.plate_no)}</b>` }, { label: 'ประเภท', key: 'vehicle_type' },
      { label: 'ความจุ (kg)', num: true, render: r => fmt(r.capacity_kg, 0) }, { label: 'ความจุ (cbm)', num: true, render: r => fmt(r.capacity_cbm) },
      { label: '฿/km', num: true, render: r => fmt(r.cost_per_km) },
      { label: 'กรรมสิทธิ์', render: r => `${badge(r.ownership)} ${esc(r.carrier_name || '')}` }, { label: 'สถานะ', render: r => badge(r.status) },
    ],
    fields: [
      { name: 'plate_no', label: 'ทะเบียนรถ', required: true },
      { name: 'vehicle_type', label: 'ประเภทรถ', type: 'select', required: true, default: '4W',
        options: opts({ '4W': '4 ล้อ', '4WJ': '4 ล้อจัมโบ้', '6W': '6 ล้อ', '10W': '10 ล้อ', TRAILER: 'รถพ่วง/เทรลเลอร์', MC: 'มอเตอร์ไซค์' }) },
      { name: 'capacity_kg', label: 'รับน้ำหนักได้ (kg)', type: 'number', default: 0 },
      { name: 'capacity_cbm', label: 'ปริมาตรบรรทุก (cbm)', type: 'number', default: 0 },
      { name: 'cost_per_km', label: 'ค่าขนส่ง (฿/km)', type: 'number', default: 0 },
      { name: 'status', label: 'สถานะ', type: 'select', required: true, default: 'available',
        options: opts({ available: 'ว่าง', on_trip: 'ออกวิ่ง', maintenance: 'ซ่อมบำรุง', inactive: 'ไม่ใช้งาน' }) },
      { name: 'ownership', label: 'กรรมสิทธิ์', type: 'select', required: true, default: 'own', options: opts({ own: 'รถบริษัท', subcontract: 'รถร่วม' }) },
      { name: 'carrier_name', label: 'ชื่อผู้รับจ้างขนส่ง (รถร่วม)' },
      { name: 'odometer_km', label: 'เลขไมล์ปัจจุบัน (km)', type: 'number', default: 0 },
      { name: 'next_service_km', label: 'เข้าศูนย์ครั้งถัดไปที่ (km)', type: 'number' },
      { name: 'next_service_date', label: 'เข้าศูนย์ครั้งถัดไป (วันที่)', type: 'date' },
      { name: 'tax_expiry', label: 'ภาษีรถหมดอายุ', type: 'date' },
      { name: 'insurance_expiry', label: 'ประกันหมดอายุ', type: 'date' },
    ],
  }),
};

Pages.drivers = {
  title: 'พนักงานขับรถ', group: 'TMS ขนส่ง', icon: '☻',
  render: crudPage({
    table: 'wt_drivers', noun: 'พนักงานขับรถ', order: 'code', searchKeys: ['code', 'name', 'phone', 'license_no'],
    writeRoles: ['transport'], importKey: 'code',
    cols: [
      { label: 'รหัส', render: r => `<b>${esc(r.code)}</b>` }, { label: 'ชื่อ', key: 'name' }, { label: 'โทร', key: 'phone' },
      { label: 'ใบขับขี่', key: 'license_no' }, { label: 'หมดอายุ', render: r => expiryBadge(r.license_expiry) },
      { label: 'สถานะ', render: r => badge(r.status) },
    ],
    fields: [
      { name: 'code', label: 'รหัส', required: true }, { name: 'name', label: 'ชื่อ-นามสกุล', required: true },
      { name: 'phone', label: 'โทรศัพท์' }, { name: 'license_no', label: 'เลขที่ใบขับขี่' },
      { name: 'license_expiry', label: 'ใบขับขี่หมดอายุ', type: 'date' },
      { name: 'status', label: 'สถานะ', type: 'select', required: true, default: 'available',
        options: opts({ available: 'ว่าง', on_trip: 'ออกวิ่ง', off: 'หยุด', inactive: 'ไม่ใช้งาน' }) },
    ],
  }),
};
