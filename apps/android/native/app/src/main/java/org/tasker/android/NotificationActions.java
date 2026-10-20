package org.tasker.android;

import android.annotation.SuppressLint;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;

/**
 * The buttons on a reminder. Snooze is native: the same reminder comes back in an hour.
 * Done and Tomorrow change the task, so they run in the page, where repeats, undo, sync
 * capture and auto sort live: the open app if there is one, otherwise a hidden page that
 * runs the change and closes, so the app never opens.
 */
public final class NotificationActions extends BroadcastReceiver {
    static final String DONE = "org.tasker.android.reminder.DONE";
    static final String TOMORROW = "org.tasker.android.reminder.TOMORROW";
    static final String SNOOZE = "org.tasker.android.reminder.SNOOZE";
    /** Broadcast receivers get about ten seconds; the hidden page must finish well within that. */
    private static final long HIDDEN_PAGE_LIMIT_MS = 9_000;

    @Override public void onReceive(Context context, Intent intent) {
        JSONObject reminder;
        try { reminder = new JSONObject(intent.getStringExtra("reminder")); }
        catch (Exception malformed) { return; }
        context.getSystemService(NotificationManager.class).cancel(reminder.optString("key").hashCode());
        String action = intent.getAction();
        if (SNOOZE.equals(action)) { Reminders.snooze(context, reminder); return; }
        if (!DONE.equals(action) && !TOMORROW.equals(action)) return;
        String payload;
        try {
            payload = new JSONObject().put("action", DONE.equals(action) ? "done" : "tomorrow")
                .put("taskId", reminder.optString("taskId")).toString();
        } catch (Exception impossible) { return; }
        if (MainActivity.runNotificationAction(payload)) return;
        PendingResult result = goAsync();
        runHidden(context.getApplicationContext(), payload, result::finish);
    }

    /** Loads the page without UI, hands it the action and closes it when it reports back (or on timeout). */
    @SuppressLint("SetJavaScriptEnabled")
    private static void runHidden(Context context, String payload, Runnable finished) {
        Handler main = new Handler(Looper.getMainLooper());
        TaskerDatabase database = new TaskerDatabase(context);
        WebView web = new WebView(context);
        AtomicBoolean closed = new AtomicBoolean();
        Runnable close = () -> {
            if (!closed.compareAndSet(false, true)) return;
            main.post(() -> {
                web.removeJavascriptInterface("TaskerNative");
                web.destroy();
                database.close();
                finished.run();
            });
        };
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.addJavascriptInterface(new Object() {
            @JavascriptInterface public String execute(String request) { return database.execute(request); }
            @JavascriptInterface public String takeNotificationAction() { return payload; }
            @JavascriptInterface public void reminders(String json) { Reminders.schedule(context, json); }
            @JavascriptInterface public void widgetSnapshot(String json) { TaskListWidget.saveSnapshot(context, json, database::image); }
            @JavascriptInterface public void openExternal(String url) {}
            @JavascriptInterface public void finished() { close.run(); }
        }, "TaskerNative");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return LocalAssets.respond(context, database, request.getUrl());
            }
        });
        web.loadUrl(LocalAssets.ORIGIN + "/index.html#notification-action");
        main.postDelayed(close, HIDDEN_PAGE_LIMIT_MS);
    }
}
