package com.shatteredcrown.rpg;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.Settings;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import androidx.core.content.FileProvider;
import androidx.core.content.pm.PackageInfoCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
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

                @JavascriptInterface
                public boolean isOnline() {
                    try {
                        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
                        if (cm == null) return false;
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                            Network net = cm.getActiveNetwork();
                            if (net == null) return false;
                            NetworkCapabilities caps = cm.getNetworkCapabilities(net);
                            return caps != null && (
                                caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                                    || caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)
                                    || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
                            );
                        }
                        NetworkInfo ni = cm.getActiveNetworkInfo();
                        return ni != null && ni.isConnected();
                    } catch (Exception ignored) {
                        return false;
                    }
                }

                @JavascriptInterface
                public String getAppVersion() {
                    JSONObject obj = new JSONObject();
                    try {
                        PackageInfo pInfo = getPackageManager().getPackageInfo(getPackageName(), 0);
                        obj.put("versionName", pInfo.versionName != null ? pInfo.versionName : "1.0.0");
                        obj.put("versionCode", PackageInfoCompat.getLongVersionCode(pInfo));
                    } catch (Exception ignored) {}
                    return obj.toString();
                }

                @JavascriptInterface
                public void restartApp() {
                    runOnUiThread(() -> {
                        try {
                            Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
                            if (launch != null) {
                                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
                                startActivity(launch);
                            }
                            finishAffinity();
                        } catch (Exception ignored) {}
                    });
                }

                @JavascriptInterface
                public void downloadAndInstallUpdate(String apkUrl) {
                    if (apkUrl == null || apkUrl.trim().isEmpty()) return;
                    new Thread(() -> {
                        try {
                            emitUpdateJs("downloading", 0, "Connecting to GitHub release...");
                            File dir = new File(getCacheDir(), "updates");
                            if (!dir.exists()) dir.mkdirs();
                            File outFile = new File(dir, "Chronicles-of-the-Shattered-Crown.apk");
                            if (outFile.exists()) outFile.delete();

                            HttpURLConnection conn = null;
                            String currentUrl = apkUrl.trim();
                            for (int hop = 0; hop < 6; hop++) {
                                URL url = new URL(currentUrl);
                                conn = (HttpURLConnection) url.openConnection();
                                conn.setInstanceFollowRedirects(false);
                                conn.setConnectTimeout(15000);
                                conn.setReadTimeout(30000);
                                conn.setRequestProperty("User-Agent", "ShatteredCrown-Updater");
                                int code = conn.getResponseCode();
                                if (code == HttpURLConnection.HTTP_MOVED_PERM
                                    || code == HttpURLConnection.HTTP_MOVED_TEMP
                                    || code == HttpURLConnection.HTTP_SEE_OTHER
                                    || code == 307
                                    || code == 308) {
                                    String loc = conn.getHeaderField("Location");
                                    conn.disconnect();
                                    if (loc == null || loc.isEmpty()) break;
                                    currentUrl = new URL(url, loc).toString();
                                    conn = null;
                                    continue;
                                }
                                break;
                            }
                            if (conn == null || conn.getResponseCode() < 200 || conn.getResponseCode() >= 300) {
                                int code = conn != null ? conn.getResponseCode() : 0;
                                if (conn != null) conn.disconnect();
                                emitUpdateJs("error", 0, "Download failed (HTTP " + code + "). Check Internet connection.");
                                return;
                            }

                            long total = conn.getContentLengthLong();
                            long downloaded = 0L;
                            int lastPct = -1;
                            try (InputStream in = conn.getInputStream(); FileOutputStream fos = new FileOutputStream(outFile)) {
                                byte[] buf = new byte[16384];
                                int n;
                                while ((n = in.read(buf)) != -1) {
                                    fos.write(buf, 0, n);
                                    downloaded += n;
                                    if (total > 0) {
                                        int pct = (int) Math.min(100, (downloaded * 100L) / total);
                                        if (pct != lastPct && (pct % 2 == 0 || pct == 100)) {
                                            lastPct = pct;
                                            String mb = String.format(java.util.Locale.ROOT, "%.1f / %.1f MB", downloaded / 1048576.0, total / 1048576.0);
                                            emitUpdateJs("downloading", pct, "Downloading update (" + mb + ")...");
                                        }
                                    }
                                }
                            } finally {
                                conn.disconnect();
                            }

                            if (!outFile.exists() || outFile.length() < 500000L) {
                                emitUpdateJs("error", 0, "Downloaded APK appears incomplete. Try again.");
                                return;
                            }

                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getPackageManager().canRequestPackageInstalls()) {
                                emitUpdateJs("need_permission", 100, "Allow 'Install unknown apps' in Android settings, then tap Download & Update again.");
                                runOnUiThread(() -> {
                                    try {
                                        Intent permIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()));
                                        permIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                        startActivity(permIntent);
                                    } catch (Exception ignored) {}
                                });
                                return;
                            }

                            Uri apkUri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".fileprovider", outFile);
                            Intent installIntent = new Intent(Intent.ACTION_VIEW);
                            installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
                            installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                            emitUpdateJs("ready_install", 100, "Installer opened! Tap Update, then tap Open / Restart Game.");
                            runOnUiThread(() -> startActivity(installIntent));
                        } catch (Exception e) {
                            emitUpdateJs("error", 0, e.getMessage() != null ? e.getMessage() : "Update download failed.");
                        }
                    }, "ShatteredCrown-ApkUpdater").start();
                }
            }, "AndroidApp");
        }
        enableImmersiveFullscreen();
    }

    private void emitUpdateJs(String state, int pct, String message) {
        try {
            JSONObject obj = new JSONObject();
            obj.put("state", state);
            obj.put("pct", pct);
            obj.put("message", message);
            final String js = "window.__onApkUpdateEvent && window.__onApkUpdateEvent(" + obj.toString() + ");";
            runOnUiThread(() -> {
                if (this.bridge != null && this.bridge.getWebView() != null) {
                    this.bridge.getWebView().evaluateJavascript(js, null);
                }
            });
        } catch (Exception ignored) {}
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
