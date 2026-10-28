-- =====================================================================
-- v2: roles, role-based RLS, driver POD (photo/signature), fleet (fuel /
-- maintenance), freight billing, cycle count, alerts, realtime
-- =====================================================================

-- ---------- ROLES ----------
create table public.wt_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'pending'
    check (role in ('admin','warehouse','transport','driver','viewer','pending')),
  driver_id bigint references public.wt_drivers(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.wt_profiles (driver_id);

create or replace function public.wt_role() returns text
language sql stable security definer set search_path = public as $$
  select role from wt_profiles where user_id = auth.uid() and active and role <> 'pending'
$$;
create or replace function public.wt_my_driver() returns bigint
language sql stable security definer set search_path = public as $$
  select driver_id from wt_profiles where user_id = auth.uid() and active and role = 'driver'
$$;
create or replace function public.wt_is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(wt_role() in ('admin','warehouse','transport','viewer'), false)
$$;
-- admin always passes
create or replace function public.wt_has_role(variadic p_roles text[]) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(wt_role() = 'admin' or wt_role() = any(p_roles), false)
$$;
create or replace function public.wt_require(variadic p_roles text[]) returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not wt_has_role(variadic p_roles) then
    raise exception 'ไม่มีสิทธิ์ทำรายการนี้ (สิทธิ์ของคุณ: %)', coalesce(wt_role(), 'ยังไม่ได้รับอนุมัติ');
  end if;
end $$;

-- Returns (and on first call creates) the caller's profile. First user ever becomes admin.
create or replace function public.wt_me() returns public.wt_profiles
language plpgsql security definer set search_path = public as $$
declare p wt_profiles;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into p from wt_profiles where user_id = auth.uid();
  if not found then
    insert into wt_profiles (user_id, email, role)
    select auth.uid(), u.email,
           case when exists (select 1 from wt_profiles where role = 'admin') then 'pending' else 'admin' end
    from auth.users u where u.id = auth.uid()
    returning * into p;
  end if;
  return p;
end $$;

-- ---------- FLEET ----------
alter table public.wt_vehicles
  add column odometer_km numeric not null default 0,
  add column tax_expiry date,
  add column insurance_expiry date,
  add column next_service_km numeric,
  add column next_service_date date;

create table public.wt_fuel_logs (
  id bigint generated always as identity primary key,
  vehicle_id bigint not null references public.wt_vehicles(id) on delete cascade,
  driver_id bigint references public.wt_drivers(id) on delete set null,
  fill_date date not null default current_date,
  odometer_km numeric,
  liters numeric not null check (liters > 0),
  amount numeric not null default 0,
  station text,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.wt_fuel_logs (vehicle_id);
create index on public.wt_fuel_logs (driver_id);

create table public.wt_maintenance (
  id bigint generated always as identity primary key,
  vehicle_id bigint not null references public.wt_vehicles(id) on delete cascade,
  service_date date not null default current_date,
  odometer_km numeric,
  service_type text not null default 'service'
    check (service_type in ('service','repair','tire','inspection','other')),
  description text,
  cost numeric not null default 0,
  vendor text,
  next_service_km numeric,
  next_service_date date,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.wt_maintenance (vehicle_id);

create or replace function public.wt_fleet_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update wt_vehicles set odometer_km = greatest(odometer_km, coalesce(new.odometer_km, 0)) where id = new.vehicle_id;
  if tg_table_name = 'wt_maintenance' then
    update wt_vehicles set
      next_service_km = coalesce(new.next_service_km, next_service_km),
      next_service_date = coalesce(new.next_service_date, next_service_date)
    where id = new.vehicle_id;
  end if;
  return new;
end $$;
create trigger wt_fuel_sync after insert on public.wt_fuel_logs for each row execute function public.wt_fleet_sync();
create trigger wt_maint_sync after insert on public.wt_maintenance for each row execute function public.wt_fleet_sync();

-- ---------- BILLING ----------
create sequence if not exists public.wt_seq_invoice;
create table public.wt_freight_rates (
  id bigint generated always as identity primary key,
  name text not null,
  customer_id bigint references public.wt_partners(id) on delete cascade,  -- null = all customers
  vehicle_type text,                                                     -- null = any vehicle
  base_charge numeric not null default 0,
  per_drop numeric not null default 0,
  per_kg numeric not null default 0,
  per_km numeric not null default 0,
  min_charge numeric not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.wt_freight_rates (customer_id);

create table public.wt_invoices (
  id bigint generated always as identity primary key,
  doc_no text not null unique default
    ('INV' || to_char(now(),'YYMM') || '-' || lpad(nextval('public.wt_seq_invoice')::text, 5, '0')),
  customer_id bigint not null references public.wt_partners(id),
  period_from date not null,
  period_to date not null,
  status text not null default 'draft' check (status in ('draft','issued','paid','cancelled')),
  subtotal numeric not null default 0,
  vat_rate numeric not null default 7,
  vat numeric not null default 0,
  total numeric not null default 0,
  due_date date,
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  issued_at timestamptz,
  paid_at timestamptz
);
create index on public.wt_invoices (customer_id);

create table public.wt_invoice_lines (
  id bigint generated always as identity primary key,
  invoice_id bigint not null references public.wt_invoices(id) on delete cascade,
  outbound_id bigint not null unique references public.wt_outbound_orders(id),
  shipment_id bigint references public.wt_shipments(id),
  description text,
  weight_kg numeric,
  amount numeric not null
);
create index on public.wt_invoice_lines (invoice_id);
create index on public.wt_invoice_lines (shipment_id);

-- ---------- CYCLE COUNT ----------
create sequence if not exists public.wt_seq_count;
create table public.wt_counts (
  id bigint generated always as identity primary key,
  doc_no text not null unique default
    ('CC' || to_char(now(),'YYMM') || '-' || lpad(nextval('public.wt_seq_count')::text, 5, '0')),
  warehouse_id bigint not null references public.wt_warehouses(id),
  zone text,
  status text not null default 'open' check (status in ('open','posted','cancelled')),
  note text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  posted_at timestamptz
);
create index on public.wt_counts (warehouse_id);

create table public.wt_count_lines (
  id bigint generated always as identity primary key,
  count_id bigint not null references public.wt_counts(id) on delete cascade,
  location_id bigint not null references public.wt_locations(id),
  product_id bigint not null references public.wt_products(id),
  lot_no text not null default '',
  expiry_date date,
  system_qty numeric not null default 0,
  counted_qty numeric check (counted_qty >= 0),
  unique (count_id, location_id, product_id, lot_no)
);
create index on public.wt_count_lines (location_id);
create index on public.wt_count_lines (product_id);

-- ---------- POD ----------
alter table public.wt_shipment_stops add column pod_photo text, add column pod_signature text;

-- ---------- ALERTS ----------
create view public.wt_v_alerts with (security_invoker = true) as
select 'stock' as kind, 'warn' as level, 'สต็อกต่ำ: ' || sku || ' ' || name || ' (เหลือ ' || on_hand || ')' as message,
       '#/inventory' as link, null::date as ref_date
  from public.wt_v_stock where below_min
union all
select 'expiry', case when i.expiry_date < current_date then 'err' else 'warn' end,
       'ใกล้หมดอายุ: ' || p.sku || ' Lot ' || i.lot_no || ' @ ' || l.code, '#/inventory', i.expiry_date
  from public.wt_inventory i join public.wt_products p on p.id = i.product_id join public.wt_locations l on l.id = i.location_id
 where i.qty > 0 and i.expiry_date <= current_date + 30
union all
select 'delivery', 'err', 'ส่งไม่สำเร็จ: ' || o.doc_no || ' ' || coalesce(st.pod_note, ''), '#/planning', st.delivered_at::date
  from public.wt_shipment_stops st join public.wt_outbound_orders o on o.id = st.outbound_id
 where st.status = 'failed' and o.status = 'failed'
union all
select 'license', case when license_expiry < current_date then 'err' else 'warn' end,
       'ใบขับขี่ใกล้หมดอายุ: ' || name, '#/drivers', license_expiry
  from public.wt_drivers where status <> 'inactive' and license_expiry <= current_date + 30
union all
select 'vehicle', 'warn', 'ภาษีรถใกล้หมดอายุ: ' || plate_no, '#/fleet', tax_expiry
  from public.wt_vehicles where status <> 'inactive' and tax_expiry <= current_date + 30
union all
select 'vehicle', 'warn', 'ประกันใกล้หมดอายุ: ' || plate_no, '#/fleet', insurance_expiry
  from public.wt_vehicles where status <> 'inactive' and insurance_expiry <= current_date + 30
union all
select 'vehicle', 'warn', 'ถึงกำหนดเข้าศูนย์: ' || plate_no, '#/fleet', next_service_date
  from public.wt_vehicles
 where status <> 'inactive' and (next_service_date <= current_date + 7 or odometer_km >= next_service_km);

-- =====================================================================
-- BUSINESS FUNCTIONS -> SECURITY DEFINER with explicit role checks
-- =====================================================================
create or replace function public.wt_receive(
  p_line_id bigint, p_qty numeric, p_location_id bigint,
  p_lot text default '', p_expiry date default null)
returns void language plpgsql security definer set search_path = public as $$
declare l record; h record; v_wh bigint;
begin
  perform wt_require('warehouse');
  if p_qty is null or p_qty <= 0 then raise exception 'จำนวนต้องมากกว่า 0'; end if;
  select * into l from wt_inbound_lines where id = p_line_id for update;
  if not found then raise exception 'ไม่พบรายการรับสินค้า'; end if;
  select * into h from wt_inbound_orders where id = l.inbound_id for update;
  if h.status in ('completed','cancelled') then raise exception 'เอกสาร % ปิดแล้ว', h.doc_no; end if;
  select warehouse_id into v_wh from wt_locations where id = p_location_id;
  if v_wh is distinct from h.warehouse_id then raise exception 'Location ไม่อยู่ในคลังของเอกสารนี้'; end if;

  insert into wt_inventory (product_id, location_id, lot_no, expiry_date, qty)
  values (l.product_id, p_location_id, coalesce(p_lot,''), p_expiry, p_qty)
  on conflict (product_id, location_id, lot_no) do update
    set qty = wt_inventory.qty + excluded.qty,
        expiry_date = coalesce(excluded.expiry_date, wt_inventory.expiry_date), updated_at = now();
  insert into wt_stock_movements (product_id, to_location_id, lot_no, qty, move_type, ref_doc)
  values (l.product_id, p_location_id, coalesce(p_lot,''), p_qty, 'receive', h.doc_no);
  update wt_inbound_lines set qty_received = qty_received + p_qty where id = p_line_id;
  update wt_inbound_orders set status = 'receiving' where id = h.id and status = 'open';
end $$;

create or replace function public.wt_close_inbound(p_inbound_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform wt_require('warehouse');
  update wt_inbound_orders set status = 'completed', completed_at = now()
  where id = p_inbound_id and status in ('open','receiving');
  if not found then raise exception 'ปิดเอกสารไม่ได้ (สถานะไม่ถูกต้อง)'; end if;
end $$;

create or replace function public.wt_transfer(
  p_inventory_id bigint, p_to_location_id bigint, p_qty numeric, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare i record;
begin
  perform wt_require('warehouse');
  select * into i from wt_inventory where id = p_inventory_id for update;
  if not found then raise exception 'ไม่พบสต็อก'; end if;
  if p_qty is null or p_qty <= 0 or p_qty > i.qty then raise exception 'จำนวนย้ายไม่ถูกต้อง (คงเหลือ %)', i.qty; end if;
  if p_to_location_id = i.location_id then raise exception 'Location ปลายทางต้องต่างจากต้นทาง'; end if;
  update wt_inventory set qty = qty - p_qty, updated_at = now() where id = i.id;
  insert into wt_inventory (product_id, location_id, lot_no, expiry_date, qty)
  values (i.product_id, p_to_location_id, i.lot_no, i.expiry_date, p_qty)
  on conflict (product_id, location_id, lot_no) do update set qty = wt_inventory.qty + excluded.qty, updated_at = now();
  insert into wt_stock_movements (product_id, from_location_id, to_location_id, lot_no, qty, move_type, note)
  values (i.product_id, i.location_id, p_to_location_id, i.lot_no, p_qty, 'transfer', p_note);
  delete from wt_inventory where id = i.id and qty = 0;
end $$;

create or replace function public.wt_adjust(
  p_product_id bigint, p_location_id bigint, p_delta numeric,
  p_lot text default '', p_expiry date default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_qty numeric;
begin
  perform wt_require('warehouse');
  if p_delta is null or p_delta = 0 then raise exception 'จำนวนปรับต้องไม่เป็น 0'; end if;
  select qty into v_qty from wt_inventory
   where product_id = p_product_id and location_id = p_location_id and lot_no = coalesce(p_lot,'') for update;
  if coalesce(v_qty,0) + p_delta < 0 then raise exception 'ปรับแล้วสต็อกติดลบ (คงเหลือ %)', coalesce(v_qty,0); end if;
  -- update when the row exists: an INSERT of a negative delta would trip the qty >= 0 check before ON CONFLICT
  if v_qty is not null then
    update wt_inventory set qty = qty + p_delta, expiry_date = coalesce(p_expiry, expiry_date), updated_at = now()
     where product_id = p_product_id and location_id = p_location_id and lot_no = coalesce(p_lot,'');
  else
    insert into wt_inventory (product_id, location_id, lot_no, expiry_date, qty)
    values (p_product_id, p_location_id, coalesce(p_lot,''), p_expiry, p_delta);
  end if;
  insert into wt_stock_movements (product_id, from_location_id, to_location_id, lot_no, qty, move_type, note)
  values (p_product_id, case when p_delta < 0 then p_location_id end, case when p_delta > 0 then p_location_id end,
          coalesce(p_lot,''), p_delta, 'adjust', p_note);
  delete from wt_inventory
   where product_id = p_product_id and location_id = p_location_id and lot_no = coalesce(p_lot,'') and qty = 0;
end $$;

create or replace function public.wt_pick(p_outbound_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare h record; ln record; inv record; v_need numeric; v_take numeric;
begin
  perform wt_require('warehouse');
  select * into h from wt_outbound_orders where id = p_outbound_id for update;
  if not found then raise exception 'ไม่พบเอกสาร'; end if;
  if h.status <> 'open' then raise exception 'เอกสาร % ไม่อยู่ในสถานะ open', h.doc_no; end if;
  if not exists (select 1 from wt_outbound_lines where outbound_id = h.id) then raise exception 'เอกสารไม่มีรายการสินค้า'; end if;
  for ln in select * from wt_outbound_lines where outbound_id = h.id order by id loop
    v_need := ln.qty_ordered - ln.qty_picked;
    for inv in
      select i.* from wt_inventory i join wt_locations l on l.id = i.location_id
       where i.product_id = ln.product_id and l.warehouse_id = h.warehouse_id and l.active and i.qty > 0
       order by i.expiry_date nulls last, i.id for update of i
    loop
      exit when v_need <= 0;
      v_take := least(v_need, inv.qty);
      update wt_inventory set qty = qty - v_take, updated_at = now() where id = inv.id;
      insert into wt_stock_movements (product_id, from_location_id, lot_no, qty, move_type, ref_doc)
      values (ln.product_id, inv.location_id, inv.lot_no, v_take, 'pick', h.doc_no);
      v_need := v_need - v_take;
    end loop;
    if v_need > 0 then
      raise exception 'สต็อก % ไม่พอ ขาดอีก %', (select sku from wt_products where id = ln.product_id), v_need;
    end if;
    update wt_outbound_lines set qty_picked = qty_ordered where id = ln.id;
  end loop;
  delete from wt_inventory where qty = 0;
  update wt_outbound_orders o set status = 'picked', picked_at = now(), total_weight_kg = t.w, total_volume_cbm = t.v
  from (select coalesce(sum(ol.qty_ordered * p.weight_kg),0) w, coalesce(sum(ol.qty_ordered * p.volume_cbm),0) v
          from wt_outbound_lines ol join wt_products p on p.id = ol.product_id where ol.outbound_id = h.id) t
  where o.id = h.id;
end $$;

create or replace function public.wt_create_shipment(
  p_vehicle_id bigint, p_driver_id bigint, p_outbound_ids bigint[],
  p_plan_date date default current_date, p_distance_km numeric default 0, p_note text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v record; d record; v_wh bigint; v_cnt int; v_whcnt int; v_w numeric; v_v numeric; v_id bigint;
begin
  perform wt_require('transport');
  if p_outbound_ids is null or cardinality(p_outbound_ids) = 0 then raise exception 'กรุณาเลือกออเดอร์อย่างน้อย 1 รายการ'; end if;
  select * into v from wt_vehicles where id = p_vehicle_id;
  if not found or v.status in ('maintenance','inactive') then raise exception 'รถไม่พร้อมใช้งาน'; end if;
  select * into d from wt_drivers where id = p_driver_id;
  if not found or d.status in ('off','inactive') then raise exception 'พนักงานขับรถไม่พร้อม'; end if;
  if d.license_expiry is not null and d.license_expiry < p_plan_date then raise exception 'ใบขับขี่ของ % หมดอายุ', d.name; end if;
  perform 1 from wt_outbound_orders where id = any(p_outbound_ids) for update;
  select count(*), min(warehouse_id), count(distinct warehouse_id), sum(total_weight_kg), sum(total_volume_cbm)
    into v_cnt, v_wh, v_whcnt, v_w, v_v
    from wt_outbound_orders where id = any(p_outbound_ids) and status in ('picked','failed');
  if v_cnt <> cardinality(p_outbound_ids) then raise exception 'มีออเดอร์ที่ยังไม่ได้ Pick หรือถูกจัดรถไปแล้ว'; end if;
  if v_whcnt > 1 then raise exception 'ออเดอร์ต้องมาจากคลังเดียวกัน'; end if;
  if v.capacity_kg > 0 and v_w > v.capacity_kg then raise exception 'น้ำหนักเกิน: % kg > ความจุ % kg', round(v_w,2), v.capacity_kg; end if;
  if v.capacity_cbm > 0 and v_v > v.capacity_cbm then raise exception 'ปริมาตรเกิน: % cbm > ความจุ % cbm', round(v_v,3), v.capacity_cbm; end if;
  insert into wt_shipments (warehouse_id, vehicle_id, driver_id, plan_date, total_weight_kg, total_volume_cbm, distance_km, freight_cost, note)
  values (v_wh, p_vehicle_id, p_driver_id, coalesce(p_plan_date, current_date), v_w, v_v,
          coalesce(p_distance_km,0), round(coalesce(p_distance_km,0) * v.cost_per_km, 2), p_note)
  returning id into v_id;
  insert into wt_shipment_stops (shipment_id, seq, outbound_id)
  select v_id, t.ord, t.oid from unnest(p_outbound_ids) with ordinality as t(oid, ord);
  update wt_outbound_orders set status = 'planned' where id = any(p_outbound_ids);
  return v_id;
end $$;

create or replace function public.wt_cancel_shipment(p_shipment_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform wt_require('transport');
  update wt_shipments set status = 'cancelled' where id = p_shipment_id and status = 'planned';
  if not found then raise exception 'ยกเลิกได้เฉพาะสถานะ planned'; end if;
  update wt_outbound_orders set status = 'picked'
   where id in (select outbound_id from wt_shipment_stops where shipment_id = p_shipment_id);
  delete from wt_shipment_stops where shipment_id = p_shipment_id;
end $$;

create or replace function public.wt_dispatch_shipment(p_shipment_id bigint)
returns void language plpgsql security definer set search_path = public as $$
declare s record; w record;
begin
  select * into s from wt_shipments where id = p_shipment_id for update;
  if not found or s.status <> 'planned' then raise exception 'ปล่อยรถได้เฉพาะสถานะ planned'; end if;
  if not (wt_has_role('transport') or s.driver_id = wt_my_driver()) then perform wt_require('transport'); end if;
  if exists (select 1 from wt_vehicles where id = s.vehicle_id and status = 'on_trip') then raise exception 'รถคันนี้กำลังวิ่งงานอื่นอยู่'; end if;
  if exists (select 1 from wt_drivers where id = s.driver_id and status = 'on_trip') then raise exception 'พนักงานขับรถกำลังวิ่งงานอื่นอยู่'; end if;
  select * into w from wt_warehouses where id = s.warehouse_id;
  update wt_shipments set status = 'in_transit', dispatched_at = now() where id = s.id;
  update wt_vehicles set status = 'on_trip' where id = s.vehicle_id;
  update wt_drivers set status = 'on_trip' where id = s.driver_id;
  update wt_outbound_orders set status = 'shipped' where id in (select outbound_id from wt_shipment_stops where shipment_id = s.id);
  insert into wt_tracking_events (shipment_id, event, lat, lng, note) values (s.id, 'dispatched', w.lat, w.lng, 'ออกจากคลัง ' || w.name);
end $$;

drop function public.wt_deliver_stop(bigint, boolean, text, text);
create function public.wt_deliver_stop(
  p_stop_id bigint, p_success boolean, p_pod_name text default null, p_note text default null,
  p_photo text default null, p_signature text default null, p_lat double precision default null, p_lng double precision default null)
returns void language plpgsql security definer set search_path = public as $$
declare st record; s record; o record;
begin
  select * into st from wt_shipment_stops where id = p_stop_id for update;
  if not found then raise exception 'ไม่พบจุดส่ง'; end if;
  select * into s from wt_shipments where id = st.shipment_id for update;
  if not (wt_has_role('transport') or s.driver_id = wt_my_driver()) then perform wt_require('transport'); end if;
  if s.status <> 'in_transit' then raise exception 'เที่ยวรถยังไม่ได้ปล่อยรถ หรือปิดงานแล้ว'; end if;
  if st.status <> 'pending' then raise exception 'จุดส่งนี้บันทึกผลแล้ว'; end if;
  update wt_shipment_stops set status = case when p_success then 'delivered' else 'failed' end,
    pod_name = p_pod_name, pod_note = p_note, pod_photo = p_photo, pod_signature = p_signature, delivered_at = now()
  where id = st.id;
  update wt_outbound_orders set status = case when p_success then 'delivered' else 'failed' end,
    delivered_at = case when p_success then now() end
  where id = st.outbound_id returning * into o;
  insert into wt_tracking_events (shipment_id, event, lat, lng, note)
  values (s.id, case when p_success then 'delivered' else 'failed' end,
          coalesce(p_lat, o.lat), coalesce(p_lng, o.lng), o.doc_no || coalesce(' : ' || p_note, ''));
  if not exists (select 1 from wt_shipment_stops where shipment_id = s.id and status = 'pending') then
    update wt_shipments set status = 'completed', completed_at = now() where id = s.id;
    update wt_vehicles set status = 'available' where id = s.vehicle_id and status = 'on_trip';
    update wt_drivers set status = 'available' where id = s.driver_id and status = 'on_trip';
    insert into wt_tracking_events (shipment_id, event, note) values (s.id, 'completed', 'ปิดเที่ยวรถ');
  end if;
end $$;

-- Cycle count
create or replace function public.wt_create_count(p_warehouse_id bigint, p_zone text default null, p_note text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  perform wt_require('warehouse');
  insert into wt_counts (warehouse_id, zone, note) values (p_warehouse_id, nullif(p_zone,''), p_note) returning id into v_id;
  insert into wt_count_lines (count_id, location_id, product_id, lot_no, expiry_date, system_qty)
  select v_id, i.location_id, i.product_id, i.lot_no, i.expiry_date, i.qty
    from wt_inventory i join wt_locations l on l.id = i.location_id
   where l.warehouse_id = p_warehouse_id and (nullif(p_zone,'') is null or l.zone = p_zone) and i.qty > 0;
  return v_id;
end $$;

create or replace function public.wt_post_count(p_count_id bigint)
returns int language plpgsql security definer set search_path = public as $$
declare c record; ln record; v_cur numeric; v_n int := 0;
begin
  perform wt_require('warehouse');
  select * into c from wt_counts where id = p_count_id for update;
  if not found or c.status <> 'open' then raise exception 'ใบนับสต็อกต้องอยู่สถานะ open'; end if;
  for ln in select * from wt_count_lines where count_id = c.id and counted_qty is not null loop
    select qty into v_cur from wt_inventory
     where product_id = ln.product_id and location_id = ln.location_id and lot_no = ln.lot_no;
    if ln.counted_qty <> coalesce(v_cur, 0) then
      perform wt_adjust(ln.product_id, ln.location_id, ln.counted_qty - coalesce(v_cur, 0), ln.lot_no, ln.expiry_date, 'นับสต็อก ' || c.doc_no);
      v_n := v_n + 1;
    end if;
  end loop;
  update wt_counts set status = 'posted', posted_at = now() where id = c.id;
  return v_n;
end $$;

-- Billing: one line per delivered, not-yet-billed order; most specific active rate wins
create or replace function public.wt_create_invoice(p_customer_id bigint, p_from date, p_to date, p_due_days int default 30)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; r record; rt record; v_amt numeric; v_cnt int := 0; v_sub numeric;
begin
  perform wt_require('transport');
  insert into wt_invoices (customer_id, period_from, period_to, due_date)
  values (p_customer_id, p_from, p_to, current_date + coalesce(p_due_days, 30)) returning id into v_id;
  for r in
    select o.id oid, o.doc_no, o.total_weight_kg w, s.id sid, s.doc_no sdoc, s.distance_km km, v.vehicle_type vt,
           (select count(*) from wt_shipment_stops x where x.shipment_id = s.id) drops
      from wt_outbound_orders o
      join wt_shipment_stops st on st.outbound_id = o.id and st.status = 'delivered'
      join wt_shipments s on s.id = st.shipment_id
      join wt_vehicles v on v.id = s.vehicle_id
     where o.customer_id = p_customer_id and o.status = 'delivered'
       and o.delivered_at::date between p_from and p_to
       and not exists (select 1 from wt_invoice_lines il where il.outbound_id = o.id)
     order by o.delivered_at
  loop
    select * into rt from wt_freight_rates f
     where f.active and (f.customer_id = p_customer_id or f.customer_id is null)
       and (f.vehicle_type = r.vt or f.vehicle_type is null)
     order by (f.customer_id is not null) desc, (f.vehicle_type is not null) desc, f.id limit 1;
    if not found then raise exception 'ไม่พบเรทค่าขนส่งที่ใช้กับลูกค้านี้ / รถ % (ตั้งค่าเรทก่อน)', r.vt; end if;
    v_amt := greatest(rt.min_charge, rt.base_charge + rt.per_drop + rt.per_kg * r.w + rt.per_km * r.km / greatest(r.drops, 1));
    insert into wt_invoice_lines (invoice_id, outbound_id, shipment_id, description, weight_kg, amount)
    values (v_id, r.oid, r.sid, r.doc_no || ' / ' || r.sdoc || ' (' || r.vt || ')', r.w, round(v_amt, 2));
    v_cnt := v_cnt + 1;
  end loop;
  if v_cnt = 0 then raise exception 'ไม่มีออเดอร์ที่ส่งสำเร็จและยังไม่ได้วางบิลในช่วงวันที่นี้'; end if;
  select sum(amount) into v_sub from wt_invoice_lines where invoice_id = v_id;
  update wt_invoices set subtotal = v_sub, vat = round(v_sub * vat_rate / 100, 2),
         total = v_sub + round(v_sub * vat_rate / 100, 2) where id = v_id;
  return v_id;
end $$;

create or replace function public.wt_set_invoice_status(p_invoice_id bigint, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare i record;
begin
  perform wt_require('transport');
  select * into i from wt_invoices where id = p_invoice_id for update;
  if not found then raise exception 'ไม่พบใบแจ้งหนี้'; end if;
  if p_status = 'issued' and i.status = 'draft' then
    update wt_invoices set status = 'issued', issued_at = now() where id = i.id;
  elsif p_status = 'paid' and i.status = 'issued' then
    update wt_invoices set status = 'paid', paid_at = now() where id = i.id;
  elsif p_status = 'cancelled' and i.status in ('draft','issued') then
    delete from wt_invoice_lines where invoice_id = i.id;  -- orders become billable again
    update wt_invoices set status = 'cancelled' where id = i.id;
  else
    raise exception 'เปลี่ยนสถานะจาก % เป็น % ไม่ได้', i.status, p_status;
  end if;
end $$;

-- =====================================================================
-- ROLE-BASED RLS (replaces v1 "staff full access")
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['wt_warehouses','wt_locations','wt_products','wt_partners',
    'wt_inventory','wt_stock_movements','wt_inbound_orders','wt_inbound_lines',
    'wt_outbound_orders','wt_outbound_lines','wt_vehicles','wt_drivers',
    'wt_shipments','wt_shipment_stops','wt_tracking_events']
  loop
    execute format('drop policy if exists "staff full access" on public.%I', t);
  end loop;
end $$;

-- helper: create select + write policies
create or replace function pg_temp.wt_pol(t text, read_expr text, write_roles text) returns void language plpgsql as $$
begin
  execute format('alter table public.%I enable row level security', t);
  execute format('revoke all on public.%I from anon', t);
  execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  execute format('create policy "read" on public.%I for select to authenticated using (%s)', t, read_expr);
  if write_roles is not null then
    execute format('create policy "insert" on public.%I for insert to authenticated with check (public.wt_has_role(%s))', t, write_roles);
    execute format('create policy "update" on public.%I for update to authenticated using (public.wt_has_role(%s)) with check (public.wt_has_role(%s))', t, write_roles, write_roles);
    execute format('create policy "delete" on public.%I for delete to authenticated using (public.wt_has_role(%s))', t, write_roles);
  end if;
end $$;

select pg_temp.wt_pol('wt_warehouses',      'public.wt_role() is not null', '''warehouse''');
select pg_temp.wt_pol('wt_locations',       'public.wt_role() is not null', '''warehouse''');
select pg_temp.wt_pol('wt_products',        'public.wt_role() is not null', '''warehouse''');
select pg_temp.wt_pol('wt_partners',        'public.wt_role() is not null', '''warehouse'',''transport''');
select pg_temp.wt_pol('wt_vehicles',        'public.wt_role() is not null', '''transport''');
select pg_temp.wt_pol('wt_drivers',         'public.wt_role() is not null', '''transport''');
select pg_temp.wt_pol('wt_maintenance',     'public.wt_role() is not null', '''transport''');
select pg_temp.wt_pol('wt_freight_rates',   'public.wt_is_staff()', '''transport''');
select pg_temp.wt_pol('wt_inventory',       'public.wt_is_staff()', null);
select pg_temp.wt_pol('wt_stock_movements', 'public.wt_is_staff()', null);
select pg_temp.wt_pol('wt_inbound_orders',  'public.wt_is_staff()', '''warehouse''');
select pg_temp.wt_pol('wt_inbound_lines',   'public.wt_is_staff()', '''warehouse''');
select pg_temp.wt_pol('wt_counts',          'public.wt_is_staff()', '''warehouse''');
select pg_temp.wt_pol('wt_count_lines',     'public.wt_is_staff()', '''warehouse''');
select pg_temp.wt_pol('wt_invoices',        'public.wt_is_staff()', null);
select pg_temp.wt_pol('wt_invoice_lines',   'public.wt_is_staff()', null);
select pg_temp.wt_pol('wt_shipments',
  'public.wt_is_staff() or driver_id = public.wt_my_driver()', null);
select pg_temp.wt_pol('wt_shipment_stops',
  'public.wt_is_staff() or exists (select 1 from public.wt_shipments s where s.id = shipment_id and s.driver_id = public.wt_my_driver())', null);
select pg_temp.wt_pol('wt_outbound_orders',
  'public.wt_is_staff() or exists (select 1 from public.wt_shipment_stops st join public.wt_shipments s on s.id = st.shipment_id where st.outbound_id = wt_outbound_orders.id and s.driver_id = public.wt_my_driver())', '''warehouse''');
select pg_temp.wt_pol('wt_outbound_lines',
  'public.wt_is_staff() or exists (select 1 from public.wt_outbound_orders o where o.id = outbound_id)', '''warehouse''');
select pg_temp.wt_pol('wt_tracking_events',
  'public.wt_is_staff() or exists (select 1 from public.wt_shipments s where s.id = shipment_id and s.driver_id = public.wt_my_driver())', null);
create policy "insert" on public.wt_tracking_events for insert to authenticated with check (
  public.wt_has_role('transport') or exists (select 1 from public.wt_shipments s where s.id = shipment_id and s.driver_id = public.wt_my_driver()));
select pg_temp.wt_pol('wt_fuel_logs',
  'public.wt_is_staff() or driver_id = public.wt_my_driver()', null);
create policy "insert" on public.wt_fuel_logs for insert to authenticated with check (
  public.wt_has_role('transport') or (driver_id is not null and driver_id = public.wt_my_driver()));
create policy "update" on public.wt_fuel_logs for update to authenticated using (public.wt_has_role('transport')) with check (public.wt_has_role('transport'));
create policy "delete" on public.wt_fuel_logs for delete to authenticated using (public.wt_has_role('transport'));

-- profiles: see yourself; admin sees and manages everyone
alter table public.wt_profiles enable row level security;
revoke all on public.wt_profiles from anon;
grant select, update on public.wt_profiles to authenticated;
create policy "read" on public.wt_profiles for select to authenticated using (user_id = auth.uid() or public.wt_role() = 'admin');
create policy "admin update" on public.wt_profiles for update to authenticated
  using (public.wt_role() = 'admin') with check (public.wt_role() = 'admin');

revoke all on public.wt_v_alerts from anon;
grant select on public.wt_v_alerts to authenticated;
grant usage on sequence public.wt_seq_invoice, public.wt_seq_count to authenticated;

-- Function execute rights: signed-in only (each function checks the role itself)
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'wt\_%' and p.proname <> 'wt_fleet_sync'
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
revoke execute on function public.wt_fleet_sync() from public, anon, authenticated;

-- ---------- STORAGE: POD photos & signatures (private) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wt-pod', 'wt-pod', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
create policy "wt-pod read" on storage.objects for select to authenticated
  using (bucket_id = 'wt-pod' and public.wt_role() is not null);
create policy "wt-pod upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'wt-pod' and public.wt_has_role('transport', 'driver'));

-- ---------- REALTIME ----------
alter publication supabase_realtime add table
  public.wt_shipments, public.wt_shipment_stops, public.wt_outbound_orders,
  public.wt_inbound_orders, public.wt_inventory, public.wt_tracking_events;

-- ---------- Owner account becomes admin ----------
insert into public.wt_profiles (user_id, email, role)
select id, email, 'admin' from auth.users where email = 'udomsaknight@gmail.com'
on conflict (user_id) do update set role = 'admin';

-- ---------- Demo data for new modules ----------
insert into public.wt_freight_rates (name, vehicle_type, base_charge, per_drop, per_kg, per_km, min_charge) values
  ('เรทมาตรฐาน 4 ล้อ', '4W', 300, 50, 0.5, 0, 500),
  ('เรทมาตรฐาน 6 ล้อ', '6W', 500, 80, 0.4, 0, 800),
  ('เรทมาตรฐาน (ทุกประเภทรถ)', null, 400, 60, 0.5, 0, 600);
update public.wt_vehicles set odometer_km = 45200, tax_expiry = current_date + 20, insurance_expiry = '2027-05-31',
  next_service_km = 50000, next_service_date = current_date + 40 where vehicle_type = '6W';
update public.wt_vehicles set odometer_km = 88150, tax_expiry = '2027-03-31', insurance_expiry = '2027-03-31',
  next_service_km = 90000 where vehicle_type = '4W';
