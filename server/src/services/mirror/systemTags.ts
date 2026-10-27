/**
 * System tags written by the ServiceTitan mirror sync.
 *
 * Every tag here is owned by the sync: it is added when a customer qualifies
 * and removed when they stop qualifying, every hour. Staff can use these tags
 * in segments and campaigns but cannot edit, delete, or hand-apply them.
 *
 * Names all start with "ST " so they sort together in the tag picker.
 */

export const IN_SERVICETITAN_TAG = 'In ServiceTitan';

export const SEGMENT_TAGS: Record<string, string> = {
  '1_active_member': 'ST Segment: 1 Active Member',
  '2_lapsed_member': 'ST Segment: 2 Lapsed Member',
  '3_open_estimate': 'ST Segment: 3 Open Estimate',
  '4_recent': 'ST Segment: 4 Recent (0-12 mo)',
  '5_warm': 'ST Segment: 5 Warm (12-36 mo)',
  '6_dormant': 'ST Segment: 6 Dormant (36+ mo)',
  '7a_never_converted': 'ST Segment: 7a Never Converted (recent)',
  '7b_legacy': 'ST Segment: 7b Legacy Import (pre-2015)',
  '7c_never_serviced': 'ST Segment: 7c Never Serviced',
};

export const SMS_TIER_TAGS: Record<string, string> = {
  A: 'ST SMS: Tier A (number on file)',
  B: 'ST SMS: Tier B (call history only)',
};

export const OVERLAY_TAGS = {
  highValue: 'ST Value: High ($12k+ lifetime)',
  hvacOnly: 'ST Cross-sell: HVAC Only',
  plumbingOnly: 'ST Cross-sell: Plumbing Only',
  agingInstall: 'ST Flag: Aging HVAC Install (8+ yrs)',
  openEstimate: 'ST Flag: Open Estimate (18 mo)',
} as const;

/** ZIP tags keep the name format the original ServiceTitan import used. */
export function zipTagName(zip: string): string {
  return `ZIP-${zip}`;
}

export function isZipTagName(name: string): boolean {
  return /^ZIP-\d{5}$/.test(name);
}

export const SYSTEM_TAG_COLORS: Record<string, string> = {
  segment: '#2B6CB0',
  sms: '#2F855A',
  overlay: '#B7791F',
  zip: '#48BB78',
  servicetitan: '#4A5568',
};

export interface MirrorProfileRow {
  customer_id: string;
  first_name: string | null;
  last_name: string | null;
  customer_type: string | null;
  best_phone: string;
  sms_tier: string;
  email: string | null;
  street: string | null;
  unit: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  lifecycle_segment: string;
  completed_jobs: number;
  is_high_value: boolean;
  is_hvac_only: boolean;
  is_plumbing_only: boolean;
  has_aging_install: boolean | null;
  has_open_estimate: boolean;
}

/** Every system tag name a profile row should carry right now. */
export function desiredTagNames(row: MirrorProfileRow): string[] {
  const names = [IN_SERVICETITAN_TAG];
  const seg = SEGMENT_TAGS[row.lifecycle_segment];
  if (seg) names.push(seg);
  const tier = SMS_TIER_TAGS[row.sms_tier];
  if (tier) names.push(tier);
  if (row.is_high_value) names.push(OVERLAY_TAGS.highValue);
  if (row.is_hvac_only) names.push(OVERLAY_TAGS.hvacOnly);
  if (row.is_plumbing_only) names.push(OVERLAY_TAGS.plumbingOnly);
  if (row.has_aging_install) names.push(OVERLAY_TAGS.agingInstall);
  if (row.has_open_estimate) names.push(OVERLAY_TAGS.openEstimate);
  if (row.zip && /^\d{5}$/.test(row.zip)) names.push(zipTagName(row.zip));
  return names;
}

export function colorForTag(name: string): string {
  if (name.startsWith('ST Segment:')) return SYSTEM_TAG_COLORS.segment;
  if (name.startsWith('ST SMS:')) return SYSTEM_TAG_COLORS.sms;
  if (isZipTagName(name)) return SYSTEM_TAG_COLORS.zip;
  if (name === IN_SERVICETITAN_TAG) return SYSTEM_TAG_COLORS.servicetitan;
  return SYSTEM_TAG_COLORS.overlay;
}
