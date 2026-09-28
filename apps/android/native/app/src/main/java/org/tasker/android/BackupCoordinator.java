package org.tasker.android;

import android.app.Activity;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.File;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

final class BackupCoordinator {
    interface Reply { void accept(String requestId, String json); }
    private final TaskerDatabase database;
    private final Activity activity;
    private final SharedPreferences prefs;
    final GoogleAuthorization google;
    private final DriveBackups drive;
    private final ExecutorService operations = Executors.newSingleThreadExecutor();
    private final ExecutorService uploads = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();
    private final AtomicBoolean uploading = new AtomicBoolean();
    private volatile CompletableFuture<Void> activeUpload = CompletableFuture.completedFuture(null);
    private volatile boolean closed, foreground = true;
    private volatile int generation;
    private volatile String localError, cloudError;
    private volatile long retryAt;
    private int failures;
    BackupCoordinator(Activity activity, TaskerDatabase database) {
        this.activity = activity; this.database = database;
        prefs = activity.getSharedPreferences("backup-connection", 0);
        String device = prefs.getString("deviceId", null);
        if (device == null) { device = UUID.randomUUID().toString(); prefs.edit().putString("deviceId", device).apply(); }
        google = new GoogleAuthorization(activity); drive = new DriveBackups(google, device);
        scheduler.scheduleWithFixedDelay(() -> { if (!closed && foreground) operations.execute(this::tick); }, 1, 60, TimeUnit.SECONDS);
    }
    void foreground(boolean value) { foreground = value; }
    void request(String id, String payload, Reply reply) {
        if (closed) return;
        operations.execute(() -> {
            JSONObject response = new JSONObject();
            try { response.put("result", manage(new JSONObject(payload))); }
            catch (Exception error) { try { response.put("error", message(error)); } catch (Exception ignored) {} }
            if (!closed) reply.accept(id, response.toString());
        });
    }
    private Object manage(JSONObject request) throws Exception {
        switch (request.getString("action")) {
            case "status": return new JSONObject().put("local", new JSONArray(database.backups(BackupStore::list)))
                .put("configured", true).put("connected", google.connected()).put("pending", false)
                .put("lastCloud", google.connected() ? prefs.getString("lastCloud", null) : JSONObject.NULL)
                .put("localError", localError == null ? JSONObject.NULL : localError).put("cloudError", cloudError == null ? JSONObject.NULL : cloudError).put("uploading", uploading.get());
            case "backup": {
                JSONObject backup = database.backups(store -> store.create("manual")); localError = null; upload(); return backup;
            }
            case "safety-backup": return database.backups(store -> store.create("safety"));
            case "connect": google.token(true); cloudError = null; retryAt = 0; upload(); return true;
            case "disconnect": generation++; drive.cancel(); google.disconnect(); cloudError = null; return true;
            case "upload":
                if (!google.connected()) throw new IllegalStateException("Connect Google Drive first");
                retryAt = 0; upload().get();
                return manage(new JSONObject().put("action", "status"));
            case "cloud-list": return new JSONArray(drive.list());
            case "restore": {
                if (!request.optBoolean("confirm")) throw new IllegalStateException("Confirm restore before replacing tasks");
                String id = request.getString("id");
                if (request.optBoolean("cloud")) {
                    File download = File.createTempFile("tasker-download-", ".sqlite", activity.getCacheDir());
                    try {
                        JSONObject manifest = drive.download(id, download);
                        database.backups(store -> { store.importSnapshot(manifest, download); return null; });
                        id = manifest.getString("id");
                    } finally { if (!download.delete() && download.exists()) download.deleteOnExit(); }
                }
                String backupId = id;
                Object result = database.backups(store -> store.restore(backupId, true)); upload(); return result;
            }
            default: throw new IllegalArgumentException("Unknown backup operation");
        }
    }
    private void tick() {
        if (closed) return;
        try { database.backups(store -> { if (store.due()) store.create("automatic"); return null; }); localError = null; }
        catch (Exception error) { localError = message(error); }
        if (System.currentTimeMillis() >= retryAt) upload();
    }
    private synchronized CompletableFuture<Void> upload() {
        if (closed || !google.connected() || !uploading.compareAndSet(false, true)) return activeUpload;
        CompletableFuture<Void> completion = new CompletableFuture<>();
        activeUpload = completion;
        int current = generation;
        try { uploads.execute(() -> {
            try {
                for (JSONObject manifest : database.backups(BackupStore::list)) {
                    if (closed || current != generation) return;
                    File file = database.backups(store -> { File snapshot = store.file(manifest.getString("id")); store.validate(manifest, snapshot); return snapshot; });
                    drive.upload(manifest, file);
                    if (closed || current != generation) return;
                }
                if (closed || current != generation) return;
                drive.prune();
                if (closed || current != generation) return;
                prefs.edit().putString("lastCloud", Instant.now().toString()).apply();
                cloudError = null; failures = 0; retryAt = System.currentTimeMillis() + 3600000;
            } catch (Exception error) {
                if (!closed && current == generation) { cloudError = message(error); retryAt = System.currentTimeMillis() + Math.min(3600000L, 60000L << Math.min(failures++, 6)); }
            } finally { uploading.set(false); completion.complete(null); }
        }); } catch (RejectedExecutionException error) {
            uploading.set(false); completion.completeExceptionally(error);
        }
        return completion;
    }
    private static String message(Exception error) { return error.getMessage() == null ? "Backup operation failed. Try again." : error.getMessage(); }
    void close() {
        closed = true; generation++; google.close(); drive.cancel(); scheduler.shutdownNow(); uploads.shutdownNow();
        activeUpload.completeExceptionally(new CancellationException("App closed"));
        // Close SQLite only after any in-flight local transaction completes.
        operations.execute(database::close); operations.shutdown();
    }
}
