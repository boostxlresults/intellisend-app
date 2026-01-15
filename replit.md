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
10. **Per-Tenant Twilio Integration**: Each tenant can configure their own Twilio credentials (Account SID, Auth Token, Messaging Service SID) with validation and testing
11. **Multi-Tenant User Access**: UserTenantMembership model with roles (OWNER, ADMIN, MEMBER) for team collaboration

## Environment Variables

Required for full functionality:
- `DATABASE_URL` - PostgreSQL connection string (auto-configured)
- `TWILIO_ACCOUNT_SID` - Global Twilio account SID (fallback if tenant has no credentials)
- `TWILIO_AUTH_TOKEN` - Global Twilio auth token (fallback)
- `TWILIO_MESSAGING_SERVICE_SID` - Global Twilio messaging service SID (fallback)
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

### Integrations
- `GET /api/tenants/:tenantId/integrations` - Get integration status (Twilio configured, etc.)
- `POST /api/tenants/:tenantId/integrations/twilio` - Save/update Twilio credentials
- `DELETE /api/tenants/:tenantId/integrations/twilio` - Remove Twilio integration
- `POST /api/tenants/:tenantId/integrations/twilio/test` - Test Twilio connection

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
- **User Authentication**: Secure login with bcrypt password hashing, session-based auth, protected API routes
  - First user registration allowed (creates admin)
  - Subsequent registration disabled for security
  - Sessions stored in PostgreSQL with connect-pg-simple
- **Production Deployment Preparation**:
  - Environment variable configuration for API URLs
  - CORS configured for cross-domain frontend/backend
  - Session cookies configured for cross-domain auth
  - Comprehensive deployment guide (DEPLOYMENT.md) for Vercel + Railway + Neon
- **TCPA Compliance System**:
  - Consent Management: ConsentRecord model with source tracking (WEB_FORM, SMS_KEYWORD, IMPORT, MANUAL, API), timestamps, IP address, user agent, and consent text
  - Pre-Send Compliance Validation: Campaign approval checklist (consent verified, opt-out included, quiet hours check, content review) required before scheduling
  - Complaint/Spam Analytics Dashboard: Alerts for high opt-out rates (>2%), complaint rates (>0.1%), carrier blocking (>10), with trend charts
  - Per-Recipient Rate Limiting: 3 messages/day, 10/week, 25/month, 30s minimum between messages - integrated into SMS sending
  - Enhanced Twilio Onboarding Wizard: 4-step A2P 10DLC guidance for proper carrier registration
  - MessageEvent types extended: RATE_LIMITED, OPT_OUT, COMPLAINT, CARRIER_BLOCKED for accurate analytics
  - Campaign scheduler enforces compliance checklist before processing
- **Send Interval Jitter System**:
  - OutboundMessageQueue table for queue-based sending with status tracking
  - Tenant-configurable send rate (messages per minute, 1-120 range)
  - Configurable jitter range (min/max milliseconds) for random spacing between messages
  - Queue dispatcher processes messages with intelligent staggering to avoid carrier spam detection
  - Campaign scheduler queues messages instead of direct sending
  - UI in Settings page for send rate and jitter configuration
- **Enhanced Multi-Tag System**:
  - Normalized Tag model with tenant-scoped unique names and optional colors
  - ContactTag junction table for many-to-many contact-tag relationships
  - Contacts can have multiple tags (e.g., "homeowner", "85742", "solar owner")
  - CSV import supports multiple tags per contact and upserts existing tags
  - Tag management API (create, list, delete tags)
  - Segment builder with AND/OR/NONE tag filtering logic
  - Segment preview endpoint to preview contacts matching tag criteria
- **Automated Drip Sequences**:
  - Sequence model with multi-step message automation
  - SequenceStep with configurable delays (minutes, hours, days)
  - SequenceEnrollment for contact tracking through sequences
  - Sequence processor service runs every 30 seconds
  - Queue-based sending with proper completion tracking
  - Frontend UI for creating and managing sequences
- **A/B Testing for Campaigns**:
  - CampaignVariant model with split percentages
  - Variant creation and management endpoints
  - A/B results endpoint for comparing variant performance
  - Tracks delivery rates and click rates per variant
- **Link Tracking & Short URLs**:
  - TrackedLink model with unique short codes
  - LinkClick model for tracking engagement
  - Redirect handler that records clicks with contact attribution
  - Link analytics endpoint showing total and unique clicks
- **MMS Support**:
  - mediaUrl field added to Message and OutboundMessageQueue
  - Twilio client updated to send media attachments
  - Queue dispatcher handles MMS with proper usage metering
- **Template Library**:
  - MessageTemplate model with categories (APPOINTMENT_REMINDER, REVIEW_REQUEST, SEASONAL_PROMO, etc.)
  - 11 pre-built system templates for home services
  - Custom template creation per tenant
  - Template variables support ({{firstName}}, {{companyName}}, etc.)
- **Billing & Usage Metering**:
  - TenantPlan model with FREE, STARTER, PROFESSIONAL, ENTERPRISE tiers
  - UsageRecord model tracking monthly SMS/MMS counts
  - Usage metering integrated into queue dispatcher
  - Plan upgrade endpoint (Stripe integration placeholder)
  - Billing dashboard showing current plan and usage
- **White-Label Branding**:
  - TenantBranding model for custom logos, colors, domains
  - Primary/secondary color customization
  - Custom domain support
  - Hide "Powered by IntelliSend" option
  - Branding API endpoints for get/update
- **ServiceTitan Bookings Integration**:
  - ServiceTitanConfig model for per-tenant API credentials (API base URL, tenant ID, client ID/secret)
  - OAuth token caching with automatic refresh
  - Automatic booking creation on inbound SMS replies via job queue
  - ServiceTitanBookingJob table with lease-based processing for reliable exactly-once booking creation
  - Conversation needsAttention flag for prioritizing customer replies
  - Conversation summary helper builds transcript snippets for booking notes
  - Settings UI for ServiceTitan configuration with connection testing
  - Conversations page shows "Needs Attention" badges for customer replies
  - Robust retry mechanism with exponential backoff for transient failures
  - Idempotency via unique messageSid constraint prevents duplicate bookings
