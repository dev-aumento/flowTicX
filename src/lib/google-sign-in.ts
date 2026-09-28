const GOOGLE_SCRIPT_SRC = "https://accounts.google.com/gsi/client";

type TokenResponse = {
  access_token?: string;
  error?: string;
};

type TokenClient = {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
};

type GoogleIdentity = {
  accounts: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string;
        scope: string;
        callback: (response: TokenResponse) => void;
        error_callback?: (error: { type?: string }) => void;
      }) => TokenClient;
    };
  };
};

declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

const GOOGLE_CLIENT_ID =
  "766786481765-jdl3n16kit7qovjnbnlchg5j6pf7b44v.apps.googleusercontent.com";

function googleClientId() {
  const value = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
  return value?.trim() || GOOGLE_CLIENT_ID;
}

let scriptPromise: Promise<void> | null = null;

export function preloadGoogleSignIn() {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>("script[data-google-gsi]");
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("load")), { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = GOOGLE_SCRIPT_SRC;
      script.async = true;
      script.dataset.googleGsi = "true";
      script.onload = () => resolve();
      script.onerror = () => {
        scriptPromise = null;
        reject(new Error("load"));
      };
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

type GoogleSignInHandlers = {
  onEmail: (email: string) => void;
  onCancel: () => void;
  onError: (message: string) => void;
};

/** Opens the Google account picker and returns that account's email. */
export function startGoogleSignIn({ onEmail, onCancel, onError }: GoogleSignInHandlers) {
  const clientId = googleClientId();
  if (!clientId) {
    onError("Google sign-in is not set up for this site yet.");
    return;
  }

  const google = window.google?.accounts?.oauth2;
  if (!google) {
    onError("Google sign-in is still loading. Try again in a moment.");
    return;
  }

  const client = google.initTokenClient({
    client_id: clientId,
    scope: "openid email profile",
    callback: (response) => {
      if (response.error || !response.access_token) {
        onCancel();
        return;
      }
      void readGoogleEmail(response.access_token).then(onEmail).catch(() => {
        onError("Could not read the email from that Google account.");
      });
    },
    error_callback: (error) => {
      if (error.type === "popup_closed") {
        onCancel();
        return;
      }
      if (error.type === "popup_failed_to_open") {
        onError("Allow popups for this site, then try Google sign-in again.");
        return;
      }
      onError("Google sign-in could not be completed. Try again.");
    },
  });

  client.requestAccessToken({ prompt: "select_account" });
}

async function readGoogleEmail(accessToken: string) {
  const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error("userinfo");
  }
  const profile = (await response.json()) as { email?: string };
  const email = profile.email?.trim().toLowerCase() ?? "";
  if (!email) throw new Error("email");
  return email;
}
