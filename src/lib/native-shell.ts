import { Capacitor } from "@capacitor/core";

/** True only inside the Capacitor Android shell, never in a normal browser. */
export function isNativeApp(): boolean {
  if (typeof navigator !== "undefined" && /AASOAndroid/i.test(navigator.userAgent)) return true;
  return Capacitor.isNativePlatform();
}

/**
 * Native-only chrome. The website skips this entirely.
 * The Android shell loads https://app.aaso.tech, so this runs after that site is deployed.
 */
export async function startNativeShell(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  const [{ App }, { StatusBar, Style }, { Keyboard, KeyboardResize }] = await Promise.all([
    import("@capacitor/app"),
    import("@capacitor/status-bar"),
    import("@capacitor/keyboard"),
  ]);

  document.documentElement.classList.add("native-app");

  const paintStatusBar = () => {
    const dark = document.documentElement.classList.contains("dark");
    void StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
    void StatusBar.setBackgroundColor({ color: dark ? "#0d1117" : "#F8F9FA" });
  };

  await StatusBar.setOverlaysWebView({ overlay: false });
  paintStatusBar();

  const themeObserver = new MutationObserver(paintStatusBar);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

  await Keyboard.setResizeMode({ mode: KeyboardResize.Body });

  await App.addListener("backButton", ({ canGoBack }) => {
    if (canGoBack) {
      window.history.back();
      return;
    }
    void App.exitApp();
  });
}
