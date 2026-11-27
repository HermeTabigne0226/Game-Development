package com.shatteredcrown.rpg;

import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.content.pm.PackageInfoCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import java.io.File;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private LocalPvpServer localPvpServer;

    private static void deleteDirSafe(File dir) {
        if (dir == null || !dir.exists()) return;
        if (dir.isDirectory()) {
            File[] children = dir.listFiles();
            if (children != null) {
                for (File child : children) deleteDirSafe(child);
            }
        }
        try {
            dir.delete();
        } catch (Exception ignored) {}
    }

    private void purgeStaleWebCacheOnUpgrade(WebView webView) {
        try {
            PackageInfo pInfo = getPackageManager().getPackageInfo(getPackageName(), 0);
            long currentVer = PackageInfoCompat.getLongVersionCode(pInfo);
            SharedPreferences prefs = getSharedPreferences("sc_app_prefs", MODE_PRIVATE);
            long savedVer = prefs.getLong("installed_version_code", -1L);
            if (savedVer != currentVer) {
                deleteDirSafe(getCacheDir());
                deleteDirSafe(getCodeCacheDir());
                File dataRoot = getApplicationInfo().dataDir != null ? new File(getApplicationInfo().dataDir) : null;
                if (dataRoot != null) {
                    File webviewDir = new File(dataRoot, "app_webview");
                    deleteDirSafe(new File(webviewDir, "Service Worker"));
                    File defProfile = new File(webviewDir, "Default");
                    deleteDirSafe(new File(defProfile, "Cache"));
                    deleteDirSafe(new File(defProfile, "Code Cache"));
                    deleteDirSafe(new File(defProfile, "Service Worker"));
                }
                if (webView != null) {
                    webView.clearCache(true);
                }
                prefs.edit().putLong("installed_version_code", currentVer).apply();
            }
        } catch (Exception ignored) {}
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        localPvpServer = new LocalPvpServer(this);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            getWindow().getAttributes().layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }
        if (this.bridge != null && this.bridge.getWebView() != null) {
            WebView wv = this.bridge.getWebView();
            purgeStaleWebCacheOnUpgrade(wv);
            wv.getSettings().setCacheMode(WebSettings.LOAD_NO_CACHE);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                wv.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            }
            wv.addJavascriptInterface(new Object() {
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
