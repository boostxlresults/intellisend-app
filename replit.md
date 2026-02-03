# IntelliSend - Multi-Tenant SMS Platform

## Overview
IntelliSend is a production-ready outbound SMS platform designed for home-services brands. Its primary purpose is to streamline SMS communication, enabling multi-tenant operations with robust features for contact management, targeted campaigns, two-way conversations, and compliance. The platform aims to enhance customer engagement and operational efficiency through integrated AI and analytics. It supports multi-tenant architecture with contact list upload, audience segmentation, campaigns, two-way conversation inbox, compliance features, and AI-assisted content creation.

## User Preferences
The user wants to communicate with the AI in simple, clear language. The user prefers an iterative development approach and wants to be asked before any major changes are made to the codebase. The user also wants detailed explanations for complex features or decisions.

## System Architecture
The platform is built on a modern tech stack featuring Node.js with TypeScript and Express.js for the backend, and React with TypeScript and Vite for the frontend. Data persistence is handled by PostgreSQL using Prisma ORM.

**Core Architectural Patterns & Design Decisions:**
- **Multi-Tenant Architecture**: Each tenant operates in an isolated environment with dedicated data for contacts, conversations, campaigns, and phone numbers.
- **Microservices-like Structure**: The backend is organized into distinct services for routes, business logic, Twilio integration, and an extensible AI engine.
- **UI/UX**: The frontend employs a clean, admin-style interface using React, focusing on intuitive navigation and data visualization.
- **Data Management**: Prisma ORM provides a type-safe and efficient way to interact with the PostgreSQL database, handling migrations and complex queries.
- **Messaging Integration**: Deep integration with Twilio for SMS sending, receiving, and status callbacks, with per-tenant Twilio credential configuration.
- **Compliance System**: Automated features for TCPA compliance, including STOP word detection, suppression lists, quiet hours, consent management, pre-send validation, rate limiting, and A2P 10DLC guidance.
- **AI Integration**:
    - **AI-Assisted Content Creation**: GPT-4o-mini for generating improved message content, suggesting replies, and intent classification.
    - **AI Booking Agent**: An intelligent agent capable of qualifying leads, booking appointments via ServiceTitan, and managing conversation states. It includes:
      - Intent classification (OPT_OUT, INTERESTED, BOOK_YES, INFO_REQUEST, etc.)
      - ServiceTitan customer search by phone - finds existing accounts
      - Address confirmation for existing customers, address collection for new customers
      - Real availability lookup from ServiceTitan Capacity API
      - Time slot presentation ("I have a tech available: 1) Thursday 12-2 PM, 2) Friday 10 AM-12 PM")
      - Customer selection handling (reply 1, 2, or 3)
      - Automatic job/appointment creation with selected time slot
      - Full conversation history context (50 messages including campaign sends)
    - **Per-Tenant AI Personas**: Each tenant can configure custom AI personalities with system prompts. Includes 4 starter templates (Professional, Friendly, Concise, Home Services Expert) or custom prompts.
    - **Per-Tenant Knowledge Base**: Tenants can upload articles about their company, services, pricing, FAQs. The AI uses this information when responding to customers.
- **Campaign & Automation Features**:
    - **Campaign System**: Blast campaigns with message templates, AI assistance, scheduling, and A/B testing capabilities.
    - **Automated Drip Sequences**: Multi-step message automation with configurable delays and enrollment tracking.
    - **Send Interval Jitter System**: Configurable send rates and jitter to intelligently stagger messages and avoid carrier spam detection.
- **Analytics & Reporting**: Comprehensive dashboard for SMS analytics, tracking message volume, delivery rates, opt-out trends, campaign performance, and compliance metrics (complaint/spam analytics).
- **Security**: User authentication with bcrypt hashing, session-based auth, and protected API routes.
- **Extensibility**: AI layer is designed for future enhancements and integrations.
- **White-Labeling**: Support for tenant-specific branding including logos, color schemes, and custom domains.
- **Billing & Usage Metering**: Tiered plans and tracking of monthly SMS/MMS usage.

**Key Technical Implementations:**
- **Twilio Webhooks**: Handlers for inbound SMS and delivery status updates with signature validation.
- **Scheduler Services**: Background processes for campaign scheduling, sequence processing, and AI agent operations.
- **Link Tracking**: Short URLs and click tracking for campaign performance monitoring.
- **MMS Support**: Capabilities to send and receive media attachments.
- **Email Notifications**: Integration with Resend for email alerts, especially for customer replies.
- **SMS Opt-In Capture**: Y/YES reply detection automatically tags contacts as "Opted In" with consent timestamp.
- **Contact Notes**: Internal note-taking system for contacts to track important information and follow-ups.
- **Duplicate Contact Detection & Merging**: Identifies contacts with the same phone number and allows merging them into a single record, consolidating tags, notes, conversations, and messages.

## External Dependencies
- **Twilio**: Core SMS messaging platform, used for sending/receiving SMS and managing messaging services.
- **PostgreSQL**: Primary database for all application data.
- **OpenAI**: AI engine for content generation, reply suggestions, and intent classification (specifically GPT-4o-mini).
- **ServiceTitan**: Integration for home services booking management, including CRM API for customer, location, and job creation, and OAuth for authentication.
- **Resend**: Email notification service for sending alerts.
- **Recharts**: JavaScript charting library for analytics visualizations.
- **Papa Parse**: CSV parser used for contact import functionality.
- **bcrypt**: For password hashing in user authentication.
- **connect-pg-simple**: For storing session data in PostgreSQL.