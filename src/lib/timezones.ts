import { getCalendars } from 'expo-localization';

// Curated IANA timezones. We ship a list instead of Intl.supportedValuesOf
// because the Hermes JS engine doesn't reliably provide it. The database
// validates every value, so a name here must be a real IANA zone.
export const TIMEZONES = [
  'UTC',
  // Europe
  'Europe/London', 'Europe/Dublin', 'Europe/Lisbon', 'Europe/Paris', 'Europe/Brussels',
  'Europe/Amsterdam', 'Europe/Luxembourg', 'Europe/Zurich', 'Europe/Berlin', 'Europe/Madrid',
  'Europe/Rome', 'Europe/Vienna', 'Europe/Stockholm', 'Europe/Oslo', 'Europe/Copenhagen',
  'Europe/Warsaw', 'Europe/Prague', 'Europe/Athens', 'Europe/Bucharest', 'Europe/Helsinki',
  'Europe/Istanbul', 'Europe/Kyiv', 'Europe/Moscow',
  // Africa
  'Africa/Casablanca', 'Africa/Algiers', 'Africa/Tunis', 'Africa/Tripoli', 'Africa/Cairo',
  'Africa/Khartoum', 'Africa/Dakar', 'Africa/Abidjan', 'Africa/Lagos', 'Africa/Nouakchott',
  'Africa/Nairobi', 'Africa/Johannesburg',
  // Middle East
  'Asia/Beirut', 'Asia/Damascus', 'Asia/Amman', 'Asia/Jerusalem', 'Asia/Baghdad',
  'Asia/Riyadh', 'Asia/Kuwait', 'Asia/Qatar', 'Asia/Bahrain', 'Asia/Dubai', 'Asia/Muscat',
  'Asia/Tehran',
  // Asia & Oceania
  'Asia/Karachi', 'Asia/Kolkata', 'Asia/Dhaka', 'Asia/Bangkok', 'Asia/Jakarta',
  'Asia/Singapore', 'Asia/Kuala_Lumpur', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Seoul',
  'Asia/Tokyo', 'Australia/Perth', 'Australia/Sydney', 'Pacific/Auckland',
  // Americas
  'America/St_Johns', 'America/Halifax', 'America/Toronto', 'America/New_York',
  'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles',
  'America/Anchorage', 'Pacific/Honolulu', 'America/Mexico_City', 'America/Bogota',
  'America/Lima', 'America/Santiago', 'America/Sao_Paulo', 'America/Argentina/Buenos_Aires',
];

/** The phone's current IANA timezone, e.g. "Europe/Paris". */
export function getDeviceTimezone(): string {
  return getCalendars()[0]?.timeZone ?? 'UTC';
}

/** "America/Argentina/Buenos_Aires" → "Buenos Aires (America)" */
export function formatTimezone(tz: string): string {
  const parts = tz.split('/');
  if (parts.length === 1) return tz;
  return `${parts[parts.length - 1].replace(/_/g, ' ')} (${parts[0]})`;
}
