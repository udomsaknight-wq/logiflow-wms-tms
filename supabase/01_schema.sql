-- =====================================================================
-- WMS + TMS (prefix wt_) : schema, business functions, RLS
-- =====================================================================

-- ---------- Document number sequences ----------
create sequence if not exists public.wt_seq_inbound;
create sequence if not exists public.wt_seq_outbound;
create sequence if not exists public.wt_seq_shipment;

-- ---------- MASTER DATA ----------
create table public.wt_warehouses (
  id bigint generated always as identity primary key,
  code text not null unique,
  name text not null,
  address text,
  lat double precision,
  lng double precision,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.wt_locations (
  id bigint generated always as identity primary key,
  warehouse_id bigint not null references public.wt_warehouses(id) on delete cascade,
  code text not null,
  zone text,
  loc_type text not null default 'storage'
    check (loc_type in ('receiving','storage','picking','staging','shipping')),
  max_qty numeric,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (warehouse_id, code)
);
create index on public.wt_locations (warehouse_id);

create table public.wt_products (
  id bigint generated always as identity primary key,
  sku text not null unique,
  name text not null,
  barcode text,
  category text,
  uom text not null default 'EA',
  weight_kg numeric not null default 0,
  volume_cbm numeric not null default 0,
  min_stock numeric not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.wt_partners (
  id bigint generated always as identity primary key,
  code text not null unique,
  name text not null,
  partner_type text not null default 'customer'
    check (partner_type in ('customer','supplier','both')),
  contact text,
  phone text,
  address text,
  lat double precision,
  lng double precision,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------- INVENTORY ----------
create table public.wt_inventory (
  id bigint generated always as identity primary key,
  product_id bigint not null references public.wt_products(id),
  location_id bigint not null references public.wt_locations(id),
  lot_no text not null default '',
  expiry_date date,
  qty numeric not null default 0 check (qty >= 0),
  updated_at timestamptz not null default now(),
  unique (product_id, location_id, lot_no)
);
create index on public.wt_inventory (location_id);

create table public.wt_stock_movements (
  id bigint generated always as identity primary key,
  product_id bigint not null references public.wt_products(id),
  from_location_id bigint references public.wt_locations(id),
  to_location_id bigint references public.wt_locations(id),
  lot_no text not null default '',
  qty numeric not null,
  move_type text not null
    check (move_type in ('receive','transfer','pick','adjust','return')),
  ref_doc text,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.wt_stock_movements (product_id);
create index on public.wt_stock_movements (from_location_id);
create index on public.wt_stock_movements (to_location_id);
create index on public.wt_stock_movements (created_at desc);

-- ---------- INBOUND ----------
create table public.wt_inbound_orders (
  id bigint generated always as identity primary key,
  doc_no text not null unique default
    ('IB' || to_char(now(),'YYMM') || '-' || lpad(nextval('public.wt_seq_inbound')::text, 5, '0')),
  supplier_id bigint references public.wt_partners(id),
  warehouse_id bigint not null references public.wt_warehouses(id),
  ref_no text,
  expected_date date,
  status text not null default 'open'
    check (status in ('open','receiving','completed','cancelled')),
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index on public.wt_inbound_orders (supplier_id);
create index on public.wt_inbound_orders (warehouse_id);

create table public.wt_inbound_lines (
  id bigint generated always as identity primary key,
  inbound_id bigint not null references public.wt_inbound_orders(id) on delete cascade,
  product_id bigint not null references public.wt_products(id),
  qty_expected numeric not null check (qty_expected > 0),
  qty_received numeric not null default 0
);
create index on public.wt_inbound_lines (inbound_id);
create index on public.wt_inbound_lines (product_id);

-- ---------- OUTBOUND ----------
create table public.wt_outbound_orders (
  id bigint generated always as identity primary key,
  doc_no text not null unique default
    ('OB' || to_char(now(),'YYMM') || '-' || lpad(nextval('public.wt_seq_outbound')::text, 5, '0')),
  customer_id bigint not null references public.wt_partners(id),
  warehouse_id bigint not null references public.wt_warehouses(id),
  ref_no text,
  required_date date,
  ship_address text,
  lat double precision,
  lng double precision,
  priority smallint not null default 3 check (priority between 1 and 5),
  status text not null default 'open'
    check (status in ('open','picked','planned','shipped','delivered','failed','cancelled')),
  total_weight_kg numeric not null default 0,
  total_volume_cbm numeric not null default 0,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  picked_at timestamptz,
  delivered_at timestamptz
);
create index on public.wt_outbound_orders (customer_id);
create index on public.wt_outbound_orders (warehouse_id);
create index on public.wt_outbound_orders (status);

create table public.wt_outbound_lines (
  id bigint generated always as identity primary key,
  outbound_id bigint not null references public.wt_outbound_orders(id) on delete cascade,
  product_id bigint not null references public.wt_products(id),
  qty_ordered numeric not null check (qty_ordered > 0),
  qty_picked numeric not null default 0
);
create index on public.wt_outbound_lines (outbound_id);
create index on public.wt_outbound_lines (product_id);

-- ---------- TMS ----------
create table public.wt_vehicles (
  id bigint generated always as identity primary key,
  plate_no text not null unique,
  vehicle_type text not null default '4W',
  capacity_kg numeric not null default 0,
  capacity_cbm numeric not null default 0,
  cost_per_km numeric not null default 0,
  ownership text not null default 'own' check (ownership in ('own','subcontract')),
  carrier_name text,
  status text not null default 'available'
    check (status in ('available','on_trip','maintenance','inactive')),
  created_at timestamptz not null default now()
);

create table public.wt_drivers (
  id bigint generated always as identity primary key,
  code text not null unique,
  name text not null,
  phone text,
  license_no text,
  license_expiry date,
  status text not null default 'available'
    check (status in ('available','on_trip','off','inactive')),
  created_at timestamptz not null default now()
);

create table public.wt_shipments (
  id bigint generated always as identity primary key,
  doc_no text not null unique default
    ('SH' || to_char(now(),'YYMM') || '-' || lpad(nextval('public.wt_seq_shipment')::text, 5, '0')),
  warehouse_id bigint not null references public.wt_warehouses(id),
  vehicle_id bigint not null references public.wt_vehicles(id),
  driver_id bigint not null references public.wt_drivers(id),
  plan_date date not null default current_date,
  status text not null default 'planned'
    check (status in ('planned','in_transit','completed','cancelled')),
  total_weight_kg numeric not null default 0,
  total_volume_cbm numeric not null default 0,
  distance_km numeric not null default 0,
  freight_cost numeric not null default 0,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  dispatched_at timestamptz,
  completed_at timestamptz
);
create index on public.wt_shipments (warehouse_id);
create index on public.wt_shipments (vehicle_id);
create index on public.wt_shipments (driver_id);

create table public.wt_shipment_stops (
  id bigint generated always as identity primary key,
  shipment_id bigint not null references public.wt_shipments(id) on delete cascade,
  seq int not null,
  outbound_id bigint not null references public.wt_outbound_orders(id),
  status text not null default 'pending' check (status in ('pending','delivered','failed')),
  pod_name text,
  pod_note text,
  delivered_at timestamptz,
  unique (shipment_id, outbound_id)
);
create index on public.wt_shipment_stops (outbound_id);

create table public.wt_tracking_events (
  id bigint generated always as identity primary key,
  shipment_id bigint not null references public.wt_shipments(id) on delete cascade,
  event text not null,
  lat double precision,
  lng double precision,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.wt_tracking_events (shipment_id);

-- ---------- VIEWS ----------
create view public.wt_v_stock with (security_invoker = true) as
select p.id as product_id, p.sku, p.name, p.uom, p.min_stock,
       coalesce(sum(i.qty), 0) as on_hand,
       coalesce(sum(i.qty), 0) < p.min_stock as below_min
from public.wt_products p
left join public.wt_inventory i on i.product_id = p.id
where p.active
group by p.id;

create view public.wt_v_dashboard with (security_invoker = true) as
select
  (select count(*) from public.wt_products where active) as products,
  (select coalesce(sum(qty),0) from public.wt_inventory) as total_units,
  (select count(*) from public.wt_v_stock where below_min) as low_stock,
  (select count(*) from public.wt_inbound_orders where status in ('open','receiving')) as inbound_open,
  (select count(*) from public.wt_outbound_orders where status = 'open') as outbound_open,
  (select count(*) from public.wt_outbound_orders where status = 'picked') as outbound_picked,
  (select count(*) from public.wt_shipments where status = 'planned') as shipments_planned,
  (select count(*) from public.wt_shipments where status = 'in_transit') as shipments_in_transit,
  (select count(*) from public.wt_outbound_orders where status = 'delivered' and delivered_at::date = current_date) as delivered_today,
  (select count(*) from public.wt_vehicles where status = 'available') as vehicles_available;

-- =====================================================================
-- BUSINESS FUNCTIONS (security invoker: RLS still applies)
-- =====================================================================

-- Receive goods against an inbound line into a location
create or replace function public.wt_receive(
  p_line_id bigint, p_qty numeric, p_location_id bigint,
  p_lot text default '', p_expiry date default null)
returns void language plpgsql set search_path = public as $$
declare l record; h record; v_wh bigint;
begin
  if p_qty is null or p_qty <= 0 then raise exception 'จำนวนต้องมากกว่า 0'; end if;
  select * into l from wt_inbound_lines where id = p_line_id for update;
  if not found then raise exception 'ไม่พบรายการรับสินค้า'; end if;
  select * into h from wt_inbound_orders where id = l.inbound_id for update;
  if h.status in ('completed','cancelled') then
    raise exception 'เอกสาร % ปิดแล้ว', h.doc_no;
  end if;
  select warehouse_id into v_wh from wt_locations where id = p_location_id;
  if v_wh is distinct from h.warehouse_id then
    raise exception 'Location ไม่อยู่ในคลังของเอกสารนี้';
  end if;

  insert into wt_inventory (product_id, location_id, lot_no, expiry_date, qty)
  values (l.product_id, p_location_id, coalesce(p_lot,''), p_expiry, p_qty)
  on conflict (product_id, location_id, lot_no) do update
    set qty = wt_inventory.qty + excluded.qty,
        expiry_date = coalesce(excluded.expiry_date, wt_inventory.expiry_date),
        updated_at = now();

  insert into wt_stock_movements (product_id, to_location_id, lot_no, qty, move_type, ref_doc)
  values (l.product_id, p_location_id, coalesce(p_lot,''), p_qty, 'receive', h.doc_no);

  update wt_inbound_lines set qty_received = qty_received + p_qty where id = p_line_id;
  update wt_inbound_orders set status = 'receiving' where id = h.id and status = 'open';
end $$;

create or replace function public.wt_close_inbound(p_inbound_id bigint)
returns void language plpgsql set search_path = public as $$
begin
  update wt_inbound_orders set status = 'completed', completed_at = now()
  where id = p_inbound_id and status in ('open','receiving');
  if not found then raise exception 'ปิดเอกสารไม่ได้ (สถานะไม่ถูกต้อง)'; end if;
end $$;

-- Move stock between locations
create or replace function public.wt_transfer(
  p_inventory_id bigint, p_to_location_id bigint, p_qty numeric, p_note text default null)
returns void language plpgsql set search_path = public as $$
declare i record;
begin
  select * into i from wt_inventory where id = p_inventory_id for update;
  if not found then raise exception 'ไม่พบสต็อก'; end if;
  if p_qty is null or p_qty <= 0 or p_qty > i.qty then
    raise exception 'จำนวนย้ายไม่ถูกต้อง (คงเหลือ %)', i.qty;
  end if;
  if p_to_location_id = i.location_id then raise exception 'Location ปลายทางต้องต่างจากต้นทาง'; end if;

  update wt_inventory set qty = qty - p_qty, updated_at = now() where id = i.id;
  insert into wt_inventory (product_id, location_id, lot_no, expiry_date, qty)
  values (i.product_id, p_to_location_id, i.lot_no, i.expiry_date, p_qty)
  on conflict (product_id, location_id, lot_no) do update
    set qty = wt_inventory.qty + excluded.qty, updated_at = now();
  insert into wt_stock_movements (product_id, from_location_id, to_location_id, lot_no, qty, move_type, note)
  values (i.product_id, i.location_id, p_to_location_id, i.lot_no, p_qty, 'transfer', p_note);
  delete from wt_inventory where id = i.id and qty = 0;
end $$;

-- Adjust stock (+/-) e.g. cycle count
create or replace function public.wt_adjust(
  p_product_id bigint, p_location_id bigint, p_delta numeric,
  p_lot text default '', p_expiry date default null, p_note text default null)
returns void language plpgsql set search_path = public as $$
declare v_qty numeric;
begin
  if p_delta is null or p_delta = 0 then raise exception 'จำนวนปรับต้องไม่เป็น 0'; end if;
  select qty into v_qty from wt_inventory
   where product_id = p_product_id and location_id = p_location_id and lot_no = coalesce(p_lot,'')
   for update;
  if coalesce(v_qty,0) + p_delta < 0 then
    raise exception 'ปรับแล้วสต็อกติดลบ (คงเหลือ %)', coalesce(v_qty,0);
  end if;
  insert into wt_inventory (product_id, location_id, lot_no, expiry_date, qty)
  values (p_product_id, p_location_id, coalesce(p_lot,''), p_expiry, p_delta)
  on conflict (product_id, location_id, lot_no) do update
    set qty = wt_inventory.qty + p_delta,
        expiry_date = coalesce(excluded.expiry_date, wt_inventory.expiry_date),
        updated_at = now();
  insert into wt_stock_movements (product_id,
     from_location_id, to_location_id, lot_no, qty, move_type, note)
  values (p_product_id,
     case when p_delta < 0 then p_location_id end,
     case when p_delta > 0 then p_location_id end,
     coalesce(p_lot,''), p_delta, 'adjust', p_note);
  delete from wt_inventory
   where product_id = p_product_id and location_id = p_location_id
     and lot_no = coalesce(p_lot,'') and qty = 0;
end $$;

-- Pick an outbound order using FEFO (first-expiry-first-out), all-or-nothing
create or replace function public.wt_pick(p_outbound_id bigint)
returns void language plpgsql set search_path = public as $$
declare h record; ln record; inv record; v_need numeric; v_take numeric;
begin
  select * into h from wt_outbound_orders where id = p_outbound_id for update;
  if not found then raise exception 'ไม่พบเอกสาร'; end if;
  if h.status <> 'open' then raise exception 'เอกสาร % ไม่อยู่ในสถานะ open', h.doc_no; end if;
  if not exists (select 1 from wt_outbound_lines where outbound_id = h.id) then
    raise exception 'เอกสารไม่มีรายการสินค้า';
  end if;

  for ln in select * from wt_outbound_lines where outbound_id = h.id order by id loop
    v_need := ln.qty_ordered - ln.qty_picked;
    for inv in
      select i.* from wt_inventory i
      join wt_locations l on l.id = i.location_id
      where i.product_id = ln.product_id and l.warehouse_id = h.warehouse_id
        and l.active and i.qty > 0
      order by i.expiry_date nulls last, i.id
      for update of i
    loop
      exit when v_need <= 0;
      v_take := least(v_need, inv.qty);
      update wt_inventory set qty = qty - v_take, updated_at = now() where id = inv.id;
      insert into wt_stock_movements (product_id, from_location_id, lot_no, qty, move_type, ref_doc)
      values (ln.product_id, inv.location_id, inv.lot_no, v_take, 'pick', h.doc_no);
      v_need := v_need - v_take;
    end loop;
    if v_need > 0 then
      raise exception 'สต็อก % ไม่พอ ขาดอีก %',
        (select sku from wt_products where id = ln.product_id), v_need;
    end if;
    update wt_outbound_lines set qty_picked = qty_ordered where id = ln.id;
  end loop;

  delete from wt_inventory where qty = 0;

  update wt_outbound_orders o set
    status = 'picked', picked_at = now(),
    total_weight_kg = t.w, total_volume_cbm = t.v
  from (select coalesce(sum(ol.qty_ordered * p.weight_kg),0) w,
               coalesce(sum(ol.qty_ordered * p.volume_cbm),0) v
          from wt_outbound_lines ol join wt_products p on p.id = ol.product_id
         where ol.outbound_id = h.id) t
  where o.id = h.id;
end $$;

-- Plan a shipment (load) from picked orders
create or replace function public.wt_create_shipment(
  p_vehicle_id bigint, p_driver_id bigint, p_outbound_ids bigint[],
  p_plan_date date default current_date, p_distance_km numeric default 0,
  p_note text default null)
returns bigint language plpgsql set search_path = public as $$
declare v record; d record; v_wh bigint; v_cnt int; v_whcnt int; v_w numeric; v_v numeric; v_id bigint;
begin
  if p_outbound_ids is null or cardinality(p_outbound_ids) = 0 then
    raise exception 'กรุณาเลือกออเดอร์อย่างน้อย 1 รายการ';
  end if;
  select * into v from wt_vehicles where id = p_vehicle_id;
  if not found or v.status in ('maintenance','inactive') then raise exception 'รถไม่พร้อมใช้งาน'; end if;
  select * into d from wt_drivers where id = p_driver_id;
  if not found or d.status in ('off','inactive') then raise exception 'พนักงานขับรถไม่พร้อม'; end if;
  if d.license_expiry is not null and d.license_expiry < p_plan_date then
    raise exception 'ใบขับขี่ของ % หมดอายุ', d.name;
  end if;

  perform 1 from wt_outbound_orders where id = any(p_outbound_ids) for update;
  select count(*), min(warehouse_id), count(distinct warehouse_id),
         sum(total_weight_kg), sum(total_volume_cbm)
    into v_cnt, v_wh, v_whcnt, v_w, v_v
    from wt_outbound_orders
   where id = any(p_outbound_ids) and status in ('picked','failed');
  if v_cnt <> cardinality(p_outbound_ids) then
    raise exception 'มีออเดอร์ที่ยังไม่ได้ Pick หรือถูกจัดรถไปแล้ว';
  end if;
  if v_whcnt > 1 then raise exception 'ออเดอร์ต้องมาจากคลังเดียวกัน'; end if;
  if v.capacity_kg > 0 and v_w > v.capacity_kg then
    raise exception 'น้ำหนักเกิน: % kg > ความจุ % kg', round(v_w,2), v.capacity_kg;
  end if;
  if v.capacity_cbm > 0 and v_v > v.capacity_cbm then
    raise exception 'ปริมาตรเกิน: % cbm > ความจุ % cbm', round(v_v,3), v.capacity_cbm;
  end if;

  insert into wt_shipments (warehouse_id, vehicle_id, driver_id, plan_date,
     total_weight_kg, total_volume_cbm, distance_km, freight_cost, note)
  values (v_wh, p_vehicle_id, p_driver_id, coalesce(p_plan_date, current_date),
     v_w, v_v, coalesce(p_distance_km,0), round(coalesce(p_distance_km,0) * v.cost_per_km, 2), p_note)
  returning id into v_id;

  insert into wt_shipment_stops (shipment_id, seq, outbound_id)
  select v_id, t.ord, t.oid from unnest(p_outbound_ids) with ordinality as t(oid, ord);

  update wt_outbound_orders set status = 'planned' where id = any(p_outbound_ids);
  return v_id;
end $$;

create or replace function public.wt_cancel_shipment(p_shipment_id bigint)
returns void language plpgsql set search_path = public as $$
begin
  update wt_shipments set status = 'cancelled' where id = p_shipment_id and status = 'planned';
  if not found then raise exception 'ยกเลิกได้เฉพาะสถานะ planned'; end if;
  update wt_outbound_orders set status = 'picked'
   where id in (select outbound_id from wt_shipment_stops where shipment_id = p_shipment_id);
  delete from wt_shipment_stops where shipment_id = p_shipment_id;
end $$;

create or replace function public.wt_dispatch_shipment(p_shipment_id bigint)
returns void language plpgsql set search_path = public as $$
declare s record; w record;
begin
  select * into s from wt_shipments where id = p_shipment_id for update;
  if not found or s.status <> 'planned' then raise exception 'ปล่อยรถได้เฉพาะสถานะ planned'; end if;
  if exists (select 1 from wt_vehicles where id = s.vehicle_id and status = 'on_trip') then
    raise exception 'รถคันนี้กำลังวิ่งงานอื่นอยู่';
  end if;
  if exists (select 1 from wt_drivers where id = s.driver_id and status = 'on_trip') then
    raise exception 'พนักงานขับรถกำลังวิ่งงานอื่นอยู่';
  end if;
  select * into w from wt_warehouses where id = s.warehouse_id;
  update wt_shipments set status = 'in_transit', dispatched_at = now() where id = s.id;
  update wt_vehicles set status = 'on_trip' where id = s.vehicle_id;
  update wt_drivers set status = 'on_trip' where id = s.driver_id;
  update wt_outbound_orders set status = 'shipped'
   where id in (select outbound_id from wt_shipment_stops where shipment_id = s.id);
  insert into wt_tracking_events (shipment_id, event, lat, lng, note)
  values (s.id, 'dispatched', w.lat, w.lng, 'ออกจากคลัง ' || w.name);
end $$;

-- Record proof of delivery for a stop; auto-complete shipment when all stops done
create or replace function public.wt_deliver_stop(
  p_stop_id bigint, p_success boolean, p_pod_name text default null, p_note text default null)
returns void language plpgsql set search_path = public as $$
declare st record; s record; o record;
begin
  select * into st from wt_shipment_stops where id = p_stop_id for update;
  if not found then raise exception 'ไม่พบจุดส่ง'; end if;
  select * into s from wt_shipments where id = st.shipment_id for update;
  if s.status <> 'in_transit' then raise exception 'เที่ยวรถยังไม่ได้ปล่อยรถ หรือปิดงานแล้ว'; end if;
  if st.status <> 'pending' then raise exception 'จุดส่งนี้บันทึกผลแล้ว'; end if;

  update wt_shipment_stops set
    status = case when p_success then 'delivered' else 'failed' end,
    pod_name = p_pod_name, pod_note = p_note, delivered_at = now()
  where id = st.id;

  update wt_outbound_orders set
    status = case when p_success then 'delivered' else 'failed' end,
    delivered_at = case when p_success then now() end
  where id = st.outbound_id
  returning * into o;

  insert into wt_tracking_events (shipment_id, event, lat, lng, note)
  values (s.id, case when p_success then 'delivered' else 'failed' end,
          o.lat, o.lng, o.doc_no || coalesce(' : ' || p_note, ''));

  if not exists (select 1 from wt_shipment_stops where shipment_id = s.id and status = 'pending') then
    update wt_shipments set status = 'completed', completed_at = now() where id = s.id;
    update wt_vehicles set status = 'available' where id = s.vehicle_id and status = 'on_trip';
    update wt_drivers set status = 'available' where id = s.driver_id and status = 'on_trip';
    insert into wt_tracking_events (shipment_id, event, note) values (s.id, 'completed', 'ปิดเที่ยวรถ');
  end if;
end $$;

-- =====================================================================
-- SECURITY: RLS = signed-in staff only. anon has no access.
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['wt_warehouses','wt_locations','wt_products','wt_partners',
    'wt_inventory','wt_stock_movements','wt_inbound_orders','wt_inbound_lines',
    'wt_outbound_orders','wt_outbound_lines','wt_vehicles','wt_drivers',
    'wt_shipments','wt_shipment_stops','wt_tracking_events']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('create policy "staff full access" on public.%I for all to authenticated using (auth.uid() is not null) with check (auth.uid() is not null)', t);
  end loop;
end $$;

revoke all on public.wt_v_stock, public.wt_v_dashboard from anon;
grant select on public.wt_v_stock, public.wt_v_dashboard to authenticated;
grant usage on sequence public.wt_seq_inbound, public.wt_seq_outbound, public.wt_seq_shipment to authenticated;

revoke execute on function
  public.wt_receive(bigint,numeric,bigint,text,date),
  public.wt_close_inbound(bigint),
  public.wt_transfer(bigint,bigint,numeric,text),
  public.wt_adjust(bigint,bigint,numeric,text,date,text),
  public.wt_pick(bigint),
  public.wt_create_shipment(bigint,bigint,bigint[],date,numeric,text),
  public.wt_cancel_shipment(bigint),
  public.wt_dispatch_shipment(bigint),
  public.wt_deliver_stop(bigint,boolean,text,text)
from public, anon;
grant execute on function
  public.wt_receive(bigint,numeric,bigint,text,date),
  public.wt_close_inbound(bigint),
  public.wt_transfer(bigint,bigint,numeric,text),
  public.wt_adjust(bigint,bigint,numeric,text,date,text),
  public.wt_pick(bigint),
  public.wt_create_shipment(bigint,bigint,bigint[],date,numeric,text),
  public.wt_cancel_shipment(bigint),
  public.wt_dispatch_shipment(bigint),
  public.wt_deliver_stop(bigint,boolean,text,text)
to authenticated;
