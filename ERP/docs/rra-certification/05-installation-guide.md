# EXCLEDGE ERP/POS — INSTALLATION GUIDE

---

```
EXCLEDGE ERP/POS
INSTALLATION GUIDE

Software Version:    1.0.0
Document Reference:  EXC-INSTALL-v1.0.0-2026
Audience:            System Administrators, IT Technicians
Classification:      Technical — Not for End Users
Date:                June 2026
```

---

## TABLE OF CONTENTS

1. [Minimum System Requirements](#section-1)
   - 1.1 Server Requirements
   - 1.2 Client Requirements
   - 1.3 Thermal Printer Requirements
   - 1.4 Network Requirements
2. [Pre-Installation Checklist](#section-2)
   - 2.1 Items to Obtain from RRA
   - 2.2 Items to Obtain from the Client
   - 2.3 Technical Prerequisites
3. [Installation on Ubuntu Linux](#section-3)
   - 3.1 System Update
   - 3.2 Install Node.js v20 LTS
   - 3.3 Install PostgreSQL 16
   - 3.4 Create Database and User
   - 3.5 Install PM2 Process Manager
   - 3.6 Create Application Directory
   - 3.7 Deploy Application Files
   - 3.8 Install Application Dependencies
   - 3.9 Configure Environment Variables
   - 3.10 Run Database Migrations
   - 3.11 PM2 Ecosystem Configuration
   - 3.12 Start the Application
   - 3.13 Verify Installation
4. [Environment Configuration Reference](#section-4)
   - 4.1 Complete .env Template
   - 4.2 RRA EBM/VSDC Variables — Detailed Descriptions
5. [Installation on Windows Server](#section-5)
   - 5.1 Install Node.js 20 on Windows
   - 5.2 Install PostgreSQL 16 on Windows
   - 5.3 Create Database on Windows
   - 5.4 Install as Windows Service
   - 5.5 Configure Windows Firewall
6. [Nginx Reverse Proxy Setup](#section-6)
   - 6.1 Install Nginx
   - 6.2 Create Excledge Site Configuration
   - 6.3 Enable Site and Test
   - 6.4 Let's Encrypt SSL Certificate
   - 6.5 Test SSL
7. [Firewall Configuration](#section-7)
8. [First-Time Setup Wizard](#section-8)
9. [Backup and Recovery](#section-9)
   - 9.1 Why Backups Are Mandatory
   - 9.2 Manual Database Backup
   - 9.3 Automated Daily Backup
   - 9.4 Backup Retention Policy
   - 9.5 Offsite Backup
   - 9.6 Recovery Procedure
10. [Upgrading the Software](#section-10)
    - 10.1 Pre-Upgrade Checklist
    - 10.2 Step-by-Step Upgrade Procedure
    - 10.3 Rollback Procedure
    - 10.4 Post-Upgrade Verification
    - 10.5 RRA Notification for Version Changes

---

<a name="section-1"></a>
## SECTION 1: MINIMUM SYSTEM REQUIREMENTS

This section defines the hardware and software requirements to install and operate Excledge ERP/POS v1.0.0 in a production environment. Meeting minimum requirements is necessary for stable operation. Meeting recommended requirements is strongly advised for multi-branch deployments and high-volume environments.

### 1.1 Server Requirements

The application backend (Node.js + PostgreSQL) must be hosted on a dedicated server or virtual machine. Shared hosting is not supported. The server must have a stable internet connection to communicate with the Rwanda Revenue Authority VSDC endpoint at all times when sales are being processed.

| Component | Minimum Requirement | Recommended Requirement |
|---|---|---|
| CPU | 2 cores at 2.0 GHz | 4 cores at 3.0 GHz or higher |
| RAM | 4 GB | 8 GB or more |
| Storage | 50 GB SSD | 200 GB SSD |
| Operating System | Ubuntu 20.04 LTS | Ubuntu 22.04 LTS |
| Node.js Runtime | v18.x LTS | v20.x LTS (required for this release) |
| PostgreSQL | v14 | v16 (required for this release) |
| Network Connection | 10 Mbps stable | 100 Mbps or higher |
| Additional OS Support | Windows Server 2019 | Windows Server 2022 |

**Important Notes:**

- The application allocates up to 2 GB of Node.js heap via `NODE_OPTIONS=--max-old-space-size=2048`. Your server RAM must exceed this value by a comfortable margin (minimum 4 GB total RAM, recommended 8 GB).
- SSD storage is mandatory. Mechanical hard drives are not supported for production deployments due to PostgreSQL write performance requirements for transactional EBM outbox operations.
- Ubuntu 22.04 LTS is the primary tested and certified operating system for this release.
- Windows Server installations are supported but the primary deployment guide targets Ubuntu Linux.

### 1.2 Client Requirements

Excledge ERP/POS is a web application. Users access it via a web browser on any device connected to the same network as the server, or via the internet if the server is cloud-hosted. No client-side software installation is required.

| Component | Minimum Version | Notes |
|---|---|---|
| Google Chrome | 90 or later | Recommended browser |
| Mozilla Firefox | 88 or later | Fully supported |
| Microsoft Edge | 90 or later | Fully supported |
| Apple Safari | 14 or later | Fully supported |
| Screen Resolution | 1280 x 720 | 1920 x 1080 recommended for full POS layout |
| JavaScript | Must be enabled | Application will not function without JavaScript |
| Cookies | Must be enabled | Required for JWT session management |
| Internet Explorer | Not supported | Internet Explorer is end-of-life and unsupported |

**Mobile Device Support:**

The frontend is responsive and functions on tablets with screens of 768 px width or greater. Smartphone screens smaller than 768 px may display the POS interface in a reduced layout. For cashier POS use, tablets (iPad, Android tablet) or dedicated POS terminals running a supported browser are recommended.

### 1.3 Thermal Printer Requirements

Excledge ERP/POS generates receipts in a format compatible with standard 80 mm thermal receipt printers using the ESC/POS command protocol. The receipt format is designed for 80 mm paper width.

| Specification | Requirement |
|---|---|
| Paper Width | 80 mm (recommended); 58 mm (minimum, condensed format) |
| Interface | USB or Ethernet (TCP/IP). Bluetooth is not recommended for production. |
| Protocol | ESC/POS (industry standard) |
| Character Encoding | Code Page 437 or UTF-8 capable |
| Auto-cutter | Supported and recommended |

**Compatible Printer Brands (tested):**

- Epson TM series (TM-T20, TM-T82, TM-T88) — recommended
- Star Micronics TSP series
- Bixolon SRP series
- GOOJPRT and other generic 80 mm ESC/POS printers (basic compatibility)

**Note on 58 mm printers:** When using 58 mm paper, the SDC block (MRC number, receipt counter, digital signature, internal data) and the QR code will still print but in a condensed format. The full RRA-required content will be present. However, 80 mm is strongly recommended for readability of the QR code and SDC information.

### 1.4 Network Requirements

Network connectivity is critical for EBM/VSDC operation. The Excledge ERP/POS system communicates with the RRA VSDC endpoint to fiscalize every sale. Intermittent or unreliable internet will cause EBM outbox items to accumulate and require retry processing.

| Requirement | Specification |
|---|---|
| Internet Connection Type | Stable broadband (fiber, DSL, or LTE failover) |
| Minimum Bandwidth | 10 Mbps download / 5 Mbps upload |
| Outbound HTTPS | Port 443 must be open to the RRA VSDC endpoint |
| Server IP | Static IP recommended for server; required if RRA VSDC whitelist is in effect |
| DNS | DNS A record must resolve to the server's public IP before SSL issuance |
| UPS (Power Backup) | Strongly recommended. Power loss during EBM transmission may cause outbox inconsistencies. |
| LAN (if applicable) | 100 Mbps LAN between server and POS terminals |

**Critical Warning:** If the RRA VSDC endpoint uses IP whitelist access control, you must register your server's static IP address with RRA before going live. Failure to do so will result in all VSDC calls failing with connection refused or authentication errors.

---

<a name="section-2"></a>
## SECTION 2: PRE-INSTALLATION CHECKLIST

Before beginning installation, the technician must collect all required credentials and information. Installation cannot be completed without the RRA-issued VSDC credentials. Print this checklist and complete it physically before starting the installation procedure.

---

**PRE-INSTALLATION CHECKLIST**
*Technician Name:* ______________________________
*Client Name:* __________________________________
*Installation Date:* _____________________________
*Server IP / Domain:* ____________________________

---

### 2.1 Items to Obtain from RRA

These items are issued by the Rwanda Revenue Authority and must be obtained before the VSDC integration can be configured. The software developer or reseller must apply to RRA for certification and receive these credentials before any client deployment.

| Item | Obtained | Value / Notes |
|---|---|---|
| VSDC API Endpoint URL (EBM_API_URL) | [ ] | e.g., https://vsdc.rra.gov.rw/... |
| VSDC API Authentication Key (EBM_API_KEY) | [ ] | Issued per developer/deployment |
| VSDC API Authentication Secret (EBM_API_SECRET) | [ ] | Keep strictly confidential |
| EBM Security Key header value (EBM_SECURITY_KEY) | [ ] | If required by RRA — confirm with RRA |
| MRC (Machine Registration Code) for Branch 1 | [ ] | Format: BBBCCNNNNNN (11 characters) |
| MRC for Branch 2 (if multi-branch) | [ ] | Format: BBBCCNNNNNN (11 characters) |
| Additional MRC per additional branch | [ ] | One MRC per physical branch |
| bhfId for each branch | [ ] | 2-digit code: "00" for first, "01" for second, etc. |
| EBM Device ID for each branch | [ ] | Issued per device/branch |
| Software Developer ID (BBB prefix) | [ ] | 3-character prefix in MRC |
| Certificate Number (CC in MRC) | [ ] | 2-character certificate portion of MRC |
| RRA Sandbox endpoint (for testing) | [ ] | Used during training mode testing |

**Important:** Store all RRA credentials in a secure, encrypted password manager. Do not commit them to source control. Do not send them via unencrypted email.

### 2.2 Items to Obtain from the Client

These items must be provided by the client organization before configuration can proceed. Incorrect values (especially TIN and VRN) will cause all VSDC calls to fail.

| Item | Obtained | Value / Notes |
|---|---|---|
| Company full legal name (exactly as in RRA records) | [ ] | Must match RRA registration exactly |
| Company TIN (Tax Identification Number) | [ ] | 9-digit number |
| Company VRN (VAT Registration Number) | [ ] | For VAT-registered organizations |
| Company physical address | [ ] | Full address as registered |
| Company phone number | [ ] | |
| Company email address | [ ] | |
| Company logo (PNG, minimum 300x300 px) | [ ] | For receipt header |
| Number of branches to configure | [ ] | |
| Branch 1: name, address, bhfId | [ ] | bhfId must match RRA-issued value |
| Branch 2: name, address, bhfId (if applicable) | [ ] | |
| Additional branches (if applicable) | [ ] | |
| Domain name or public IP for deployment | [ ] | e.g., erp.company.rw |
| SSL certificate (own) OR confirm use of Let's Encrypt | [ ] | |
| Server access credentials (SSH) | [ ] | |
| Backup storage location (local path or cloud) | [ ] | |
| Preferred admin email address | [ ] | First system administrator account |
| Number of expected daily transactions (estimate) | [ ] | For capacity planning |

### 2.3 Technical Prerequisites

All items in this section must be verified as complete before beginning the installation steps in Section 3.

| Prerequisite | Verified | Notes |
|---|---|---|
| Server is provisioned and accessible via SSH | [ ] | |
| Server OS is Ubuntu 20.04 or 22.04 LTS | [ ] | |
| Server has a public IP address assigned | [ ] | |
| DNS A record configured and propagated | [ ] | Test: `dig [domain]` should resolve |
| Firewall allows inbound SSH (port 22) | [ ] | |
| Firewall allows inbound HTTPS (port 443) | [ ] | |
| Firewall allows inbound HTTP (port 80) for redirect | [ ] | |
| Outbound HTTPS (port 443) to RRA VSDC endpoint | [ ] | Test: `curl -v [RRA VSDC URL]` |
| PostgreSQL 14 or 16 can be installed | [ ] | |
| Node.js 18 or 20 can be installed | [ ] | |
| Backup storage configured with 5+ year capacity | [ ] | RRA requires 5-year data retention |
| UPS or power backup in place at server location | [ ] | |
| Maintenance window agreed with client | [ ] | |

---

<a name="section-3"></a>
## SECTION 3: INSTALLATION ON UBUNTU LINUX

This section provides step-by-step instructions for installing Excledge ERP/POS v1.0.0 on Ubuntu Server 20.04 LTS or 22.04 LTS. All commands are to be executed as a user with `sudo` privileges. Commands that require root access are prefixed with `sudo`.

### 3.1 Update the System

Begin by updating all system packages to the latest versions. This ensures security patches are applied before installation.

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install curl wget git unzip build-essential -y
```

After the upgrade completes, reboot the server if the kernel was updated:

```bash
sudo reboot
```

Reconnect via SSH after the reboot before proceeding.

### 3.2 Install Node.js v20 LTS

Excledge ERP/POS requires Node.js v20.x LTS. Install it using the NodeSource distribution:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Verify the installation:

```bash
node --version   # Must display v20.x.x
npm --version    # Must display 10.x.x or higher
```

If the version displayed is v18.x or earlier, the wrong distribution was installed. Remove and reinstall using the command above with `setup_20.x` explicitly.

### 3.3 Install PostgreSQL 16

Excledge ERP/POS requires PostgreSQL 14 minimum, and PostgreSQL 16 is recommended and certified for this release.

Add the official PostgreSQL APT repository:

```bash
sudo sh -c 'echo "deb http://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list'
wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | sudo apt-key add -
sudo apt update
sudo apt install postgresql-16 postgresql-client-16 -y
```

Start and enable PostgreSQL to start on boot:

```bash
sudo systemctl start postgresql
sudo systemctl enable postgresql
```

Verify PostgreSQL is running:

```bash
sudo systemctl status postgresql
```

The output should show `Active: active (running)`.

### 3.4 Create the Application Database and User

Connect to PostgreSQL as the `postgres` superuser and create the application database and a dedicated database user:

```bash
sudo -u postgres psql << 'EOF'
CREATE DATABASE excledge_erp;
CREATE USER excledge_user WITH ENCRYPTED PASSWORD '[STRONG_PASSWORD_HERE]';
GRANT ALL PRIVILEGES ON DATABASE excledge_erp TO excledge_user;
ALTER DATABASE excledge_erp OWNER TO excledge_user;
\q
EOF
```

**Password Guidelines:**

- Replace `[STRONG_PASSWORD_HERE]` with a strong random password
- Generate a secure password: `openssl rand -base64 32`
- Record this password securely — it will be used in the `DATABASE_URL` environment variable
- Minimum password length: 32 characters
- Do not use dictionary words or common patterns

### 3.5 Install PM2 Process Manager

PM2 is a Node.js process manager that keeps the application running, restarts it on crash, and manages log files.

```bash
sudo npm install -g pm2
```

Verify the installation:

```bash
pm2 --version
```

### 3.6 Create the Application Directory

Create a dedicated directory for the application files:

```bash
sudo mkdir -p /opt/excledge
sudo chown $USER:$USER /opt/excledge
```

Also create the log directory:

```bash
sudo mkdir -p /var/log/excledge
sudo chown $USER:$USER /var/log/excledge
```

### 3.7 Deploy Application Files

**Option A: Deploy from Archive**

If the application is distributed as a `.zip` or `.tar.gz` archive:

```bash
cd /opt/excledge
# Copy archive to server first, then:
unzip excledge-erp-v1.0.0.zip -d /opt/excledge
# OR for tar.gz:
tar -xzf excledge-erp-v1.0.0.tar.gz -C /opt/excledge --strip-components=1
```

**Option B: Deploy from Git Repository**

If access to the source repository is available:

```bash
cd /opt/excledge
git clone https://github.com/[your-org]/excledge-erp.git .
git checkout v1.0.0
```

After deployment, verify the directory structure:

```bash
ls /opt/excledge
```

Expected output should include: `package.json`, `dist/` (or `src/`), `prisma/`, `ecosystem.config.js`.

### 3.8 Install Application Dependencies

Install only production dependencies (development tools are not needed on the server):

```bash
cd /opt/excledge
npm ci --omit=dev
```

The `npm ci` command uses the `package-lock.json` to install exact dependency versions, ensuring reproducible builds. Do not use `npm install` on a production server as it may update dependencies beyond the tested versions.

This step may take 2–5 minutes depending on network speed.

### 3.9 Configure Environment Variables

Create the environment configuration file. This file contains sensitive credentials and must be protected:

```bash
nano /opt/excledge/.env
```

Paste the complete configuration template from Section 4.1, filling in all required values. Save the file.

Set correct permissions to protect the credentials:

```bash
chmod 600 /opt/excledge/.env
```

Verify the file is readable only by the current user:

```bash
ls -la /opt/excledge/.env
# Should show: -rw------- 1 [user] [user] ... .env
```

### 3.10 Run Database Migrations

Apply the Prisma database migrations to create all required tables and indexes:

```bash
cd /opt/excledge
npx prisma migrate deploy
```

Generate the Prisma client:

```bash
npx prisma generate
```

Verify all migrations have been applied:

```bash
npx prisma migrate status
```

All migrations should show `Applied` status. If any migrations show `Pending`, re-run `npx prisma migrate deploy`.

**Critical Tables for EBM Operation:**

The following tables are critical for RRA EBM compliance. Verify they exist after migration:

```bash
sudo -u postgres psql -d excledge_erp -c "\dt" | grep -E "(ebm|branch_receipt|organization_invoice)"
```

Expected tables: `ebm_outbox`, `ebm_transactions`, `ebm_queue`, `branch_receipt_counters`, `organization_invoice_counters`.

### 3.11 PM2 Ecosystem Configuration

Create the PM2 ecosystem configuration file at `/opt/excledge/ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'excledge-erp',
    script: './dist/index.js',
    instances: 1,
    exec_mode: 'fork',
    env_production: {
      NODE_ENV: 'production',
      PORT: 5000,
      NODE_OPTIONS: '--max-old-space-size=2048'
    },
    max_memory_restart: '1500M',
    error_file: '/var/log/excledge/error.log',
    out_file: '/var/log/excledge/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    restart_delay: 3000,
    max_restarts: 10,
    min_uptime: '30s'
  }]
};
```

**Configuration Notes:**

- `instances: 1` — Single instance is required. Do not use `cluster` mode as it may interfere with the EBM outbox cron job deduplication.
- `max_memory_restart: '1500M'` — PM2 will restart the process if it exceeds 1.5 GB RAM. The application sets a 2 GB Node.js heap limit but PM2 monitors RSS memory including the heap.
- `restart_delay: 3000` — 3 second delay between restarts prevents CPU spin loops on repeated crashes.

### 3.12 Build and Start the Application

Build the TypeScript source code to JavaScript:

```bash
cd /opt/excledge
npm run build
```

This compiles the TypeScript in `src/` to JavaScript in `dist/`. Verify the build succeeded:

```bash
ls /opt/excledge/dist/
# Should include: index.js, services/, jobs/, routes/, controllers/
```

Start the application with PM2:

```bash
pm2 start ecosystem.config.js --env production
```

Save the PM2 process list so it restarts on server reboot:

```bash
pm2 save
```

Configure PM2 to start on system boot:

```bash
pm2 startup
```

PM2 will output a command that must be executed. Copy and run that command exactly. It will look similar to:

```bash
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u [username] --hp /home/[username]
```

### 3.13 Verify Installation

Check that the PM2 process is running:

```bash
pm2 status
```

The `excledge-erp` process should show status `online`. If it shows `errored` or `stopped`, check the error log:

```bash
pm2 logs excledge-erp --lines 50
```

Test the health check endpoint:

```bash
curl http://localhost:5000/health
```

Expected response:

```json
{"status":"ok","version":"1.0.0"}
```

If the health check returns a connection refused error, the Node.js application has not started. Review the PM2 error log for details.

---

<a name="section-4"></a>
## SECTION 4: ENVIRONMENT CONFIGURATION

The `.env` file controls all configurable parameters of the Excledge ERP/POS system. All RRA EBM/VSDC credentials must be obtained from Rwanda Revenue Authority before the system can be placed in live production mode.

### 4.1 Complete Environment File Template

Create the file at `/opt/excledge/.env` with the following content:

```env
# ─────────────────────────────────────────────────────────────
# APPLICATION
# ─────────────────────────────────────────────────────────────
NODE_ENV=production
PORT=5000
APP_NAME=Excledge ERP/POS
FRONTEND_URL=https://[your-domain.com]

# ─────────────────────────────────────────────────────────────
# DATABASE
# ─────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://excledge_user:[PASSWORD]@localhost:5432/excledge_erp
# Generate a secure password: openssl rand -base64 32

# ─────────────────────────────────────────────────────────────
# AUTHENTICATION
# ─────────────────────────────────────────────────────────────
JWT_SECRET=[generate: openssl rand -base64 64]
JWT_EXPIRES_IN=8h

# ─────────────────────────────────────────────────────────────
# RRA EBM / VSDC — ALL VALUES BELOW MUST BE OBTAINED FROM RRA
# ─────────────────────────────────────────────────────────────
ENABLE_EBM=true
EBM_ENVIRONMENT=production
EBM_API_URL=[RRA VSDC ENDPOINT — OBTAIN FROM RRA]
EBM_API_KEY=[VSDC API KEY — OBTAIN FROM RRA]
EBM_API_SECRET=[VSDC API SECRET — OBTAIN FROM RRA]
EBM_SECURITY_KEY=[SECURITY KEY IF REQUIRED — OBTAIN FROM RRA]

# VSDC endpoint paths (defaults match RRA ALGO EBM API v8.2)
EBM_SALE_PATH=/saveInvc
EBM_REFUND_PATH=/saveInvc
EBM_VOID_PATH=/saveInvc
EBM_ITEM_PATH=/saveItem
EBM_MOVEMENT_PATH=/selectMvmt
EBM_PURCHASE_PATH=/savePurc
EBM_IMPORT_PATH=/selectImportInvc
EBM_STATUS_CHECK_PATH=/status

# VSDC request timeout — MUST remain at 1000ms per RRA specification
EBM_REQUEST_TIMEOUT_MS=1000
EBM_MAX_QUEUE_RETRIES=10
EBM_USE_MOCK=false

# ─────────────────────────────────────────────────────────────
# EMAIL
# ─────────────────────────────────────────────────────────────
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=[your-email@gmail.com]
EMAIL_PASSWORD=[gmail-app-password]
EMAIL_FROM=[your-email@gmail.com]

# ─────────────────────────────────────────────────────────────
# FILE STORAGE (Cloudinary — for product images)
# ─────────────────────────────────────────────────────────────
CLOUDINARY_CLOUD_NAME=[from cloudinary.com dashboard]
CLOUDINARY_API_KEY=[from cloudinary.com dashboard]
CLOUDINARY_API_SECRET=[from cloudinary.com dashboard]

# ─────────────────────────────────────────────────────────────
# NODE.JS PERFORMANCE
# ─────────────────────────────────────────────────────────────
NODE_OPTIONS=--max-old-space-size=2048

# ─────────────────────────────────────────────────────────────
# PAYMENT GATEWAYS (optional — only configure what is used)
# ─────────────────────────────────────────────────────────────
PAYPACK_CLIENT_ID=[from paypack.rw developer portal]
PAYPACK_CLIENT_SECRET=[from paypack.rw developer portal]
PAYPACK_BASE_URL=https://api.paypack.rw
PESAPAL_API_URL=https://pay.pesapal.com/v3/api
PESAPAL_IPN_ID=[from pesapal dashboard]
```

### 4.2 RRA EBM/VSDC Variables — Detailed Descriptions

**ENABLE_EBM**

Controls whether the EBM/VSDC integration is active. Set to `true` to enable fiscalization. When set to `false`, sales are completed but are not submitted to the VSDC — this is not permitted in a live production environment. Only set to `false` during initial server testing before RRA credentials are available. If this variable is `false` in production and RRA performs an audit, the organization may be found non-compliant.

**EBM_ENVIRONMENT**

Set to `production` for live operations. Set to `sandbox` only when testing with the RRA sandbox VSDC endpoint. This value is included in VSDC API call payloads. If set to `sandbox` in a live environment, the VSDC may reject calls or route them to the test server instead of the production server.

**EBM_API_URL**

The base URL of the RRA VSDC server endpoint. This value is assigned by RRA and is not published publicly. It must be obtained directly from RRA during the certification process. All VSDC API calls (sales, refunds, item registration, heartbeat) are sent to this base URL with path suffixes (e.g., `/saveInvc`, `/saveItem`). If this URL is incorrect, all EBM submissions will fail. The `ebm-outbox.job.ts` background job will retry up to `EBM_MAX_QUEUE_RETRIES` times before marking entries as `DEAD_LETTER`.

**EBM_API_KEY and EBM_API_SECRET**

Authentication credentials issued by RRA for the VSDC API. When both are present, the system constructs a Basic Authentication header: `Authorization: Basic base64(EBM_API_KEY:EBM_API_SECRET)`. When only `EBM_API_KEY` is present, Bearer token authentication is used. These credentials must be kept strictly confidential. If they are compromised, notify RRA immediately and request new credentials.

**EBM_SECURITY_KEY**

An additional security header value sent as `security_key` in all VSDC request headers. This is an optional field depending on the RRA VSDC deployment configuration. Confirm with RRA whether this header is required. If required and not configured, VSDC calls will return authentication errors.

**EBM_SALE_PATH, EBM_REFUND_PATH, EBM_VOID_PATH**

All three point to `/saveInvc` as per RRA ALGO EBM API v8.2. The operation type (sale, refund, void) is distinguished by the `rcptTyCd` field in the request body, not by the endpoint path. Do not change these unless RRA explicitly instructs a path change.

**EBM_REQUEST_TIMEOUT_MS**

The timeout for VSDC HTTP requests, in milliseconds. The value `1000` (1 second) is the maximum permitted by the RRA specification. Do not increase this value. If VSDC responses are consistently slower than 1 second, contact RRA technical support. Increasing the timeout does not improve reliability — it only delays the failure detection, causing cascading delays in sale processing.

**EBM_MAX_QUEUE_RETRIES**

The number of times the outbox worker (`ebm-outbox.job.ts`) will retry a failed VSDC submission before marking the entry `DEAD_LETTER`. Default is 10. Dead Letter entries require manual technician intervention. The retry backoff is exponential: first retry after 2 minutes, second after 4 minutes, growing to a maximum of 60 minutes between retries.

**EBM_USE_MOCK**

Must be `false` in production at all times. When `true`, the system generates fake VSDC responses without contacting the real VSDC server. This is used only during development. If this is accidentally set to `true` in production, sales will appear to fiscalize successfully but no data will be submitted to RRA. This is a serious compliance violation.

---

<a name="section-5"></a>
## SECTION 5: INSTALLATION ON WINDOWS SERVER

This section covers installation on Windows Server 2019 or 2022. The steps differ from Ubuntu but the outcome is equivalent.

### 5.1 Install Node.js 20 on Windows

1. Navigate to https://nodejs.org/en/download in a browser on the server.
2. Download the Windows Installer (.msi) for Node.js 20 LTS (64-bit).
3. Run the installer. Accept all defaults. Ensure "Add to PATH" is checked during installation.
4. After installation, open a Command Prompt (cmd.exe) as Administrator and verify:

```cmd
node --version
npm --version
```

Both commands must return a version number. If `node` is not recognized, the PATH was not updated. Log out and back in, or restart the Command Prompt.

5. Install PM2 globally:

```cmd
npm install -g pm2
npm install -g pm2-windows-startup
pm2-startup install
```

### 5.2 Install PostgreSQL 16 on Windows

1. Navigate to https://www.postgresql.org/download/windows/
2. Download the PostgreSQL 16 installer for Windows (64-bit) from EnterpriseDB.
3. Run the installer. Configure as follows:
   - Installation directory: `C:\Program Files\PostgreSQL\16`
   - Data directory: `C:\Program Files\PostgreSQL\16\data`
   - Password for postgres superuser: Set a strong password and record it securely.
   - Port: 5432 (default)
   - Locale: Default
4. Uncheck "Stack Builder" at the end of installation — it is not needed.
5. PostgreSQL will be installed as a Windows service named `postgresql-x64-16` and will start automatically.

Verify PostgreSQL is running by opening Services (services.msc) and confirming `postgresql-x64-16` shows status "Running".

### 5.3 Create the Application Database on Windows

Open a Command Prompt as Administrator and connect to PostgreSQL:

```cmd
"C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres
```

Enter the postgres password when prompted. Then run the following SQL commands:

```sql
CREATE DATABASE excledge_erp;
CREATE USER excledge_user WITH ENCRYPTED PASSWORD '[STRONG_PASSWORD_HERE]';
GRANT ALL PRIVILEGES ON DATABASE excledge_erp TO excledge_user;
ALTER DATABASE excledge_erp OWNER TO excledge_user;
\q
```

Alternatively, use pgAdmin 4 (installed alongside PostgreSQL) to run the SQL commands via the query tool.

### 5.4 Install as a Windows Service using NSSM

NSSM (Non-Sucking Service Manager) allows Node.js applications to run as proper Windows services with automatic restart.

1. Download NSSM from https://nssm.cc/download (nssm-2.24.zip or later)
2. Extract to `C:\nssm\`
3. Open a Command Prompt as Administrator and run:

```cmd
C:\nssm\win64\nssm.exe install excledge-erp
```

In the NSSM GUI that opens, configure:
- Path: `C:\Program Files\nodejs\node.exe`
- Startup directory: `C:\opt\excledge`
- Arguments: `dist\index.js`
- Environment tab: Add all environment variables from the .env file, prefixed correctly

Alternatively, install from command line without the GUI:

```cmd
C:\nssm\win64\nssm.exe install excledge-erp "C:\Program Files\nodejs\node.exe" "C:\opt\excledge\dist\index.js"
C:\nssm\win64\nssm.exe set excledge-erp AppDirectory C:\opt\excledge
C:\nssm\win64\nssm.exe set excledge-erp AppEnvironmentExtra NODE_ENV=production PORT=5000 NODE_OPTIONS=--max-old-space-size=2048
C:\nssm\win64\nssm.exe set excledge-erp Start SERVICE_AUTO_START
```

Start the service:

```cmd
C:\nssm\win64\nssm.exe start excledge-erp
```

Verify the service is running:

```cmd
sc query excledge-erp
```

### 5.5 Configure Windows Firewall

Open required ports and block unnecessary access using netsh:

```cmd
REM Allow inbound HTTP (for Let's Encrypt certificate renewal)
netsh advfirewall firewall add rule name="Excledge HTTP" protocol=TCP dir=in localport=80 action=allow

REM Allow inbound HTTPS
netsh advfirewall firewall add rule name="Excledge HTTPS" protocol=TCP dir=in localport=443 action=allow

REM Block direct access to Node.js API port from outside (Nginx will proxy)
netsh advfirewall firewall add rule name="Block Excledge API Direct" protocol=TCP dir=in localport=5000 remoteip=!127.0.0.1 action=block

REM Block direct PostgreSQL access from outside
netsh advfirewall firewall add rule name="Block PostgreSQL External" protocol=TCP dir=in localport=5432 remoteip=!127.0.0.1 action=block
```

For Windows Server, also verify these rules in Windows Defender Firewall with Advanced Security (wf.msc).

---

<a name="section-6"></a>
## SECTION 6: NGINX REVERSE PROXY SETUP

Nginx serves as the reverse proxy, handling SSL termination and forwarding requests to the Node.js application running on port 5000. This section applies to Ubuntu Linux. For Windows, use IIS as the reverse proxy or install Nginx for Windows.

### 6.1 Install Nginx

```bash
sudo apt install nginx -y
sudo systemctl start nginx
sudo systemctl enable nginx
```

Verify Nginx is running:

```bash
sudo systemctl status nginx
curl http://localhost/
```

The curl command should return the default Nginx welcome page.

### 6.2 Create the Excledge Site Configuration

Create the Nginx virtual host configuration file:

```bash
sudo nano /etc/nginx/sites-available/excledge
```

Paste the following complete configuration. Replace `[your-domain.com]` and `[admin@email.com]` with actual values:

```nginx
# Excledge ERP/POS — Nginx configuration
# Redirect all HTTP to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name [your-domain.com];

    # Allow Let's Encrypt ACME challenge
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # Redirect everything else to HTTPS
    location / {
        return 301 https://$host$request_uri;
    }
}

# HTTPS server
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name [your-domain.com];

    # SSL Certificate (Let's Encrypt — paths set by certbot)
    ssl_certificate /etc/letsencrypt/live/[your-domain.com]/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/[your-domain.com]/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # Maximum upload size (for product images via Cloudinary proxy)
    client_max_body_size 50m;

    # Timeouts — increased for VSDC operations
    proxy_connect_timeout 30s;
    proxy_send_timeout    60s;
    proxy_read_timeout    60s;

    # Gzip compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
    gzip_min_length 1024;

    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Main application proxy
    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;

        # WebSocket upgrade support (Socket.io for real-time VSDC status)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # Standard proxy headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_cache_bypass $http_upgrade;
    }

    # Health check endpoint (no auth needed)
    location /health {
        proxy_pass http://127.0.0.1:5000/health;
        proxy_set_header Host $host;
        access_log off;
    }
}
```

### 6.3 Enable the Site and Test Configuration

Enable the Excledge site by creating a symbolic link to `sites-enabled/`:

```bash
sudo ln -s /etc/nginx/sites-available/excledge /etc/nginx/sites-enabled/
```

Remove the default Nginx site if it exists:

```bash
sudo rm -f /etc/nginx/sites-enabled/default
```

Test the Nginx configuration for syntax errors:

```bash
sudo nginx -t
```

Expected output:

```
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

If there are errors, review the configuration file for typos. Common issues: incorrect domain name, missing semicolons, wrong file paths.

Reload Nginx:

```bash
sudo systemctl reload nginx
```

### 6.4 Issue a Let's Encrypt SSL Certificate

Install Certbot and the Nginx plugin:

```bash
sudo apt install certbot python3-certbot-nginx -y
```

Issue the certificate (replace placeholders with actual values):

```bash
sudo certbot --nginx -d [your-domain.com] --non-interactive --agree-tos -m [admin@email.com]
```

Certbot will automatically update the Nginx configuration with the correct SSL certificate paths.

Set up automatic certificate renewal (Let's Encrypt certificates expire every 90 days):

```bash
sudo systemctl enable certbot.timer
sudo systemctl start certbot.timer
```

Verify the renewal timer is active:

```bash
sudo systemctl list-timers | grep certbot
```

### 6.5 Test SSL

After the certificate is issued and Nginx is reloaded, test the full HTTPS connection:

```bash
curl -I https://[your-domain.com]/health
```

Expected output should include:

```
HTTP/2 200
content-type: application/json
strict-transport-security: max-age=31536000; includeSubDomains
```

Also test from a browser by navigating to `https://[your-domain.com]`. The browser should show a padlock icon without any certificate warnings.

---

<a name="section-7"></a>
## SECTION 7: FIREWALL CONFIGURATION

A properly configured firewall is essential for security. The following table defines the required firewall rules for a production Excledge ERP/POS server.

| Port | Protocol | Direction | Source | Action | Purpose |
|---|---|---|---|---|---|
| 22 | TCP | Inbound | Admin IP only | Allow | SSH administration access |
| 80 | TCP | Inbound | Any | Allow | HTTP (redirected to HTTPS by Nginx) |
| 443 | TCP | Inbound | Any | Allow | HTTPS — application access |
| 5000 | TCP | Inbound | 127.0.0.1 only | Allow | Node.js API (loopback only) |
| 5432 | TCP | Inbound | 127.0.0.1 only | Allow | PostgreSQL (loopback only) |
| 443 | TCP | Outbound | Server IP | Allow | Outbound HTTPS to RRA VSDC endpoint |
| 587 | TCP | Outbound | Server IP | Allow | SMTP email (optional) |

**Configuring UFW (Ubuntu Uncomplicated Firewall):**

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

Verify the rules:

```bash
sudo ufw status verbose
```

**Why Port 5000 Must NOT Be Publicly Exposed:**

Port 5000 is where the Node.js application listens internally. It has no TLS encryption, no rate limiting at the OS level, and no protection against direct API abuse. All traffic must pass through Nginx on port 443, where SSL is terminated and headers are properly forwarded. If port 5000 is publicly accessible, an attacker could bypass Nginx security headers, access the API without HTTPS, and potentially overwhelm the server.

**Why Port 5432 Must NOT Be Publicly Exposed:**

PostgreSQL port 5432 is the database listener. If exposed to the internet, it becomes a direct attack surface for brute-force password attacks, SQL injection attempts via the PostgreSQL wire protocol, and known PostgreSQL CVE exploits. The database must only accept connections from `127.0.0.1` (localhost). All application-to-database communication occurs via the internal loopback interface.

---

<a name="section-8"></a>
## SECTION 8: FIRST-TIME SETUP WIZARD

After successful installation and server startup, the technician must complete the initial configuration of the Excledge ERP/POS system. This section walks through all required configuration steps in the correct sequence.

Open a browser and navigate to: `https://[your-domain.com]`

### Step 1: Create the Super Administrator Account

On first access, the system displays the initial setup screen.

1. Navigate to `https://[your-domain.com]/setup`
2. Fill in the following fields:
   - **Administrator Name:** Full name of the primary administrator
   - **Email Address:** The email to use for login (this becomes the SYSTEM_OWNER account)
   - **Password:** Minimum 12 characters, must include uppercase, lowercase, numbers, and symbols
   - **Confirm Password:** Must match exactly
3. Click "Create Account"
4. The system creates the SYSTEM_OWNER account and redirects to the dashboard login

5. Log in with the newly created credentials
6. Verify the login succeeded and the dashboard is visible

### Step 2: Set Up the Organization

The Organization record holds the company's RRA-registered information. This data must be exact.

1. Navigate to Settings → Organization
2. Fill in all fields:
   - **Legal Name:** The company's full legal name exactly as registered with RRA (case-sensitive)
   - **TIN:** 9-digit Tax Identification Number (e.g., `123456789`)
   - **VRN:** VAT Registration Number (leave blank if not VAT registered)
   - **Phone:** Company main phone number
   - **Email:** Company email (`exceledgecpaltd@gmail.com` or client's email)
   - **Address:** Full physical address as registered with RRA
   - **Business Type:** Select the appropriate business category
3. Upload the company logo (PNG format, minimum 300x300 px)
4. Click "Save Organization"
5. Verify that the saved TIN matches the RRA records exactly. An incorrect TIN will cause VSDC error code 2 (`Invalid TIN`) on every submission.

### Step 3: Configure Tax Rates

Tax rates must match the RRA tax configuration for the organization's registration.

1. Navigate to Settings → Tax Configuration
2. Review and confirm the following tax bands:
   - **Band A (Exempt):** 0% — For VAT-exempt goods (food, medicine, etc.)
   - **Band B (Standard VAT):** 18.00% — For standard-rated goods and services
   - **Band C (Zero-Rated):** 0% — For zero-rated exports
   - **Band D (Non-Taxable):** 0% — For other non-taxable items
3. Verify the effective date is set to today's date or earlier
4. Click "Save Tax Configuration"
5. The system logs this change in ActivityLog with event type `TAX_CONFIG_CHANGED`

**Important:** Do not set Band B to any value other than 18.00% unless RRA has officially changed the VAT rate and you have received written instruction to update the configuration.

### Step 4: Set Up the First Branch

Every physical location where sales occur must be configured as a Branch. The first branch should receive bhfId `"00"`.

1. Navigate to Settings → Branches → Add Branch
2. Fill in:
   - **Branch Name:** e.g., "Main Branch" or "Headquarters"
   - **Branch Code:** Internal identifier, e.g., "HQ" or "BRANCH-01" (must be unique within the organization)
   - **bhfId:** Enter `00` for the first branch (this is the RRA-assigned 2-digit branch identifier — use exactly the value provided by RRA)
   - **Address Line 1:** Full street address of this branch
   - **Phone:** Branch phone number
   - **VSDC URL (vsdcUrl):** The per-branch VSDC endpoint URL from RRA. If all branches share the same VSDC device, enter the same URL as `EBM_API_URL`.
   - **MRC (ebmSerialNo):** The 11-character Machine Registration Code in format BBBCCNNNNNN (e.g., `EXC01000001`). This is unique to this branch's EBM device.
   - **EBM Device ID (ebmDeviceId):** The VSDC device ID issued by RRA for this branch.
3. Click "Save Branch"
4. Repeat for each additional branch, incrementing bhfId: `"01"`, `"02"`, etc.

### Step 5: Test the VSDC Connection

Before processing any real transactions, verify that the VSDC connection is working.

1. Navigate to Settings → EBM Integration → Test Connection
2. Click "Test VSDC Connection"
3. The system calls `vsdcHeartbeat()` which sends a POST to the configured `/status` endpoint
4. Expected success response: "Connected — SDC ID: [SDCXXXXXXXX]"
5. If the test fails:
   - Verify `EBM_API_URL` is correct (no trailing slash, correct protocol)
   - Verify `EBM_API_KEY` and `EBM_API_SECRET` match the values provided by RRA
   - Verify `EBM_SECURITY_KEY` is set if required
   - Verify outbound HTTPS (port 443) is allowed in the firewall
   - Check PM2 logs: `pm2 logs excledge-erp --lines 100`
   - After making changes to `.env`, restart: `pm2 restart excledge-erp`

### Step 6: Enable Training Mode

Before processing real transactions, enable Training Mode to run test transactions that are not submitted to RRA.

1. Navigate to Settings → Organization → Training Mode
2. Click the "Enable Training Mode" toggle
3. A confirmation dialog will appear explaining that all receipts in training mode will be issued as TS/TR types and will not be submitted to VSDC
4. Click "Confirm"
5. The dashboard will display a "TRAINING MODE ACTIVE" banner

When Training Mode is active:
- All receipts are issued as TS (Training Sale) or TR (Training Refund)
- Receipt counters for TS/TR are used
- No VSDC API calls are made (outbox items are marked SUCCEEDED with note "Training mode — VSDC submission skipped")
- Receipts are watermarked with "TRAINING MODE" on printout
- Digital signature fields are empty or show placeholder values

### Step 7: Create a Test Sale in Training Mode

Perform a complete test transaction to verify the system end-to-end.

1. Navigate to POS → New Sale
2. Select a customer (or use the default walk-in customer)
3. Add at least one product that has a tax code assigned (Band B recommended for the first test)
4. Complete the sale with a cash payment
5. The system generates a TS receipt
6. Verify the following on the receipt printout:
   - Company name, TIN, and address are correct
   - Product name, quantity, and price are correct
   - Tax amount is calculated correctly (18% of taxable amount for Band B)
   - Receipt type label shows "TS"
   - "TRAINING MODE" watermark is visible
   - No digital signature is printed (training mode)
   - QR code is present but may not validate on RRA portal

7. Review the EBM outbox: Settings → EBM → Outbox
8. The TS sale outbox entry should show status `SUCCEEDED` with note `Training mode — VSDC submission skipped`

### Step 8: Add Products with RRA Classification

Every product sold in the system must have the required RRA classification fields populated. These fields are sent to the VSDC via the `/saveItem` endpoint.

For each product:

1. Navigate to Products → Add Product (or edit existing)
2. Fill in mandatory RRA fields:
   - **Item Code (itemCd):** Your internal product code registered with RRA (e.g., "PROD001")
   - **Item Classification Code (itemClsCd):** The RRA 10-digit item classification code from the RRA code table (e.g., "5020230302" for pharmaceutical products). Obtain the full code table from RRA.
   - **Tax Code:** Select A, B, C, or D based on RRA product classification
   - **Package Unit Code (pkgUnitCd):** e.g., "CT" for carton, "BT" for bottle (from RRA code table)
   - **Quantity Unit Code (qtyUnitCd):** e.g., "U" for unit, "KG" for kilogram (from RRA code table)
3. Save the product
4. The system queues the product for synchronization to VSDC via the `/saveItem` endpoint

### Step 9: Disable Training Mode and Go Live

When all configuration is verified and test transactions are satisfactory:

1. Navigate to Settings → Organization → Training Mode
2. Click "Disable Training Mode"
3. Confirm in the dialog
4. Verify the "TRAINING MODE" banner disappears from the dashboard
5. Verify the VSDC connection indicator in the header shows green
6. Make ONE test normal sale (NS) with the smallest possible amount
7. Verify the NS receipt:
   - Receipt type label shows "NS"
   - SDC block appears with a real VSDC-issued signature
   - MRC number appears in format BBBCCNNNNNN
   - Receipt counter appears in format `X/Y NS`
   - Digital signature appears with hyphens every 4 characters
   - QR code prints and can be scanned

### Step 10: Verify RRA Compliance — Final Check

After the first live NS receipt is issued:

1. Check the MRC number on the receipt matches the RRA-issued MRC for that branch
2. Check the SDC ID on the receipt matches the registered device ID
3. Check the receipt counter format is correct (e.g., `1/1 NS` for the first receipt)
4. Scan the QR code with a mobile device
5. Navigate to https://rra.gov.rw and use the receipt verification service to validate the QR code
6. The RRA portal should confirm the receipt is valid
7. Print this receipt and file it as the "Go-Live Test Receipt" for the certification submission documentation

**Document the following for RRA submission:**
- Date and time of first live NS receipt
- Receipt number
- MRC number
- SDC ID
- VSDC status code received (must be `0` — Success)

---

<a name="section-9"></a>
## SECTION 9: BACKUP AND RECOVERY

### 9.1 Why Backups Are Mandatory

The Rwanda Revenue Authority requires EBM/VSDC data to be retained for a minimum of five (5) years. This includes all sale records, EBM transaction records (EbmTransaction table), outbox history (EbmOutbox table), receipt counter values (BranchReceiptCounter table), and activity logs (ActivityLog table).

Loss of this data may result in:
- Inability to respond to RRA audit requests
- Inability to prove receipt sequence continuity
- Financial penalties under the tax administration laws of Rwanda
- Suspension of the organization's EBM device certification

Backups are not optional for any production deployment of Excledge ERP/POS.

### 9.2 Manual Database Backup

To create a manual database backup at any time:

```bash
pg_dump -U excledge_user -h localhost excledge_erp | gzip > /backups/excledge_$(date +%Y%m%d_%H%M%S).sql.gz
```

To include all database objects explicitly:

```bash
pg_dump -U excledge_user -h localhost -Fc excledge_erp > /backups/excledge_$(date +%Y%m%d_%H%M%S).dump
```

The `-Fc` flag creates a custom-format backup that supports parallel restore.

Verify the backup is valid:

```bash
pg_restore --list /backups/excledge_[timestamp].dump | head -20
```

### 9.3 Automated Daily Backup with Cron

Create the backup directory and configure the cron job:

```bash
sudo mkdir -p /backups/excledge
sudo chown $USER:$USER /backups/excledge
```

Edit the cron table:

```bash
crontab -e
```

Add the following line (this runs daily at 2:00 AM):

```bash
0 2 * * * pg_dump -U excledge_user excledge_erp | gzip > /backups/excledge/excledge_$(date +\%Y\%m\%d).sql.gz 2>> /var/log/excledge/backup.log
```

Verify cron is set up correctly:

```bash
crontab -l
```

Test the backup script manually:

```bash
pg_dump -U excledge_user excledge_erp | gzip > /backups/excledge/excledge_test.sql.gz
ls -lh /backups/excledge/excledge_test.sql.gz
```

The backup file should be non-zero in size.

### 9.4 Backup Retention Policy

The following retention policy meets the RRA 5-year data retention requirement:

| Backup Frequency | Retention Period | Storage Required (estimate) |
|---|---|---|
| Daily backups | 30 days | ~3 GB |
| Weekly backups (every Sunday) | 52 weeks (1 year) | ~10 GB |
| Monthly backups (1st of month) | 60 months (5 years) | ~30 GB |

Implement automated retention management by adding these cleanup cron jobs:

```bash
# Delete daily backups older than 30 days
0 3 * * * find /backups/excledge/daily -name "*.sql.gz" -mtime +30 -delete

# Delete weekly backups older than 52 weeks
0 3 * * 1 find /backups/excledge/weekly -name "*.sql.gz" -mtime +365 -delete
```

### 9.5 Offsite Backup

Local backups are not sufficient. Use rsync or rclone to copy backups to a remote location.

**Using rsync to a remote server:**

```bash
rsync -avz --delete /backups/excledge/ user@backup-server.com:/backups/excledge/
```

Add this to cron to run nightly after the database backup completes:

```bash
30 2 * * * rsync -avz /backups/excledge/ user@backup-server.com:/backups/excledge/ >> /var/log/excledge/backup-sync.log 2>&1
```

**Using rclone to cloud storage (Google Drive, S3, etc.):**

```bash
# Install rclone
curl https://rclone.org/install.sh | sudo bash
# Configure rclone
rclone config
# Sync backups
rclone sync /backups/excledge/ remote:excledge-backups/
```

### 9.6 Recovery Procedure

In the event of server failure, database corruption, or accidental data deletion:

**Step 1: Stop the application**

```bash
pm2 stop excledge-erp
```

**Step 2: Restore the database from backup**

```bash
# For gzip SQL backup:
gunzip -c /backups/excledge/excledge_20240101.sql.gz | psql -U excledge_user excledge_erp

# For custom-format backup:
pg_restore -U excledge_user -d excledge_erp /backups/excledge/excledge_20240101.dump
```

**Step 3: Verify migration status**

```bash
cd /opt/excledge
npx prisma migrate status
```

All migrations should show `Applied`. If the restored backup predates a migration, run `npx prisma migrate deploy` to re-apply missing migrations.

**Step 4: Restart the application**

```bash
pm2 restart excledge-erp
```

**Step 5: Verify EBM consistency**

After recovery, check for EBmOutbox entries that were PROCESSING or PENDING at the time of failure:

Navigate to Settings → EBM → Outbox and filter for PROCESSING status. Entries stuck in PROCESSING may need manual review. The orphan reconciliation mechanism in `ebm-outbox.service.ts` will attempt to resolve these via the VSDC `/status` endpoint on the next job cycle (every 2 minutes).

---

<a name="section-10"></a>
## SECTION 10: UPGRADING THE SOFTWARE

### 10.1 Pre-Upgrade Checklist

Complete all items before beginning the upgrade:

| Item | Done | Notes |
|---|---|---|
| Create a full database backup | [ ] | `pg_dump -U excledge_user excledge_erp > backup_pre_upgrade.sql` |
| Notify all active users of maintenance window | [ ] | |
| Confirm all EbmOutbox items are SUCCEEDED or DEAD_LETTER | [ ] | No PENDING items should be mid-flight |
| Review release notes for migration warnings | [ ] | Especially review Prisma migration changes |
| Confirm new version is compatible with current PostgreSQL | [ ] | |
| Test upgrade on a staging server first if available | [ ] | |

### 10.2 Step-by-Step Upgrade Procedure

```bash
# Step 1: Create pre-upgrade backup
pg_dump -U excledge_user excledge_erp | gzip > /backups/excledge/pre_upgrade_$(date +%Y%m%d_%H%M%S).sql.gz

# Step 2: Stop the application
pm2 stop excledge-erp

# Step 3: Backup current application files
cp -r /opt/excledge /opt/excledge.bak_$(date +%Y%m%d)

# Step 4: Deploy new application files
# Option A (archive): unzip new-version.zip -d /opt/excledge
# Option B (git): cd /opt/excledge && git fetch && git checkout v[NEW_VERSION]

# Step 5: Install updated dependencies
cd /opt/excledge
npm ci --omit=dev

# Step 6: Run database migrations
npx prisma migrate deploy
npx prisma generate
npx prisma migrate status  # Verify all applied

# Step 7: Build the application
npm run build

# Step 8: Start the application
pm2 start excledge-erp

# Step 9: Verify
pm2 status
curl http://localhost:5000/health
```

### 10.3 Rollback Procedure

If the upgrade fails and the previous version must be restored:

```bash
# Step 1: Stop the failed application
pm2 stop excledge-erp

# Step 2: Restore database from pre-upgrade backup
gunzip -c /backups/excledge/pre_upgrade_[timestamp].sql.gz | psql -U excledge_user excledge_erp

# Step 3: Restore application files from backup
rm -rf /opt/excledge
mv /opt/excledge.bak_[date] /opt/excledge

# Step 4: Start the previous version
cd /opt/excledge
pm2 start excledge-erp

# Step 5: Verify the previous version is running
curl http://localhost:5000/health
```

**Important:** Prisma migration rollback is not automatically supported. If the new version applied database migrations, a schema rollback may require manual SQL commands. Always test upgrades on a staging server before production.

### 10.4 Post-Upgrade Verification

After any upgrade, perform the following verification steps before returning the system to active use:

1. Check the health endpoint returns the new version number: `curl http://localhost:5000/health`
2. Log in to the dashboard and verify the version number in the footer matches the new version
3. Navigate to Settings → EBM → Test Connection and confirm VSDC connectivity is green
4. Create one test sale in training mode to verify the complete EBM flow works
5. Review PM2 logs for any new error patterns: `pm2 logs excledge-erp --lines 200`
6. Confirm EbmOutbox background job is processing (check Settings → EBM → Outbox shows new entries processing)
7. Generate an X report for the current day and verify it renders correctly

### 10.5 Notification to RRA for Version Changes

Per RRA certification requirements, any change to the software version that affects EBM functionality must be communicated to RRA.

When upgrading from one certified version to another:

1. Prepare a version change notification letter including:
   - Previous version number
   - New version number
   - Summary of EBM-related changes
   - Date of upgrade
   - Organization name and TIN
2. Submit the notification to RRA via the official EBM certification channel
3. Update the version number on all certification documents submitted to RRA
4. If the new version introduces changes to receipt format, VSDC payload structure, or tax calculation logic, a full re-certification review may be required

---

*Document Reference: EXC-INSTALL-v1.0.0-2026*
*Software Version: 1.0.0*
*Classification: Technical — Not for End Users*
*Last Updated: June 2026*
*Contact: exceledgecpaltd@gmail.com*
