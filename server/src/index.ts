import express from 'express';
import cors from 'cors';
import path from 'path';
import dotenv from 'dotenv';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { PrismaClient } from '@prisma/client';
import tenantRoutes from './routes/tenants';
import contactRoutes from './routes/contacts';
import segmentRoutes from './routes/segments';
import campaignRoutes from './routes/campaigns';
import conversationRoutes from './routes/conversations';
import suppressionRoutes from './routes/suppressions';
import aiPersonaRoutes from './routes/aiPersonas';
import kbArticleRoutes from './routes/kbArticles';
import twilioWebhooks from './routes/twilioWebhooks';
import healthRoutes from './routes/health';
import analyticsRoutes from './routes/analytics';
import authRoutes from './routes/auth';
import integrationRoutes from './routes/integrations';
import { requireAuth } from './middleware/auth';
import { startCampaignScheduler } from './services/campaignScheduler';

dotenv.config();

export const prisma = new PrismaClient();

const app = express();
const PORT = process.env.PORT || 3001;

const PgSession = connectPgSimple(session);

const corsOrigins = process.env.FRONTEND_URL 
  ? process.env.FRONTEND_URL.split(',').map(url => url.trim())
  : true;

app.use(cors({
  origin: corsOrigins,
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.set('trust proxy', 1);

app.use(session({
  store: new PgSession({
    conString: process.env.DATABASE_URL,
    tableName: 'user_sessions',
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET || 'intellisend-dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    domain: process.env.COOKIE_DOMAIN || undefined,
  },
}));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);

app.use('/api/tenants', requireAuth, tenantRoutes);
app.use('/api/tenants', requireAuth, contactRoutes);
app.use('/api/tenants', requireAuth, segmentRoutes);
app.use('/api/tenants', requireAuth, campaignRoutes);
app.use('/api/tenants', requireAuth, conversationRoutes);
app.use('/api/tenants', requireAuth, suppressionRoutes);
app.use('/api/tenants', requireAuth, aiPersonaRoutes);
app.use('/api/tenants', requireAuth, kbArticleRoutes);
app.use('/api/tenants', requireAuth, analyticsRoutes);
app.use('/api/tenants', requireAuth, integrationRoutes);
app.use('/webhooks/twilio', twilioWebhooks);
app.use('/api/health', healthRoutes);

app.use(express.static(path.join(__dirname, '../public')));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/webhooks') || req.path.startsWith('/health')) {
    return next();
  }
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err.message);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

async function main() {
  try {
    await prisma.$connect();
    console.log('Database connected successfully');
    
    startCampaignScheduler();
    
    app.listen(PORT, () => {
      console.log(`IntelliSend server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

main();
