package org.tasker.android;

import android.util.Base64;
import java.net.HttpURLConnection;
import java.net.URI;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.Locale;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/** Bounded Drive transport. Account tokens never enter JavaScript. */
final class SyncHttp {
    private final GoogleAuthorization google;
    private final java.util.concurrent.ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile HttpURLConnection active;
    private volatile int generation;
    private volatile boolean closed;
    SyncHttp(GoogleAuthorization google) { this.google = google; }
    void request(String id, String payload, BackupCoordinator.Reply reply) {
        int current = generation;
        worker.execute(() -> {
            JSONObject response = new JSONObject();
            try { if (closed || current != generation) throw new IllegalStateException("Sync cancelled"); response.put("result", send(new JSONObject(payload), current)); }
            catch (Exception error) { try { response.put("error", error.getMessage() == null ? "Sync request failed" : error.getMessage()); } catch (Exception ignored) {} }
            if (!closed) reply.accept(id, response.toString());
        });
    }
    private JSONObject send(JSONObject request, int current) throws Exception {
        URI uri = URI.create(request.getString("url"));
        if (!"https".equals(uri.getScheme()) || !"www.googleapis.com".equals(uri.getHost()) || uri.getUserInfo() != null || (uri.getPort() != -1 && uri.getPort() != 443) || !(uri.getPath().startsWith("/drive/v3/") || uri.getPath().equals("/upload/drive/v3/files"))) throw new IllegalArgumentException("Only Google Drive sync requests are allowed");
        String method = request.getString("method");
        if (!java.util.Set.of("GET", "POST", "DELETE").contains(method)) throw new IllegalArgumentException("Unsupported sync method");
        int max = request.getInt("maxBytes");
        if (max < 0 || max > 16 * 1024 * 1024) throw new IllegalArgumentException("Invalid sync size limit");
        String encoded = request.optString("body", "");
        if (encoded.length() > 24 * 1024 * 1024) throw new IllegalArgumentException("Sync request too large");
        byte[] body = encoded.isEmpty() ? null : Base64.decode(encoded, Base64.DEFAULT);
        String token = google.token(false);
        if (current != generation || closed) throw new IllegalStateException("Sync cancelled");
        HttpURLConnection connection = (HttpURLConnection)uri.toURL().openConnection();
        active = connection;
        try {
            if (current != generation || closed) throw new IllegalStateException("Sync cancelled");
            connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(15000); connection.setReadTimeout(120000);
            connection.setRequestMethod(method); connection.setRequestProperty("Authorization", "Bearer " + token);
            JSONObject headers = request.getJSONObject("headers");
            if (headers.has("Content-Type")) connection.setRequestProperty("Content-Type", headers.getString("Content-Type"));
            if (body != null) { connection.setDoOutput(true); connection.setFixedLengthStreamingMode(body.length); try (var output = connection.getOutputStream()) { output.write(body); } }
            int status = connection.getResponseCode();
            if (status == 401) google.invalidToken();
            JSONObject returnedHeaders = new JSONObject();
            for (var entry : connection.getHeaderFields().entrySet()) if (entry.getKey() != null && !entry.getValue().isEmpty()) returnedHeaders.put(entry.getKey().toLowerCase(Locale.ROOT), entry.getValue().get(0));
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            if (stream != null) try (stream) { byte[] buffer = new byte[8192]; int count; while ((count = stream.read(buffer)) != -1) { if (current != generation || closed) throw new IllegalStateException("Sync cancelled"); if (bytes.size() + count > max) throw new IllegalStateException("Sync response exceeds its size limit"); bytes.write(buffer, 0, count); } }
            return new JSONObject().put("status", status).put("headers", returnedHeaders).put("body", Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP));
        } finally { active = null; connection.disconnect(); }
    }
    void cancel() { generation++; HttpURLConnection connection = active; if (connection != null) connection.disconnect(); }
    void close() { closed = true; cancel(); worker.shutdownNow(); }
}
