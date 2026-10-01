import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Tailwind-aware className combiner (shadcn/ui convention).
 * @param  {...any} inputs
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

/**
 * Format a number with thousands separators.
 * @param {number} n
 */
export function formatNumber(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return new Intl.NumberFormat('en-US').format(Number(n));
}

/**
 * Format a 0–1 ratio as a percentage.
 * @param {number} part
 * @param {number} whole
 */
export function formatRate(part, whole) {
  const p = Number(part) || 0;
  const w = Number(whole) || 0;
  if (!w) return '0%';
  return `${((p / w) * 100).toFixed(1)}%`;
}

/**
 * Relative-ish human timestamp.
 * @param {string|Date} value
 */
export function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
