import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../index';

const router = Router();

router.post('/setup-admin', async (req, res) => {
  try {
    const { email, password, tenantName, setupKey } = req.body;

    if (setupKey !== 'INTELLISEND_SETUP_2024') {
      res.status(403).json({ error: 'Invalid setup key' });
      return;
    }

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const existingUsers = await prisma.user.count();
    if (existingUsers > 0) {
      res.status(400).json({ error: 'Setup already completed. Users exist in database.' });
      return;
    }

    const tenant = await prisma.tenant.create({
      data: {
        name: (tenantName || 'default').toLowerCase().replace(/\s+/g, '-'),
        publicName: tenantName || 'IntelliSend',
        plan: 'pro',
        monthlyMessageLimit: 10000,
        quietHoursStart: '21:00',
        quietHoursEnd: '08:00',
        quietHoursTimezone: 'America/New_York',
      },
    });

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        passwordHash,
        name: 'Admin',
        role: 'admin',
        tenantId: tenant.id,
      },
    });

    res.json({
      success: true,
      message: 'Admin user created successfully',
      email: user.email,
      tenantName: tenant.publicName,
    });
  } catch (error: any) {
    console.error('Setup error:', error);
    res.status(500).json({ error: 'Setup failed: ' + error.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { tenant: true },
    });

    if (!user) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const isValidPassword = await bcrypt.compare(password, user.passwordHash);
    if (!isValidPassword) {
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    (req.session as any).userId = user.id;
    (req.session as any).tenantId = user.tenantId;

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId,
        tenant: user.tenant ? {
          id: user.tenant.id,
          name: user.tenant.name,
          publicName: user.tenant.publicName,
        } : null,
      },
    });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
      res.status(500).json({ error: 'Logout failed' });
      return;
    }
    res.clearCookie('connect.sid');
    res.json({ message: 'Logged out successfully' });
  });
});

router.get('/me', async (req, res) => {
  try {
    const userId = (req.session as any)?.userId;
    
    if (!userId) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { tenant: true },
    });

    if (!user) {
      res.status(401).json({ error: 'User not found' });
      return;
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId,
        tenant: user.tenant ? {
          id: user.tenant.id,
          name: user.tenant.name,
          publicName: user.tenant.publicName,
        } : null,
      },
    });
  } catch (error: any) {
    console.error('Auth check error:', error);
    res.status(500).json({ error: 'Auth check failed' });
  }
});

router.get('/can-register', async (req, res) => {
  try {
    const userCount = await prisma.user.count();
    res.json({ canRegister: userCount === 0 });
  } catch (error: any) {
    res.status(500).json({ canRegister: false });
  }
});

router.post('/register', async (req, res) => {
  try {
    const { email, password, name, tenantId } = req.body;

    if (!email || !password || !name) {
      res.status(400).json({ error: 'Email, password, and name are required' });
      return;
    }

    const userCount = await prisma.user.count();
    if (userCount > 0) {
      res.status(403).json({ error: 'Registration is disabled. Contact an administrator.' });
      return;
    }

    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingUser) {
      res.status(400).json({ error: 'Email already registered' });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        name,
        passwordHash,
        tenantId: tenantId || null,
        role: 'ADMIN',
      },
      include: { tenant: true },
    });

    (req.session as any).userId = user.id;
    (req.session as any).tenantId = user.tenantId;

    res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        tenantId: user.tenantId,
        tenant: user.tenant ? {
          id: user.tenant.id,
          name: user.tenant.name,
          publicName: user.tenant.publicName,
        } : null,
      },
    });
  } catch (error: any) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

export default router;
