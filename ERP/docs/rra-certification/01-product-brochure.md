# EXCLEDGE ERP/POS
## Rwanda Revenue Authority Certified Invoicing System (CIS) for VSDC Integration

---

```
Software Version:    1.0.0
Document Reference:  EXC-BROCHURE-v1.0.0-2026
Prepared by:         Excledge CPA Ltd
Date:                June 2026
RRA Certification:   Pending — application not yet issued by RRA
Contact:             exceledgecpaltd@gmail.com
Deployed URL:        https://erp.exceledgecpa.com
```

---

*This document is prepared in support of an application for certification as a Certified Invoicing System (CIS) connected to the Virtual Sales Data Controller (VSDC) under the authority of the Rwanda Revenue Authority (RRA). All technical details herein reflect the actual production implementation of Excledge ERP/POS version 1.0.0.*

---

## TABLE OF CONTENTS

1. Executive Summary
2. Product Overview
   - 2.1 What is a Certified Invoicing System (CIS)?
   - 2.2 What is a Virtual Sales Data Controller (VSDC)?
   - 2.3 How Does Excledge + VSDC Work Together?
3. Key Features
4. Technical Specifications
5. RRA Compliance Statement
6. Company Information

---

## SECTION 1: EXECUTIVE SUMMARY

### 1.1 Product Identity and Core Purpose

Excledge ERP/POS is a comprehensive, web-based Enterprise Resource Planning and Point-of-Sale system designed, engineered, and deployed specifically for taxpaying businesses operating within the Republic of Rwanda. As a Certified Invoicing System (CIS) as defined by the Rwanda Revenue Authority, Excledge ERP/POS provides a complete, end-to-end solution for the issuance of legally compliant certified receipts, the management of VAT obligations, real-time inventory control, and seamless electronic integration with the RRA's Virtual Sales Data Controller (VSDC) infrastructure. The system enables businesses of all sizes to fulfil their statutory obligations under Rwandan tax law with efficiency, accuracy, and confidence. Every certified receipt issued through Excledge ERP/POS carries a cryptographic signature, a unique sequential identifier, a machine-readable QR code in the RRA-mandated format, and a complete SDC INFORMATION block, ensuring that every transaction is verifiable, tamper-evident, and permanently recorded on the RRA Authority Server. The platform is accessible via modern web browsers at https://erp.exceledgecpa.com and is maintained and supported by Excledge CPA Ltd, a Rwandan technology company dedicated to building compliant fiscal software solutions for the local market.

### 1.2 Target Market and Business Types Served

Excledge ERP/POS is engineered to serve the full spectrum of Rwandan businesses that are required by law to use a Certified Invoicing System connected to the VSDC. The platform is equally suitable for small and medium-sized enterprises (SMEs) operating from a single location and for large, multi-branch organisations managing complex sales and inventory operations across multiple sites. Specific sectors served include retail shops and supermarkets, wholesale distributors, service providers of all kinds, hospitality businesses including hotels, restaurants, and bars, pharmacies and medical supply companies, professional services firms including accounting, legal, and consulting practices, and any other business engaged in the sale of taxable goods or services to customers in Rwanda. The system supports both product-based and service-based business models natively, with separate handling for physical inventory items and non-stock service items, ensuring that every category of Rwandan taxpayer can find a compliant workflow within the platform. Support for multiple payment methods — including cash, mobile money, insurance, credit card, and mixed payments — further extends the system's applicability across all commercial sectors.

### 1.3 Purpose-Built for Rwanda's Fiscal Compliance Requirements

Unlike generic ERP or POS software products that treat fiscal compliance as a secondary feature or a third-party plug-in, Excledge ERP/POS was architected from its very inception with the RRA CIS/VSDC Technical Specification Version 1.0 (March 2018) as a foundational design document. Every major architectural decision — from the choice of a transactional outbox pattern for guaranteed VSDC delivery, to the implementation of per-branch VSDC URLs and independent receipt sequence counters, to the enforcement of atomic database transactions that prevent inventory and receipt data from ever becoming inconsistent — was made specifically to satisfy the requirements set out in the RRA specification. The system's receipt engine enforces the correct receipt type, the correct VAT tax code, the correct QR code format (ddmmyyyy#hhmmss#sdc#rcpt#data#sig), and the correct signature display format (dashes every four characters) as mandated by the specification. The VSDC communication layer enforces the 1,000-millisecond timeout defined in the specification's Section 24.2.1, and the system's offline resilience queue ensures that no sale is ever lost when temporary network interruptions occur. Rwanda's fiscal compliance requirements are not a constraint that Excledge works around — they are the foundation upon which the entire system is built.

