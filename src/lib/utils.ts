import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Formats hours for display as hours and minutes.
 * Converts decimal hours to "Xh Ym" format.
 * @param hours - The number of hours (decimal) to format
 * @returns Formatted string with hours and minutes (e.g., "3h 30m")
 */
export function formatHours(hours: number): string {
  const sign = hours < 0 ? '-' : '';
  const absTotalMinutes = Math.round(Math.abs(hours) * 60);
  const h = Math.floor(absTotalMinutes / 60);
  const m = absTotalMinutes % 60;
  
  if (h === 0) {
    return `${sign}${m}m`;
  }
  if (m === 0) {
    return `${sign}${h}h`;
  }
  return `${sign}${h}h ${m}m`;
}

/**
 * Formats hours for display as hours and minutes (same as formatHours).
 * Kept for backward compatibility.
 * @param hours - The number of hours (decimal) to format
 * @returns Formatted string with hours and minutes (e.g., "3h 30m")
 */
export function formatHoursLocale(hours: number): string {
  return formatHours(hours);
}

/**
 * Formats hours as decimal for data exports and calculations.
 * @param hours - The number of hours to format
 * @returns Formatted string with 2 decimal places (e.g., "3.50")
 */
export function formatHoursDecimal(hours: number): string {
  return hours.toFixed(2);
}

/**
 * Formats hours as decimal with Italian locale (comma separator) for exports.
 * @param hours - The number of hours to format
 * @returns Formatted string with comma separator (e.g., "3,50")
 */
export function formatHoursDecimalLocale(hours: number): string {
  return hours.toFixed(2).replace('.', ',');
}

/**
 * Rounds decimal hours to the nearest 5-minute increment.
 * E.g. 0.65h (39m) → 0.6667h (40m), 0.9833h (59m) → 1h, 2.2833h (2h17m) → 2.25h (2h15m)
 */
export function roundToNearest5Minutes(hours: number): number {
  const totalMinutes = hours * 60;
  const rounded = Math.round(totalMinutes / 5) * 5;
  return rounded / 60;
}

/**
 * Formats an amount as Italian currency (EUR).
 * useGrouping è esplicito: senza, l'italiano non raggruppa le migliaia sotto i
 * diecimila e "3500,00 €" appare accanto a "12.250,00 €" nella stessa colonna.
 */
export function formatCurrency(value: number): string {
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    useGrouping: 'always',
  }).format(value);
}
