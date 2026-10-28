-- Demo data for WMS + TMS
insert into public.wt_warehouses (code, name, address, lat, lng) values
  ('BKK1', 'คลังสินค้าบางนา', 'ถ.บางนา-ตราด กม.7 บางพลี สมุทรปราการ', 13.6655, 100.6600),
  ('LKB1', 'คลังสินค้าลาดกระบัง', 'นิคมฯ ลาดกระบัง กรุงเทพฯ', 13.7262, 100.7480);

insert into public.wt_locations (warehouse_id, code, zone, loc_type, max_qty)
select w.id, l.code, l.zone, l.loc_type, l.max_qty
from public.wt_warehouses w
cross join (values
  ('RCV-01','R','receiving',null::numeric),
  ('A-01-01','A','storage',500), ('A-01-02','A','storage',500),
  ('A-02-01','A','storage',500), ('B-01-01','B','picking',200),
  ('B-01-02','B','picking',200), ('STG-01','S','staging',null),
  ('SHP-01','S','shipping',null)
) as l(code, zone, loc_type, max_qty);

insert into public.wt_products (sku, name, barcode, category, uom, weight_kg, volume_cbm, min_stock) values
  ('SKU-1001','น้ำดื่ม 600ml (แพ็ค 12)','8850001001','เครื่องดื่ม','PACK',7.5,0.012,100),
  ('SKU-1002','กาแฟกระป๋อง (ลัง 24)','8850001002','เครื่องดื่ม','CASE',6.2,0.010,60),
  ('SKU-2001','ข้าวหอมมะลิ 5 กก.','8850002001','อาหารแห้ง','BAG',5.0,0.008,80),
  ('SKU-2002','น้ำมันพืช 1 ลิตร (ลัง 12)','8850002002','อาหารแห้ง','CASE',11.5,0.015,40),
  ('SKU-3001','ผงซักฟอก 3 กก.','8850003001','ของใช้','BAG',3.0,0.006,50),
  ('SKU-3002','กระดาษทิชชู่ (แพ็ค 24)','8850003002','ของใช้','PACK',2.4,0.045,70);

insert into public.wt_partners (code, name, partner_type, contact, phone, address, lat, lng) values
  ('SUP-01','บริษัท สยามเบฟ ซัพพลาย จำกัด','supplier','คุณสมชาย','02-111-1111','ปทุมธานี',14.0208,100.5250),
  ('SUP-02','บริษัท ไทยฟู้ด เทรดดิ้ง จำกัด','supplier','คุณวิภา','02-222-2222','นนทบุรี',13.8621,100.5144),
  ('CUS-01','ร้านมินิมาร์ท สุขุมวิท 71','customer','คุณเอ','081-000-0001','สุขุมวิท 71 วัฒนา กรุงเทพฯ',13.7180,100.5980),
  ('CUS-02','ซูเปอร์มาร์เก็ต รามอินทรา','customer','คุณบี','081-000-0002','รามอินทรา กม.4 บางเขน',13.8700,100.6200),
  ('CUS-03','ร้านค้าส่ง บางกะปิ','customer','คุณซี','081-000-0003','ถ.ลาดพร้าว บางกะปิ',13.7650,100.6430),
  ('CUS-04','โชห่วย สมุทรปราการ','customer','คุณดี','081-000-0004','ปากน้ำ สมุทรปราการ',13.5990,100.5970),
  ('CUS-05','ร้านสะดวกซื้อ ลาดกระบัง','customer','คุณอี','081-000-0005','ลาดกระบัง กรุงเทพฯ',13.7220,100.7590);

insert into public.wt_vehicles (plate_no, vehicle_type, capacity_kg, capacity_cbm, cost_per_km, ownership, carrier_name) values
  ('1ฒก-1234 กทม','4W',1500,8,12,'own',null),
  ('70-5678 กทม','6W',5000,20,18,'own',null),
  ('71-9999 สป','10W',12000,40,28,'subcontract','ขนส่งรุ่งเรือง');

insert into public.wt_drivers (code, name, phone, license_no, license_expiry) values
  ('DRV-01','สมศักดิ์ ใจดี','089-111-0001','ท.2-12345','2028-12-31'),
  ('DRV-02','ประยุทธ มั่นคง','089-111-0002','ท.2-22345','2027-06-30'),
  ('DRV-03','วีระ ขยันงาน','089-111-0003','ท.3-32345','2029-03-31');

-- Opening stock in BKK1
insert into public.wt_inventory (product_id, location_id, lot_no, expiry_date, qty)
select p.id, l.id, s.lot, s.exp, s.qty
from (values
  ('SKU-1001','A-01-01','L2609A','2027-03-31'::date,300),
  ('SKU-1001','B-01-01','L2608B','2027-01-31'::date,60),
  ('SKU-1002','A-01-02','L2610A','2027-06-30'::date,150),
  ('SKU-2001','A-02-01','L2609R','2027-09-30'::date,200),
  ('SKU-2002','A-02-01','L2607O','2027-12-31'::date,25),
  ('SKU-3001','B-01-02','',null,120),
  ('SKU-3002','B-01-02','',null,90)
) as s(sku, loc, lot, exp, qty)
join public.wt_products p on p.sku = s.sku
join public.wt_locations l on l.code = s.loc
join public.wt_warehouses w on w.id = l.warehouse_id and w.code = 'BKK1';

insert into public.wt_stock_movements (product_id, to_location_id, lot_no, qty, move_type, ref_doc, note)
select product_id, location_id, lot_no, qty, 'adjust', 'OPENING', 'ยอดยกมา'
from public.wt_inventory;

-- A pending inbound (ASN)
with h as (
  insert into public.wt_inbound_orders (supplier_id, warehouse_id, ref_no, expected_date, note)
  select s.id, w.id, 'PO-26-0101', current_date + 1, 'ตัวอย่างใบรับสินค้า'
  from public.wt_partners s, public.wt_warehouses w
  where s.code = 'SUP-02' and w.code = 'BKK1'
  returning id
)
insert into public.wt_inbound_lines (inbound_id, product_id, qty_expected)
select h.id, p.id, x.qty from h
join (values ('SKU-2002',60),('SKU-2001',100)) as x(sku, qty) on true
join public.wt_products p on p.sku = x.sku;

-- Open outbound orders
do $$
declare r record; v_id bigint;
begin
  for r in select * from (values
      ('CUS-01', 'SKU-1001', 40, 'SKU-3002', 10),
      ('CUS-03', 'SKU-1002', 20, 'SKU-2001', 30),
      ('CUS-04', 'SKU-3001', 25, 'SKU-1001', 30)) as t(cus, s1, q1, s2, q2)
  loop
    insert into public.wt_outbound_orders (customer_id, warehouse_id, required_date, ship_address, lat, lng)
    select c.id, w.id, current_date + 1, c.address, c.lat, c.lng
    from public.wt_partners c, public.wt_warehouses w
    where c.code = r.cus and w.code = 'BKK1'
    returning id into v_id;
    insert into public.wt_outbound_lines (outbound_id, product_id, qty_ordered)
    select v_id, p.id, x.q from (values (r.s1, r.q1), (r.s2, r.q2)) as x(s, q)
    join public.wt_products p on p.sku = x.s;
  end loop;
end $$;