---

## SECTION 2: PRODUCT OVERVIEW

### 2.1 What is a Certified Invoicing System (CIS)?

The Rwanda Revenue Authority defines a Certified Invoicing System as **"a system designated for use in business for efficiency management controls in areas of sales analysis and stock control which conforms to the requirements specified by the Authority."**

In practical terms, a CIS is a software or hardware system that a business uses to record every sale it makes, calculate the correct VAT for each transaction, issue a certified receipt to the customer, and electronically transmit a record of every sale to the RRA's servers. A CIS replaces the older Electronic Billing Machine (EBM) hardware devices and operates in conjunction with a Virtual Sales Data Controller (VSDC), which is a software component that handles the cryptographic signing of receipts and the secure transmission of sales data to the RRA Authority Server. Under Rwandan tax law and the provisions of the Value Added Tax (VAT) Act, every taxpayer registered for VAT whose annual turnover exceeds the prescribed threshold is required to use a CIS connected to an approved VSDC. The use of a non-certified system, or the failure to issue certified receipts, constitutes a tax offence and is subject to substantial penalties as defined by Rwandan law. Excledge ERP/POS has been designed to satisfy every requirement of the CIS specification as published by the RRA, ensuring that businesses using it remain fully compliant with their VAT obligations at all times.

### 2.2 What is a Virtual Sales Data Controller (VSDC)?

A Virtual Sales Data Controller (VSDC) is a software module that serves as the secure intermediary between a Certified Invoicing System and the RRA Authority Server. The VSDC performs three critical functions: it receives transaction data from the CIS in a defined JSON format, it applies a cryptographic signature to each transaction to create a tamper-evident certified receipt, and it transmits the signed transaction data to the RRA Authority Server within the prescribed time window (not to exceed fifteen minutes from the time of the transaction). The VSDC also maintains a Machine Registration Code (MRC) for each device — a unique identifier in the format BBBCCNNNNNN — and issues a sequential internal data number and receipt signature for each certified receipt. The VSDC is provided and maintained by the RRA and its authorised partners.

Excledge ERP/POS integrates with the VSDC using the **RRA ALGO EBM API v8.2** REST/JSON protocol. Communication occurs over HTTPS using a defined set of endpoint commands. The system calls the following VSDC endpoints in the course of normal operation:

| Endpoint | Purpose |
|---|---|
| `/saveInvc` | Submit a completed sale invoice for signing and certification |
| `/saveItem` | Register or update inventory items in the VSDC item catalogue |
| `/selectMvmt` | Query stock movement data from the VSDC |
| `/savePurc` | Register purchase transactions with the VSDC |
| `/selectImportInvc` | Retrieve import invoice data from the VSDC |
| `/status` | Check the health and availability of the VSDC service |

### 2.3 How Does Excledge + VSDC Work Together?

The following describes the complete, end-to-end data flow from the moment a cashier completes a sale in Excledge POS to the moment the customer's receipt is verifiable on the RRA portal:

**Step 1 — Cashier Completes Sale in Excledge POS**
The cashier adds items or services to the sale transaction in the Excledge POS interface. The system validates item availability (for stock items), calculates the applicable VAT for each line item based on the assigned RRA tax code (A, B, C, D, or E), and displays the total amount due. The cashier selects the payment method (cash, mobile money, credit card, insurance, debt, or mixed) and confirms the transaction.

**Step 2 — Excledge Backend Calls VSDC /saveInvc**
Immediately upon sale confirmation, the Excledge backend service constructs a JSON payload conforming to the RRA ALGO EBM API v8.2 specification and transmits it to the VSDC `/saveInvc` endpoint. This call is executed by the `vsdc-api.service.ts` module with a mandatory timeout of 1,000 milliseconds (EBM_REQUEST_TIMEOUT_MS=1000), as required by the CIS specification Section 24.2.1. The JSON payload includes the branch's bhfId (2-digit RRA branch code), the organisation's TIN and VRN, the complete line-item detail with tax codes and amounts, and the assigned receipt type from the RcptLabel enumeration.

