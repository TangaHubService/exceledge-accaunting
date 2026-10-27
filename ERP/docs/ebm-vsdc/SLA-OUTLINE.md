# SLA outlines for RRA certification (draft)

RRA typically requires two SLAs: **vendor ↔ RRA** and **vendor ↔ customer**. Replace bracketed text with your legal entity and contacts; align uptime and response times with what your team can commit to.

## 1. Supplier ↔ RRA (maintenance & incident)

- **Parties:** [Your company legal name] (“Supplier”) and Rwanda Revenue Authority (“RRA”).
- **Scope:** Availability of the certified VSDC integration, security patches, and coordination during RRA-led tests or production incidents.
- **Support channel:** [email], [phone], escalation path to technical lead.
- **Severity definitions:** e.g. Critical (no fiscal submissions), Major (intermittent failures), Minor (cosmetic / non-blocking).
- **Target response:** e.g. acknowledge Critical within [X] business hours; workaround or fix within [Y] hours/days per severity.
- **Maintenance windows:** planned downtime notice period [X] days/hours.
- **Reporting:** monthly or quarterly summary of incidents affecting fiscal submission (if required by RRA).

## 2. Supplier ↔ end users (your customers)

- **Parties:** [Your company] and the subscribing business (“Customer”).
- **Scope:** Support for EBM/VSDC configuration (TIN, device ID, serial), training on receipts, and troubleshooting failed submissions / queue retries.
- **Channels:** in-app support, email, phone as applicable.
- **Hours:** [business hours / 24×7].
- **Targets:** first response within [X] hours; resolution or workaround timelines by severity.

## 3. Attachments for certification

- Contact list (24×7 if claimed).
- Runbook excerpt: how to verify `EbmTransaction` / `ebm_queue` status and when to escalate to Supplier engineering.
- Versioning: how you notify RRA and customers of certified software releases.

Use RRA’s official SLA templates when provided; this file is a starting outline only.
