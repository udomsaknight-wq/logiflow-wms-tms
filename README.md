# LogiFlow WMS + TMS

ระบบบริหารคลังสินค้า (WMS) และการขนส่ง (TMS) แบบครบวงจร — หน้าเว็บ static (HTML/JS) + Supabase (Postgres, Auth, RLS) และ deploy บน Render

## โมดูล
| WMS คลังสินค้า | TMS ขนส่ง | ข้อมูลหลัก |
|---|---|---|
| สต็อกตาม Location / Lot / วันหมดอายุ | วางแผนจัดรถ (เช็คน้ำหนัก/ปริมาตร, แนะนำรถ, จัดลำดับจุดส่ง, คำนวณ km/ค่าขนส่ง) | สินค้า |
| รับสินค้า (ASN → รับเข้า Location) | เที่ยวรถ: ปล่อยรถ, POD ส่งสำเร็จ/ไม่สำเร็จ, พิมพ์ใบคุมรถ | คลังสินค้า |
| ออเดอร์ขาออก + หยิบสินค้าแบบ FEFO | ติดตามรถบนแผนที่ + บันทึกตำแหน่ง GPS | Location |
| ย้าย / ปรับสต็อก, ประวัติเคลื่อนไหว | รายงาน: OTD, % สำเร็จ, ต้นทุน/จุด, ต้นทุน/km | ลูกค้า / ผู้ขาย, รถ, คนขับ |

Flow: `Inbound → Putaway/Stock → Outbound (Pick FEFO) → Load planning → Dispatch → POD → Billing → Report`

### v2
- **สิทธิ์ผู้ใช้ (Role)** — admin / พนักงานคลัง / ฝ่ายขนส่ง / คนขับ / ดูอย่างเดียว บังคับที่ฐานข้อมูล (RLS + ฟังก์ชันเช็คสิทธิ์) ผู้สมัครใหม่เป็น "รออนุมัติ" จนกว่า admin จะกำหนดสิทธิ์ที่หน้า **ผู้ใช้งาน**
- **หน้าคนขับ (มือถือ)** — งานของฉัน, เริ่มออกรถ, นำทาง Google Maps, โทรหาลูกค้า, POD (ชื่อผู้รับ + รูปถ่าย + ลายเซ็น) เก็บใน Storage bucket `wt-pod` (private), GPS อัตโนมัติทุก 2 นาที, บันทึกเติมน้ำมัน
- **สแกนบาร์โค้ด** — กล้องมือถือหรือเครื่องยิง USB: หน้า สแกน/ค้นหา, รับสินค้า, สร้างออเดอร์, นับสต็อก + พิมพ์ป้ายบาร์โค้ดสินค้า/Location
- **Excel** — Export ทุกตาราง, Import ข้อมูลหลัก (upsert ตามรหัส) และนำเข้าออเดอร์ขาออก
- **นับสต็อก (Cycle count)** — สร้างใบนับตามคลัง/โซน, Blind count, เพิ่มสินค้าที่พบ, ปรับยอดอัตโนมัติ
- **วางบิลค่าขนส่ง** — เรทตามลูกค้า/ประเภทรถ, สร้างใบแจ้งหนี้จากออเดอร์ที่ส่งสำเร็จ, VAT 7%, ออกบิล/รับชำระ/ยกเลิก
- **ซ่อมบำรุง / น้ำมัน** — บันทึกน้ำมัน, ประวัติซ่อม, km/ลิตร, ต้นทุน/km, เตือนภาษี/ประกัน/เข้าศูนย์
- **Realtime + แจ้งเตือน** — หน้าจออัปเดตทันทีเมื่อมีคนแก้ข้อมูล, กระดิ่งแจ้งเตือน (สต็อกต่ำ, ใกล้หมดอายุ, ส่งไม่สำเร็จ, ใบขับขี่/ภาษี/ประกัน), แจ้งเตือนบนเครื่อง

## โครงสร้าง
```
public/            เว็บแอป (ไม่มี build step)
  js/config.js     Supabase URL + anon key (public, ข้อมูลป้องกันด้วย RLS)
  js/core.js       helper: client, modal, form, table, CRUD, แผนที่
  js/wms.js        หน้า WMS + ข้อมูลหลัก
  js/tms.js        หน้า TMS
  js/app.js        login + router
supabase/
  01_schema.sql    ตาราง wt_*, view, ฟังก์ชันธุรกิจ (wt_receive, wt_pick, wt_create_shipment, ...), RLS
  02_seed.sql      ข้อมูลตัวอย่าง
  03_features.sql  v2: roles/RLS, fleet, billing, cycle count, POD storage, alerts, realtime
render.yaml        Render static site
serve.ps1          เซิร์ฟเวอร์ทดสอบในเครื่อง (Windows PowerShell)
```

## ติดตั้งใหม่
1. Supabase → SQL Editor → รัน `supabase/01_schema.sql`, `02_seed.sql` แล้ว `03_features.sql` (ผู้ใช้คนแรกที่ล็อกอินจะเป็น admin)
2. ใส่ URL / anon key ใน `public/js/config.js`
3. Render → New → Blueprint (หรือ Static Site) ชี้มาที่ repo นี้, publish directory = `public`
4. Supabase → Authentication → URL Configuration → ใส่ URL ของ Render เป็น Site URL
5. เปิดเว็บ → สมัครใช้งาน → เข้าสู่ระบบ

ทดสอบในเครื่อง: `powershell -ExecutionPolicy Bypass -File serve.ps1` แล้วเปิด http://localhost:5180
