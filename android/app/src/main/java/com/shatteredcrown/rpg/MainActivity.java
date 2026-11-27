package com.shatteredcrown.rpg;

import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private LocalPvpServer localPvpServer;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        localPvpServer = new LocalPvpServer(this);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        if (this.bridge != null && this.bridge.getWebView() != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                this.bridge.getWebView().getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            }
            this.bridge.getWebView().addJavascriptInterface(new Object() {
                @JavascriptInterface
                public void exitApp() {
                    runOnUiThread(() -> {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                            finishAndRemoveTask();
                        } else {
                            finishAffinity();
                        }
                    });
                }

                @JavascriptInterface
                public String startLanServer() {
                    JSONObject res = new JSONObject();
                    try {
                        localPvpServer.start(LocalPvpServer.DEFAULT_PORT);
                        String ip = LocalPvpServer.getLocalLanIp();
                        res.put("ok", true);
                        res.put("ip", ip);
                        res.put("port", localPvpServer.getPort());
                        res.put("url", "ws://" + ip + ":" + localPvpServer.getPort() + "/ws");
                        res.put("selfUrl", "ws://127.0.0.1:" + localPvpServer.getPort() + "/ws");
                        res.put("httpUrl", "http://" + ip + ":" + localPvpServer.getPort());
                    } catch (Exception e) {
                        try {
                            res.put("ok", false);
                            res.put("error", e.getMessage() != null ? e.getMessage() : "Could not bind port 8080");
                        } catch (Exception ignored) {}
                    }
                    return res.toString();
                }

                @JavascriptInterface
                public String stopLanServer() {
                    if (localPvpServer != null) localPvpServer.stop();
                    return "{\"ok\":true}";
                }

                @JavascriptInterface
                public String getLanStatus() {
                    JSONObject res = new JSONObject();
                    try {
                        boolean up = localPvpServer != null && localPvpServer.isRunning();
                        String ip = LocalPvpServer.getLocalLanIp();
                        res.put("running", up);
                        res.put("ip", ip);
                        res.put("port", localPvpServer != null ? localPvpServer.getPort() : LocalPvpServer.DEFAULT_PORT);
                        res.put("url", "ws://" + ip + ":" + LocalPvpServer.DEFAULT_PORT + "/ws");
                        res.put("httpUrl", "http://" + ip + ":" + LocalPvpServer.DEFAULT_PORT);
                    } catch (Exception ignored) {}
                    return res.toString();
                }

                @JavascriptInterface
                public String getLanIp() {
                    return LocalPvpServer.getLocalLanIp();
                }

                @JavascriptInterface
                public String discoverLanHosts() {
                    return LocalPvpServer.discoverLanHosts(850).toString();
                }
            }, "AndroidApp");
        }
        enableImmersiveFullscreen();
    }

    @Override
    public void onDestroy() {
        if (localPvpServer != null) {
            localPvpServer.stop();
        }
        super.onDestroy();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            enableImmersiveFullscreen();
        }
    }

    private void enableImmersiveFullscreen() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller =
            WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (controller != null) {
            controller.hide(WindowInsetsCompat.Type.systemBars());
            controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            );
        }
    }
}
