package tech.aaso.app;

import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    if (getBridge() == null) return;

    WebView webView = getBridge().getWebView();
    WebSettings settings = webView.getSettings();
    // Honor the site viewport so a 1080px-wide phone uses the mobile layout.
    settings.setUseWideViewPort(true);
    settings.setLoadWithOverviewMode(false);
    webView.setInitialScale(0);
  }
}
