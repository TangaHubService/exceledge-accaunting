# EXCLEDGE ERP/POS
# PRODUCT USER MANUAL

---

**Software Version:** 1.0.0
**Document Reference:** EXC-USERMAN-v1.0.0-2026
**Audience:** Cashiers, Managers, Business Owners
**Language:** English
**System URL:** https://erp.exceledgecpa.com
**Date:** June 2026
**Support Email:** exceledgecpaltd@gmail.com
**Classification:** Public — For Distribution to Authorized Staff

---

## TABLE OF CONTENTS

1. [Introduction](#section-1-introduction)
   - 1.1 About This Manual
   - 1.2 About Excledge ERP/POS
   - 1.3 Key Terms You Must Understand
   - 1.4 User Roles
   - 1.5 How to Get Help
   - 1.6 About the Software Supplier

2. [Getting Started](#section-2-getting-started)
   - 2.1 Accessing the System
   - 2.2 Logging In
   - 2.3 The Main Dashboard
   - 2.4 The VSDC Status Indicator — CRITICAL

3. [Making a Normal Sale (NS Receipt)](#section-3-making-a-normal-sale-ns-receipt)
   - 3.1 through 3.17 — Step-by-step sale process
   - 3.15 (expanded) Understanding Your NS Receipt — Complete Walkthrough

4. [Processing a Refund (NR Receipt)](#section-4-processing-a-refund-nr-receipt)
   - 4.1 When Is a Refund Allowed?
   - 4.2 Step-by-Step Refund Process
   - 4.3 Understanding the NR Receipt
   - 4.4 Rules the Cashier Must Follow
   - 4.5 What Happens if a Refund is Rejected

5. [Reprinting a Receipt (CS/CR Receipt)](#section-5-reprinting-a-receipt-cscr-receipt)
   - 5.1 When to Reprint
   - 5.2 Step-by-Step Reprint Process
   - 5.3 Understanding the COPY Receipt
   - 5.4 Important Rules

6. [Training Mode (TS/TR Receipts)](#section-6-training-mode-tstr-receipts)
   - 6.1 What Training Mode Is
   - 6.2 How to Activate Training Mode (Admin Only)
   - 6.3 What Training Receipts Look Like
   - 6.4 Critical Warning
   - 6.5 How to Deactivate Training Mode (Admin Only)

7. [Proforma Invoices (PS Receipts)](#section-7-proforma-invoices-ps-receipts)
   - 7.1 What a Proforma Is
   - 7.2 How to Create a Proforma Invoice
   - 7.3 Converting a Proforma to a Real Sale
   - 7.4 What the PS Receipt Shows

8. [Daily Reports](#section-8-daily-reports)
   - 8.1 The X Report (Interim Daily Report)
   - 8.2 The Z Report (End-of-Day Report) — Legal Document
   - 8.3 The PLU Report (Per-Item Sales Report)

9. [Inventory Management](#section-9-inventory-management)
   - 9.1 Adding Stock (Receiving Goods)
   - 9.2 What Happens When Stock Runs Out
   - 9.3 Stock Adjustment (Write-Off, Damage, Correction)
   - 9.4 Closing Stock Report

10. [Managing the VSDC Offline Queue](#section-10-managing-the-vsdc-offline-queue)
    - 10.1 What Happens When VSDC Goes Offline
    - 10.2 What the Cashier Sees and Must Do
    - 10.3 What the Manager Must Do
    - 10.4 How to Check the Offline Queue
    - 10.5 VSDC Error Codes in Plain Language

11. [Common Problems and Solutions](#section-11-common-problems-and-solutions)

12. [Frequently Asked Questions](#section-12-frequently-asked-questions)

13. [Programming System & Operational Parameters (Administrator Reference)](#section-13-programming-system--operational-parameters-administrator-reference)
    - 13.1 Setting Up Tax Codes on a Product
    - 13.2 Changing a Product's Price
    - 13.3 Setting Up PLU / Barcode Identifiers
    - 13.4 Creating and Naming Cashier Accounts
    - 13.5 Other System Options

14. [Peripheral Devices](#section-14-peripheral-devices)
    - 14.1 Receipt Printer
    - 14.2 Barcode Scanner

- [Appendix A: Receipt Field Complete Glossary](#appendix-a-receipt-field-complete-glossary)
- [Appendix B: RRA Contact Information](#appendix-b-rra-contact-information)
- [Appendix C: Quick Reference Card](#appendix-c-quick-reference-card)

---

## SECTION 1: INTRODUCTION

### 1.1 About This Manual

This manual is the official guide for using the Excledge ERP/POS system. It has been written for every member of staff who will use the system in their daily work, from cashiers making their first sale to managers generating end-of-day reports. You do not need any special technical knowledge to understand this manual. Everything is explained in plain, simple language.

**Who should read this manual:**
Every member of staff who uses the Excledge ERP/POS system should read the sections that apply to their role. Cashiers should focus on Sections 2, 3, 4, 5, and 6. Managers should read all sections, with particular attention to Sections 8, 9, and 10. Business owners and administrators should read the entire manual. New staff should read this manual before using the system for the first time.

**How this manual is organized:**
The manual is organized by task. Each section covers a specific thing you need to do in the system. Section 1 introduces the system and explains key terms. Sections 2 through 7 cover daily operations — logging in, making sales, processing refunds, and handling special receipt types. Section 8 covers reports. Section 9 covers inventory. Section 10 explains what to do when there are technical problems. Section 11 is a troubleshooting guide. Section 12 answers the most common questions. The Appendices contain reference information and a quick reference card you can print and keep at the till.

**How to get help:**
If you cannot find the answer to your question in this manual, see Appendix B for contact information and Appendix C for the quick reference card. You can also contact your manager, your IT support team, or the Excledge support team at exceledgecpaltd@gmail.com.

---

### 1.2 About Excledge ERP/POS

Excledge ERP/POS is a complete business management system for Rwandan businesses. In simple terms, it helps your business do three main things:

**1. Manage Sales:** Every time a customer buys something, the cashier records the sale in Excledge ERP/POS. The system automatically calculates the correct price, applies the correct tax, and produces a certified receipt that the customer can keep as proof of purchase. The system also keeps a permanent record of every sale so managers can review sales history at any time.

**2. Manage Inventory:** The system tracks how much stock you have. Every time a sale is made, stock is automatically reduced. Every time new stock arrives, it is added. The system warns you when stock is running low.

**3. Produce Reports:** At the end of every day, the system produces official reports for tax purposes. These reports are required by law and must be generated every business day. The system also produces detailed sales and inventory reports to help managers run the business better.

**Why Rwandan law requires this system:**

In Rwanda, all VAT-registered businesses and businesses whose sales exceed the taxable threshold set by the Rwanda Revenue Authority (RRA) are required by law to use an Electronic Billing Machine (EBM). The EBM law requires that every sale generates a certified receipt that is recorded by the RRA. This is how the government ensures that all taxes are collected fairly.

Excledge ERP/POS is a Certified Invoicing System (CIS). This means it is official software, certified by the RRA, that replaces the older physical EBM devices. The system is connected to the RRA's Virtual Sales Data Controller (VSDC) server through the internet. Every time a sale is made, Excledge ERP/POS automatically sends the sale information to the RRA VSDC, which checks and certifies the receipt. The RRA then has a complete, real-time record of all your business's sales.

Every receipt that comes out of Excledge ERP/POS has a special section at the bottom called the SDC Information Block. This block contains a unique digital signature from the RRA that proves the receipt is genuine. Customers can scan the QR code on the receipt at rra.gov.rw to verify that their receipt is authentic.

It is important that all staff understand that using the system correctly is not just good business practice — it is a legal requirement. Failure to generate certified receipts, or attempting to make sales without using the system, can result in serious penalties for your business.

---

### 1.3 Key Terms You Must Understand

This section explains the most important technical terms used in this manual and on your receipts. Even if you are not a technical person, understanding these terms will help you use the system correctly and answer questions from customers and RRA auditors.

---

**Electronic Billing Machine (EBM)**

An Electronic Billing Machine is a device or system that records sales and generates official receipts connected to the Rwanda Revenue Authority. In the early days of the EBM law, an EBM was a small physical hardware device that sat next to the till, like a calculator, and printed receipts on its own printer. Today, the RRA allows businesses to use software-based systems instead of physical hardware devices. These software systems are called Certified Invoicing Systems (CIS). Excledge ERP/POS is a CIS. When people say "EBM," they often mean either the old hardware device or the new software system — both do the same job of producing certified receipts connected to the RRA. The most important thing to understand is that EBM receipts are the only receipts that are legally valid for VAT purposes in Rwanda.

---

**Certified Invoicing System (CIS)**

A Certified Invoicing System is the official name for software-based EBM systems that have been certified by the Rwanda Revenue Authority to generate legally valid sales receipts. Excledge ERP/POS is a CIS. When you make a sale in Excledge ERP/POS, the system generates a certified receipt — this is what a CIS does. The word "certified" is very important: it means the RRA has tested and approved the software, and every receipt it generates carries the RRA's digital certification. A receipt from a CIS is exactly as valid as a receipt from an old physical EBM device. Businesses that use a CIS do not need a separate physical EBM device. The CIS handles everything: recording the sale, calculating the tax, sending the information to the RRA, and printing or displaying the certified receipt.

---

**Virtual Sales Data Controller (VSDC)**

The Virtual Sales Data Controller is the RRA's own server system that receives and certifies every receipt generated by your CIS. Think of it like this: every time your cashier completes a sale in Excledge ERP/POS, the system sends a message to the RRA's VSDC server. The VSDC checks the sale, records it, and sends back a digital signature. This digital signature is then printed on the receipt as the "Receipt Signature" and "Internal Data" in the SDC Information Block. The VSDC is the RRA's way of maintaining a live, real-time record of all business sales in Rwanda. The VSDC is operated by the RRA and is located on the RRA's servers — you do not need to manage it. However, your system must be connected to the VSDC through the internet for receipts to be certified. If the internet is not working, sales can still be made, but receipts are put into a queue and certified later when the connection is restored.

---

**Machine Registration Code (MRC)**

The Machine Registration Code is a unique eleven-character code that identifies your specific POS terminal (till) in the RRA's system. Every POS terminal that is registered with the RRA is assigned its own MRC. The MRC is formatted as **BBBCCNNNNNN** — where BBB is the three-character code for the software developer (Excledge), CC is the two-character certificate number for this version of the software, and NNNNNN is a six-digit number unique to your specific terminal. Your MRC never changes. It appears on every receipt generated by your terminal, in the CIS Information Block at the bottom of the receipt. The MRC helps the RRA and auditors quickly identify which business, which software, and which specific terminal generated any receipt. If you are asked for your "MRC" or "EBM serial number," look at the bottom of any receipt.

---

**TIN (Tax Identification Number)**

A Tax Identification Number is the unique nine-digit number that the Rwanda Revenue Authority assigns to every registered taxpayer — individuals, businesses, and organizations. Your business's TIN is printed on every receipt. The TIN tells the RRA which business generated the receipt. Customers who are also VAT-registered businesses may have their own TIN, and if they provide it when making a purchase, their TIN will appear on their receipt so they can use it for their own VAT input tax claims. If a customer asks for a "TIN receipt" or a "VAT invoice with TIN," they mean they want their TIN number printed on the receipt. In Excledge ERP/POS, you can add a customer's TIN by searching for the customer at the time of sale. Never guess or mistype a TIN — an incorrect TIN on a receipt can cause tax problems for your customer.

---

**Receipt Types**

Excledge ERP/POS produces seven different types of receipts. Each type has a two-letter code that appears in the receipt type field on the receipt and in the SDC receipt counter. Here is what each one means:

- **NS — Normal Sale:** This is the most common receipt. It is issued every time you complete a regular sale to a customer. This is the only type of receipt that customers can use for VAT input tax claims. The NS receipt is a legally valid tax invoice.

- **NR — Normal Refund:** This receipt is issued when you give a customer a refund for a previous NS sale. The NR receipt shows all the amounts as negative numbers, because money is going back to the customer instead of coming in. Every NR receipt must reference the original NS receipt number.

- **CS — Copy Sale:** This receipt is issued when you reprint an existing NS receipt for a customer who lost or damaged their original. The CS receipt shows the same information as the original NS but is clearly marked "COPY." A CS receipt is not a new tax invoice — it is just a copy of the original.

- **CR — Copy Refund:** This receipt is issued when you reprint an NR (refund) receipt. It works the same way as a CS — it is a copy of an existing refund receipt, marked "COPY."

- **TS — Training Sale:** This receipt is issued during Training Mode. It looks like a Normal Sale receipt but is clearly marked "TRAINING MODE." It goes through the VSDC as a training document (it receives a training receipt number but no digital signature) and is NOT legally valid. It is only for practice purposes.

- **TR — Training Refund:** This receipt is issued when you refund a TS receipt during Training Mode. Like TS, it is clearly marked "TRAINING MODE" and has no legal validity.

- **PS — Proforma Sale:** This is a quote or estimate issued to a customer before a sale is completed. A proforma is NOT a tax invoice. Customers cannot use a PS receipt for VAT claims. A proforma can be converted into a real NS receipt when the customer is ready to pay.

---

**SDC Information Block**

The SDC Information Block is the section that appears at the bottom of every certified receipt. SDC stands for Sales Data Controller (the old name for what is now called the VSDC). This block is the most important part of the receipt — it proves that the receipt has been certified by the RRA. Without this block, or if this block is incomplete, the receipt is not legally valid. The SDC Information Block contains the date and time the receipt was certified by the RRA, the SDC ID (a code identifying which VSDC server certified the receipt), the receipt counter number (showing how many receipts of each type have been issued by this terminal), the Internal Data (encrypted information about the sale), the Receipt Signature (a unique digital signature from the RRA's system), and the QR Code. If a customer or RRA auditor questions whether a receipt is genuine, the presence of a complete SDC Information Block with a valid QR code is proof that the receipt is authentic.

---

**QR Code**

The QR Code is the black-and-white square barcode that appears in the SDC Information Block at the bottom of every certified receipt. QR stands for "Quick Response" — it is a type of barcode that smartphones can read using the camera. The QR Code on your receipts contains encrypted information about the sale, including the date and time, the SDC ID, the receipt number, and the RRA digital signature. Customers can scan this QR Code with their smartphone camera (or any free QR code reader app) and visit the RRA website at rra.gov.rw to verify that the receipt is genuine. If the QR code scan shows "Receipt Found and Valid" on the RRA website, the receipt is confirmed authentic. If a customer asks "how do I know this receipt is real?", tell them to scan the QR code with their phone. The QR code format used by Excledge ERP/POS follows the RRA standard: ddmmyyyy#hhmmss#sdc#rcpt#data#sig.

---

**Receipt Signature and Internal Data**

The Receipt Signature and Internal Data are two blocks of text that appear in the SDC Information Block. They look like a long string of letters and numbers separated by dashes every four characters — for example: **A1B2-C3D4-E5F6-G7H8-...**. These strings are encrypted codes generated by the RRA's VSDC server. They are the RRA's digital "stamp of approval" on the receipt. You do not need to understand what the letters and numbers mean — they are for the RRA's computer systems. However, they must be present and complete on every certified receipt. If the Receipt Signature or Internal Data fields are blank or show an error, the receipt may not be valid, and you should contact your manager immediately. The Receipt Signature specifically proves that the RRA received and accepted the specific transaction details. The Internal Data contains additional encrypted transaction information.

---

**X Report (Interim Daily Report)**

The X Report is a summary of all sales made so far during the current business day. It can be printed or viewed at any time during the day — it does not close or reset anything. Managers often print an X Report mid-morning, at lunchtime, and in the afternoon to check how the day's trading is going. The X Report shows the total number and value of all receipts by type (NS, NR, CS, CR, etc.), the tax collected by tax code (A, B, C, D, E), payment method totals (cash, MoMo, card, etc.), and the net sales after refunds. The X Report is not a legal document — it is a management tool. You can print as many X Reports as you want during the day without any effect on the system.

---

**Z Report (End-of-Day Report)**

The Z Report is the official end-of-day sales record. Unlike the X Report, the Z Report closes the current day's accounting period and creates a permanent, final record. The Z Report contains the same information as the X Report but is final — it cannot be changed once generated. The Z Report is a legal document under Rwandan tax law. It must be generated at the end of every business day that had at least one sale. The RRA can request Z Reports during audits, and businesses are required by law to keep Z Report records for a minimum of five years. Failure to generate Z Reports or losing Z Report records can result in fines and penalties. Always print or save a PDF copy of every Z Report on the day it is generated.

---

**Training Mode**

Training Mode is a special setting in Excledge ERP/POS that allows staff to practice making sales without creating any real sale. When Training Mode is turned on, the system generates TS (Training Sale) and TR (Training Refund) receipts that look almost identical to real receipts, but are clearly marked "TRAINING MODE" and submitted to the VSDC as training documents only (no digital signature). Training Mode is used to teach new cashiers how to use the system before they start handling real customer transactions. Only administrators can turn Training Mode on or off. Training Mode must NEVER be used during real business hours when serving real customers — this would mean real sales go unrecorded by the RRA, which is a serious violation of Rwandan tax law.

---

### 1.4 User Roles

Excledge ERP/POS has five user roles. Your role determines what you can see and do in the system. Every user is assigned a role by the administrator when their account is created. If you believe you have been assigned the wrong role, contact your administrator.

| Role | What They Can Do | What They Cannot Do |
|---|---|---|
| **Administrator** | Everything: full system access, organization settings, branch configuration, training mode toggle, all reports, user management, product/category management, supplier management, all sales data across all branches | Nothing is restricted |
| **Manager** | Daily reports (X and Z), all sales data for their branch, approve and process refunds, approve stock adjustments, view inventory, view receipt history, search any receipt, assign cashier roles | System configuration, training mode toggle, create new branches, manage user accounts, view other branches' data (unless multi-branch manager) |
| **Cashier** | New sales (NS), process refunds (NR) if authorized, reprint receipts (CS/CR), view own shift summary, search their own receipts, basic POS functions | Generate X or Z reports, modify stock, access configuration, view other cashiers' data, delete products or customers |
| **Viewer** | Read-only access to reports and receipt history for their assigned branch | Make sales, process refunds, modify any data, access configuration, generate Z reports |
| **RRA Auditor** | Read-only access to ALL EBM data, all receipts for all branches, all daily reports (X and Z), all VSDC logs, sequence reports, SDC information blocks, tax summaries | Make any changes, process any transactions, modify any settings, generate new reports |

**Detailed Role Descriptions:**

**Administrator:** The Administrator has complete control over the Excledge ERP/POS system. Administrators set up the organization's profile, configure branches with their RRA Branch IDs and VSDC URLs, manage user accounts (create, edit, disable), set up products and price lists, configure tax codes, and control Training Mode. In a multi-branch business, the Administrator has visibility across all branches. Administrators are responsible for ensuring the system is correctly configured for RRA compliance. There should be at least two administrators in any business — a primary and a backup — in case one is unavailable.

**Manager:** The Manager handles daily operations. They can see all sales data for their branch, generate the required X and Z reports, approve refunds that require manager authorization, review and approve stock adjustments, and monitor the VSDC connection status. In a multi-branch business, a Manager may be assigned to one specific branch or to multiple branches. Managers are responsible for ensuring that the Z Report is generated every business day and that the printed/saved copy is archived. Managers are the first point of escalation when cashiers encounter problems.

**Cashier:** The Cashier is the primary user of the POS screen. They handle the daily customer transactions — making sales, processing refunds, and reprinting receipts as needed. Cashiers can see their own sales history and shift summary but cannot access reports or configuration. Cashiers are responsible for correctly selecting the right payment method, adding the customer's TIN when requested, and informing the manager if the VSDC goes offline or if any error occurs during a transaction.

**Viewer:** The Viewer role is for staff who need to see sales data and reports for business purposes but do not make sales themselves. Examples include accountants, internal auditors, or senior management who want to monitor sales without being able to change anything. Viewers can look at receipts, check daily totals, and view reports, but cannot click any button that would change data.

**RRA Auditor:** This role is created when an RRA official requests access to the system for auditing purposes. The RRA Auditor can see everything related to EBM compliance — all receipts, all VSDC logs, all daily reports — but cannot make any changes whatsoever to the data. This role ensures that RRA audits can be conducted efficiently without giving the auditor any ability to alter records.

---

### 1.5 How to Get Help

If you encounter a problem that is not covered in this manual, or if you need immediate help, use the following escalation procedure:

**Step 1 — Check this manual:** Use the Table of Contents or Section 11 (Common Problems and Solutions) to find a solution.

**Step 2 — Contact your manager:** Most day-to-day issues can be resolved by your branch manager. Your manager's contact details should be posted at the till.

**Step 3 — Contact IT support:** If the manager cannot resolve the issue, especially for technical problems, contact your organization's IT support team.

**Step 4 — Contact Excledge support:** For issues with the software itself, contact the Excledge support team:
- Email: exceledgecpaltd@gmail.com
- Support hours: Monday to Friday, 08:00 to 18:00 Central Africa Time (CAT)
- System URL: https://erp.exceledgecpa.com

**Step 5 — Contact the RRA EBM Helpdesk:** For issues relating to RRA compliance, VSDC certification, or receipt verification questions from customers or auditors, contact the RRA directly. See Appendix B for RRA contact details.

**Emergency Contacts for RRA Compliance Issues:**
If you are currently being audited by the RRA and have an urgent question, call your manager and IT support immediately. Do not attempt to answer detailed technical questions from an RRA auditor without your manager or compliance officer present.

---

### 1.6 About the Software Supplier

Excledge ERP/POS is developed, supported, and maintained by the software supplier registered with the Rwanda Revenue Authority as a Certified Invoicing System developer. The details below identify the supplier for RRA certification purposes and must match the Company Profile and Physical Address Declaration (document reference EXC-COMPANY-v1.0.0-2026) submitted alongside this manual — update both documents together if any of these details change.

| Field | Details |
|---|---|
| **Supplier Legal Name** | [COMPANY LEGAL NAME] |
| **Company Registration Number** | [REG NUMBER] |
| **RRA Tax Identification Number (TIN)** | [9-DIGIT TIN] |
| **Registered Physical Address** | [SEE SECTION 2 OF EXC-COMPANY-v1.0.0-2026] |
| **General Support Email** | exceledgecpaltd@gmail.com |
| **Support Phone** | [+250 7XX XXX XXX] |
| **Product / System URL** | https://erp.exceledgecpa.com |
| **Support Hours** | Monday – Friday, 08:00 – 18:00 Central Africa Time (CAT) |

**Primary contact for RRA certification and compliance matters:**

| Role | Name | Phone | Email |
|---|---|---|---|
| Authorized Representative | [FULL NAME] | [+250 7XX XXX XXX] | [EMAIL] |
| Technical Lead (VSDC Integration) | [FULL NAME] | [+250 7XX XXX XXX] | [EMAIL] |

If you are an RRA auditor or official and need to reach the supplier directly (for example, to verify a certification detail or report a defect), use the General Support Email or Support Phone above — see also Appendix B for the RRA's own contact details.

---

## SECTION 2: GETTING STARTED

### 2.1 Accessing the System

Excledge ERP/POS is a web-based system. You access it through a web browser on a computer or tablet — you do not need to install any software.

**System URL:** https://erp.exceledgecpa.com

**Supported browsers:**
- Google Chrome version 90 or newer (recommended)
- Mozilla Firefox version 88 or newer
- Microsoft Edge version 90 or newer
- Safari version 14 or newer (on Apple devices)

**Recommended device:**
- Desktop computer or laptop: best experience, full screen layout
- Tablet (10-inch screen or larger): works well, touch-friendly interface
- Mobile phone: limited — some screens may not display correctly on small screens. For making sales at a till, always use a computer or tablet with a minimum 10-inch screen.

**Internet connection:**
The system requires an internet connection for full functionality. The VSDC connection (which certifies receipts) requires internet access. If the internet is disconnected, sales can still be made but receipts will be queued for certification. See Section 10 for details on what to do when VSDC goes offline.

---

### 2.2 Logging In

Follow these steps every time you start your shift and need to log into Excledge ERP/POS:

**Step 1:** Open your web browser (Chrome, Firefox, or Edge).

**Step 2:** In the address bar at the top of the browser, type: **https://erp.exceledgecpa.com** and press Enter. Make sure you type the address correctly, including the "https://" part.

**Step 3:** The Excledge ERP/POS login page will appear. You will see a screen with the Excledge logo, an email address field, a password field, and a "Sign In" button.

**Step 4:** Click on the "Email" field and type your email address. This is the email address your administrator used when they created your account. Type it carefully — even one wrong letter will prevent you from logging in.

**Step 5:** Click on the "Password" field and type your password. As you type, the password will appear as dots for security. Make sure the Caps Lock key on your keyboard is not accidentally turned on, as passwords are case-sensitive (a capital "A" is different from a lowercase "a").

**Step 6:** Click the "Sign In" button. Wait a moment for the system to verify your details.

**Step 7:** If you have been assigned to only one branch, you will go directly to the main dashboard. If you have been assigned to multiple branches, a "Select Branch" popup will appear. Click on the branch name for the till you are working at today, then click "Confirm." You will then be taken to the main dashboard.

**You are now logged in and ready to use the system.**

---

**What to do if login fails:**

If you see an error message after clicking "Sign In," here is what to check:

- **"Incorrect email or password":** Double-check that your email address is spelled correctly and that your password is correct. Remember that passwords are case-sensitive.

- **"Account locked — too many failed attempts":** If you enter the wrong password three times in a row, your account will be locked for security. You cannot log in again until your administrator unlocks your account. Contact your administrator or manager.

- **"Account not found":** Your account may not have been created yet, or you may be using the wrong email address. Contact your administrator.

- **"Session expired, please log in again":** For security, the system automatically logs you out after a period of inactivity. Simply log in again.

- **Forgotten password:** On the login screen, click the "Forgot Password?" link. Enter your email address and click "Send Reset Link." You will receive an email with a link to reset your password. Check your spam/junk folder if you do not see the email within five minutes.

- **The page will not load:** Check that your internet connection is working by trying to open another website. If the internet is working but Excledge does not load, contact IT support.

---

### 2.3 The Main Dashboard

After logging in, you will see the main dashboard. The dashboard gives you a quick overview of the current day's business performance and provides access to all the system's features. Here is what every element on the dashboard means:

**Top Summary Cards (row of boxes at the top of the screen):**

- **Today's Revenue:** This shows the total value of all sales made today (from midnight until now), after deducting refunds. This is the net revenue for the current business day.

- **Today's Sales:** This shows the total number of completed sale transactions (NS receipts) made today. Note this is the count of transactions, not the number of individual items sold.

- **Today's VAT:** This shows the total VAT amount collected from all sales today. This is the amount that will be reported to the RRA in today's Z Report.

- **VSDC Status Indicator:** This is a small circle (dot) that shows the current connection status to the RRA VSDC. Green means connected, red means offline. This indicator is explained in detail in Section 2.4 — please read that section carefully.

**Navigation Menu (left side of screen or top bar):**

- **Dashboard:** Returns to this main screen from anywhere in the system.
- **Sales:** Access the POS screen to make new sales, view sales history, search receipts, and manage proforma invoices.
- **Inventory:** Manage products, categories, stock levels, purchase orders, suppliers, and stock adjustments.
- **Reports:** Access the X Report, Z Report, PLU Report, and other business intelligence reports.
- **Settings:** For administrators — configure organization details, branches, VSDC settings, user accounts, and system preferences.

**Top Right Area:**

- **Branch Selector:** If you have access to multiple branches, there will be a dropdown menu showing your current branch. Click it to switch to a different branch. Always make sure you are on the correct branch before making any sales.

- **Notification Bell:** A bell icon that shows alerts. A red number badge on the bell means there are unread notifications. Click the bell to see what they are. Common notifications include: "VSDC is offline," "Stock for [product] is low," "Pending receipts in queue," and "Z Report not yet generated today."

- **User Menu:** Usually shows your name or initials. Click it to see your profile, change your password, or log out.

---

### 2.4 The VSDC Status Indicator — CRITICAL

The VSDC Status Indicator is one of the most important elements on the screen. It tells you whether Excledge ERP/POS is currently connected to the RRA's certification server.

> **⚠ SAFETY REQUIREMENT AND WARNING — RECEIPTS DEPEND ON THE VSDC**
>
> Excledge ERP/POS **will not produce an RRA-certified receipt without a working connection to the VSDC.** A receipt is only legally valid — with a complete SDC Information Block, digital signature, and scannable QR code — once the VSDC has received and certified it.
>
> If the VSDC cannot be reached (indicator RED), the system does not refuse to serve customers — it records the sale locally and marks the receipt **"Pending Certification"** while the transaction waits in the internal offline queue. That receipt is **not yet a valid tax document** until the VSDC certifies it, which happens automatically the moment connectivity is restored. Staff and customers must never treat a "Pending Certification" receipt as a final, certified tax invoice.
>
> Never disable, bypass, or attempt to work around the VSDC connection check. Never issue a receipt from a modified or unauthorized version of this software. Doing so produces a document with no legal standing under Rwanda's EBM law and exposes the business to penalties.

**GREEN (Connected):**
> **VSDC Connected — All receipts are being certified in real time.**

When the indicator is green, everything is working normally. Every sale you complete is immediately sent to the RRA VSDC for certification. The customer receives a fully certified receipt with a complete SDC Information Block, digital signature, and valid QR code. This is the normal and expected state during business hours.

**RED (Offline):**
> **VSDC Offline — Sales continue but receipts are queued for later certification. Receipts printed now will be certified once the connection is restored. Contact your manager or IT support if this persists.**

When the indicator is red, the internet connection to the RRA VSDC has been interrupted. This does NOT mean you must stop serving customers. The system will continue to record every sale securely in its internal offline queue. When the internet connection is restored, the system will automatically send all queued receipts to the VSDC for certification. Receipts issued during the offline period will be updated with their certification details once the connection is restored.

**What the cashier must do when the indicator turns red:**

1. Do NOT panic. Your sales are being recorded and saved.
2. Do NOT stop serving customers. Continue making sales as normal.
3. Inform your manager immediately that the VSDC indicator has turned red, and note the time it happened.
4. Continue making sales. The system handles the queue automatically.

**What the manager must do when the VSDC goes offline:**

1. Note the exact time the VSDC went offline.
2. Check the internet connection by opening a different website on any device in the building. If websites load, the internet is working but there may be a specific issue with the VSDC server — call IT support.
3. If no websites load, check that the internet router is turned on and all cables are connected. Try restarting the router (turn it off, wait 30 seconds, turn it back on).
4. If the internet connection is restored and the VSDC indicator turns green again within 30 minutes, no further action is needed. Check the offline queue (main navigation menu → **EBM Outbox**, under the Admin section — administrators only) to confirm all receipts have been certified.
5. If the VSDC indicator is still red after 30 minutes, call IT support immediately.
6. If the VSDC indicator is still red after 2 hours, call IT support and also contact the RRA EBM Helpdesk to report the issue.
7. If the VSDC indicator has been red for 4 hours or more, the system may begin limiting new sales. Call IT support immediately and do not attempt to close the business — document everything.

---

## SECTION 3: MAKING A NORMAL SALE (NS RECEIPT)

The Normal Sale is the most common action you will perform in Excledge ERP/POS. This section walks you through every step of making a sale, from opening the POS screen to handing the receipt to your customer.

### 3.1 Starting a New Sale

Click the **"New Sale"** button. This button is prominently displayed on the main dashboard and is also accessible from the Sales menu in the navigation. Clicking it opens the POS (Point of Sale) screen.

### 3.2 The POS Screen Layout

The POS screen is divided into two panels:
- **Left panel:** This is where you search for and select products. It shows a search box at the top and a grid of product thumbnails below.
- **Right panel (the cart):** This is where selected items appear before you finalize the sale. It shows each item, its quantity, price, and tax code, plus a running total at the bottom.

### 3.3 Searching for a Product

Type the product name (or part of it) in the search box on the left panel. As you type, matching products appear below. You can also scan a product's barcode using a barcode scanner connected to the till — the scanner will automatically enter the barcode number and find the product instantly. You can search by product name, product code, or barcode number.

### 3.4 Reading the Search Results

Each product in the search results shows:
- **Product name**
- **Selling price** (including VAT if applicable)
- **Current stock level** (number of units in stock)
- **Tax code** (A, B, C, D, or E — see the glossary in Section 1.3)

Check that the stock level is sufficient before adding the product to the cart.

### 3.5 Adding a Product to the Cart

Click on the product's name or thumbnail to add it to the cart. The product will appear immediately in the right panel (cart) with a quantity of 1. If you scanned a barcode, the product is added automatically when the barcode is recognized.

### 3.6 Product in the Cart

Once a product is in the cart, you will see it listed on the right panel with: product name, quantity (starting at 1), unit price, tax code, and line total.

### 3.7 Adjusting Quantity

To change the quantity:
- Click the **"+"** (plus) button next to the product to increase the quantity by 1.
- Click the **"–"** (minus) button to decrease the quantity by 1. If you reduce to 0, the item is removed from the cart.
- Or click directly on the quantity number and type the exact quantity you need, then press Enter.

If you try to add more quantity than is in stock, the system will show a warning and will not allow you to proceed with more than the available stock.

### 3.8 Adding More Products

Repeat steps 3.3 to 3.7 for each additional product the customer wants to buy. Each new product is added as a new line in the cart. There is no limit on the number of different products you can add to one sale.

### 3.9 Adding a Customer (Optional but Important for B2B)

If the customer is a business and wants their TIN on the receipt (for their own VAT claims), click the **"Add Customer"** button at the top of the cart panel. A search box will appear. Type the customer's name or TIN number and select them from the list. If the customer is new and not yet in the system, click "New Customer" and enter their name, phone number, and TIN. Once a customer is added, their name and TIN will appear on the receipt. For individual (personal) customers, adding a customer is optional.

### 3.10 Reviewing the Cart Total

Before proceeding, review the cart carefully. At the bottom of the right panel, you will see:
- **Subtotal:** Total before tax
- **Tax breakdown:** Shows how much tax is being charged per tax code. For example, "Tax B (18%): RWF [amount]"
- **Grand Total:** The amount the customer needs to pay

Make sure the items, quantities, and total are correct. If you need to remove an item, click the trash/delete icon next to that item. Once you click "Complete Sale," you cannot change the items.

### 3.11 Selecting the Payment Method

Below the cart total, select how the customer is paying:
- **CASH** — customer pays with physical money
- **MOBILE MONEY** — customer pays via MTN MoMo, Airtel Money, or other mobile money services
- **CREDIT CARD** — customer pays by debit or credit card
- **INSURANCE** — customer's purchase is being covered by an insurance scheme
- **DEBT** — customer will pay later (creates a debt record)
- **MIXED** — customer is paying with a combination of methods (e.g., part cash and part MoMo)

If you select MIXED, additional fields appear to enter the amount paid by each method.

### 3.12 Entering Cash Amount (for Cash Payments)

If the customer is paying with cash, enter the amount the customer has given you in the "Cash Received" field. The system will automatically calculate the change you need to give back and display it clearly on screen. For example, if the total is RWF 8,500 and the customer gives you RWF 10,000, the system will show "Change: RWF 1,500."

### 3.13 Completing the Sale

Click the **"Complete Sale"** button (usually a green button at the bottom of the right panel). Before clicking, make sure:
- All items and quantities are correct
- The correct payment method is selected
- For cash, the correct amount received is entered
- The correct customer is attached (if applicable)

### 3.14 The Loading Indicator (VSDC Certification)

After you click "Complete Sale," you will see a brief loading spinner or animation for approximately one second (1000 milliseconds). During this moment, Excledge ERP/POS is:
1. Saving the sale to the database
2. Sending the sale details to the RRA VSDC server
3. Receiving the digital signature and certification back from the VSDC
4. Generating the final certified receipt

This process happens automatically and very quickly. Do not click anything or refresh the page during this moment. If the VSDC is offline, the system will still complete and save the sale, but the certification will be queued — the screen will still proceed to show the receipt.

### 3.15 Sale Complete Confirmation

A green **"Sale Complete"** screen appears, confirming the transaction was successful. This screen shows the full NS receipt with all details including the SDC Information Block at the bottom. Review the receipt before printing or sharing it with the customer.

### 3.16 Reviewing the NS Receipt on Screen

Before printing, quickly check:
- Business name and TIN at the top are correct
- All items and prices are correct
- The payment method and amount received are correct
- The SDC Information Block at the bottom is present and complete (you should see the Receipt Number, Internal Data, Receipt Signature, and QR Code)

### 3.17 Print or Share the Receipt

You now have three options:
- **Print:** Click the "Print" button to print the receipt on the connected thermal printer. Make sure the printer has paper before printing.
- **Share/Email:** Click "Share" or "Email" to send the receipt to the customer's email address. This is useful for customers who prefer digital receipts.
- **Close:** Click "Close" to go back to the dashboard without printing (use this only if the customer does not want a receipt, though every customer is entitled to receive one).

---

### 3.15 (Expanded): Understanding Your NS Receipt — Complete Walkthrough

Every NS receipt that Excledge ERP/POS generates follows a standard format that is required by the RRA. This section walks through every part of the receipt from top to bottom, explaining what each line means. Understanding the receipt helps you answer customer questions and spot any errors quickly.

**THE RECEIPT — TOP SECTION (Business Header)**

The very top of the receipt shows your business identity. This is printed on every receipt automatically from your organization's settings:

- **Business Name:** Your company's registered trading name. Example: "ACME DISTRIBUTORS LTD"
- **TIN:** Your 9-digit Tax Identification Number. Example: "TIN: 123456789"
- **Branch Address:** The physical address of the branch where this receipt was generated. This is the address registered with the RRA for this specific branch.
- **Branch Phone Number** (if configured)
- **Date and Time of the Sale:** The date and time when the cashier clicked "Complete Sale." This is the local time in Rwanda (Central Africa Time). Example: "23/06/2026 14:32:07"

**THE RECEIPT — ITEM LINES (What Was Sold)**

After the header, each item sold is listed on its own line. Each item line shows:

- **Item Name:** The product name as it appears in your inventory. Example: "FANTA ORANGE 500ML"
- **Quantity:** How many units of this item were sold. Example: "2"
- **Unit Price:** The price of one unit. Example: "RWF 800"
- **Tax Code:** A single letter showing which tax category this item falls into. Example: "B" for standard-rated at 18% VAT. The tax codes are: A (zero-rated), B (18% VAT standard rated), C (exempt), D (specific excise duty), E (zero-rated exports). The tax code tells both the customer and the RRA exactly how the item is taxed.
- **Line Total:** Quantity multiplied by unit price. Example: "RWF 1,600"

If you sold multiple different items, each appears on its own line. The system automatically handles items with different tax codes on the same receipt.

**THE RECEIPT — TOTALS SECTION (How Much Is Owed)**

Below the item lines is the totals section. For a typical sale with items taxed at Tax Code B (standard VAT rate of 18%), you will see:

- **TOTAL:** The total value of all items before tax breakdown is shown separately. This is the base amount.
- **TOTAL B-18.00%:** This is the net (excluding VAT) value of all items that are taxed at Tax Code B (18% standard VAT). In Rwandan EBM receipts, prices are shown inclusive of VAT, so this line helps the customer see the breakdown. Example: "TOTAL B-18.00%: RWF 13,559" means RWF 13,559 is the pre-VAT value of the standard-rated goods.
- **TOTAL TAX B:** This is the VAT amount charged on the Tax Code B items. This is the actual VAT the customer is paying. Example: "TOTAL TAX B: RWF 2,441"
- **GRAND TOTAL TAX:** This is the total of all tax charged across all tax codes in this receipt. Example: "GRAND TOTAL TAX: RWF 2,441"

If your receipt has items in multiple tax codes (for example, some Tax Code A and some Tax Code B items), you will see a separate "TOTAL [letter]" and "TOTAL TAX [letter]" line for each tax code that applies.

**THE RECEIPT — PAYMENT SECTION (How the Customer Paid)**

- **CASH:** If the customer paid with cash, this shows the amount of cash received. Example: "CASH: RWF 20,000"
- **CHANGE:** The amount of change given back to the customer. Example: "CHANGE: RWF 4,000"
- **MOBILE MONEY / MOMO:** If the customer paid by mobile money, this shows the amount. For mixed payments, multiple payment method lines will appear.
- **ITEMS NUMBER:** This shows the total count of individual items sold in this transaction. Example: "ITEMS NUMBER: 3" means the customer bought three individual items (could be different quantities of each).

**THE RECEIPT — SDC INFORMATION BLOCK (The Most Important Section)**

The SDC Information Block appears at the bottom of the receipt and is separated from the rest by a line or border. This block is proof that the receipt has been certified by the RRA. Every field in this block must be present and complete. Here is what each field means:

- **Date/Time:** The date and time that the RRA VSDC received and certified this receipt. This may be a fraction of a second different from the sale time shown in the header. Example: "23/06/2026 14:32:08"

- **SDC ID:** A code that identifies which specific RRA VSDC server or component certified this receipt. This number is assigned by the RRA. Example: "SDC00001234"

- **RECEIPT NUMBER (SDC Counter):** This is one of the most important fields on the receipt. It shows the running count of receipts by type for this specific terminal. The format is **A/B RECEIPT-TYPE**, where A is the number of this specific type of receipt, and B is the total number of all receipts of all types issued by this terminal. For example, **168/258 NS** means: this is the 168th Normal Sale receipt issued by this terminal, and it is receipt number 258 out of all receipt types combined (NS, NR, CS, CR, TS, TR, PS counted together). This counter is crucial for RRA audits — it must always increase sequentially, never go backwards, and never have gaps. If a customer asks what the number on their receipt means, you can explain: "168 is the number of normal sales receipts this till has generated, and 258 is the total number of all receipts this till has generated since it was set up."

- **Internal Data:** A long string of letters and numbers, printed with dashes every four characters. Example: "A1B2-C3D4-E5F6-G7H8-I9J0-K1L2-M3N4-O5P6-Q7R8-S9T0". This is encrypted data generated by the RRA VSDC that encodes key details about the transaction. It is used by RRA systems to verify receipt authenticity. You cannot read it manually and do not need to — it is for computer systems only. However, it must be present. If this field is blank, the receipt is not fully certified.

- **Receipt Signature:** Another long string of letters and numbers, printed with dashes every four characters, usually longer than the Internal Data. This is the RRA's unique digital signature for this specific receipt. No two receipts will ever have the same Receipt Signature. This is the definitive proof that the RRA has seen and recorded this specific transaction. Like the Internal Data, you cannot read it manually — it is for computer verification systems.

- **QR CODE:** The square barcode printed at the very bottom of the SDC block. Every receipt has a unique QR code. Customers can scan this with their smartphone camera and visit rra.gov.rw to confirm the receipt is genuine. The QR code contains all the key details of the receipt encoded in the RRA's standard format. If a customer asks if their receipt is genuine and has a smartphone, invite them to scan the QR code on the spot.

**THE RECEIPT — BOTTOM CIS SECTION (System Information)**

Below the SDC block, you may see a final CIS (Certified Invoicing System) section:

- **POS Receipt Number:** An internal receipt number generated by Excledge ERP/POS (separate from the SDC counter). This is the number used when searching for receipts in the system.
- **Date/Time:** The system date and time of the sale (this may be the same as the header date/time).
- **MRC:** Your terminal's Machine Registration Code. This 11-character code (format BBBCCNNNNNN) identifies the specific POS terminal and the software developer to the RRA. It appears on every receipt.

**IN SUMMARY — WHY THE SDC BLOCK MATTERS:**
The SDC Information Block transforms an ordinary sales receipt into a legally certified tax document. A customer holding a receipt with a complete and valid SDC block has proof of purchase that is legally recognized for VAT claims and that cannot be disputed by the RRA. Always ensure that the SDC block is fully printed and legible before handing the receipt to a customer. If the printer cuts off part of the receipt and the SDC block is incomplete, reprint the receipt immediately.

---

## SECTION 4: PROCESSING A REFUND (NR RECEIPT)

A refund is processed when a customer wants to return goods they previously purchased and receive their money back. In Excledge ERP/POS, processing a refund generates a special NR (Normal Refund) receipt that is sent to the RRA VSDC, just like a normal sale.

### 4.1 When Is a Refund Allowed?

Before processing a refund, make sure these conditions are met:

- **Original receipt required:** The customer must have the original NS receipt number. Without this number, the refund cannot be processed.
- **NS receipts only:** Refunds can only be processed for completed Normal Sales (NS receipts). You cannot refund a proforma invoice (PS) or a copy (CS). A training receipt (TS) can only be refunded — as a TR — while Training Mode is on, and an NS cannot be refunded while Training Mode is on.
- **One refund per original sale:** Once an NS receipt has been refunded (NR issued), it cannot be refunded again. The system will reject a second refund attempt.
- **Same organization and branch:** The refund must be processed at the same branch that made the original sale.
- **Manager approval:** Depending on your organization's settings, refunds over a certain amount may require a manager to enter their approval PIN before the refund can proceed.
- **Refund reason is mandatory:** You must enter a reason for the refund before the system will allow you to proceed.

If you are unsure whether a refund should be processed, always check with your manager before proceeding.

### 4.2 Step-by-Step Refund Process

**Step 1:** From the Sales menu or dashboard, click on **"Sales History"** or look for a **"Process Refund"** button.

**Step 2:** In the search field, enter the original NS receipt number from the customer's receipt. The receipt number appears in the SDC block (for example: "168/258 NS") or in the CIS section at the bottom. You can also search by the POS receipt number.

**Step 3:** Click **"Search"** or press Enter. The original sale will appear on screen showing all items purchased, the amounts, the payment method used, and the date of the original sale.

**Step 4:** The system automatically checks whether this receipt has already been refunded. If it has, you will see a message saying "This receipt has already been refunded" and you cannot proceed. If it has not been refunded, you can continue.

**Step 5:** Review the original sale details with the customer to confirm this is the correct receipt.

**Step 6:** Select which items to refund. You can refund all items (full refund) or only some items (partial refund). For each item you want to refund, click the checkbox next to it. If it is a full refund, click "Select All."

**Step 7:** If it is a partial refund, adjust the quantities as needed. For example, if the customer originally bought 3 items and wants to return 2, set the refund quantity to 2.

**Step 8:** Type the **reason for the refund** in the mandatory "Refund Reason" field. Be specific — for example: "Customer received wrong product size," "Product found damaged at home," "Customer changed mind (within 24 hours)."

**Step 9:** If manager approval is required, a PIN entry screen will appear. The manager must enter their PIN to authorize the refund. The system will log who authorized the refund.

**Step 10:** Click **"Process Refund."**

**Step 11:** The loading indicator appears briefly while the system sends the NR receipt to the VSDC.

**Step 12:** The NR receipt appears on screen. It will show all the refunded items with negative amounts. Print the NR receipt and give it to the customer.

**Step 13:** Return the customer's money using the same method they originally paid:
- For cash sales: count out the refund amount from the till
- For mobile money: initiate a reverse transaction
- For card payments: process the refund through the card terminal

**Step 14:** Keep a record of the refund in the refund log (see 4.4 below).

### 4.3 Understanding the NR Receipt

The NR receipt is similar to an NS receipt in format but has several key differences:

- **"REFUND" heading:** The word REFUND appears prominently at the top of the receipt to make it clear this is a refund, not a sale.
- **"REF. NORMAL RECEIPT#: [original SDC receipt number]":** This line shows the SDC receipt number of the original NS sale that is being refunded — the first number of the `RECEIPT NUMBER: n/m NS` line in the SDC INFORMATION block of the original receipt (e.g. `REF. NORMAL RECEIPT#: 201` for an original printed `201/216 NS`), exactly as in the RRA EBM receipt example 14.1. It is read from the VSDC response stored for the original sale. (The VSDC request of the refund separately carries the original's invoice number as `orgInvcNo`.)
- **Negative amounts:** All item prices and totals appear as negative numbers, because money is flowing back to the customer. For example, if the original item cost RWF 5,000, the NR receipt will show -RWF 5,000.
- **Tax amounts are negative:** The tax portion is also shown as negative — the VAT that was collected in the original sale is now being "uncollected" and returned.
- **Payment returned:** The payment section shows the refund amount as negative — for example, "CASH: -RWF 5,000" meaning RWF 5,000 was returned to the customer in cash.
- **SDC block shows NR counter:** The receipt number in the SDC block will show the NR type counter. For example: "12/259 NR" meaning this is the 12th Normal Refund receipt from this terminal.

### 4.4 Rules the Cashier Must Follow for Refunds

1. **Always record the reason:** Never process a refund without entering a reason. If the system does not ask for a reason, do not process the refund — contact your manager.

2. **Keep a written refund log:** In addition to the system record, maintain a physical refund log. For each refund, record: customer name, customer phone number if available, original NS receipt number, NR receipt number, refund amount, reason for refund, date and time, and your name as the cashier who processed it. The manager should sign the log for each entry.

3. **Cannot reverse a refund:** Once a refund has been processed and the NR receipt has been sent to the VSDC, it cannot be undone. There is no "cancel refund" option.

4. **Get manager signature on refund log:** Even if the system does not require a manager PIN for the specific refund, your organization's policy may require the manager to physically sign the refund log. Follow your organization's policy.

5. **Return money in the same form as it was received:** If the customer paid cash, refund in cash. Do not refund cash to a different mobile money number without manager authorization.

### 4.5 What Happens if a Refund is Rejected

The system may refuse to process a refund for the following reasons. Here is what each message means and what to do:

| System Message | What It Means | What To Do |
|---|---|---|
| **"Receipt already refunded"** | This NS receipt has already been refunded once. The system only allows one refund per receipt. | Explain to the customer that their original purchase was already refunded (show them the NR receipt date if needed). Escalate to manager if customer disputes this. |
| **"Receipt not found"** | The receipt number entered does not match any record in the system. | Double-check the receipt number carefully — it is easy to misread numbers. Try both the SDC counter number and the POS receipt number. If still not found, the receipt may have been generated at a different branch — contact that branch's manager. |
| **"VSDC offline — refund queued"** | The system is currently offline and cannot confirm the refund with the RRA. | The system will process the refund and queue the NR receipt for when the VSDC comes back online. Proceed with giving the customer their refund, but note that the NR receipt signature will be completed once connectivity is restored. |
| **"Manager approval required"** | This refund exceeds the automatic approval limit and needs a manager PIN. | Call the manager. The manager must come to the till and enter their PIN. Do not attempt to process the refund without manager authorization. |
| **"Original sale from a different branch"** | The NS receipt number belongs to a sale made at a different branch of the same company. | Contact the manager of the original branch. Depending on company policy, the refund may need to be processed at the original branch. |
| **"Refund reason is required"** | You tried to proceed without typing a refund reason. | Type a clear, specific reason in the refund reason field and try again. |

---

## SECTION 5: REPRINTING A RECEIPT (CS/CR RECEIPT)

### 5.1 When to Reprint

There are several legitimate reasons to reprint a receipt:

- A customer lost or misplaced their original receipt and needs another copy for their records
- The original receipt was damaged (torn, wet, faded) and is no longer readable
- The thermal printer paper ran out mid-print and the original did not print completely
- The business needs to file a copy of a receipt and cannot find the original printout
- A customer's accountant or tax consultant needs a copy for a VAT claim

Every reprint is tracked by the system. When you reprint an NS receipt, the system produces a CS (Copy Sale) receipt, and when you reprint an NR receipt, it produces a CR (Copy Refund) receipt. A copy is not a new transaction: it is not sent to the VSDC (the VSDC sales API accepts only normal "N" transactions), and it creates no new sale, refund, stock movement, payment, tax or accounting entry. Each copy is recorded in the audit log and in the sale's reprint count, which feeds the "Copy receipts" line of the X and Z reports.

Only one original is ever issued: the first print/download of a sale is the original, and any later print, download or share of the same receipt automatically comes out as its CS/CR copy.

### 5.2 Step-by-Step Reprint Process

**Step 1:** From the main menu, go to **Sales → Sales History**.

**Step 2:** Use the search tools to find the receipt you need to reprint. You can search by:
- Date of the original sale
- Sale amount
- Customer name or TIN
- Original receipt number

**Step 3:** Open the row's **⋯** menu and choose **"Print copy A4"** or **"Print copy 80mm"** — or open the sale's details, select the A4, A5 or 80mm format and click **"Download Copy (CS)"** (for a sale) or **"Download Copy (CR)"** (for a refund).

**Step 4:** The system checks that the receipt is an NS or NR of your organization and branch and that its VSDC confirmation is complete, then opens the copy in the print dialog (or downloads it as a PDF).

**Step 5:** Hand the printed copy to the customer or send them the PDF.

Training (TS/TR) and proforma (PS) documents cannot be copied as CS/CR. If the original sale's VSDC confirmation is still pending or incomplete, the copy is refused with an explanation instead of printing an invalid receipt.

### 5.3 Understanding the COPY Receipt

The CS receipt (copy of a Normal Sale) reproduces the original NS receipt exactly, with these differences:

- **"COPY" heading** at the top (a CR adds the **REFUND** title under it), again right above **SDC INFORMATION**, and as a light diagonal watermark across the page (RRA receipt example 15.1).
- **Reference to the original:** `ORIGINAL RECEIPT#: 168/258 NS` (the copied receipt's own VSDC counter). A CR additionally keeps the refund's `REF. NORMAL RECEIPT#` (the refunded sale's SDC receipt number, e.g. `201`), its refund reason and recipient.
- **"THIS IS NOT AN OFFICIAL RECEIPT"** printed in large bold text between the items and the totals.
- **Original SDC Information Block, unchanged:** the original date and time, SDC ID, receipt counter (e.g. "168/258 NS"), internal data, receipt signature and MRC are reproduced exactly as VSDC issued them for the original. A copy never receives a new counter or signature. Like the RRA example 15.1, a copy prints no QR code.
- **Original amounts:** items, quantities, unit prices, discounts, tax rates, per-band tax, totals, customer and payment details are those of the original. A CR keeps the refund's negative amounts.

**Important limitation:** A CS receipt cannot be used for VAT input tax claims. Only the original NS receipt is a valid VAT invoice. If a customer needs a receipt for VAT purposes, the CS copy is proof of the original transaction, but technically the original NS receipt is the VAT invoice. For most purposes (proof of purchase, returns, record keeping), the CS copy is perfectly adequate.

### 5.4 Important Rules About Reprints

- **Every copy is tracked:** Each copy is written to the audit log (user, time, CS/CR, copy number, format) and counted in the sale's reprint count used by the X and Z reports.
- **Copies are not sent to VSDC:** A copy reproduces the original's VSDC confirmation; it is not a new fiscal transaction, so it works even while the VSDC is offline.
- **Unlimited reprints:** There is no limit on how many copies you can print; each one is numbered and audited.

---

## SECTION 6: TRAINING MODE (TS/TR RECEIPTS)

### 6.1 What Training Mode Is

Training Mode is a special operational mode in Excledge ERP/POS designed to allow staff to learn and practice using the system without affecting any real business records or sending any data to the RRA.

When Training Mode is active, the system behaves exactly like it does in normal operation — you can make test sales, process test refunds, search for products, and complete all the steps you would in a real transaction. However, two critical things are different:

1. **Nothing real changes.** Training sales and refunds never change stock, batches, customer balances, payments, shifts or accounting, and they are left out of sales, cash-flow, debtor and dashboard reports. They are still kept in the electronic journal and audit log, and counted separately (TS/TR) on the X and Z reports.

2. **They go to the VSDC as training documents.** As the RRA specification requires for every receipt type, a TS/TR is sent to the VSDC (as a training transaction) before it prints. The VSDC returns a training receipt number but no Internal Data and no Receipt Signature. If the VSDC is unreachable, the training receipt waits — exactly like a real one.

3. **Receipts are clearly marked as training receipts.** Every receipt generated in Training Mode has "TRAINING MODE" under the header and again after the totals, and the text "THIS IS NOT AN OFFICIAL RECEIPT." There is no digital signature and no QR code.

Training Mode is perfect for:
- Teaching new cashiers how to make sales, process refunds, and search for receipts
- Demonstrating the system to a business owner or manager
- Testing new products or price lists before they go live
- Verifying that a new branch's setup is correct before the branch goes live

### 6.2 How to Activate Training Mode — ADMIN ONLY

Only users with the Administrator role can turn Training Mode on or off. If you are a cashier or manager, ask your administrator to turn on Training Mode for a training session.

To activate Training Mode:

**Step 1:** Log in with your Administrator account.

**Step 2:** Click on **"Settings"** in the navigation menu.

**Step 3:** Click on **"Organization Settings."**

**Step 4:** Scroll down to find the **"Training Mode"** section. You will see a toggle switch.

**Step 5:** Click the toggle to turn Training Mode **ON** and save. The change waits for any sale or refund that is being recorded at that moment, so no receipt is ever half normal, half training. Any POS screen that was opened before the switch must be reloaded: a sale or refund sent from a screen still showing the old mode is refused with "Receipt mode changed … Nothing was recorded — reload the page and try again." The switch is recorded in the audit log.

**Step 6:** The VSDC Status Indicator at the top of the dashboard will change from a green "Connected" dot to an orange/yellow "TRAINING" status. All users logged in across all terminals at this branch will see that Training Mode is now active.

### 6.3 What Training Receipts Look Like

Training receipts are designed to be obviously different from real receipts so they can never be confused with genuine certified receipts:

- **"TRAINING MODE"** printed in large bold text below the header (above the items) and again right above SDC INFORMATION — at least twice the size of the amounts
- **"THIS IS NOT AN OFFICIAL RECEIPT"** printed in large bold text between the items and the totals
- **TS / TR in the receipt number** of the SDC block, e.g. `RECEIPT NUMBER : 6/207 TS` — the VSDC's training counter
- **No digital signature in the SDC block:** the Internal Data and Receipt Signature lines are not printed
- **No QR code**
- A TR shows a **REFUND** title and `REF. NORMAL RECEIPT#:` followed by the SDC receipt number of the TS it refunds (e.g. `6` for an original printed `6/207 TS`)

### 6.4 CRITICAL WARNING — NEVER ISSUE TRAINING RECEIPTS TO REAL CUSTOMERS

> **⚠ WARNING — SERIOUS LEGAL RISK**
>
> **NEVER issue a training receipt to a real customer for a real purchase.**
>
> Training Mode must ONLY be used during actual training sessions with test transactions. It must NEVER be used while the business is open and serving real customers.
>
> Issuing a training receipt to a real customer instead of a real certified receipt means:
> 1. The sale is NOT recorded with the RRA
> 2. The VAT on the sale is NOT reported
> 3. The customer does NOT have a legally valid receipt
>
> This is a serious violation of Rwandan tax law (the Electronic Billing Machine Law). Businesses found to have issued training receipts to real customers may face:
> - Large fines from the RRA
> - Forced closure of the business
> - Criminal prosecution of responsible individuals
>
> If you are not sure whether Training Mode is currently active, check the VSDC Status Indicator. If it shows "TRAINING" instead of "Connected," Training Mode is ON and you must not serve real customers until an administrator turns it off.

### 6.5 How to Deactivate Training Mode — ADMIN ONLY

After a training session is complete, the administrator must turn Training Mode off before the business opens or resumes serving real customers.

**Step 1:** Log in with your Administrator account.

**Step 2:** Click on **"Settings"** → **"Organization Settings."**

**Step 3:** Find the Training Mode toggle and click it to turn Training Mode **OFF.** Confirm the action when prompted.

**Step 4:** The VSDC Status Indicator should change back to green "Connected" (or red "Offline" if there is an internet issue — in that case, fix the internet before proceeding).

**Step 5:** Make one test real NS sale (for a small amount, or with a test product if available) to confirm that the system is in live mode. The receipt generated should have a real Receipt Signature and a scannable QR code in the SDC block. Verify the signature is present before proceeding with real customer transactions.

**Step 6:** Inform all cashiers that the system is back in live mode.

---

## SECTION 7: PROFORMA INVOICES (PS RECEIPTS)

### 7.1 What a Proforma Is

A proforma invoice is a preliminary quotation or estimate that is given to a customer before the goods are delivered or the payment is made. Think of it as a "promise to sell" — it shows the customer exactly what they will be charged, but the actual sale has not happened yet.

Key facts about proforma invoices:

- A proforma is **NOT a tax invoice.** It has no legal status as a VAT document.
- A customer **cannot use a proforma for VAT input tax claims.** Only an NS receipt can be used for that.
- Proformas are most commonly used in **B2B (business-to-business)** situations where a business needs to get internal approval or budget sign-off before making a purchase.
- A proforma can be **converted into a real NS receipt** when the customer pays. The conversion creates a proper certified receipt linked to the proforma number.
- Proforma invoices are still sent to the VSDC (as PS type) and counted in the daily reports.

### 7.2 How to Create a Proforma Invoice

**Step 1:** Click **"New Sale"** to open the POS screen, exactly as you would for a regular sale.

**Step 2:** Add all the items the customer wants, with the correct quantities, exactly as described in Section 3.

**Step 3:** For a proforma, adding a customer is **required** (not optional). Click "Add Customer" and search for the customer by name or TIN. If this is a new customer, click "New Customer" to create their record. The customer's details (name, TIN, address) will appear on the proforma.

**Step 4:** Review the items and totals carefully. The proforma shows the customer exactly what they will be paying if they go ahead with the purchase.

**Step 5:** Instead of clicking "Complete Sale," click the **"Proforma"** button (usually a secondary button next to "Complete Sale"). This tells the system to generate a PS receipt instead of an NS receipt.

**Step 6:** The PS (Proforma Sale) receipt is generated and displayed. Print it or email it to the customer.

**Step 7:** The proforma is saved in the system and can be found later in Sales → Proforma Invoices.

### 7.3 Converting a Proforma to a Real Sale

When the customer is ready to pay and wants to confirm the order:

**Step 1:** Go to **Sales → Proforma Invoices.**

**Step 2:** Find the proforma invoice by customer name, proforma number, or date.

**Step 3:** Open the proforma and click **"Convert to Sale."**

**Step 4:** Review the items (you can make adjustments if the customer's order has changed).

**Step 5:** Select the payment method and enter the amount received (for cash payments).

**Step 6:** Click **"Complete Sale."** The system generates an NS receipt and sends it to the VSDC for certification. The NS receipt will include a reference to the original proforma number. The proforma is marked as "Converted" and cannot be converted again.

### 7.4 What the PS Receipt Shows

The PS (Proforma Sale) receipt clearly distinguishes itself from a real receipt:

- **"PROFORMA INVOICE"** printed at the top in large text
- **"THIS IS NOT AN OFFICIAL RECEIPT"** in bold
- **"NOT A TAX INVOICE — CANNOT BE USED FOR VAT CLAIMS"** notice
- **Customer details prominently shown** (name, TIN, address)
- **No digital signature** in the SDC block (since the RRA does not certify proformas in the same way as real sales)
- **Proforma-specific counter** in the SDC block showing the PS receipt number
- **Validity date** (if configured — for example, "This proforma is valid for 30 days")

---

## SECTION 8: DAILY REPORTS

Reports are a critical part of running a compliant business in Rwanda. Excledge ERP/POS makes it easy to generate all required reports. This section explains the three main report types you will use every day.

### 8.1 The X Report (Interim Daily Report)

**What the X Report is:**
The X Report is a running summary of all sales activity from the beginning of the current business day up to the moment you generate the report. It shows you exactly where the business stands at any point during the day. The "X" stands for a reading of the current totals — like reading a meter. Importantly, generating an X Report does NOT close the day or change anything in the system. You can generate as many X Reports as you want during the day with no consequences.

**When to use the X Report:**
- Mid-morning check (for example, after the first rush)
- Before and after a management shift change
- Before a manager takes a break
- Whenever the business owner wants to know current day totals
- To check that all sales are recording correctly before the end of the day

**How to generate the X Report:**

**Step 1:** Click **"Reports"** in the navigation menu.

**Step 2:** Click **"Daily Reports"** or **"X Report."**

**Step 3:** Confirm the branch and date (the current branch and today's date should be pre-selected).

**Step 4:** Click **"Generate X Report."**

**Step 5:** The X Report is displayed on screen. Click "Print" to print it or "Save PDF" to save a digital copy.

**What the X Report fields mean — plain language guide:**

| Report Field | What It Means |
|---|---|
| Business Name and TIN | Your business name and tax ID — confirms which business the report is for |
| Branch ID / bhfId | The RRA 2-digit code for this specific branch |
| Report Date | Today's date |
| Report Time | The time the report was generated (not end of day) |
| NS Count | How many Normal Sale receipts have been issued today |
| NS Total | Total value (RWF) of all Normal Sale receipts today |
| NR Count | How many Normal Refund receipts have been issued today |
| NR Total | Total value of all refunds given today |
| CS Count | How many Copy Sale receipts have been issued today |
| CR Count | How many Copy Refund receipts have been issued today |
| TS Count | How many Training Sale receipts were issued (should be 0 in live operation) |
| TR Count | How many Training Refund receipts were issued (should be 0 in live operation) |
| PS Count | How many Proforma Sale receipts have been issued today |
| Tax Code A Total | Total sales value of zero-rated (Tax Code A) items |
| Tax Code B Net | Net value (excluding VAT) of standard-rated (Tax Code B, 18% VAT) items |
| Tax Code B VAT | Total VAT collected on Tax Code B items — this is the VAT payable amount |
| Tax Code C Total | Total value of VAT-exempt (Tax Code C) items |
| Cash Total | Total cash received across all sales today |
| Mobile Money Total | Total MoMo payments received today |
| Card Total | Total card payments received today |
| Insurance Total | Total insurance payments received today |
| Discount Total | Total discounts given today |
| Net Sales (After Refunds) | Total NS sales minus total NR refunds = net revenue for the day |

### 8.2 The Z Report (End-of-Day Report) — Legal Document

> **⚠ LEGAL REQUIREMENT**
>
> The Z Report is an official accounting record under Rwandan tax law. It MUST be generated at the end of every business day that had at least one transaction (sale, refund, or copy receipt). Failure to generate the Z Report may result in RRA penalties and fines. The Z Report must be generated on the same calendar day as the sales it covers — you cannot generate yesterday's Z Report tomorrow.

**What the Z Report is:**
The Z Report is the final, official end-of-day closing report. Unlike the X Report, generating the Z Report closes the current day's accounting period. After a Z Report is generated, no new receipts can be added to that day's records. The Z Report creates a permanent, sealed record of all activity for that business day.

**When to generate the Z Report:**
- After the last customer of the day has been served and the last receipt has been issued
- Before closing the shop, restaurant, pharmacy, or other business
- Before counting the cash in the till
- After last sale, on the same calendar day

**How to generate the Z Report:**

**Step 1:** Make sure all sales for the day are complete. Do not generate the Z Report if customers are still being served.

**Step 2:** Click **"Reports"** in the navigation menu.

**Step 3:** Click **"Daily Reports"** → **"Z Report."**

**Step 4:** Review the current day's summary that appears on screen. This is exactly what will appear in the Z Report. Check it for any obvious errors.

**Step 5:** Click **"Generate Z Report."** A confirmation dialog appears: "This will close today's accounting period. This action cannot be undone. Are you sure?" Click **"Confirm — Generate Z Report."**

**Step 6:** The Z Report is generated, sealed, and displayed on screen.

**Step 7:** Click **"Print"** to print a physical copy on the receipt printer or on a regular A4 printer. **Print at least two copies** — one for the daily files and one for the Z Report archive.

**Step 8:** Click **"Save PDF"** to save a digital copy. Store this PDF in a secure, backed-up location.

**How to archive Z Reports:**
- Physical copies: File Z Reports in a dedicated "Daily Z Reports" folder, organized by month and year. Keep in a secure, fireproof location.
- Digital copies: Save to a cloud storage service (Google Drive, Dropbox, or company server) in a folder organized by year and month.
- **Minimum retention period: 5 years** from the date of the report, as required by Rwandan tax law. Do not delete Z Report files until they are at least 5 years old.
- If an RRA auditor requests Z Reports, you can print them directly from the system: Reports → Daily Reports → Z Report → Select Date → View/Print.

**What happens if you miss a day:**
If a business day passes without a Z Report being generated, the following day's Z Report will cover the sales from both days. The system tracks all sales, and any sales that were not included in a Z Report will be included in the next Z Report that is generated. However, this is irregular and may attract attention during an RRA audit. Always generate the Z Report every day. If you accidentally miss a day, contact your manager and IT support to document the reason and ensure the next Z Report correctly covers the missed period.

**The Z Report contains all the same fields as the X Report** but they are final and sealed. Additionally, the Z Report includes:
- Z Report sequence number (the number of Z Reports generated by this terminal — increases by 1 each day)
- Cumulative totals (grand totals since the terminal was first activated)
- Previous Z Report reference
- Digital seal from the VSDC confirming the report is final

### 8.3 The PLU Report (Per-Item Sales Report)

**What the PLU Report is:**
PLU stands for Price Look-Up. The PLU Report shows sales broken down by individual product, rather than by receipt type. It answers the question: "Which specific products did we sell, and how much of each?"

**How to generate the PLU Report:**

**Step 1:** Click **"Reports"** → **"PLU Report."**

**Step 2:** Select the date range (today, this week, this month, or custom dates).

**Step 3:** Select the branch (or all branches if you have multi-branch access).

**Step 4:** Click **"Generate."**

**What the PLU Report shows for each product:**
- Item Code: The product's internal code
- Item Name: The product name
- Selling Price: The current selling price
- Tax Code: The product's tax code (A, B, C, D, or E)
- Quantity Sold: How many units were sold in the selected period
- Total Revenue: Total sales value for this product
- Remaining Stock: How many units are currently in stock

**Common uses of the PLU Report:**
- Identifying your best-selling products to ensure you always have enough stock
- Identifying slow-moving products for promotional pricing decisions
- Checking that inventory quantities match physical stock counts
- Providing detailed sales data to suppliers during re-ordering discussions
- Tax analysis: seeing the split of sales across different tax codes

---

## SECTION 9: INVENTORY MANAGEMENT

Excledge ERP/POS includes a full inventory management system that tracks stock levels in real time. Every sale automatically reduces stock. Every stock receipt increases it. The system can alert you when stock is low.

### 9.1 Adding Stock — Receiving Goods

When new goods arrive at your business, you must record them in the system immediately. This keeps your stock levels accurate and ensures that cashiers can see correct stock availability when making sales.

**Step 1:** From the main navigation, click **"Inventory."**

**Step 2:** Click **"Purchase Orders"** and then click **"New Purchase Order."**

**Step 3:** In the "Supplier" field, search for and select the supplier. If the supplier is not in the system, click "New Supplier" to add them first with their name, address, TIN, and contact details.

**Step 4:** Add the items you are ordering. For each item:
- Click "Add Item"
- Search for and select the product from your inventory
- Enter the quantity ordered
- Enter the cost price (what you paid the supplier per unit)

**Step 5:** Review the purchase order and click **"Save Purchase Order."** The PO is saved with a PO number.

**Step 6:** When the physical goods arrive at your business, go to **Inventory → Receive Goods.**

**Step 7:** Find the relevant Purchase Order by PO number or supplier name and click on it.

**Step 8:** For each item on the PO, confirm the quantity actually received. If you received fewer items than ordered (short delivery), enter the actual quantity received. If you received more (over-delivery), contact your manager before recording the extra stock.

**Step 9:** Click **"Confirm Receipt."** The system adds the received quantities to your current stock levels.

**Step 10:** Your stock levels are now updated. Cashiers will immediately see the new stock quantities when they search for products during sales. The system also notifies the VSDC of the new stock items via the /saveItem endpoint, keeping the RRA's records aligned with your inventory.

### 9.2 What Happens When Stock Runs Out

If a cashier tries to sell more units of a product than are currently in stock, the system will prevent the sale and show this exact message:

> **"Insufficient stock — this sale cannot be completed. Current stock: [X] units. Requested: [Y] units."**

This message means you must either:
1. Reduce the quantity in the cart to the available stock level or less, or
2. Tell the customer that the full quantity is not currently available

This stock check is required by the RRA specifications (CIS/VSDC Technical Specification Section 7.30). The only exceptions are **service items** — items that do not require physical stock, such as consulting services, professional fees, or service charges. Service items are configured by the administrator with a "service" flag that bypasses the stock check.

If you believe there is a stock error (the system shows 0 units but you can see physical stock), do not try to bypass the system. Contact your manager to investigate and process a stock adjustment if needed (see 9.3 below).

### 9.3 Stock Adjustment (Write-Off, Damage, Correction)

Sometimes the physical stock does not match what the system shows. This can happen due to theft, damage, product expiry, counting errors, or data entry mistakes. When this happens, a stock adjustment is needed.

**Step 1:** From the navigation, click **"Inventory" → "Products."**

**Step 2:** Search for the product that needs a stock adjustment and click on it.

**Step 3:** Click **"Adjustments"** on the product detail page.

**Step 4:** Click **"New Adjustment."**

**Step 5:** Enter the adjustment quantity:
- Use a **positive number** to increase stock (e.g., if you found extra stock that was not recorded)
- Use a **negative number** to decrease stock (e.g., if items are damaged or expired)

**Step 6:** Select the reason for the adjustment from the dropdown list:
- Damage: items physically damaged and cannot be sold
- Expired: items past their expiry date
- Theft/Loss: items missing, possibly stolen
- Correction: fixing a data entry error
- Other: any other reason (must be explained in notes)

**Step 7:** Enter detailed notes explaining the adjustment. For example: "12 units of Fanta Orange expired (expiry date 01/05/2026). Disposed of on 15/06/2026. Authorized by [manager name]."

**Step 8:** Click **"Submit Adjustment."**

**Step 9:** If manager approval is required for adjustments above a certain value, the system will prompt for a manager PIN. The manager must enter their PIN to authorize.

**Step 10:** The stock level is updated immediately after approval.

### 9.4 Closing Stock Report for a Specific Date

The Closing Stock Report shows the complete stock position for a specific date. It is a required record under the RRA specification (Section 7.31).

**Step 1:** Click **"Reports" → "Inventory" → "Closing Stock Report."**

**Step 2:** Select the date for which you want the stock position.

**Step 3:** Select the branch.

**Step 4:** Click **"Generate."**

**Step 5:** Wait for the report to calculate (it may take a moment for businesses with large product catalogues).

**Step 6:** The report displays showing for every product: opening stock at the start of the date, purchases received during the date, sales made during the date, adjustments made during the date, and closing balance at the end of the date.

This report is useful for:
- Monthly stock takes
- Reconciling physical stock counts with system records
- RRA audit preparation
- Identifying stock shrinkage patterns

---

## SECTION 10: MANAGING THE VSDC OFFLINE QUEUE

### 10.1 What Happens When VSDC Goes Offline

When the connection to the RRA VSDC is interrupted, Excledge ERP/POS continues to work normally but stores transactions in an internal offline queue.

> **ℹ Your sales are NOT lost.**
>
> The system saves every transaction securely in the offline queue in your local database. The VSDC will receive and certify all receipts automatically when the connection is restored. You can continue serving customers normally. The offline queue is fully automatic — you do not need to do anything to manage it.

The receipts issued during offline periods will be updated with their RRA certification (Receipt Signature, Internal Data, QR Code) once the VSDC reconnects. Some businesses print a temporary receipt during offline periods and replace it with the certified version once connectivity returns.

### 10.2 What the Cashier Sees and Must Do

When the VSDC goes offline:
- The VSDC Status Indicator at the top of the screen turns **red**
- The notification bell shows an alert: "VSDC Connection Lost"
- Receipts generated while offline may show a "Pending Certification" watermark instead of the normal SDC Information Block
- Sales can still be made and receipts will still be printed or shown on screen

**What the cashier must do:**
1. Do not panic — sales are being recorded
2. Continue serving customers as normal — do not stop selling
3. Inform the manager immediately that the VSDC indicator has turned red
4. Note the time the indicator turned red
5. If you are printing receipts, inform customers that their receipt will show "Pending Certification" and that the receipt will be updated automatically. The customer may return for a certified copy if needed.

### 10.3 What the Manager Must Do

**Within the first 30 minutes of VSDC going offline:**
- Check the internet connection by trying to open any website (e.g., rra.gov.rw or google.com) on any device in the building
- If websites load, the internet is working but the specific VSDC server may be temporarily unavailable — this is usually a brief outage on the RRA's side that resolves itself
- If websites do not load, check that the internet router is powered on and all cables are properly connected
- Try restarting the router: turn it off, wait 30 full seconds, then turn it back on. Wait two minutes for it to reconnect
- Check if the VSDC status changes back to green after the router restarts

**If still offline after 30 minutes:**
- Call IT support immediately and report the outage with the time it started

**If still offline after 2 hours:**
- Call IT support (escalate to emergency support)
- Contact the RRA EBM Helpdesk to report the prolonged outage (see Appendix B for contact details)
- Document all actions taken with times

**If still offline after 4+ hours:**
- The system may begin displaying warnings about the length of the outage
- IT support must be on-site or actively working on the problem
- Contact RRA EBM Helpdesk again for guidance
- Do not close the business — document everything and continue serving customers
- The offline queue will hold all transactions until connectivity is restored

### 10.4 How to Check the Offline Queue

**Step 1:** This screen is only visible to Administrators. In the main navigation menu, find the Admin section and click **"EBM Outbox"** (it uses a Wi-Fi icon).

**Step 2:** The outbox screen shows a list of all receipts that are currently queued for VSDC certification, grouped by status count at the top: PENDING, PROCESSING, SUCCEEDED, FAILED, and DEAD_LETTER. For each entry in the list, you can see:
- Receipt type and the sale it belongs to
- Queue status
- Number of retry attempts made (retry count)
- The last error message, if any, or the confirmed SDC certification date/time once successful

**Step 3:** Normally, all items should move from PENDING to SUCCEEDED automatically when the VSDC comes back online. You do not need to do anything. Click the refresh button at the top of the screen to update the list.

**If an item is PENDING, PROCESSING, or FAILED:** Click **"Check VSDC"** next to that entry to manually ask the VSDC for its current certification status, rather than waiting for the automatic retry.

**If an item reaches DEAD_LETTER status:** This means the system exhausted its automatic retry attempts and the receipt could not be certified. A **"Request Reversal"** button appears for these entries — this starts the compensation process (reversing the inventory and customer balance impact of that sale). Do not click this without your manager's or IT support's confirmation first; contact IT support before taking action on any DEAD_LETTER entry.

### 10.5 VSDC Error Codes in Plain Language

When a transaction fails to reach the VSDC, the system logs an error code. Here is what the most common error codes mean and what to do:

| Error Code | What It Means | What To Do |
|---|---|---|
| **00** | Success — no error | No action needed. Receipt certified successfully. |
| **01** | Unauthorized — authentication failed | IT support should check VSDC credentials. Contact IT support. |
| **02** | Invalid request format | IT support issue — contact IT support. |
| **03** | TIN not registered in VSDC | Check organization TIN. Contact RRA to confirm TIN registration. |
| **04** | Branch not registered | Check bhfId (Branch ID). Contact RRA to confirm branch registration. |
| **05** | Invalid tax code | Check item tax codes. Contact IT support. |
| **06** | Duplicate receipt number | Sequence integrity issue. Contact IT support immediately. |
| **07** | Invalid payment type | Payment method not recognized by VSDC. Contact IT support. |
| **08** | Invalid item code | Product item code has formatting error. Contact IT support. |
| **09** | Stock quantity error | Stock level conflict. Contact IT support. |
| **10** | VAT calculation error | Tax amount mismatch. Contact IT support. |
| **11** | Invalid customer TIN | Customer's TIN is not registered with RRA. Ask customer to verify their TIN. |
| **12** | Refund not allowed — original not found | VSDC cannot find the original NS receipt. Verify original receipt number. |
| **13** | Refund already processed | This receipt has already been refunded. Cannot refund twice. |
| **14** | Training mode mismatch | System tried to send a training receipt to live VSDC or vice versa. Contact IT support. |
| **15** | VSDC server timeout | VSDC did not respond within the 1000ms timeout. Receipt queued for retry. |
| **99** | Unknown VSDC error | Contact IT support and RRA EBM helpdesk. |

---

## SECTION 11: COMMON PROBLEMS AND SOLUTIONS

This section provides solutions to the most common issues experienced by users of Excledge ERP/POS.

| Problem | Likely Cause | Solution |
|---|---|---|
| **Cannot log in — "incorrect password"** | Wrong password entered | Check Caps Lock is off. Try typing password somewhere you can see it first. Use "Forgot Password?" link if needed. |
| **Account locked after failed logins** | Entered wrong password 3+ times | Contact your administrator to unlock your account. |
| **VSDC indicator is red** | No internet or VSDC server issue | Follow procedure in Section 2.4 and Section 10. Inform manager immediately. |
| **Product not found when searching** | Product not in system, or name spelled differently | Try searching by product code or barcode. Check with manager if product should be in system. |
| **"Insufficient stock" error** | System stock is 0 or below requested quantity | Verify physical stock count. Contact manager for stock adjustment. Do not bypass the system. |
| **Receipt did not print** | Printer offline, no paper, or connection issue | Check printer is powered on and has paper. Check USB or network cable. Restart printer. Reprint from Sales History if needed. |
| **Sale completed but no receipt shown** | System glitch or browser refresh | Check Sales History — the sale was likely saved. Find and reprint from Sales History. Do not attempt the sale again. |
| **Wrong item added to the sale** | Human error | Click the delete/remove icon next to the wrong item in the cart BEFORE clicking "Complete Sale." Once a sale is completed and sent to the VSDC, you cannot edit it — you must process a refund and make a new sale. |
| **Customer TIN not accepted** | TIN entered incorrectly or not registered with RRA | Verify the TIN is exactly 9 digits. Ask the customer to confirm their TIN. If still rejected, proceed without TIN and contact manager. |
| **"Duplicate receipt number" warning** | Sequence integrity issue in system | STOP — do not proceed. Contact IT support immediately. This is a serious system integrity error. |
| **Z Report already generated today** | Z Report was already closed for today | You cannot generate a second Z Report for the same day. The day is already closed. Check if someone already generated it. Contact manager. |
| **Receipt printed twice accidentally** | Printer button clicked twice | The second printout is a CS (Copy Sale) receipt. Explain to the customer that they have two copies — the original (NS) and a copy (CS). Both are valid for their records. Inform manager so they are aware the CS count in the Z Report will be higher. |
| **Product showing wrong price** | Price not updated in system | Contact administrator to update the product price. Do not override the price manually unless your role allows price overrides. |
| **Customer not found when searching** | Customer not in system | Click "New Customer" to create a new customer record with their name and TIN. |
| **Cannot select a different branch** | Only one branch is assigned to your account | Contact administrator to assign additional branch access if needed. |
| **Cannot select branch at login** | Your account is assigned to only one branch | This is normal if you only work at one branch. No action needed. |
| **Printer won't print — jobs stuck** | Printer driver issue or print queue frozen | Cancel all print jobs from the computer's printer settings. Turn printer off and on. If still stuck, restart the computer. Contact IT support. |
| **Customer requests VAT invoice after purchase** | Customer forgot to request receipt at time of purchase | Find the original NS receipt in Sales History and reprint it as a CS (Copy Sale). Explain that the original NS receipt is the VAT invoice and the CS is an authorized copy. |
| **"Session expired" message** | System logged you out after inactivity | Log in again. If this happens frequently, check with IT — the session timeout may be too short. |
| **System running very slowly** | Browser issue, internet speed, or many tabs open | Close other browser tabs. Clear browser cache. Try a different browser. If still slow, contact IT support. |
| **Tax amounts look wrong on receipt** | Tax code may be wrong on the product | Contact manager and IT support to check and correct the product's tax code assignment. |
| **Cannot generate Z Report — access denied** | Your user role is Cashier or Viewer | Z Reports can only be generated by Manager or Administrator. Ask your manager. |
| **Cannot process refund — "access denied"** | Refunds may require Manager role or specific permissions | Contact manager. In some organizations, refunds require manager approval. |
| **Training mode receipts showing on Z Report** | Training receipts are included in totals when counting | A small TS/TR count may appear if testing was done. Discuss with manager. Note: training mode should only be used when business is closed. |
| **"Subscription expired" message** | Business software license has expired | This is an admin-level issue. Contact your administrator to renew the Excledge license immediately. Sales may not be possible until the license is renewed. |
| **QR code on receipt not scanning** | Printer quality issue, or QR code printed too small | The QR code requires good print quality. Try a reprint. If QR codes consistently do not scan, contact IT support to check printer DPI settings. |
| **Customer says QR code shows "not found" when scanned** | VSDC certification may still be pending | If the VSDC was offline when the receipt was issued, the QR code may not yet be in the RRA system. Once the VSDC reconnects and processes the offline queue, the QR code will be valid. Ask customer to try again the next business day. |

---

## SECTION 12: FREQUENTLY ASKED QUESTIONS

**Q1: What is the difference between the SDC receipt number and the POS receipt number?**

A: Your receipt has two different numbers on it. The POS receipt number (also called the internal receipt number) is the number assigned by the Excledge ERP/POS software — it is the number you use when searching for receipts within the system. The SDC receipt number (shown in the SDC Information Block in the format "168/258 NS") is the number assigned by the RRA VSDC system — it is the official RRA record number. The SDC counter number is the one that matters for tax compliance purposes. Both numbers are unique to your specific receipt. If an RRA auditor asks for a receipt number, give them the SDC counter number from the SDC Information Block.

---

**Q2: A customer says their receipt is fake. What do I do?**

A: A receipt from Excledge ERP/POS is certified by the Rwanda Revenue Authority and cannot be forged. If a customer questions the authenticity, ask them to scan the QR code at the bottom of the receipt using their phone camera. This will connect to the RRA website at rra.gov.rw and confirm the receipt is genuine. If the QR code confirmation shows "Receipt Valid," the receipt is genuine. If the customer still disputes it, call your manager. Do not argue with the customer.

---

**Q3: Can I process a sale without internet?**

A: Yes. Excledge ERP/POS can continue making sales even when the internet or the VSDC connection is down. When the internet is unavailable, the system stores every sale in an internal offline queue. When the internet connection is restored, the system automatically sends all queued sales to the RRA VSDC for certification. However, receipts issued during the offline period may show "Pending Certification" instead of the full SDC Information Block until the VSDC reconnects. For extended offline periods (more than 4 hours), inform your manager and IT support.

---

**Q4: What is the difference between a proforma invoice and a real receipt?**

A: A proforma invoice (PS receipt) is a quote or estimate. It tells a customer what they would be charged if they go ahead with a purchase, but no money has changed hands yet and no sale has been recorded with the RRA. A proforma is not a tax invoice and cannot be used for VAT claims. A real receipt (NS receipt) is issued when the customer actually pays and the sale is completed. The NS receipt is sent to the RRA, is certified, and is the legally valid tax invoice. When a customer who received a proforma comes back to pay, the cashier converts the proforma into a real sale, which generates an NS receipt.

---

**Q5: Why does my receipt show two different times?**

A: Your receipt has two time fields. The time at the top of the receipt (in the business header section) is the local time when the cashier clicked "Complete Sale" — this is the time the transaction happened at your till. The time in the SDC Information Block is the time at which the RRA VSDC received and certified the receipt. Because data travels over the internet, there is usually a fraction of a second difference between these two times. This is completely normal. If you see a difference of more than a few minutes, contact IT support as it may indicate a time synchronization issue.

---

**Q6: A customer scanned my QR code and the RRA website says "not found." Is there a problem?**

A: This usually happens when the VSDC was offline when the receipt was issued. The receipt has been saved by Excledge ERP/POS but has not yet been sent to the RRA VSDC. The RRA website cannot confirm the receipt until the VSDC receives and processes it. This situation resolves itself automatically once the internet connection is restored and the offline queue is processed. Ask the customer to try scanning again the next business day. If the issue persists beyond 48 hours after the receipt was issued, contact IT support.

---

**Q7: Can I give a customer a copy of a training mode receipt?**

A: No. You must never give a training mode receipt (TS or TR) to a real customer for a real purchase. Training receipts are clearly marked "TRAINING MODE" and "THIS IS NOT AN OFFICIAL RECEIPT." They have no legal validity and the transaction is not recorded with the RRA. If a training receipt was accidentally issued to a real customer, inform your manager immediately. The manager will need to take corrective action, which may include making the correct real sale and documenting what happened.

---

**Q8: How do I know if I am in Training Mode or Live Mode?**

A: Check the VSDC Status Indicator at the top of the screen. If it shows a green dot and says "Connected," you are in Live Mode — all receipts will be certified by the RRA. If it shows "TRAINING," you are in Training Mode. Also, if any receipt you generate shows "TRAINING MODE" in large text, the system is in Training Mode. If you are unsure, ask your administrator.

---

**Q9: My RRA auditor is asking for the Z Report from last month. How do I find it?**

A: Z Reports from previous days and months are stored in the system and can be accessed at any time. Go to Reports → Daily Reports → Z Report. Use the date selector to choose the specific date the auditor needs. Click "View" or "Print" to display the historical Z Report. If the auditor needs multiple days, generate each Z Report for each specific date. You can also ask your administrator to generate a range report. Note: never delete or modify Z Reports. If an auditor finds missing Z Reports, there may be a compliance issue — contact your administrator.

---

**Q10: What happens if I make a mistake in a sale after it has been completed?**

A: Once a sale has been completed and the NS receipt has been sent to the VSDC, it cannot be edited or deleted. The only way to correct a completed sale is to process a refund (NR receipt) for the incorrect sale and then make a new correct sale (NS receipt). You will need the original receipt number to process the refund. If you notice a mistake immediately after completing the sale, process the refund right away before the customer leaves. If the customer has already left, you will need to contact them to arrange the refund and re-purchase.

---

**Q11: Can two cashiers use the same account at the same time?**

A: No. Each cashier must have their own personal login account. Sharing accounts is not permitted. Having individual accounts is important for several reasons: it allows the system to track which cashier made each sale for accountability and management purposes; it allows the manager to see each cashier's shift summary separately; and it protects each cashier from being held responsible for mistakes made by someone else using their account. If a cashier does not have an account, contact the administrator to create one.

---

**Q12: What does "Tax Code B" mean on a receipt, and why does it matter?**

A: Tax Code B means the item is subject to the standard VAT rate of 18% in Rwanda. When you see "TOTAL B-18.00%" on a receipt, it is showing the pre-VAT price of all items taxed at 18%. "TOTAL TAX B" shows the actual VAT amount charged. This matters because your customers who are also VAT-registered businesses can claim back the VAT shown in "TOTAL TAX B" from the RRA as an input tax credit — but only if they have a valid NS receipt from your business. This is one reason why issuing correct certified receipts is so important: your customers' VAT claims depend on it.

---

**Q13: The printer is out of paper in the middle of a receipt. What do I do?**

A: Do not panic. The sale has already been saved in the system and sent to the VSDC — the receipt is not lost just because the printer ran out of paper. Refill the printer with paper immediately. Then go to Sales → Sales History, find the sale that did not print completely (it will be the most recent sale), and click "Reprint." A CS (Copy Sale) receipt will be generated and printed. Give this CS copy to the customer and explain that the printer ran out of paper during the original print, and this is an authorized copy.

---

**Q14: A manager has left the company. How do I remove their access?**

A: Contact your administrator immediately when any staff member leaves the company or changes roles. The administrator should: disable or delete the departed manager's user account so they can no longer log in, and change any shared passwords or PINs that the departed staff member may have known. Only administrators can manage user accounts. This should be done on the day the person leaves — leaving accounts active creates a security and compliance risk.

---

**Q15: How many Z Reports can I generate in one day?**

A: Only one Z Report can be generated per day per branch. The Z Report closes the day's accounting period, and once it is closed, it cannot be closed again. If you generate the Z Report in the morning by mistake and then make more sales, those additional sales will be included in the next day's Z Report. This is irregular and may raise questions during an RRA audit. Always generate the Z Report only at the end of the business day, after the last sale.

---

**Q16: Can I use Excledge ERP/POS on my mobile phone?**

A: Excledge ERP/POS is accessible on mobile phones through a web browser, but it is not optimized for small screens. The POS sale screen in particular requires enough screen space to show both the product search panel and the cart panel at the same time. For the daily POS work of making sales, you should use a desktop computer, laptop, or tablet with a screen of at least 10 inches. Using a phone for POS operations may result in display problems and errors. Managers who need to check reports on the go can use a phone for the reports section, which is simpler and works on smaller screens.

---

**Q17: What should I do at the start of every business day?**

A: Follow the daily opening checklist (see Appendix C for the printed quick reference card):
1. Check that the VSDC Status Indicator is green (connected)
2. Log in with your personal credentials
3. (Administrators) Check if there are any pending or failed items in the EBM Outbox from the previous day
4. Check for any low stock alerts on the dashboard notification bell
5. Confirm that you are on the correct branch in the branch selector

---

**Q18: A customer wants to split payment between cash and mobile money. How do I do this?**

A: Select **"MIXED"** as the payment method when completing the sale. After selecting MIXED, additional fields will appear on screen asking how much is being paid by each method. Enter the cash amount and the mobile money amount. The system will verify that the total of all payment amounts equals the sale total. Both payment methods will be shown on the NS receipt. The Z Report will separately total the cash and mobile money components of all mixed payment sales.

---

**Q19: What is the "Items Number" field on the receipt?**

A: "Items Number" shows the total count of individual items in the transaction. For example, if a customer bought 2 bottles of water and 1 loaf of bread, the Items Number would be 3. If they bought 5 bottles of the same water, the Items Number is 5 (not 1). This field is required by the RRA specification and helps auditors quickly understand the volume of goods in any given transaction.

---

**Q20: How long should I keep receipt records?**

A: The RRA requires businesses to keep all EBM records — including physical copies of Z Reports, electronic backups, and the digital records stored in the system — for a minimum of five (5) years from the date of the transaction. The records stored in Excledge ERP/POS are maintained automatically. Physical Z Report copies and PDF backups must be kept by the business. It is good practice to keep records for 7 years to allow for any delayed audits. Never delete records from the system, and never destroy physical Z Report archives, without confirming that they are beyond the 5-year retention period.

---

## SECTION 13: PROGRAMMING SYSTEM & OPERATIONAL PARAMETERS (ADMINISTRATOR REFERENCE)

This section is for Administrators only. It explains how to configure the parameters that control how products, prices, tax codes, and cashier accounts behave in Excledge ERP/POS. Cashiers and Managers do not need this section for daily work.

### 13.1 Setting Up Tax Codes on a Product

Excledge ERP/POS does not use custom, business-defined tax rates — it uses the five fixed RRA tax codes (A, B, C, D, E) described in Section 1.3. Configuring a product means **assigning** the correct RRA tax code to it, not creating a new rate.

**Step 1:** Go to **Inventory** in the navigation menu.

**Step 2:** Click **"Add Product"** to create a new product, or select an existing product and click **"Edit"**.

**Step 3:** In the product form, find the **"Tax Code"** field and select the correct code from the list (A, B, C, D, or E — see Section 1.3 for what each one means).

**Step 4:** Enter the **Unit Price**, which the system uses together with the tax code to calculate the tax breakdown shown on receipts.

**Step 5:** Click **"Save"** (or complete the remaining steps in the Add Product wizard, then confirm on the review screen).

**Important:** Assigning the wrong tax code to a product will cause incorrect VAT to be charged and reported to the RRA. If you are unsure which tax code applies to a product, confirm with your accountant or the RRA before saving.

### 13.2 Changing a Product's Price

**Step 1:** Go to **Inventory**, find the product, and click **"Edit"**.

**Step 2:** Update the **Unit Price** field to the new price.

**Step 3:** Click **"Save."** The new price applies to all sales made from this point forward. Sales already completed before the change keep the price that was in effect at the time of the original sale — changing the price does not alter historical receipts.

**Important:** Only Administrators (and Managers where permitted) can change prices. Cashiers cannot override a product's price at the till unless your organization has specifically granted that permission.

### 13.3 Setting Up PLU / Barcode Identifiers

Excledge ERP/POS identifies products using a **SKU** (internal stock code) and/or a **Barcode** (scannable code), either of which can serve as the product's PLU (Price Look-Up) identifier referenced in the PLU Report (Section 8.3).

**Step 1:** In the Add/Edit Product form, enter the product's **SKU** in the "SKU" field (used for internal reference and searching).

**Step 2:** Enter the product's **Barcode** in the "Barcode" field. If the product has a printed barcode, you can scan it directly into this field using a barcode scanner connected to the computer.

**Step 3:** Click **"Save."** The product can now be found at the POS by searching its name, SKU, or barcode, and will appear individually on the PLU Report.

### 13.4 Creating and Naming Cashier Accounts

Cashier (and other staff) accounts are created through an email invitation, not by typing a name directly into a form. The invited person supplies their own name when they accept the invitation and set up their account.

**Step 1:** Go to **Settings → User Management** (Administrators only).

**Step 2:** Click **"Add User"** / **"Invite User."**

**Step 3:** Enter the staff member's **email address**.

**Step 4:** Select their **Role** — for a till operator, select **Seller/Cashier**. See Section 1.4 for what each role can and cannot do. Only Administrators can assign the Administrator role to someone else.

**Step 5:** Select the **Branch** the staff member will work at.

**Step 6:** Click **"Send Invitation."** The staff member receives an email invitation; once they accept it and complete their account setup, their name will appear throughout the system (in the "Recorded By" / cashier fields on sales, reports, and the audit trail).

**To change a user's role or disable their access:** Go to Settings → User Management, find the user, and use the role dropdown or the disable toggle next to their entry. Only Administrators can disable or re-enable accounts.

### 13.5 Other System Options

The remaining system-wide options are configured under **Settings → Organization Settings** (Administrators only):

- **Organization TIN, EBM Device ID, and EBM Serial Number** — see the companion *Programming and Configuration Manual* (document 06-programming-configuration-manual) for the full procedure.
- **Branches** — create, edit, activate/deactivate branches, and set the organization's default branch, from the Branch Management tab of Organization Settings.
- **Training Mode** — turn on/off, as described in Section 6.2 and 6.5.

---

## SECTION 14: PERIPHERAL DEVICES

Excledge ERP/POS is a browser-based system. It does not require special drivers or an in-app pairing process for peripherals — printers and scanners are set up once at the operating-system level and then work through the browser like any other application.

### 14.1 Receipt Printer

**Setup:**

**Step 1:** Connect the receipt printer to the till computer, either directly by USB cable or over the network (Wi-Fi/Ethernet), following the printer manufacturer's instructions.

**Step 2:** Install the printer's driver on the computer if the manufacturer requires one, and confirm the computer's operating system recognizes the printer (it should appear in the OS's list of printers/devices).

**Step 3:** In the operating system's printer settings, you may set the receipt printer as the default printer for the till computer, so that clicking "Print" in Excledge ERP/POS sends the receipt straight to it without extra prompts.

**Operation:** When a cashier clicks **"Print"** on a completed sale (Section 3.17), the browser's print function sends the receipt to whichever printer is selected (the default, or one chosen from the browser's print dialog).

**Troubleshooting:** See the printer-related rows in Section 11 (Common Problems and Solutions) — for example, "Receipt did not print," "Printer won't print — jobs stuck," and "QR code on receipt not scanning." For hardware faults (paper jams, power issues, damaged print heads), refer to the printer manufacturer's own manual or contact IT support.

### 14.2 Barcode Scanner

**Setup:**

**Step 1:** Connect the barcode scanner to the till computer by USB cable, or pair it over Bluetooth if it is a wireless model, following the scanner manufacturer's instructions.

**Step 2:** Most barcode scanners work as a "keyboard wedge" — the operating system sees them as a keyboard, typing out the scanned number automatically. No driver or in-app configuration is normally required.

**Step 3:** Confirm the scanner is working by clicking into the product search box on the POS screen (Section 3.3) and scanning a barcoded product — the barcode number should appear in the box and the matching product should be found automatically.

**Operation:** Cashiers use the scanner at the POS screen (Section 3.3) and when entering a product's barcode in the Add/Edit Product form (Section 13.3). Always click into the relevant search or input field before scanning, since the scanner types into whichever field is currently focused.

**Troubleshooting:** If scans are not recognized, confirm the product's barcode is correctly saved in the system (Section 13.3), check the scanner's USB/Bluetooth connection, and try scanning into a plain text field (such as the browser's address bar) to confirm the scanner itself is working before assuming the fault is in Excledge ERP/POS.

---

## APPENDIX A: RECEIPT FIELD COMPLETE GLOSSARY

This glossary defines every field that appears on receipts generated by Excledge ERP/POS, listed in alphabetical order.

---

**BRANCH**
The specific location or outlet of the business that generated this receipt. In the Excledge ERP/POS system, each physical location (shop, pharmacy, restaurant, etc.) is set up as a Branch. The Branch field shows the branch name and address. Each branch has its own unique RRA-assigned Branch ID (a two-digit code called the bhfId). Knowing which branch generated a receipt is important for multi-location businesses and for RRA compliance tracking.

---

**CASH**
The amount of money paid by the customer in physical cash. Appears in the payment section of the receipt. If the customer paid entirely in cash, one CASH line will appear. If the customer paid partly in cash and partly by another method (MIXED payment), the CASH line shows only the cash portion.

---

**CHANGE**
The amount of money given back to the customer from the cash they paid. Only appears on receipts where the customer paid more cash than the sale total. For example, if the total is RWF 7,500 and the customer paid RWF 10,000, the CHANGE field shows RWF 2,500. This field only appears for cash payments.

---

**DATE**
The date on which the sale, refund, or other transaction took place, shown in the format DD/MM/YYYY (day/month/year). For example, 23/06/2026. The date at the top of the receipt (in the business header) is the date at the cashier's till. The date in the SDC Information Block is the date at the VSDC server — these are usually the same but may differ by seconds for cross-midnight transactions.

---

**GRAND TOTAL TAX**
The total tax amount charged across all tax codes in this receipt. This is the sum of all TOTAL TAX lines (Tax Code A tax + Tax Code B tax + Tax Code C tax, etc.). For most receipts, this will be the same as TOTAL TAX B since Tax Code B (18% VAT) is the most common taxable category. This is the total VAT amount that your VAT-registered customers can potentially claim as input tax credit.

---

**INTERNAL DATA**
A long string of letters and numbers in the SDC Information Block, printed with dashes every four characters (example: A1B2-C3D4-E5F6-G7H8...). The Internal Data is an encrypted code generated by the RRA VSDC that encodes key details about the transaction in a secure format that can only be read by RRA's computer systems. The Internal Data is unique to each receipt and is used by the RRA to verify that the receipt has not been altered since it was certified.

---

**ITEMS NUMBER**
The total count of individual units of goods or services included in this receipt. For example, if a customer bought 3 units of Product A and 2 units of Product B, the Items Number is 5. This is a required field in the RRA receipt specification.

---

**MRC (Machine Registration Code)**
The unique eleven-character code assigned by the RRA to identify this specific POS terminal. Appears at the bottom of the receipt in the CIS Information Block. Format: BBBCCNNNNNN — where BBB is the software developer code, CC is the certificate number, and NNNNNN is the sequential terminal number. The MRC never changes for a given terminal. It allows the RRA to instantly identify which software, which developer, and which specific terminal generated any receipt.

---

**RECEIPT NUMBER (POS — Internal)**
The receipt number assigned by the Excledge ERP/POS software system. This is the number to use when searching for a receipt within the Excledge system. It is different from the SDC counter number. The POS receipt number appears in the CIS Information Block at the bottom of the receipt.

---

**RECEIPT NUMBER (SDC Counter)**
The official RRA receipt counter number, displayed in the SDC Information Block in the format **A/B TYPE** — for example, **168/258 NS**. "A" (168 in the example) is the sequential count of receipts of this specific type (NS, NR, CS, etc.) issued by this terminal. "B" (258 in the example) is the sequential count of ALL receipts of ALL types issued by this terminal since it was first registered. "TYPE" (NS in the example) identifies the receipt type. This counter must always increase sequentially and can never go backwards. It is the most important identifying number for RRA compliance purposes.

---

**RECEIPT SIGNATURE**
A long string of letters and numbers in the SDC Information Block, printed with dashes every four characters — usually longer than the Internal Data string. The Receipt Signature is the RRA's unique digital signature for this specific receipt. It is mathematically generated from the transaction data and can only be created by the RRA's VSDC server. No two receipts will ever have the same Receipt Signature. The Receipt Signature is proof that the RRA saw and accepted this exact transaction. It cannot be forged. If a receipt does not have a Receipt Signature, or if the field is blank, the receipt is not fully certified.

---

**SDC DATE/TIME**
The date and time at which the RRA VSDC received and certified this receipt. Appears in the SDC Information Block. Usually within seconds of the sale time shown in the header, but may differ slightly due to internet transmission time. Format: DD/MM/YYYY HH:MM:SS.

---

**SDC ID**
A code in the SDC Information Block that identifies which specific RRA VSDC server or component certified this receipt. Assigned by the RRA. Used by the RRA's internal systems for audit trail purposes.

---

**TAX CODE**
A single letter (A, B, C, D, or E) printed next to each item on the receipt to show how that item is taxed. Tax Code A = zero-rated (taxable at 0%). Tax Code B = standard rate (VAT at 18%). Tax Code C = VAT-exempt (no VAT charged). Tax Code D = specific excise duty (special tax on specific goods). Tax Code E = zero-rated exports. The tax code on each item is determined by the product's configuration in the system, which must match the product's classification under Rwandan tax law.

---

**TIME**
The time of the transaction, shown in 24-hour format (HH:MM:SS). For example, 14:32:07 means 2:32 PM and 7 seconds. The time in the header is the cashier's local time when the sale was completed. The time in the SDC block is the VSDC server time when the receipt was certified.

---

**TIN (Tax Identification Number)**
The 9-digit tax registration number assigned to the business by the Rwanda Revenue Authority. Printed on every receipt in the business header section. Identifies which taxpayer (business) generated the receipt. If the customer's TIN was also recorded (for B2B sales), the customer's TIN may appear separately, often labeled "CUSTOMER TIN" or "BUYER TIN."

---

**TOTAL**
The sum of all item line totals before any tax is broken out separately. On a receipt where all items are Tax Code B, the TOTAL includes VAT (as prices are shown inclusive of VAT in the Rwandan EBM system). The TOTAL is the starting point for the tax breakdown calculation.

---

**TOTAL B-18.00%**
The net value (excluding 18% VAT) of all items in this receipt that are taxed at Tax Code B. This is the pre-VAT amount. For example, if items totaling RWF 16,000 (inclusive of 18% VAT) are in Tax Code B, the TOTAL B-18.00% will be approximately RWF 13,559 (the VAT-exclusive amount). VAT-registered customers use this figure in their VAT return calculations.

---

**TOTAL TAX B**
The VAT amount charged on all Tax Code B items. This is the difference between the inclusive total and the TOTAL B-18.00% net amount. This is the actual VAT that the business is collecting on behalf of the government. VAT-registered customers can claim this amount as input tax credit, provided they have a valid NS receipt.

---

**VRN (VAT Registration Number)**
The VAT Registration Number assigned to the business by the RRA when they registered for VAT. May appear on receipts in addition to the TIN. The VRN is specifically the number that identifies a business as a VAT-registered entity. Not all businesses have a VRN — only those that are VAT-registered (either because they applied voluntarily or because their turnover exceeded the VAT threshold).

---

## APPENDIX B: RRA CONTACT INFORMATION

For questions related to EBM compliance, VSDC technical issues, receipt verification, or certification matters, contact the Rwanda Revenue Authority:

---

**RWANDA REVENUE AUTHORITY (RRA)**

**Head Office:**
Kimihurura, Gasabo District
Kigali, Republic of Rwanda

**RRA Website:** www.rra.gov.rw

**General Contact:**
- Phone: +250 788 185 500
- Email: info@rra.gov.rw

**EBM / CIS / VSDC Helpdesk:**
- Email: **cis_sdc_certification@rra.gov.rw**
- EBM Helpdesk Phone: [CONTACT RRA FOR CURRENT EBM HELPDESK NUMBER]

**EBM Helpdesk Hours:** Monday to Friday, 07:30 – 17:00 CAT (Central Africa Time)

**For urgent EBM/VSDC outages after hours:** Contact your IT support first. If the issue is suspected to be on the RRA side (VSDC server down), report it to cis_sdc_certification@rra.gov.rw with a detailed description and wait for the next business day for a response.

---

**EXCLEDGE SUPPORT:**

For issues with the Excledge ERP/POS software:

- **Support Email:** exceledgecpaltd@gmail.com
- **Product URL:** https://erp.exceledgecpa.com
- **Support Hours:** Monday to Friday, 08:00 – 18:00 CAT

**For urgent issues (VSDC offline, system down during business hours):**
Contact your organization's IT support representative first, then escalate to Excledge support if needed.

---

**YOUR ORGANIZATION'S INTERNAL CONTACTS:**

*(Fill in your specific contacts here and keep this card at the till)*

| Contact | Name | Phone |
|---|---|---|
| IT Support | [NAME] | [PHONE] |
| Branch Manager | [NAME] | [PHONE] |
| Head Office / Admin | [NAME] | [PHONE] |
| RRA EBM Helpdesk | — | [RRA HELPDESK NUMBER] |

---

## APPENDIX C: QUICK REFERENCE CARD

*Print this page and keep it at every till*

---

### EXCLEDGE ERP/POS — QUICK REFERENCE CARD
**Version 1.0.0 | https://erp.exceledgecpa.com**

---

### DAILY OPENING CHECKLIST

Before you start serving customers, complete these 5 checks:

- [ ] **1. VSDC Status is GREEN** (check the indicator at the top of the screen — if red, call manager)
- [ ] **2. Log in** with YOUR personal account (never share accounts)
- [ ] **3. Check EBM Outbox** (Administrators — confirm no FAILED or DEAD_LETTER items from yesterday)
- [ ] **4. Check low stock alerts** (notification bell — bell) — report critical low stock to manager
- [ ] **5. Correct branch selected** (check branch name top right of screen)

---

### HOW TO MAKE A SALE (NS RECEIPT)

1. Click **"New Sale"**
2. Search for products and add them to the cart
3. Add customer TIN if requested by customer
4. Select payment method (Cash / MoMo / Card / Mixed)
5. Click **"Complete Sale"** — wait 1 second for VSDC certification
6. Print or share receipt with customer

---

### HOW TO PROCESS A REFUND (NR RECEIPT)

1. Go to **Sales → Sales History**
2. Search for and open the original NS receipt
3. Select items to refund and enter **refund reason** (mandatory)
4. Get **manager PIN** if prompted
5. Click **"Process Refund"** — print NR receipt and return money to customer

---

### VSDC OFFLINE — WHAT TO DO

1. **DO NOT STOP SERVING CUSTOMERS** — sales are being saved automatically
2. **Inform your manager immediately** — note the time it went offline
3. **Continue as normal** — system will certify all receipts when connection returns

---

### DAILY CLOSING CHECKLIST

Before you close the business each day:

- [ ] **1. Generate Z Report** (Reports → Daily Reports → Z Report → Confirm) — LEGAL REQUIREMENT
- [ ] **2. Print Z Report** (minimum 2 copies) AND **Save as PDF**
- [ ] **3. Check EBM Queue** — confirm no PENDING or FAILED items remain
- [ ] **4. Close cash drawer** and reconcile cash against "Cash Total" on Z Report
- [ ] **5. Log out** of the system (click your name top right → Log Out)

---

### RECEIPT TYPES — QUICK GUIDE

| Code | Name | When Used |
|---|---|---|
| NS | Normal Sale | Every regular sale |
| NR | Normal Refund | Customer returns goods |
| CS | Copy Sale | Reprint of NS receipt |
| CR | Copy Refund | Reprint of NR receipt |
| TS | Training Sale | Training Mode only — NOT for real customers |
| TR | Training Refund | Training Mode only — NOT for real customers |
| PS | Proforma Sale | Quote/estimate before sale |

---

### EMERGENCY CONTACTS

| Contact | Name / Number |
|---|---|
| IT Support | [INSERT NUMBER] |
| Branch Manager | [INSERT NAME / NUMBER] |
| Head Office | [INSERT NUMBER] |
| RRA EBM Helpdesk | cis_sdc_certification@rra.gov.rw |
| Excledge Support | exceledgecpaltd@gmail.com |

---

### REMEMBER — THE MOST IMPORTANT RULES

1. **ALWAYS issue a receipt** for every sale — it is the law
2. **NEVER give a training receipt to a real customer**
3. **ALWAYS generate the Z Report** at end of every business day
4. **NEVER share your login password** with anyone
5. **If VSDC goes red — inform manager, but keep serving customers**

---

*Excledge ERP/POS Version 1.0.0 | Document Reference: EXC-USERMAN-v1.0.0-2026*
*Support: exceledgecpaltd@gmail.com | System: https://erp.exceledgecpa.com*
*For RRA EBM Helpdesk: cis_sdc_certification@rra.gov.rw | www.rra.gov.rw*
