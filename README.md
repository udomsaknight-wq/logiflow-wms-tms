# LogiFlow WMS + TMS

ระบบบริหารคลังสินค้า (WMS) และการขนส่ง (TMS) แบบครบวงจร — หน้าเว็บ static (HTML/JS) + Supabase (Postgres, Auth, RLS) และ deploy บน Render

## โมดูล
| WMS คลังสินค้า | TMS ขนส่ง | ข้อมูลหลัก |
|---|---|---|
| สต็อกตาม Location / Lot / วันหมดอายุ | วางแผนจัดรถ (เช็คน้ำหนัก/ปริมาตร, แนะนำรถ, จัดลำดับจุดส่ง, คำนวณ km/ค่าขนส่ง) | สินค้า |
| รับสินค้า (ASN → รับเข้า Location) | เที่ยวรถ: ปล่อยรถ, POD ส่งสำเร็จ/ไม่สำเร็จ, พิมพ์ใบคุมรถ | คลังสินค้า |
| ออเดอร์ขาออก + หยิบสินค้าแบบ FEFO | ติดตามรถบนแผนที่ + บันทึกตำแหน่ง GPS | Location |
| ย้าย / ปรับสต็อก, ประวัติเคลื่อนไหว | รายงาน: OTD, % สำเร็จ, ต้นทุน/จุด, ต้นทุน/km | ลูกค้า / ผู้ขาย, รถ, คนขับ |

Flow: `Inbound → Putaway/Stock → Outbound (Pick FEFO) → Load planning → Dispatch → POD → Report`

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
render.yaml        Render static site
serve.ps1          เซิร์ฟเวอร์ทดสอบในเครื่อง (Windows PowerShell)
```

## ติดตั้งใหม่
1. Supabase → SQL Editor → รัน `supabase/01_schema.sql` แล้ว `02_seed.sql`
2. ใส่ URL / anon key ใน `public/js/config.js`
3. Render → New → Blueprint (หรือ Static Site) ชี้มาที่ repo นี้, publish directory = `public`
4. Supabase → Authentication → URL Configuration → ใส่ URL ของ Render เป็น Site URL
5. เปิดเว็บ → สมัครใช้งาน → เข้าสู่ระบบ

ทดสอบในเครื่อง: `powershell -ExecutionPolicy Bypass -File serve.ps1` แล้วเปิด http://localhost:5180
