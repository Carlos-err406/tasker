package org.tasker.android;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.*;
import android.view.WindowInsets;
import android.widget.LinearLayout;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.Map;

public final class MainActivity extends Activity {
    private static final String ORIGIN = "https://app.tasker.local";
    private static final String CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; media-src 'self' https:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
    private WebView web;
    private TaskerDatabase database;
    private BackupCoordinator backups;
    private SyncHttp syncHttp;
    private AppUpdates updates;
    private ValueCallback<Uri[]> fileCallback;
    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        database = new TaskerDatabase(this);
        backups = new BackupCoordinator(this, database);
        syncHttp = new SyncHttp(backups.google);
        updates = new AppUpdates(this);
        getWindow().setDecorFitsSystemWindows(false);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return insets;
        });
        web = new WebView(this);
        root.addView(web, new LinearLayout.LayoutParams(-1, -1));
        setContentView(root);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        web.addJavascriptInterface(new NativeBridge(), "TaskerNative");
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("image/*").addCategory(Intent.CATEGORY_OPENABLE);
                try { startActivityForResult(intent, 1); }
                catch (android.content.ActivityNotFoundException error) { fileCallback.onReceiveValue(null); fileCallback = null; }
                return true;
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Never load a navigated document into the privileged WebView, even on its own origin.
                if (request.isForMainFrame() && request.hasGesture()) openExternal(request.getUrl().toString());
                return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!"https".equals(uri.getScheme()) || !"app.tasker.local".equals(uri.getHost()) || uri.getPort() != -1) return null;
                return localResponse(uri.getPath());
            }
        });
        web.loadUrl(ORIGIN + "/index.html");
    }
    private WebResourceResponse localResponse(String path) {
        try {
            if (path == null || path.contains("..") || path.contains("\\")) return missing();
            if (path.matches("/attachments/[a-f0-9-]{36}")) {
                TaskerDatabase.Image image = database.image(path.substring("/attachments/".length()));
                if (image == null) return missing();
                return response(image.mime(), new ByteArrayInputStream(image.bytes()));
            }
            String asset = path.equals("/") ? "index.html" : path.substring(1);
            if (!asset.equals("index.html") && !asset.matches("assets/[A-Za-z0-9_.-]+")) return missing();
            String mime = asset.endsWith(".html") ? "text/html" : asset.endsWith(".js") ? "text/javascript" : asset.endsWith(".css") ? "text/css" : asset.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream";
            return response(mime, getAssets().open(asset));
        } catch (Exception error) { return missing(); }
    }
    private WebResourceResponse response(String mime, InputStream content) {
        return new WebResourceResponse(mime, "UTF-8", 200, "OK", Map.of("Content-Security-Policy", CSP, "X-Content-Type-Options", "nosniff", "Cache-Control", "no-store"), content);
    }
    private WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Map.of(), new ByteArrayInputStream(new byte[0]));
    }
    private void openExternal(String url) {
        Uri uri = Uri.parse(url);
        if (!"https".equals(uri.getScheme()) && !"http".equals(uri.getScheme())) return;
        if ("app.tasker.local".equals(uri.getHost())) return;
        runOnUiThread(() -> {
            try { startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE)); }
            catch (android.content.ActivityNotFoundException ignored) { /* No browser installed. */ }
        });
    }
    public final class NativeBridge {
        @JavascriptInterface public void updates(String id, String action) {
            updates.request(id, action, (requestId, response) -> runOnUiThread(() -> {
                if (!isDestroyed()) web.evaluateJavascript("window.taskerUpdateResult?.(" + org.json.JSONObject.quote(requestId) + "," + org.json.JSONObject.quote(response) + ")", null);
            }));
        }
        @JavascriptInterface public String execute(String request) { return database.execute(request); }
        @JavascriptInterface public void openExternal(String url) { MainActivity.this.openExternal(url); }
        @JavascriptInterface public void syncCancel() { syncHttp.cancel(); }
        @JavascriptInterface public void sync(String id, String request) {
            syncHttp.request(id, request, (requestId, response) -> runOnUiThread(() -> {
                if (!isDestroyed()) web.evaluateJavascript("window.taskerSyncResult?.(" + org.json.JSONObject.quote(requestId) + "," + org.json.JSONObject.quote(response) + ")", null);
            }));
        }
        @JavascriptInterface public void backups(String id, String request) {
            backups.request(id, request, (requestId, response) -> runOnUiThread(() -> {
                if (isDestroyed()) return;
                web.evaluateJavascript("window.taskerBackupResult?.(" + org.json.JSONObject.quote(requestId) + "," + org.json.JSONObject.quote(response) + ")", null);
            }));
        }
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == GoogleAuthorization.REQUEST) backups.google.onResult(data, result == RESULT_OK);
        if (request == 1 && fileCallback != null) {
            fileCallback.onReceiveValue(result == RESULT_OK && data != null && data.getData() != null ? new Uri[]{data.getData()} : null);
            fileCallback = null;
        }
    }
    @Override public void onBackPressed() {
        web.evaluateJavascript("(() => { const el = document.activeElement; if (el?.matches('input,textarea,[contenteditable=true]') || document.querySelector('[role=dialog],[role=menu]')) { el?.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); el?.blur(); return true; } return window.taskerBack?.() ?? false; })()", handled -> {
            if (!"true".equals(handled)) moveTaskToBack(true);
        });
    }
    @Override protected void onDestroy() {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        syncHttp.close();
        updates.close();
        web.removeJavascriptInterface("TaskerNative"); web.destroy(); backups.close();
        super.onDestroy();
    }
    @Override protected void onResume() { super.onResume(); if (backups != null) backups.foreground(true); }
    @Override protected void onPause() { if (backups != null) backups.foreground(false); super.onPause(); }
}
