import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
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
import { startCampaignScheduler } from './services/campaignScheduler';

dotenv.config();

export const prisma = new PrismaClient();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/tenants', tenantRoutes);
app.use('/api/tenants', contactRoutes);
app.use('/api/tenants', segmentRoutes);
app.use('/api/tenants', campaignRoutes);
app.use('/api/tenants', conversationRoutes);
app.use('/api/tenants', suppressionRoutes);
app.use('/api/tenants', aiPersonaRoutes);
app.use('/api/tenants', kbArticleRoutes);
app.use('/webhooks/twilio', twilioWebhooks);
app.use('/api/health', healthRoutes);

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