**Step 3 — VSDC Validates, Signs, and Returns Receipt Data**
The VSDC validates the submitted transaction data, assigns a sequential SDC internal data number, applies a cryptographic signature, and returns a signed response containing: the SDC ID, the receipt internal data value, the receipt signature string, the VSDC-assigned date and time, and the complete QR code payload string formatted as `ddmmyyyy#hhmmss#sdc#rcpt#data#sig`.

**Step 4 — Excledge Stores Response and Updates Outbox**
The Excledge backend stores the complete VSDC response in the `EbmTransaction` table, atomically updates the sale record with the certified receipt data, and marks the corresponding `EbmOutbox` record status as `SUCCEEDED`. This entire operation is performed within a single ACID database transaction, ensuring that inventory deductions, payment records, receipt data, and VSDC response data are always consistent with one another.

**Step 5 — Receipt is Rendered with Full SDC INFORMATION Block**
The system generates the certified receipt for printing or electronic delivery. The receipt includes the mandatory SDC INFORMATION block containing: the VSDC date and time, the SDC ID (MRC/device identifier), the receipt counter in A/B RT format (for example, `168/258 NS` indicating the 168th receipt out of a total running sequence of 258, receipt type Normal Sale), the internal data value, the receipt signature displayed with a dash separator every four characters, and the QR code image in the RRA-mandated format.

**Step 6 — VSDC Transmits to RRA Authority Server**
The VSDC transmits the certified transaction data to the RRA Authority Server. By specification, this transmission must occur within fifteen minutes of the transaction time. This process is handled entirely by the VSDC and does not require further action from the Excledge system.

**Step 7 — Customer Can Verify Receipt**
The customer may verify the authenticity of any certified receipt issued by scanning the QR code or entering the receipt details at the RRA taxpayer portal at rra.gov.rw. Because the transaction has been transmitted to the RRA Authority Server, the verification will confirm that the receipt is genuine and has not been altered.

---

## SECTION 3: KEY FEATURES

### Feature 1: Complete Receipt Type Support

Excledge ERP/POS implements all seven receipt types defined in the RRA CIS/VSDC Technical Specification, Section 5. The system's receipt engine uses the `RcptLabel` enumeration in the database schema to enforce that only valid receipt types are ever assigned to a transaction. The supported types are: **NS (Normal Sale)** — the standard certified receipt issued for every completed sale of goods or services; **NR (Normal Refund)** — issued when a previously certified sale is reversed or refunded, with a mandatory reference to the original NS receipt; **CS (Copy Sale)** — a reprint of a previously issued NS receipt bearing a clear copy indicator; **CR (Copy Refund)** — a reprint of a previously issued NR receipt; **TS (Training Sale)** — issued during training mode operations, clearly watermarked to prevent confusion with live receipts; **TR (Training Refund)** — the training-mode equivalent of an NR receipt; and **PS (Proforma Sale)** — a proforma invoice that does not constitute a certified receipt but is tracked within the system. Each receipt type maintains its own independent sequential counter per branch, so the receipt counter shown on a Normal Sale receipt reflects only the sequence of Normal Sale receipts for that branch, providing a clear and auditable trail per transaction type.

### Feature 2: Real-Time VSDC Communication

The Excledge ERP/POS VSDC communication layer is engineered to meet the strict timing and protocol requirements defined in the RRA specification. All requests to the VSDC are transmitted with a mandatory timeout of exactly **1,000 milliseconds** (one second), controlled by the `EBM_REQUEST_TIMEOUT_MS=1000` configuration constant. This timeout value is set in accordance with CIS specification Section 24.2.1 and ensures that the CIS does not indefinitely block on a VSDC response, protecting the cashier experience and system throughput. Communication uses the JSON command protocol defined in the RRA ALGO EBM API v8.2, with all requests and responses fully logged. To ensure continuous VSDC availability monitoring, the system includes a `vsdcHeartbeat()` function that periodically polls the VSDC `/status` endpoint, allowing operations teams to detect and respond to VSDC connectivity issues before they affect sales. When the VSDC does not respond within the timeout window, the system automatically queues the transaction in the transactional outbox (`EbmOutbox` table) for retry with exponential backoff, ensuring that no transaction is lost and that VSDC submission is eventually guaranteed.

### Feature 3: RRA-Compliant Receipt Format

