import type { CapacitorConfig } from "@capacitor/cli";

/** Live site by default, so the Android app and app.aaso.tech stay the same product. */
const serverUrl = process.env.CAPACITOR_SERVER_URL?.trim() || "https://app.aaso.tech";

const config: CapacitorConfig = {
  appId: "tech.aaso.app",
  appName: "AASO",
  webDir: "dist/public",
  server: {
    url: serverUrl,
    cleartext: serverUrl.startsWith("http://"),
    androidScheme: "https",
    allowNavigation: [
      "app.aaso.tech",
      "*.aaso.tech",
      "*.razorpay.com",
      "accounts.google.com",
      "*.google.com",
      "*.googleapis.com",
      "*.gstatic.com",
    ],
  },
  android: {
    appendUserAgent: "AASOAndroid",
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 800,
      backgroundColor: "#071633",
      showSpinner: false,
    },
    StatusBar: {
      overlaysWebView: false,
      style: "LIGHT",
      backgroundColor: "#F8F9FA",
    },
  },
};

export default config;
