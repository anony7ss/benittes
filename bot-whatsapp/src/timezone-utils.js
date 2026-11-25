export const SAO_PAULO_TIME_ZONE = 'America/Sao_Paulo';

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidYmd(value) {
  const match = typeof value === 'string' && value.match(YMD_RE);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function getYmdInTimeZone(date = new Date(), timeZone = SAO_PAULO_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function addDaysToYmd(ymd, days) {
  if (!isValidYmd(ymd) || !Number.isInteger(days)) return null;
  const [year, month, day] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

/** Weekday for a civil YYYY-MM-DD date, independent of the process timezone. */
export function getUtcWeekdayForYmd(ymd) {
  if (!isValidYmd(ymd)) return null;
  const [year, month, day] = ymd.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function normalizeProfessionalTargetDate(value, todayYmd) {
  if (!isValidYmd(todayYmd) || typeof value !== 'string' || !value.trim()) return null;
  const normalized = value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  if (normalized === 'hoje') return todayYmd;
  if (normalized === 'amanha') return addDaysToYmd(todayYmd, 1);
  if (normalized === 'depois de amanha' || normalized === 'depois_de_amanha') return addDaysToYmd(todayYmd, 2);
  if (isValidYmd(normalized)) return normalized;

  const slashDate = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (slashDate) {
    const [, day, month, year] = slashDate;
    const converted = `${year}-${month}-${day}`;
    return isValidYmd(converted) ? converted : null;
  }

  const weekdayMatch = normalized.match(/^(?:(?:nesta|nessa|na|esta|essa|proxima|proximo)\s+)?(domingo|segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado)(?:\s+que vem)?$/);
  if (!weekdayMatch) return null;

  const weekdays = { domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6 };
  const weekdayName = weekdayMatch[1].replace(/-feira$/, '');
  const targetDay = weekdays[weekdayName];
  const todayDay = getUtcWeekdayForYmd(todayYmd);
  const offset = (targetDay - todayDay + 7) % 7 || 7;
  return addDaysToYmd(todayYmd, offset);
}

export function getWeekRangeYmd(todayYmd, offsetWeeks = 0) {
  if (!isValidYmd(todayYmd) || !Number.isInteger(offsetWeeks)) return null;
  const weekday = getUtcWeekdayForYmd(todayYmd);
  const daysSinceMonday = (weekday + 6) % 7;
  const start = addDaysToYmd(todayYmd, -daysSinceMonday + offsetWeeks * 7);
  return { inicio: start, fim: addDaysToYmd(start, 6) };
}

function offsetAt(instant, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const localAsUtc = Date.UTC(
    Number(values.year), Number(values.month) - 1, Number(values.day),
    Number(values.hour), Number(values.minute), Number(values.second),
  );
  return localAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Converts a wall-clock time in an IANA zone into an absolute ISO timestamp. */
export function zonedDateTimeToIso(ymd, hour = 0, minute = 0, second = 0, timeZone = SAO_PAULO_TIME_ZONE) {
  if (!isValidYmd(ymd) || ![hour, minute, second].every(Number.isInteger)
    || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) {
    return null;
  }
  const [year, month, day] = ymd.split('-').map(Number);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let instant = new Date(wallClockAsUtc);
  // Recompute once in case the target date uses a different UTC offset.
  instant = new Date(wallClockAsUtc - offsetAt(instant, timeZone));
  instant = new Date(wallClockAsUtc - offsetAt(instant, timeZone));
  return instant.toISOString();
}
