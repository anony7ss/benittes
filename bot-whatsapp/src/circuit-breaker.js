/**
 * Pequeno circuit breaker em memória para APIs remotas do bot.
 * O estado é intencionalmente por processo; não deve bloquear o Supabase inteiro.
 */
export class CircuitOpenError extends Error {
  constructor(name, retryAt) {
    super(`Circuit breaker ${name} aberto; nova tentativa após ${new Date(retryAt).toISOString()}`);
    this.name = 'CircuitOpenError';
    this.code = 'CIRCUIT_OPEN';
    this.retryAt = retryAt;
  }
}

export function isTransientExternalError(error) {
  const status = Number(error?.status || error?.response?.status);
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '').toLowerCase();
  return status === 408 || status === 425 || status === 429 || status >= 500 ||
    ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT', 'ECONNABORTED'].includes(code) ||
    /\b(timeout|timed out|network|socket hang up|connection reset|fetch failed)\b/.test(message);
}

export function createCircuitBreaker({
  name,
  failureThreshold = 3,
  resetTimeoutMs = 30_000,
  now = Date.now,
  shouldCountFailure = () => true,
  onStateChange = () => {},
} = {}) {
  const safeName = String(name || 'external-api').slice(0, 80);
  const threshold = Math.max(1, Math.floor(Number(failureThreshold) || 3));
  const resetMs = Math.max(1000, Number(resetTimeoutMs) || 30_000);
  let failures = 0;
  let openedAt = null;
  let probeInFlight = false;

  function getState() {
    if (openedAt === null) return { state: 'closed', failures, retryAt: null };
    if (now() - openedAt >= resetMs) return { state: 'half-open', failures, retryAt: openedAt + resetMs };
    return { state: 'open', failures, retryAt: openedAt + resetMs };
  }

  function emit(state, previous) {
    if (state !== previous) {
      try { onStateChange({ name: safeName, state, failures, retryAt: openedAt === null ? null : openedAt + resetMs }); } catch {}
    }
  }

  async function execute(operation) {
    const state = getState();
    if (state.state === 'open') throw new CircuitOpenError(safeName, state.retryAt);
    if (state.state === 'half-open') {
      if (probeInFlight) throw new CircuitOpenError(safeName, state.retryAt);
      probeInFlight = true;
    }

    const before = openedAt === null ? 'closed' : 'half-open';
    try {
      const result = await operation();
      failures = 0;
      openedAt = null;
      emit('closed', before);
      return result;
    } catch (error) {
      let count = false;
      try { count = shouldCountFailure(error) === true; } catch {}
      if (count) {
        failures += 1;
        if (before === 'half-open' || failures >= threshold) {
          const previous = before === 'half-open' ? 'half-open' : 'closed';
          openedAt = now();
          emit('open', previous);
        }
      } else {
        // A permanent/validation failure breaks the consecutive-failure streak.
        openedAt = null;
        failures = 0;
        if (before === 'half-open') emit('closed', 'half-open');
      }
      throw error;
    } finally {
      probeInFlight = false;
    }
  }

  function reset() {
    const previous = openedAt === null ? 'closed' : getState().state;
    failures = 0;
    openedAt = null;
    probeInFlight = false;
    emit('closed', previous);
  }

  return { execute, getState, reset };
}

export default { CircuitOpenError, createCircuitBreaker, isTransientExternalError };
