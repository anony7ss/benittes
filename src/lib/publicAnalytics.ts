export const PUBLIC_ANALYTICS_ACTION_EVENT = "benittes:analytics-action";

export const PUBLIC_ANALYTICS_ACTIONS = [
  "request_quote",
  "whatsapp_widget_opened",
  "contact_whatsapp",
  "contact_email",
  "contact_instagram",
  "contact_form_sent",
] as const;

export type PublicAnalyticsAction = (typeof PUBLIC_ANALYTICS_ACTIONS)[number];

export function sendPublicAnalyticsAction(action: PublicAnalyticsAction): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(PUBLIC_ANALYTICS_ACTION_EVENT, { detail: { action } }),
  );
}