Every certified receipt produced by Excledge ERP/POS includes the complete **SDC INFORMATION** block as required by the RRA CIS/VSDC Technical Specification. This block contains the VSDC-assigned date and time (distinct from the system transaction time), the SDC ID identifying the specific VSDC device that signed the receipt, the receipt counter displayed in the mandatory A/B RT format (for example, `168/258 NS`, where 168 is the type-specific counter, 258 is the cumulative counter, and NS is the receipt type label), the internal data value assigned by the VSDC, and the receipt signature string displayed with a dash character inserted after every four characters, exactly as required by the specification. Additionally, every receipt contains the QR code image encoding the RRA-mandated string in the format `ddmmyyyy#hhmmss#sdc#rcpt#data#sig`, where the fields represent the date, time, SDC identifier, receipt number, internal data, and signature respectively. The receipt also displays the RRA official logo, the business name, TIN, VRN, and branch information as required, and the Excledge software version (1.0.0) is displayed on all printed outputs, enabling RRA inspectors to identify and verify the software version at any time.

### Feature 4: Four-Band VAT Engine

Excledge ERP/POS implements Rwanda's full VAT tax code structure as defined in the CIS specification Sections 7.22 and 7.23. The system uses the `RraTaxCode` enumeration in the database, which enforces assignment of one of the following codes to every item and service: **Tax Code A** — VAT-exempt transactions (0% VAT rate, applicable to exempt goods and services under Rwandan law); **Tax Code B** — Standard-rated VAT at 18%, applicable to most commercial goods and services and representing the primary revenue-generating tax category for Rwandan businesses; **Tax Code C** — Zero-rated VAT (0% VAT rate, applicable to zero-rated supplies including exports and specified categories); **Tax Code D** — Other category for specific transaction types; and **Tax Code E** — For additional specified categories as defined by the RRA. The receipt engine correctly calculates VAT amounts for each line item based on its assigned tax code, accumulates totals per tax code across all line items in the transaction, and prints the tax summary section on every receipt, showing the taxable amount and VAT amount for each rate where the value is greater than zero, in full compliance with the specification's receipt printing requirements.

### Feature 5: X and Z Daily Reports

The Excledge ERP/POS daily reporting module implements both the X Report (interim daily summary) and the Z Report (end-of-day closing report) as defined in the RRA CIS/VSDC Technical Specification Sections 18 and 19 respectively. The **Z Report** is a legally significant accounting record that must be generated at the close of every business day. It consolidates all certified receipts issued during the day, totals sales and VAT by tax code, records the opening and closing receipt sequence numbers, and is electronically submitted to the VSDC. Once a Z Report is generated, the daily receipt counter for that branch is reset in preparation for the next business day, and the Z Report record becomes permanently immutable in the system's database. The **X Report** is an interim summary report that can be generated at any point during the business day without resetting counters, providing branch managers and supervisors with a real-time view of the day's trading activity. Both reports are generated per branch per MRC (Machine Registration Code), ensuring that each EBM device's data is independently accounted for, and both include all twenty fields mandated by the RRA specification, including total sales by receipt type, VAT breakdown by tax code, number of receipts issued, number of voids and refunds, and the net tax liability for the period.

### Feature 6: Electronic Journal (EJ_DATA)

The Excledge ERP/POS Electronic Journal feature ensures that a complete, structured record of every Normal Sale (NS) and Normal Refund (NR) receipt is transmitted to the VSDC in the EJ_DATA format as defined by the RRA CIS/VSDC Technical Specification Sections 6.5 and the EJ_DATA command specification in Section 24.7.7. The Electronic Journal serves as the authoritative audit trail of all certified transactions for a given business day and EBM device. The Excledge implementation generates the complete EJ_DATA payload for each transaction — including all header fields, line-item detail, tax summary, and receipt signature fields — and queues it for transmission to the VSDC via the Electronic Journal service (`electronic-journal.service.ts`). This ensures that the RRA Authority Server receives a complete, independently verifiable record of all transactions, separate from the individual invoice submissions, providing a second layer of audit assurance. The Electronic Journal records are retained in the Excledge database permanently and are accessible to authorised users and RRA auditors through the system's audit interface.

### Feature 7: Multi-Branch Architecture

