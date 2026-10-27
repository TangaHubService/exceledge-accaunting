# EXCLEDGE ERP/POS
# PROGRAMMING AND CONFIGURATION MANUAL

---

**Software Version:** 1.0.0
**Document Reference:** EXC-CONFIGMAN-v1.0.0-2026
**Audience:** System Administrators, Support/Implementation Engineers — NOT for cashier or general staff use
**System URL:** https://erp.exceledgecpa.com
**Date:** June 2026
**Support Email:** exceledgecpaltd@gmail.com
**Classification:** Public — For Distribution to Authorized Technical/Administrative Staff

---

## PURPOSE OF THIS DOCUMENT

This is the technical/service-level companion to the *Product User Manual* (document 04-user-manual). It documents the configuration and programming procedures that are not part of everyday cashier or manager work: registering a business's RRA/VSDC credentials, configuring branches, and what to do if a device credential needs to be corrected or reissued. It is intended for the person(s) responsible for setting up and maintaining a business's Excledge ERP/POS installation — typically a System Administrator at the client business, or an Excledge implementation/support engineer.

This document does not repeat day-to-day sales, refund, or reporting procedures — those are fully covered in the Product User Manual (Sections 3–12).

---

## TABLE OF CONTENTS

1. [System Architecture Overview](#section-1-system-architecture-overview)
2. [Configuring Organization RRA/VSDC Credentials (TIN, EBM Device ID, MRC Serial)](#section-2-configuring-organization-rravsdc-credentials-tin-ebm-device-id-mrc-serial)
3. [Configuring Branches](#section-3-configuring-branches)
4. [Per-Branch RRA Device Credentials (bhfId, Device ID, MRC Serial, VSDC URL)](#section-4-per-branch-rra-device-credentials-bhfid-device-id-mrc-serial-vsdc-url)
4A. [Tax Rates (A / B / C / D)](#section-4a-tax-rates-a--b--c--d)
5. [User/Role Programming](#section-5-userrole-programming)
6. [Product/Tax Programming](#section-6-producttax-programming)
7. [Training Mode Programming](#section-7-training-mode-programming)
8. [Correcting or Reissuing a Device Credential ("Reset")](#section-8-correcting-or-reissuing-a-device-credential-reset)
9. [Monitoring VSDC Submission Health](#section-9-monitoring-vsdc-submission-health)
10. [Version and Recertification Notes](#section-10-version-and-recertification-notes)

---

## SECTION 1: SYSTEM ARCHITECTURE OVERVIEW

Excledge ERP/POS is a cloud-based, multi-tenant system. Each registered business is an **Organization**. Each Organization has one set of RRA/VSDC device credentials (EBM Device ID and EBM Serial/MRC) and one Tax Identification Number (TIN). An Organization can have one or more **Branches** (physical till locations); every sale is recorded against a specific Branch.

The configuration layers, from broadest to narrowest, are:

1. **Organization** — legal business entity, TIN, EBM device credentials.
2. **Branch** — a physical location/till; belongs to one Organization.
3. **User** — a staff account with a Role (Administrator, Manager, Seller/Cashier, Viewer, RRA Auditor); assigned to one or more Branches.
4. **Product** — belongs to an Organization; carries a Tax Code, price, SKU, and barcode.

All configuration in this document is performed through **Settings → Organization Settings**, which only Administrator-role users can access.

---

## SECTION 2: CONFIGURING ORGANIZATION RRA/VSDC CREDENTIALS (TIN, EBM DEVICE ID, MRC SERIAL)

These are the credentials the RRA issues when a business registers for EBM/VSDC. They must be entered accurately — an incorrect value here will cause every receipt to fail certification (see Section 10.5 of the Product User Manual, error codes 01 and 03).

**Step 1:** Log in with an Administrator account.

**Step 2:** Go to **Settings → Organization Settings** (the Profile tab, shown by default).

**Step 3:** Locate the following fields:
- **Organization Code / TIN** — the business's 9-digit RRA Tax Identification Number.
- **RRA EBM / VSDC — device ID** — the EBM Device ID issued by the RRA at VSDC registration.
- **RRA EBM / VSDC — serial number** — the Machine Registration Code (MRC), an 11-character code in the format **BBBCCNNNNNN** (3-character developer code + 2-character certificate number + 6-digit terminal sequence). The system validates this format when you save; an incorrectly formatted serial number will be rejected with an error.

**Step 4:** Enter (or correct) the values exactly as issued by the RRA. Do not guess or reformat them.

**Step 5:** Click **"Save."**

**Important:** These credentials apply to the whole Organization. If your business has multiple branches, do not confuse this with per-branch fields (Section 4) — the values here are the ones printed on every receipt across all of your branches unless a branch has its own override configured (Section 4).

---

## SECTION 3: CONFIGURING BRANCHES

**Step 1:** Go to **Settings → Organization Settings → Branch Management** tab.

**Step 2:** Click **"Add Branch"** to create a new branch, or select an existing branch and click the edit action to change it.

**Step 3:** Enter:
- **Branch Name** — a human-readable name (e.g. "Kigali Heights").
- **Branch Identifier/Code** — an internal short code (e.g. "KGL-01"). This must be unique within the Organization.
- **Location / Area** — free-text location description.

**Step 4:** Click **"Create Branch"** (or **"Update Branch"**).

**Step 5:** To set which branch is used by default when a multi-branch user has no branch explicitly selected, use the **"Set as Default"** action next to a branch in the Branch Management list.

**Step 6:** To temporarily stop a branch from being used (without deleting its history), use the activate/deactivate toggle next to the branch.

---

## SECTION 4: PER-BRANCH RRA DEVICE CREDENTIALS (bhfId, Device ID, MRC Serial, VSDC URL)

Businesses that receive an individual RRA registration for each till location can
configure a separate RRA Branch ID (**bhfId**), EBM Device ID (SDC ID), MRC
Serial, and VSDC endpoint URL **per branch**. A branch with no per-branch values
inherits the Organization-level credentials from Section 2.

**Where:** **Admin → EBM Outbox → "EBM / VSDC Credentials"** card. Select a branch,
enter the RRA-issued `bhfId`, the VSDC device serial (`dvcSrlNo`), the device's
**MRC (Machine Registration Code)**, `sdcId`, and (optionally) a per-branch VSDC
URL, then **"Save Credentials."** The per-branch device table on the same card
shows every branch's current values, MRC included.

**MRC per device (CIS spec Article 3.2.1):** each connected device has its own
MRC, configured separately from the VSDC device serial. It is validated as
**BBBCCNNNNNN** (3-character developer id + 2-character certificate number +
6-digit serial — exactly 11 characters, never fewer or more, in every
environment) and printed as `MRC:` on every receipt (including reprints
and copies) and fiscal report of the device, in place of the MRC VSDC echoes.
A device with no MRC configured prints the MRC VSDC returns.

**Initializing the device:** after saving the credentials, click **"Initialize
with RRA."** This calls RRA's initialization service with the device serial to
confirm the device is registered under this TIN, pull back the authoritative
SDC ID, and seed the local invoice counter past the last number RRA has on
record. A blank device MRC is filled from the MRC VSDC reports; a configured
MRC that differs from it is shown as a warning so it can be corrected. Do this
once per branch device before the first real sale.

---

## SECTION 4A: TAX RATES (A / B / C / D)

The RRA tax bands and their rates are **fixed by Rwandan tax law** and applied
automatically by the CIS according to each product's assigned tax code:

| Band | Rate | Meaning |
|------|------|---------|
| A | 0% | Exempt |
| B | 18% | Standard VAT |
| C | 0% | Zero-rated / export |
| D | 0% | Non-taxable (taxpayer not VAT registered) |

These rates are **not operator-editable** — a rate change (e.g. if RRA revises
the standard VAT rate) is a system update that requires RRA re-certification. The
bands and their rates are shown read-only in **Settings → Organization Settings**
for verification. What the operator *does* control is which band a product falls
into: set the product **Tax Code (A–D)** in **Inventory → Add/Edit Product**
(Product User Manual Section 13.1). Organization-level switches also apply:
"VAT Registered" off forces every line to D; "Tax Exempt" on forces every line
to A.

Rounding: tax values are rounded to two decimals, `<5` down and `>=5` up.

---

## SECTION 5: USER/ROLE PROGRAMMING

See Product User Manual Section 13.4 for the full step-by-step for inviting a user, assigning their Role and Branch, and disabling accounts. In summary: **Settings → User Management → Add/Invite User**, enter email, select Role, select Branch, send invitation. Only an Administrator can assign the Administrator role to another user.

---

## SECTION 6: PRODUCT/TAX PROGRAMMING

See Product User Manual Section 13.1–13.3 for the full step-by-step for assigning a Tax Code to a product, changing a price, and setting a product's SKU/barcode (PLU) identifiers. In summary: **Inventory → Add/Edit Product**, set Tax Code (A–E), Unit Price, SKU, and Barcode.

---

## SECTION 7: TRAINING MODE PROGRAMMING

See Product User Manual Section 6.2 and 6.5 for the full step-by-step. In summary: **Settings → Organization Settings → Training Mode toggle** (Administrator only). Always verify Training Mode is switched back OFF, and confirm with a real test sale that a genuine SDC signature is returned, before resuming service to real customers.

---

## SECTION 8: CORRECTING OR REISSUING A DEVICE CREDENTIAL ("RESET")

Excledge ERP/POS has no "factory reset" button and does not need one — the RRA/VSDC credentials are simple data fields (Section 2), not a physical device state that can be corrupted.

**If the RRA issues a corrected or new EBM Device ID, MRC serial number, or TIN** (for example, after a recertification, a developer/certificate code change, or a data entry correction):

**Step 1:** Confirm the new value directly from the RRA notice or portal — never rely on a verbal or informal source for a credential that will appear on every legal receipt.

**Step 2:** Go to **Settings → Organization Settings** and update the affected field(s) as described in Section 2 (or contact Excledge support for a per-branch value, per Section 4).

**Step 3:** Save the change.

**Step 4:** Make one test sale (with Training Mode OFF) and confirm the new value appears correctly in the CIS Information Block at the bottom of the printed receipt (Section 3.15 of the Product User Manual), and that the sale receives a valid SDC signature and QR code.

**Step 5:** Inform all branch staff that the change has been made, and archive the RRA notice authorizing the change for your compliance records.

**If a receipt shows the wrong TIN/MRC due to a configuration mistake (not an RRA-issued change):** correct the field immediately using the same steps above, then contact the RRA EBM Helpdesk (Appendix B of the Product User Manual) to disclose that receipts were issued with an incorrect value, and follow their guidance — do not attempt to silently alter historical receipt records.

---

## SECTION 9: MONITORING VSDC SUBMISSION HEALTH

Use the **EBM Outbox** screen (Admin section of the main navigation — see Product User Manual Section 10.4) to monitor the health of receipt submissions to the VSDC:

- **PENDING / PROCESSING** — normal, waiting for the automatic send/retry cycle.
- **SUCCEEDED** — certified by the VSDC.
- **FAILED** — a submission attempt failed; use "Check VSDC" to manually re-query status, or wait for the automatic retry.
- **DEAD_LETTER** — automatic retries were exhausted. Use "Request Reversal" only after confirming with IT support, since it reverses the sale's inventory and customer-balance effects.

Administrators should check this screen at the start of each business day (see the Daily Opening Checklist, Appendix C of the Product User Manual) and whenever the VSDC Status Indicator has been red for an extended period.

---

## SECTION 10: VERSION AND RECERTIFICATION NOTES

This document applies to Excledge ERP/POS **version 1.0.0**. Any change to the core receipt generation logic, VSDC integration, or tax calculation engine, or any major version change, may require RRA recertification (see Section 6.4 of the Company Profile and Physical Address Declaration, document 03-company-profile-address). Keep this document's version number in sync with document 04 (Product User Manual) and 03 (Company Profile) when recertifying.

---

*End of Document — EXC-CONFIGMAN-v1.0.0-2026*

*Excledge ERP/POS | Version 1.0.0 | June 2026*
*Contact: exceledgecpaltd@gmail.com | https://erp.exceledgecpa.com*
