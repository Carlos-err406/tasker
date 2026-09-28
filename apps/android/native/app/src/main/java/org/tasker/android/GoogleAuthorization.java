package org.tasker.android;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import com.google.android.gms.auth.api.identity.*;
import com.google.android.gms.common.api.Scope;
import com.google.android.gms.tasks.Tasks;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

/** Google Play services owns account grants. Tokens never enter the WebView or snapshots. */
final class GoogleAuthorization {
    static final int REQUEST = 20;
    private final Activity activity;
    private final SharedPreferences prefs;
    private volatile CompletableFuture<AuthorizationResult> resolution;
    private volatile String lastToken;
    private volatile int generation;
    GoogleAuthorization(Activity activity) { this.activity = activity; prefs = activity.getSharedPreferences("backup-connection", 0); }
    boolean connected() { return prefs.getBoolean("connected", false); }
    String token(boolean interactive) throws Exception {
        int current = generation;
        if (!interactive && !connected()) throw new IllegalStateException("Connect Google Drive first");
        try {
            AuthorizationResult result = Tasks.await(Identity.getAuthorizationClient(activity).authorize(
                AuthorizationRequest.builder().setRequestedScopes(List.of(new Scope("https://www.googleapis.com/auth/drive.file"))).build()), 60, TimeUnit.SECONDS);
            if (result.hasResolution()) {
                if (!interactive) throw new IllegalStateException("Reconnect Google Drive to continue backing up");
                CompletableFuture<AuthorizationResult> pending = new CompletableFuture<>(); resolution = pending;
                var intent = result.getPendingIntent();
                activity.runOnUiThread(() -> {
                    try { activity.startIntentSenderForResult(intent.getIntentSender(), REQUEST, null, 0, 0, 0); }
                    catch (Exception error) { pending.completeExceptionally(error); }
                });
                try { result = pending.get(180, TimeUnit.SECONDS); }
                finally { resolution = null; }
            }
            if (result.getAccessToken() == null) throw new IllegalStateException("Google did not grant Drive access");
            synchronized (this) {
                if (current != generation) throw new IllegalStateException("Google Drive disconnected");
                lastToken = result.getAccessToken();
                if (interactive) prefs.edit().putBoolean("connected", true).apply();
            }
            return lastToken;
        } catch (Exception error) {
            if (error instanceof IllegalStateException) throw error;
            Throwable cause = error.getCause() == null ? error : error.getCause();
            if (cause instanceof com.google.android.gms.common.api.ApiException && ((com.google.android.gms.common.api.ApiException)cause).getStatusCode() == 10)
                throw new IllegalStateException("Google setup is incomplete for this Android build. Register its package and signing certificate in the Tasker Google project.");
            throw new IllegalStateException("Google connection was cancelled or could not complete. Try connecting again.");
        }
    }
    void onResult(Intent data, boolean accepted) {
        var pending = resolution; if (pending == null) return;
        try {
            if (!accepted || data == null) throw new IllegalStateException("Google connection cancelled");
            pending.complete(Identity.getAuthorizationClient(activity).getAuthorizationResultFromIntent(data));
        } catch (Exception error) { pending.completeExceptionally(error); }
    }
    void invalidToken() {
        if (lastToken != null) Identity.getAuthorizationClient(activity).clearToken(ClearTokenRequest.builder().setToken(lastToken).build());
        lastToken = null;
    }
    synchronized void disconnect() { generation++; prefs.edit().putBoolean("connected", false).remove("lastCloud").apply(); invalidToken(); }
    void close() { if (resolution != null) resolution.completeExceptionally(new IllegalStateException("App closed")); }
}