Excledge ERP/POS is designed from the ground up to support businesses with multiple branches, each operating as an independent, RRA-registered EBM device. Each `Branch` record in the system stores a complete set of RRA-mandated device identifiers: the **bhfId** (a 2-digit RRA branch code uniquely identifying the branch within the organisation), the **ebmDeviceId** (the EBM device identifier assigned by the RRA), the **ebmSerialNo** field which stores the Machine Registration Code (MRC) in the RRA-mandated format `BBBCCNNNNNN` (where BBB is the business category code, CC is the country code, and NNNNNN is the device serial number), and the **vsdcUrl** (the per-branch URL of the VSDC endpoint to which this branch's transactions are submitted). Receipt sequence counters are maintained independently per branch per receipt type in the `BranchReceiptCounter` table, ensuring that each branch's receipt numbering is entirely autonomous and that a receipt sequence for one branch can never interfere with the receipt sequence of another branch. One EBM device per branch is enforced at the data model level, as required by RRA regulations, ensuring full compliance with the requirement that each physical or logical branch of a business has its own dedicated, registered EBM device.

### Feature 8: Multi-Tenant Support

The Excledge ERP/POS platform is built as a true multi-tenant system, enabling multiple independent organisations to share the same platform infrastructure while maintaining complete and absolute data isolation from one another. The `Organization` model in the system stores each tenant's unique 9-digit Taxpayer Identification Number (TIN), Value Added Tax Registration Number (VRN), and all other tax-related configuration fields. Every query in the system is scoped by `organizationId`, ensuring that no data from one organisation is ever accessible to users of another organisation. Each organisation can operate one or more branches, each with its own independent EBM device registration. The system supports the full range of Rwandan business types that require EBM compliance, including pharmacy and medical supply businesses, retail and wholesale operations, service-based businesses, and hospitality establishments, with business-type-specific workflows and reporting configurations available for each. Multi-tenant architecture allows Excledge CPA Ltd to efficiently deploy and maintain the system for multiple clients while providing each client with a completely private, secure, and independently configured environment.

### Feature 9: Offline Resilience and Guaranteed VSDC Delivery

The Excledge ERP/POS system implements a **transactional outbox pattern** using the `EbmOutbox` database table to guarantee that every completed sale is eventually submitted to the VSDC, even in the event of temporary network interruptions, VSDC unavailability, or system restarts. When a sale is confirmed, the system creates an `EbmOutbox` record atomically within the same database transaction that records the sale, deducts inventory, and records the payment. This means that the EbmOutbox entry for a sale is always created if and only if the sale itself is recorded — there is no possibility of a sale being recorded without a corresponding VSDC submission attempt, or of a VSDC submission attempt being lost without the corresponding sale record. The `ebm-outbox.job.ts` background worker continuously monitors the EbmOutbox table and processes pending submissions in order of creation. If a VSDC call fails, the worker applies an exponential backoff retry strategy, increasing the interval between retries to avoid overwhelming a temporarily unavailable VSDC while still ensuring prompt recovery when connectivity is restored. The status of each outbox record progresses through the following lifecycle: `PENDING` (created with the sale, awaiting first submission attempt), `PROCESSING` (currently being submitted to the VSDC), `SUCCEEDED` (VSDC accepted and signed the transaction), `FAILED` (last attempt failed, retry pending), and `DEAD_LETTER` (maximum retry attempts exhausted, requiring manual intervention).

### Feature 10: Inventory Control and Stock Management

Excledge ERP/POS integrates inventory control directly into the sales transaction workflow, providing the stock management capabilities required by the RRA CIS specification. A **stock gate** is enforced at the point of sale: before confirming any sale transaction involving a physical stock item, the system verifies that the available quantity of the item in the selling branch is equal to or greater than the quantity being sold. If insufficient stock is available, the sale is blocked and the cashier is informed, preventing the issuance of receipts for goods that are not actually in stock, which would create discrepancies between certified sales records and actual inventory. Service items (records with `ItemType.SERVICE`) are appropriately exempted from the stock gate check, as they represent non-physical services for which stock levels are not applicable. The system produces a **closing stock report by date** per branch, reflecting the stock position as at the close of each business day, as required by specification Section 7.31. Inventory updates are synchronised with the VSDC via the `/saveItem` and `/selectMvmt` endpoints, ensuring that the VSDC's item catalogue and stock movement records remain consistent with the Excledge inventory database.

### Feature 11: Training Mode

Excledge ERP/POS includes a fully functional **training mode** that allows business owners and managers to train new staff on the complete POS workflow — from opening a sale to issuing a certified receipt — without generating any real tax records or submitting any data to the RRA Authority Server. Training mode is enabled at the organisation level via the `Organization.trainingMode` boolean field, which can only be toggled by users with appropriate administrative permissions. When training mode is active, all receipts issued are of the TS (Training Sale) or TR (Training Refund) type, as specified in the RRA specification Section 16. Training receipts are clearly watermarked with a "TRAINING" indicator to prevent them from being mistakenly accepted as genuine certified receipts. The VSDC communication layer does not submit training transactions to the RRA Authority Server, and no tax records are created. The training workflow is otherwise identical to the live workflow, giving staff authentic practice with receipt issuance, payment processing, item lookup, and refund procedures. When the organisation is ready to go live, training mode is disabled and all subsequent transactions are processed as live certified transactions.

### Feature 12: Audit Interface and RRA Inspection Support

Excledge ERP/POS provides a dedicated, read-only audit interface designed to support RRA inspections and internal audit requirements. The system includes a specific auditor role with read-only access to all certified receipts, daily X and Z reports, Electronic Journal (EJ_DATA) records, VSDC communication logs, receipt sequence integrity reports, and the complete activity log. The `ActivityLog` table records every significant system action — including receipt issuance, receipt cancellation, daily report generation, user login events, configuration changes, and administrative actions — with a timestamp, the identity of the user who performed the action, the branch at which the action occurred, and a complete record of the data that was created or modified. This log is immutable once written and cannot be modified or deleted by any user, including system administrators, ensuring a reliable and tamper-evident audit trail that satisfies the requirements of specification Section 7.26. RRA inspectors can be granted temporary auditor access to review all relevant records for a specific branch or date range without being able to modify any data in the system.

### Feature 13: Software Version Verification

Excledge ERP/POS displays the current software version (1.0.0) in multiple locations to enable verification by RRA personnel, business owners, and auditors at any time, as required by specification Section 7.7. The version number is prominently displayed on every printed and electronic receipt in the receipt footer, in the system settings screen accessible to administrative users, and at the `/health` API endpoint, which returns a machine-readable JSON response including the version number, build timestamp, and system health indicators. This ensures that RRA inspectors can instantly confirm the software version in use at any branch during a physical inspection, that remote verification is possible via the health endpoint, and that the version displayed on archived receipts provides a permanent record of the software version under which each receipt was issued.

---

## SECTION 4: TECHNICAL SPECIFICATIONS

### 4.1 System Specifications Table

| Specification | Details |
|---|---|
| **Software Name** | Excledge ERP/POS |
| **Software Version** | 1.0.0 |
| **Document Reference** | EXC-BROCHURE-v1.0.0-2026 |
| **Certification Category** | Certified Invoicing System (CIS) |
| **VSDC Integration Protocol** | RRA ALGO EBM API v8.2 |
| **RRA Specification Compliance** | CIS/VSDC Technical Specification Ver.1.0, March 2018 |
| **Deployment URL** | https://erp.exceledgecpa.com |
| **Application Type** | Web-based SaaS ERP/POS |
| **Backend Runtime** | Node.js 20 (LTS) |
| **Backend Language** | TypeScript |
| **Backend Framework** | Express.js |
| **Database Engine** | PostgreSQL 16 |
| **ORM Layer** | Prisma ORM |
| **Frontend Framework** | React 18 |
| **Frontend Language** | TypeScript |
| **Architecture** | Multi-tenant, multi-branch |
| **Deployment Model** | Cloud-hosted SaaS |
| **VSDC Timeout** | 1,000 ms (EBM_REQUEST_TIMEOUT_MS=1000) |
| **Receipt Types Supported** | NS, NR, CS, CR, TS, TR, PS (all 7 RRA types) |
| **VAT Tax Codes Supported** | A, B, C, D, E (complete RraTaxCode enumeration) |
| **Payment Methods** | CASH, MOBILE_MONEY, CREDIT_CARD, INSURANCE, DEBT, MIXED |
| **VSDC Endpoints Used** | /saveInvc, /saveItem, /selectMvmt, /savePurc, /selectImportInvc, /status |
| **Receipt Counter Format** | A/B RT (e.g. 168/258 NS) |
| **QR Code Format** | ddmmyyyy#hhmmss#sdc#rcpt#data#sig |
| **MRC Format** | BBBCCNNNNNN (as per RRA specification) |
| **Offline Queue** | EbmOutbox table (PENDING/PROCESSING/SUCCEEDED/FAILED/DEAD_LETTER) |
| **Database Transactions** | ACID-compliant (PostgreSQL 16) |
| **Outbox Pattern** | Transactional outbox (sale + outbox in single atomic transaction) |
| **Daily Reports** | X Report (interim) and Z Report (end-of-day) per branch per MRC |
| **Electronic Journal** | EJ_DATA per specification Section 24.7.7 |
| **Training Mode** | Organization.trainingMode boolean (TS/TR receipt types) |
| **Audit Logging** | Immutable ActivityLog table with timestamps |
| **Branch Identifier** | bhfId (2-digit RRA branch code) |
| **EBM Device Identifier** | ebmDeviceId + ebmSerialNo (MRC) per branch |
| **VSDC URL** | Per-branch vsdcUrl field (supports multi-branch VSDC routing) |
| **TIN Storage** | Organization.TIN (9-digit) |
| **VRN Storage** | Organization.VRN |
| **Stock Gate** | Enforced pre-sale for ItemType.PRODUCT; exempt for ItemType.SERVICE |
| **Receipt Immutability** | Certified receipts are write-once; cancellation creates NR, not deletion |
| **Minimum Browser** | Chrome 110+, Firefox 115+, Edge 110+, Safari 16+ |
| **Minimum Internet Speed** | 2 Mbps (for real-time VSDC communication) |

---

## SECTION 5: RRA COMPLIANCE STATEMENT

### 5.1 Formal Declaration of Compliance

Excledge CPA Ltd hereby formally declares that Excledge ERP/POS version 1.0.0, as submitted for certification under this application reference [APPLICATION REF], has been designed, developed, and tested in full compliance with the **Rwanda Revenue Authority CIS/VSDC Technical Specification Version 1.0, dated March 2018**, and with all applicable provisions of Rwandan tax law governing the use of Certified Invoicing Systems. The system implements every mandatory functional requirement of the CIS specification, including but not limited to: the generation and management of all seven certified receipt types; real-time VSDC communication with the mandated 1,000-millisecond timeout; the complete SDC INFORMATION block on every receipt; QR code generation in the mandated format; complete four-band VAT calculation and display; independent sequential receipt counters per branch per receipt type; daily X and Z report generation; Electronic Journal (EJ_DATA) transmission; stock gate enforcement; training mode; software version display; and a read-only audit interface. Excledge CPA Ltd further commits to maintaining compliance with all future amendments to the RRA CIS/VSDC specification and to releasing compliant updates to the software within the timeframes established in the accompanying Software Product Warranty Statement (Document Reference: EXC-WARRANTY-v1.0.0-2026).

### 5.2 Compliance Matrix

The following table maps the key sections of the RRA CIS/VSDC Technical Specification Version 1.0 (March 2018) to the corresponding implementation in Excledge ERP/POS version 1.0.0.

| Spec Section | Requirement Description | Excledge Implementation | Status |
|---|---|---|---|
| Section 4 | General CIS functional requirements | Full ERP/POS platform with inventory, sales, VAT, receipt management | COMPLIANT |
| Section 5 | Receipt types (NS, NR, CS, CR, TS, TR, PS) | RcptLabel enum; all 7 types implemented with per-type sequential counters | COMPLIANT |
| Section 6.5 | Electronic Journal (EJ_DATA) | electronic-journal.service.ts; EJ_DATA generated per NS/NR transaction | COMPLIANT |
| Section 7.7 | Software version display | Version 1.0.0 on receipts, settings screen, and /health API endpoint | COMPLIANT |
| Section 7.22 | VAT tax code A (exempt) | RraTaxCode.A; 0% VAT; printed on receipt when applicable | COMPLIANT |
| Section 7.23 | VAT tax codes B, C, D, E | RraTaxCode enum; B=18%, C=0% zero-rated, D and E implemented | COMPLIANT |
| Section 7.26 | Audit access for RRA inspectors | Read-only auditor role; ActivityLog; all receipts and reports accessible | COMPLIANT |
| Section 7.30 | Stock gate (block sale if insufficient stock) | Pre-sale stock check; blocks if stock < quantity; service items exempt | COMPLIANT |
| Section 7.31 | Closing stock report by date | Closing stock report per branch per date; /selectMvmt VSDC sync | COMPLIANT |
| Section 16 | Training mode | Organization.trainingMode boolean; TS/TR types; watermarked; no RRA submission | COMPLIANT |
| Section 18 | X Report (interim daily report) | X Report per branch per MRC; all 20 required fields | COMPLIANT |
| Section 19 | Z Report (end-of-day closing report) | Z Report per branch per MRC; immutable once generated; counter reset | COMPLIANT |
| Section 24.2.1 | VSDC request timeout (1,000 ms) | EBM_REQUEST_TIMEOUT_MS=1000 enforced in vsdc-api.service.ts | COMPLIANT |
| Section 24.7.7 | EJ_DATA command | electronic-journal.service.ts; full EJ_DATA payload per specification | COMPLIANT |
| MRC Format | BBBCCNNNNNN device identifier | Branch.ebmSerialNo stores MRC in BBBCCNNNNNN format | COMPLIANT |
| QR Code | ddmmyyyy#hhmmss#sdc#rcpt#data#sig | QR code generated from VSDC response; mandated format enforced | COMPLIANT |
| Receipt Counter | A/B RT format (e.g. 168/258 NS) | BranchReceiptCounter table; counter displayed in A/B RT format | COMPLIANT |
| SDC Block | Complete SDC INFORMATION on receipt | VSDC date/time, SDC ID, counter, internal data, signature (dash/4) on every receipt | COMPLIANT |
| VSDC Endpoints | /saveInvc, /saveItem, /selectMvmt, /savePurc, /selectImportInvc, /status | All endpoints implemented in vsdc-api.service.ts | COMPLIANT |
| Outbox | Guaranteed VSDC delivery | EbmOutbox transactional outbox; retry with exponential backoff | COMPLIANT |
| Multi-branch | Per-branch bhfId, MRC, vsdcUrl | Branch model with independent bhfId, ebmDeviceId, ebmSerialNo, vsdcUrl | COMPLIANT |
| Immutability | Receipts cannot be modified after issuance | Certified receipts are write-once; refunds create NR; no record deletion | COMPLIANT |
| Cancel Once | Each receipt can be refunded only once | NR reference to original NS enforced; duplicate refund prevention | COMPLIANT |

---

## SECTION 6: COMPANY INFORMATION

### 6.1 Software Developer and Applicant

| Field | Details |
|---|---|
| **Company Legal Name** | Excledge CPA Ltd |
| **Company Type** | [Limited Liability Company / Other] |
| **Registration Number** | [COMPANY REGISTRATION NUMBER] |
| **TIN** | [COMPANY TIN] |
| **Street Address** | [STREET ADDRESS] |
| **Sector** | [SECTOR] |
| **District** | [DISTRICT] |
| **Province** | Kigali City / [PROVINCE] |
| **Country** | Republic of Rwanda |
| **Email** | exceledgecpaltd@gmail.com |
| **Telephone** | [TELEPHONE NUMBER] |
| **Website** | https://erp.exceledgecpa.com |
| **Authorised Representative** | [FULL NAME OF AUTHORISED REPRESENTATIVE] |
| **Representative Title** | [TITLE / POSITION] |
| **Representative TIN** | [REPRESENTATIVE TIN] |

### 6.2 Application Details

| Field | Details |
|---|---|
| **Application Type** | New CIS Certification Application |
| **Product Name** | Excledge ERP/POS |
| **Product Version** | 1.0.0 |
| **Application Reference** | [APPLICATION REF] |
| **Date of Application** | June 2026 |
| **RRA Specification Version** | CIS/VSDC Technical Specification Ver.1.0, March 2018 |
| **EBM API Version** | RRA ALGO EBM API v8.2 |

### 6.3 Technical Contact

| Field | Details |
|---|---|
| **Technical Contact Name** | [TECHNICAL CONTACT FULL NAME] |
| **Title** | [TITLE] |
| **Email** | exceledgecpaltd@gmail.com |
| **Telephone** | [TELEPHONE NUMBER] |

---

*This document is prepared in support of the RRA CIS/VSDC certification application for Excledge ERP/POS version 1.0.0. All technical specifications herein reflect the actual production implementation. Bracketed placeholders ([...]) must be completed with the correct company-specific information before submission to the Rwanda Revenue Authority.*

*Document Reference: EXC-BROCHURE-v1.0.0-2026*
*Document Version: 1.0*
*Date: June 2026*
*Classification: Certification Submission Document*
