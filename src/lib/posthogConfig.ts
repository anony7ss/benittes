const POSTHOG_ENDPOINTS = {
  "https://us.i.posthog.com": {
    apiHost: "https://us.i.posthog.com",
    assetsHost: "https://us-assets.i.posthog.com",
  },
  "https://eu.i.posthog.com": {
    apiHost: "https://eu.i.posthog.com",
    assetsHost: "https://eu-assets.i.posthog.com",
  },
} as const;

export type PostHogEndpoints = (typeof POSTHOG_ENDPOINTS)[keyof typeof POSTHOG_ENDPOINTS];

export function resolvePostHogEndpoints(host: string | undefined): PostHogEndpoints | null {
  const normalizedHost = host?.trim();
  if (!normalizedHost) return POSTHOG_ENDPOINTS["https://us.i.posthog.com"];
  return POSTHOG_ENDPOINTS[normalizedHost as keyof typeof POSTHOG_ENDPOINTS] ?? null;
}
