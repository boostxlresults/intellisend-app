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
2. **Contact Management**: Import contacts via JSON or CSV, add tags, segment audiences
3. **Campaign System**: Create blast campaigns with message templates and AI assistance
4. **Conversation Inbox**: Two-way SMS messaging with AI reply suggestions
5. **Compliance**: STOP word detection (STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT), suppression lists, quiet hours enforcement, automatic opt-out footer
6. **Twilio Integration**: Webhooks for inbound SMS and status callbacks with signature validation
7. **Tenant Settings**: Per-tenant timezone, quiet hours (no SMS during configured hours), and default from number
8. **Analytics Dashboard**: Message volume tracking, delivery rates, opt-out trends, blocked sends, campaign performance with charts
9. **User Authentication**: Secure login with bcrypt password hashing, session-based auth, protected API routes

## Environment Variables

Required for full functionality:
- `DATABASE_URL` - PostgreSQL connection string (auto-configured)
- `TWILIO_ACCOUNT_SID` - Twilio account SID
- `TWILIO_AUTH_TOKEN` - Twilio auth token
- `TWILIO_MESSAGING_SERVICE_SID` - Twilio messaging service SID
- `SESSION_SECRET` - Secret for session encryption (auto-generated if not set)
- `FRONTEND_URL` - Frontend URL for CORS (optional, auto-detected)

## API Endpoints

### Tenants
- `GET /api/tenants` - List all tenants
- `POST /api/tenants` - Create a tenant
- `GET /api/tenants/:tenantId/numbers` - List tenant phone numbers
- `POST /api/tenants/:tenantId/numbers` - Add phone number
- `GET /api/tenants/:tenantId/settings` - Get tenant settings (timezone, quiet hours)
- `POST /api/tenants/:tenantId/settings` - Update tenant settings

### Contacts
- `GET /api/tenants/:tenantId/contacts` - List contacts with pagination
- `POST /api/tenants/:tenantId/contacts` - Create contact
- `POST /api/tenants/:tenantId/contacts/import` - Import contacts from JSON or CSV (multipart/form-data)
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
- Twilio webhook handlers for SMS with signature validation
- TenantSettings model: timezone, quiet hours, default from number
- Quiet hours enforcement in campaign scheduler and conversations
- CSV contact import with Papa Parse for proper quoted field handling
- Global tags support on import
- Settings UI for timezone, quiet hours, default from number
- **AI Layer Upgrade**: Full OpenAI integration with real GPT calls
  - generateImprovedMessage with persona and knowledge base context
  - suggestRepliesForInboundMessage with conversation transcript
  - AI goal selector (higher_reply_rate, more_compliant, shorter, friendlier)
  - Fallback to original text when OPENAI_API_KEY not set
- **New Conversation Flow**: Start new conversations from Conversations page with contact selector
- **Opt-Out Footer**: All outgoing SMS automatically includes "Reply STOP to unsubscribe" footer
- **Segment Tag Filtering**: Create segments by filtering contacts by tags
- **Analytics Dashboard**: Comprehensive SMS analytics with:
  - MessageEvent model tracking SENT, DELIVERED, FAILED, SUPPRESSED events
  - KPI cards: Messages Sent, Delivery Rate, Opt-Outs, Reply Rate, Blocked Sends, Replies
  - Line charts for message volume over time
  - Bar charts for delivery status breakdown
  - Campaign performance table with delivery metrics
  - Time range filtering (Today, 7 Days, 30 Days, All Time)
  - Recharts library for visualizations
