package org.tasker.android;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.Insets;
import android.graphics.drawable.Icon;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.*;
import android.view.WindowInsets;
import android.view.inputmethod.InputMethodManager;
import android.widget.LinearLayout;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

public final class MainActivity extends Activity {
    /** The running activity, so reminder buttons can act in its page instead of a hidden one. */
    private static volatile java.lang.ref.WeakReference<MainActivity> live = new java.lang.ref.WeakReference<>(null);
    private WebView web;
    private TaskerDatabase database;
    private BackupCoordinator backups;
    private SyncHttp syncHttp;
    private AppUpdates updates;
    private ValueCallback<Uri[]> fileCallback;
    // Long-press launcher shortcuts and widget taps; the page takes the pending one when it's ready.
    private static final String SHORTCUT_ACTION = "org.tasker.android.SHORTCUT";
    private static final List<String> SHORTCUTS = List.of("new-task", "search", "open-task", "open-list");
    private final AtomicReference<String> pendingShortcut = new AtomicReference<>();
    private static final int NOTIFICATIONS = 2;
    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        live = new java.lang.ref.WeakReference<>(this);
        database = new TaskerDatabase(this);
        backups = new BackupCoordinator(this, database);
        syncHttp = new SyncHttp(backups.google);
        updates = new AppUpdates(this);
        publishShortcuts();
        pendingShortcut.set(shortcutOf(getIntent()));
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
                return LocalAssets.respond(MainActivity.this, database, request.getUrl());
            }
        });
        web.loadUrl(LocalAssets.ORIGIN + "/index.html");
    }
    private boolean notificationsAllowed() {
        return getSystemService(android.app.NotificationManager.class).areNotificationsEnabled();
    }
    private void publishShortcuts() {
        ShortcutManager manager = getSystemService(ShortcutManager.class);
        if (manager == null) return;
        manager.setDynamicShortcuts(List.of(
            shortcut("new-task", "New task", R.drawable.ic_shortcut_add),
            shortcut("search", "Search", R.drawable.ic_shortcut_search)));
    }
    private ShortcutInfo shortcut(String id, String label, int icon) {
        // Published at runtime rather than in XML: XML shortcuts clear the task, which would reload the page and drop an open draft.
        return new ShortcutInfo.Builder(this, id).setShortLabel(label).setIcon(Icon.createWithResource(this, icon)).setIntent(shortcutIntent(this, id, null, null)).build();
    }
    /** Opens the app to run a shortcut; `list` ("" for All lists) and `task` are optional. */
    static Intent shortcutIntent(android.content.Context context, String action, String list, String task) {
        Intent intent = new Intent(context, MainActivity.class).setAction(SHORTCUT_ACTION).putExtra("shortcut", action);
        if (list != null) intent.putExtra("list", list);
        if (task != null) intent.putExtra("task", task);
        return intent;
    }
    private static String shortcutOf(Intent intent) {
        if (intent == null || !SHORTCUT_ACTION.equals(intent.getAction())) return null;
        String action = intent.getStringExtra("shortcut");
        if (!SHORTCUTS.contains(action)) return null;
        try {
            org.json.JSONObject payload = new org.json.JSONObject().put("action", action);
            if (intent.hasExtra("list")) payload.put("list", intent.getStringExtra("list"));
            if (intent.hasExtra("task")) payload.put("task", intent.getStringExtra("task"));
            return payload.toString();
        } catch (org.json.JSONException error) { return null; }
    }
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        String shortcut = shortcutOf(intent);
        if (shortcut == null) return;
        pendingShortcut.set(shortcut);
        web.requestFocus();
        web.evaluateJavascript("window.taskerShortcut?.()", null);
    }
    /** Runs a reminder button's action in the open app's page; false when no page is open. */
    static boolean runNotificationAction(String payload) {
        MainActivity activity = live.get();
        if (activity == null || activity.isDestroyed()) return false;
        activity.runOnUiThread(() -> {
            if (!activity.isDestroyed()) activity.web.evaluateJavascript("window.taskerNotificationAction?.(" + org.json.JSONObject.quote(payload) + ")", null);
        });
        return true;
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
        @JavascriptInterface public String takeShortcut() { return pendingShortcut.getAndSet(null); }
        @JavascriptInterface public void reminders(String json) {
            Reminders.schedule(MainActivity.this, json);
            // Ask once, the first time there's something to remind; the Settings switch asks again.
            SharedPreferences prefs = getSharedPreferences("reminders", MODE_PRIVATE);
            if (!prefs.getBoolean("asked", false) && Reminders.hasReminders(MainActivity.this) && !notificationsAllowed()) {
                prefs.edit().putBoolean("asked", true).apply();
                runOnUiThread(() -> requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATIONS));
            }
        }
        @JavascriptInterface public void requestNotifications() {
            if (notificationsAllowed()) return;
            runOnUiThread(() -> {
                if (isDestroyed()) return;
                // After a denial Android stops showing the prompt, so open the app's notification settings instead.
                if (getSharedPreferences("reminders", MODE_PRIVATE).getBoolean("asked", false) && !shouldShowRequestPermissionRationale(android.Manifest.permission.POST_NOTIFICATIONS))
                    startActivity(new Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, getPackageName()));
                else {
                    getSharedPreferences("reminders", MODE_PRIVATE).edit().putBoolean("asked", true).apply();
                    requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS}, NOTIFICATIONS);
                }
            });
        }
        @JavascriptInterface public void widgetSnapshot(String json) { TaskListWidget.saveSnapshot(MainActivity.this, json, database::image); }
        // Focus set without a tap (a shortcut on a cold start) doesn't raise the keyboard by itself.
        @JavascriptInterface public void showKeyboard() {
            runOnUiThread(() -> {
                if (isDestroyed()) return;
                web.requestFocus();
                getSystemService(InputMethodManager.class).showSoftInput(web, 0);
            });
        }
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
        if (live.get() == this) live = new java.lang.ref.WeakReference<>(null);
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        syncHttp.close();
        updates.close();
        web.removeJavascriptInterface("TaskerNative"); web.destroy(); backups.close();
        super.onDestroy();
    }
    @Override protected void onResume() { super.onResume(); if (backups != null) backups.foreground(true); }
    @Override protected void onPause() {
        if (backups != null) backups.foreground(false);
        if (web != null) web.evaluateJavascript("window.taskerWidgetSnapshot?.()", null);
        super.onPause();
    }
}
