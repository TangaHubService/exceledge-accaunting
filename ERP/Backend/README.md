# Pharmacy Management System - Backend

Backend API for the Pharmacy Inventory & Sales Management System built with Express, TypeScript, PostgreSQL, and Prisma.

## Features

// <CHANGE> Added new features documentation
- **Authentication & Authorization**: JWT-based auth with role-based access control
- **Multi-tenant Support**: Each pharmacy's data is completely isolated
- **Pharmacy Management**: Create, manage multiple pharmacies with user invitations
- **User Invitations**: Single and bulk user invitations via Excel upload
- **Subscription Management**: Automated billing with DPO Pay integration
- **Payment Processing**: Secure payment handling with DPO Pay gateway
- **Email Notifications**: Automated alerts for expiry, subscriptions, and reports
- **Cron Jobs**: Automated tasks for subscriptions and medicine expiry alerts
- **RESTful API**: Clean, organized endpoints for all operations
- **FEFO System**: First Expired First Out inventory management
- **Comprehensive Reports**: Sales, inventory, and debtors reporting
- **System Owner Dashboard**: Super admin view of all pharmacies and revenue

... existing code ...

## API Endpoints

### Authentication
- `POST /api/auth/signup` - Register new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/me` - Get current user
- `POST /api/auth/switch-pharmacy` - Switch active pharmacy

// <CHANGE> Added pharmacy endpoints
### Pharmacies
- `GET /api/pharmacies` - Get all pharmacies for logged-in user
- `GET /api/pharmacies/:id` - Get pharmacy by ID
- `POST /api/pharmacies` - Create new pharmacy
- `PUT /api/pharmacies/:id` - Update pharmacy
- `DELETE /api/pharmacies/:id` - Delete pharmacy (soft delete)
- `POST /api/pharmacies/:pharmacyId/invite` - Invite single user
- `POST /api/pharmacies/:pharmacyId/bulk-invite` - Bulk invite users via Excel
- `POST /api/pharmacies/accept-invitation` - Accept invitation
- `GET /api/pharmacies/:pharmacyId/users` - Get pharmacy users
- `DELETE /api/pharmacies/:pharmacyId/users/:userId` - Remove user from pharmacy

... existing code ...

// <CHANGE> Added system owner endpoints
### System Owner
- `GET /api/system-owner/dashboard` - Get system-wide statistics
- `GET /api/system-owner/pharmacies` - Get all pharmacies
- `GET /api/system-owner/users` - Get all users
- `GET /api/system-owner/revenue` - Get revenue analytics
- `PUT /api/system-owner/pharmacies/:id/status` - Update pharmacy status

### Subscriptions
- `GET /api/subscriptions/:pharmacyId` - Get pharmacy subscription
- `POST /api/subscriptions/:pharmacyId/create` - Create subscription payment
- `GET /api/subscriptions/:pharmacyId/history` - Get payment history

### Payments
- `POST /api/payments/create` - Create DPO Pay payment
- `POST /api/payments/verify` - Verify payment status
- `POST /api/payments/webhook` - DPO Pay webhook handler

... existing code ...

## User Roles & Permissions

// <CHANGE> Added SYSTEM_OWNER role
- **SYSTEM_OWNER**: Super admin with access to all pharmacies and system analytics
- **ADMIN**: Full pharmacy access, can invite users and manage pharmacy
- **MANAGER**: Manage inventory, view reports, approve transactions
- **ACCOUNTANT**: View sales data, manage debtors, sync with QuickBooks
- **PHARMACIST**: Record sales, view inventory, see alerts

... existing code ...

## Environment Variables

Create a `.env` file in the server directory with the following variables:

\`\`\`env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/pharmacy_db"

# Server
PORT=5000
NODE_ENV=development

# JWT
JWT_SECRET="your-super-secret-jwt-key-change-this-in-production"

# Frontend URL
FRONTEND_URL="http://localhost:3000"

# DPO Pay Integration
DPO_COMPANY_TOKEN="your-dpo-company-token"
DPO_SERVICE_TYPE="your-dpo-service-type"
DPO_API_URL="https://secure.3gdirectpay.com"

# Email Configuration (SMTP)
EMAIL_HOST="smtp.gmail.com"
EMAIL_PORT=587
EMAIL_USER="your-email@gmail.com"
EMAIL_PASSWORD="your-app-password"
EMAIL_FROM="Pharmacy System <noreply@pharmacy.com>"

# Subscription Pricing
MONTHLY_PRICE=2999
QUARTERLY_PRICE=7999
YEARLY_PRICE=29999
\`\`\`

## Bulk User Invitation via Excel

To invite multiple users at once, upload an Excel file with the following format:

| email | role |
|-------|------|
| user1@example.com | PHARMACIST |
| user2@example.com | MANAGER |
| user3@example.com | ACCOUNTANT |

**Supported Roles**: ADMIN, MANAGER, ACCOUNTANT, PHARMACIST

**Endpoint**: `POST /api/pharmacies/:pharmacyId/bulk-invite`

## Automated Cron Jobs

The system runs four automated cron jobs:

1. **Subscription Reminder Job** - Runs daily at 9 AM
   - Sends reminders 7 days before subscription expiry
   - Sends reminders 3 days before subscription expiry

2. **Subscription Expiry Job** - Runs daily at midnight
   - Marks expired subscriptions as EXPIRED
   - Deactivates pharmacies with expired subscriptions

3. **Medicine Expiry Alert Job** - Runs daily at 8 AM
   - Checks all medicines for expiry (30 days, 7 days, expired)
   - Sends email alerts to pharmacy admins and managers

4. **Daily Report Job** - Runs daily at 10 PM
   - Compiles daily sales summary
   - Lists inventory alerts
   - Shows customer debts
   - Emails report to pharmacy management

## API Documentation

Interactive OpenAPI (Swagger) is served by the running backend:

| URL | Description |
|-----|-------------|
| `/api/docs` | Docs landing page |
| `/api/docs/full` | Full backend API (~280 routes) |
| `/api/docs/rra` | RRA / EBM fiscal endpoints only |
| `/api/docs/openapi.json` | Full OpenAPI 3.0 JSON |
| `/api/docs/rra.json` | RRA-only OpenAPI JSON |

Regenerate specs after adding routes:

```bash
npm run docs:generate
```

## Postman Collection

Prefer the generated collections under `../Postman/`:

- `Excledge-API-Collection.json` — full API
- `Excledge-RRA-API-Collection.json` — RRA/EBM only
- `EBM-Test-Collection.json` — sandbox certification flows
- `EBM-Environment.json` — shared env (`baseUrl`, JWT, TIN, …)

`postman_collection.json` in this folder is regenerated by `npm run docs:generate` and mirrors the full collection.

See `../Postman/README.md` for import steps and the RRA endpoint map.

... existing code ...
\`\`\`

\`\`\`json file="" isHidden
