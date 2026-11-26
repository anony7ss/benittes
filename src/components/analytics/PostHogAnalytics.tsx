"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { PostHog } from "posthog-js";
import { analyticsPathFor, isReplayEligiblePath, suppressReplayForPath } from "@/lib/analyticsPaths";
import { CONSENT_EVENT, COOKIE_CONSENT_STORAGE_KEY, getCookieConsent } from "@/lib/cookies";
import { resolvePostHogEndpoints } from "@/lib/posthogConfig";
import { PUBLIC_ANALYTICS_ACTION_EVENT, PUBLIC_ANALYTICS_ACTIONS } from "@/lib/publicAnalytics";

const PROJECT_TOKEN = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim() ?? "";
const POSTHOG_ENDPOINTS = resolvePostHogEndpoints(process.env.NEXT_PUBLIC_POSTHOG_HOST);
const ALLOWED_ACTIONS = new Set<string>(PUBLIC_ANALYTICS_ACTIONS);

let posthogInstance: PostHog | null = null;
let posthogLoad: Promise<PostHog> | null = null;
let activeAnalyticsPath: string | null = null;
let replaySuppressedForCurrentDocument = false;

type AnalyticsActionDetail = { action?: string };

async function getPostHog(): Promise<PostHog> {
  if (posthogInstance) return posthogInstance;
  if (!POSTHOG_ENDPOINTS) throw new Error("Região do PostHog inválida.");
  if (!posthogLoad) {
    posthogLoad = import("posthog-js")
      .then(({ default: posthog }) => {
        posthog.init(PROJECT_TOKEN, {
          api_host: POSTHOG_ENDPOINTS.apiHost,
          autocapture: false,
          capture_pageview: false,
          capture_pageleave: false,
          opt_out_capturing_by_default: true,
          disable_session_recording: true,
          opt_in_site_apps: false,
          require_subresource_integrity: true,
          respect_dnt: true,
          session_recording: {
            maskAllInputs: true,
            maskTextSelector: "[data-ph-mask]",
            recordBody: false,
            recordHeaders: false,
            sampleRate: 0.1,
          },
          prepare_external_dependency_script: (script) => {
            const nonce = document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce;
            if (nonce) script.nonce = nonce;
            return script;
          },
        });
        posthogInstance = posthog;
        return posthog;
      })
      .catch((error: unknown) => {
        posthogLoad = null;
        throw error;
      });
  }
  return posthogLoad;
}

function emitPageView(client: PostHog, path: string) {
  const pageType = path === "/orcamento/:token" ? "customer_quote" : "public_site";
  client.capture("$pageview", {
    $current_url: `${window.location.origin}${path}`,
    $pathname: path,
    page_type: pageType,
  });
}

function emitAction(client: PostHog, action: string) {
  if (!activeAnalyticsPath || !ALLOWED_ACTIONS.has(action)) return;
  client.capture("benittes_public_action", {
    action,
    $current_url: `${window.location.origin}${activeAnalyticsPath}`,
    $pathname: activeAnalyticsPath,
  });
}

export function PostHogAnalytics() {
  const pathname = usePathname() || "/";
  const [consentRevision, setConsentRevision] = useState(0);

  useEffect(() => {
    const onConsentChange = () => setConsentRevision((revision) => revision + 1);
    const onStorageChange = (event: StorageEvent) => {
      if (event.key === COOKIE_CONSENT_STORAGE_KEY || event.key === null) onConsentChange();
    };
    window.addEventListener(CONSENT_EVENT, onConsentChange);
    window.addEventListener("storage", onStorageChange);
    return () => {
      window.removeEventListener(CONSENT_EVENT, onConsentChange);
      window.removeEventListener("storage", onStorageChange);
    };
  }, []);

  useEffect(() => {
    const analyticsPath = analyticsPathFor(pathname);
    if (
      suppressReplayForPath(pathname) ||
      window.location.search.length > 0 ||
      window.location.hash.length > 0
    ) {
      replaySuppressedForCurrentDocument = true;
    }

    const consent = getCookieConsent();
    if (!PROJECT_TOKEN || !POSTHOG_ENDPOINTS || !consent?.analytics || !analyticsPath) {
      activeAnalyticsPath = null;
      posthogInstance?.stopSessionRecording();
      posthogInstance?.opt_out_capturing();
      return;
    }

    let cancelled = false;
    const onDocumentClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const quoteLink = target.closest("[data-site-quote]");
      if (quoteLink) {
        emitAction(posthogInstance!, "request_quote");
        return;
      }

      const channelLink = target.closest<HTMLElement>("[data-site-channel]");
      const channel = channelLink?.dataset.siteChannel;
      if (channel === "whatsapp" || channel === "email" || channel === "instagram") {
        emitAction(posthogInstance!, `contact_${channel}`);
        return;
      }

      if (target.closest(".wa-fab")) emitAction(posthogInstance!, "whatsapp_widget_opened");
    };
    const onAnalyticsAction = (event: Event) => {
      const action = (event as CustomEvent<AnalyticsActionDetail>).detail?.action;
      if (typeof action === "string") emitAction(posthogInstance!, action);
    };

    void getPostHog()
      .then((client) => {
        if (cancelled) {
          client.stopSessionRecording();
          client.opt_out_capturing();
          return;
        }

        activeAnalyticsPath = analyticsPath;
        client.opt_in_capturing({ captureEventName: false });
        emitPageView(client, analyticsPath);

        const canRecord =
          !replaySuppressedForCurrentDocument &&
          isReplayEligiblePath(pathname) &&
          !window.location.search &&
          !window.location.hash;
        if (canRecord) client.startSessionRecording();
        else client.stopSessionRecording();

        document.addEventListener("click", onDocumentClick, true);
        window.addEventListener(PUBLIC_ANALYTICS_ACTION_EVENT, onAnalyticsAction);
      })
      .catch(() => {
        activeAnalyticsPath = null;
      });

    return () => {
      cancelled = true;
      activeAnalyticsPath = null;
      document.removeEventListener("click", onDocumentClick, true);
      window.removeEventListener(PUBLIC_ANALYTICS_ACTION_EVENT, onAnalyticsAction);
      posthogInstance?.stopSessionRecording();
    };
  }, [pathname, consentRevision]);

  return null;
}
