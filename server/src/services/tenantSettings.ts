import { prisma } from '../index';

export interface TenantSendContext {
  fromNumber: string;
  timezone: string;
  quietHoursStart: number;
  quietHoursEnd: number;
}

export async function getTenantSendContext(tenantId: string): Promise<TenantSendContext | null> {
  let settings = await prisma.tenantSettings.findUnique({
    where: { tenantId },
    include: { defaultFromNumber: true },
  });

  if (!settings) {
    settings = await prisma.tenantSettings.create({
      data: {
        tenantId,
        timezone: 'America/Phoenix',
        quietHoursStart: 20 * 60,
        quietHoursEnd: 8 * 60,
      },
      include: { defaultFromNumber: true },
    });
  }

  let fromNumber: string | null = null;

  if (settings.defaultFromNumber) {
    fromNumber = settings.defaultFromNumber.phoneNumber;
  } else {
    const defaultNum = await prisma.tenantNumber.findFirst({
      where: { tenantId, isDefault: true },
    });
    
    if (defaultNum) {
      fromNumber = defaultNum.phoneNumber;
    } else {
      const anyNum = await prisma.tenantNumber.findFirst({
        where: { tenantId },
      });
      fromNumber = anyNum?.phoneNumber || null;
    }
  }

  if (!fromNumber) {
    return null;
  }

  return {
    fromNumber,
    timezone: settings.timezone,
    quietHoursStart: settings.quietHoursStart,
    quietHoursEnd: settings.quietHoursEnd,
  };
}

export function isWithinQuietHours(
  now: Date,
  timezone: string,
  quietHoursStart: number,
  quietHoursEnd: number
): boolean {
  let localMinutes: number;
  
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
    localMinutes = hour * 60 + minute;
  } catch {
    const hour = now.getHours();
    const minute = now.getMinutes();
    localMinutes = hour * 60 + minute;
    console.warn(`Invalid timezone ${timezone}, using system time`);
  }

  if (quietHoursStart > quietHoursEnd) {
    return localMinutes >= quietHoursStart || localMinutes < quietHoursEnd;
  } else if (quietHoursStart < quietHoursEnd) {
    return localMinutes >= quietHoursStart && localMinutes < quietHoursEnd;
  }
  
  return false;
}

export function minutesToTimeString(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

export function timeStringToMinutes(timeStr: string): number {
  const [hours, mins] = timeStr.split(':').map(Number);
  return hours * 60 + mins;
}
