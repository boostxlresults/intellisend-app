import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function createAdmin() {
  const email = process.argv[2] || 'admin@intellisend.net';
  const password = process.argv[3] || 'IntelliSend2024!';
  const tenantName = process.argv[4] || 'IntelliSend Demo';

  console.log(`Creating admin user: ${email}`);

  const existingUser = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  if (existingUser) {
    console.log('User already exists!');
    await prisma.$disconnect();
    return;
  }

  const tenant = await prisma.tenant.create({
    data: {
      name: tenantName.toLowerCase().replace(/\s+/g, '-'),
      publicName: tenantName,
      plan: 'pro',
      monthlyMessageLimit: 10000,
      quietHoursStart: '21:00',
      quietHoursEnd: '08:00',
      quietHoursTimezone: 'America/New_York',
    },
  });

  console.log(`Created tenant: ${tenant.publicName}`);

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

  console.log(`Created admin user: ${user.email}`);
  console.log('');
  console.log('=== LOGIN CREDENTIALS ===');
  console.log(`Email: ${email}`);
  console.log(`Password: ${password}`);
  console.log('=========================');

  await prisma.$disconnect();
}

createAdmin().catch(console.error);
