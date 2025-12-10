# IntelliSend - Multi-Tenant SMS Platform

## Overview
IntelliSend is a production-ready outbound SMS platform for home-services brands that integrates with Twilio Messaging Services. It supports multi-tenant architecture with contact list upload, audience segmentation, campaigns, two-way conversation inbox, compliance features, and AI-assisted content creation.

## Tech Stack

### Backend
- Node.js + TypeScript
- Express.js HTTP framework
- PostgreSQL database
- Prisma ORM for data modeling/migrations
- Twilio Node SDK for SMS

### Frontend
- React + TypeScript (Vite)
- React Router for navigation
- Clean admin-style UI

## Project Structure

```
/server
  /src
    /routes      - Express API routes
    /services    - Business logic services
    /twilio      - Twilio client integration
    /ai          - AI engine abstraction (stubbed)
  /prisma        - Database schema and migrations

/client
  /src
    /api         - API client functions
    /components  - Reusable UI components
    /context     - React context providers
    /pages       - Page components
```

## Key Features

1. **Multi-Tenant Architecture**: Each tenant has their own contacts, conversations, campaigns, and phone numbers
2. **Contact Management**: Import contacts via JSON, add tags, segment audiences
3. **Campaign System**: Create blast campaigns with message templates and AI assistance
4. **Conversation Inbox**: Two-way SMS messaging with AI reply suggestions
5. **Compliance**: STOP word detection, suppression lists, quiet hours ready
6. **Twilio Integration**: Webhooks for inbound SMS and status callbacks

## Environment Variables

Required for full functionality:
- `DATABASE_URL` - PostgreSQL connection string (auto-configured)
- `TWILIO_ACCOUNT_SID` - Twilio account SID
- `TWILIO_AUTH_TOKEN` - Twilio auth token
- `TWILIO_MESSAGING_SERVICE_SID` - Twilio messaging service SID

## API Endpoints

### Tenants
- `GET /api/tenants` - List all tenants
- `POST /api/tenants` - Create a tenant
- `GET /api/tenants/:tenantId/numbers` - List tenant phone numbers
- `POST /api/tenants/:tenantId/numbers` - Add phone number

### Contacts
- `GET /api/tenants/:tenantId/contacts` - List contacts with pagination
- `POST /api/tenants/:tenantId/contacts` - Create contact
- `POST /api/tenants/:tenantId/contacts/import` - Import contacts from JSON
- `POST /api/tenants/:tenantId/contacts/:contactId/tags` - Add tag

### Campaigns
- `GET /api/tenants/:tenantId/campaigns` - List campaigns
- `POST /api/tenants/:tenantId/campaigns` - Create campaign
- `POST /api/tenants/:tenantId/campaigns/:campaignId/schedule` - Schedule campaign

### Conversations
- `GET /api/tenants/:tenantId/conversations` - List conversations
- `GET /api/tenants/:tenantId/conversations/:conversationId` - Get conversation with messages
- `POST /api/tenants/:tenantId/conversations/:conversationId/messages` - Send message

### Twilio Webhooks
- `POST /webhooks/twilio/inbound` - Receive inbound SMS
- `POST /webhooks/twilio/status` - Receive delivery status updates

## Running the Application

The application runs with two servers:
1. Backend API server on port 3001
2. Frontend dev server on port 5000 (proxies API requests to backend)

## Development Notes

- AI layer is currently stubbed - returns modified text with "[AI enhanced]" suffix
- Campaign scheduler runs every 60 seconds checking for scheduled campaigns
- Frontend uses Vite proxy to communicate with backend API
- Prisma is used for database migrations and type-safe queries

## Recent Changes
- Initial implementation of full SMS platform
- Multi-tenant data model with Prisma
- Complete REST API for all entities
- React dashboard with all core views
- Twilio webhook handlers for SMS
- AI stub layer for future integration
