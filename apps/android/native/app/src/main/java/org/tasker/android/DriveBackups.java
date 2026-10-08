package org.tasker.android;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Same Drive file metadata and snapshot bytes as the Mac client. */
final class DriveBackups {
    private static final String API = "https://www.googleapis.com/drive/v3/files";
    private final Set<HttpURLConnection> connections = java.util.concurrent.ConcurrentHashMap.newKeySet();
    void cancel() { for (HttpURLConnection c : connections) c.disconnect(); connections.clear(); }
    private void release(HttpURLConnection c) { connections.remove(c); c.disconnect(); }
    interface Authorization { String token() throws Exception; void invalidate(); }
    interface ConnectionFactory { HttpURLConnection open(URL url) throws Exception; }
    private final Authorization authorization;
    private final ConnectionFactory connectionFactory;
    private final String deviceId;
    DriveBackups(GoogleAuthorization google, String deviceId) {
        this(new Authorization() {
            public String token() throws Exception { return google.token(false); }
            public void invalidate() { google.invalidToken(); }
        }, deviceId, url -> (HttpURLConnection)url.openConnection());
    }
    DriveBackups(Authorization authorization, String deviceId, ConnectionFactory connectionFactory) {
        this.authorization = authorization; this.deviceId = deviceId; this.connectionFactory = connectionFactory;
    }
    private HttpURLConnection request(String url, String method, byte[] json) throws Exception {
        URL target = new URL(url);
        if (!target.getProtocol().equals("https") || !target.getHost().equals("www.googleapis.com") || target.getPort() != -1)
            throw new IOException("Invalid Google Drive endpoint");
        String token = authorization.token();
        HttpURLConnection connection = connectionFactory.open(target);
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(15000); connection.setReadTimeout(120000);
        connection.setRequestMethod(method); connection.setRequestProperty("Authorization", "Bearer " + token);
        connections.add(connection);
        try {
            if (json != null) {
                connection.setDoOutput(true); connection.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
                connection.setFixedLengthStreamingMode(json.length);
                try (OutputStream out = connection.getOutputStream()) { out.write(json); }
            }
            return connection;
        } catch (Exception error) { release(connection); throw error; }
    }
    private void check(HttpURLConnection c) throws Exception {
        int status = c.getResponseCode();
        if (status >= 200 && status < 300) return;
        if (status == 401) { authorization.invalidate(); throw new IOException("Reconnect Google Drive"); }
        if (status == 403) throw new IOException("Drive quota or permission denied. Check storage and access.");
        throw new IOException("Google Drive request failed (" + status + "). Try again later.");
    }
    private JSONObject json(HttpURLConnection c) throws Exception {
        try {
            check(c);
            try (InputStream in = c.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                copy(in, out, 2 * 1024 * 1024);
                String text = out.toString(StandardCharsets.UTF_8.name()); return text.trim().isEmpty() ? new JSONObject() : new JSONObject(text);
            }
        } finally { release(c); }
    }
    private static byte[] bytes(JSONObject value) { return value.toString().getBytes(StandardCharsets.UTF_8); }
    private static String encode(String value) { try { return URLEncoder.encode(value, "UTF-8"); } catch (UnsupportedEncodingException e) { throw new AssertionError(e); } }
    private List<JSONObject> find(String query) throws Exception {
        String next = ""; List<JSONObject> files = new ArrayList<>(); Set<String> pages = new HashSet<>();
        do {
            if (!pages.add(next)) throw new IOException("Invalid Drive pagination");
            JSONObject response = json(request(API + "?q=" + encode("trashed=false and (" + query + ")") + "&fields=" + encode("nextPageToken,files(id,description,appProperties,size,md5Checksum)") + "&pageSize=100&pageToken=" + encode(next), "GET", null));
            JSONArray list = response.optJSONArray("files");
            if (list != null) for (int i=0;i<list.length();i++) files.add(list.getJSONObject(i));
            next = response.optString("nextPageToken", "");
        } while (!next.isEmpty());
        return files;
    }
    List<JSONObject> list() throws Exception {
        List<JSONObject> result = new ArrayList<>();
        for (JSONObject file : find("appProperties has { key='app' and value='tasker-swiftbar' } and appProperties has { key='kind' and value='snapshot' }")) {
            try {
                JSONObject manifest = new JSONObject(file.getString("description")); BackupStore.checkManifest(manifest);
                if (!manifest.getString("id").equals(file.getJSONObject("appProperties").getString("backupId"))) continue;
                manifest.put("fileId", file.getString("id")); manifest.put("sourceDevice", file.getJSONObject("appProperties").optString("sourceDevice")); result.add(manifest);
            } catch (Exception ignored) { /* Foreign/corrupt files cannot be selected for restore. */ }
        }
        result.sort((a,b) -> java.time.Instant.parse(b.optString("createdAt")).compareTo(java.time.Instant.parse(a.optString("createdAt")))); return result;
    }
    private String folder() throws Exception {
        List<JSONObject> folders = find("mimeType='application/vnd.google-apps.folder' and appProperties has { key='app' and value='tasker-swiftbar' }");
        if (!folders.isEmpty()) return folders.get(0).getString("id");
        return json(request(API, "POST", bytes(new JSONObject().put("name", "Tasker backups").put("mimeType", "application/vnd.google-apps.folder").put("appProperties", new JSONObject().put("app", "tasker-swiftbar"))))).getString("id");
    }
    void upload(JSONObject manifest, File snapshot) throws Exception {
        BackupStore.checkManifest(manifest);
        String md5 = BackupStore.hash(snapshot,"MD5");
        List<JSONObject> matches = find("appProperties has { key='app' and value='tasker-swiftbar' } and appProperties has { key='backupId' and value='" + manifest.getString("id") + "' }");
        for (JSONObject file : matches) if (file.optString("size").equals(String.valueOf(snapshot.length())) && file.optString("md5Checksum").equals(md5)) return;
        // Never overwrite a mismatched existing recovery file; publish a validated copy.
        JSONObject metadata = new JSONObject().put("name", "Tasker-" + manifest.getString("createdAt").substring(0,10) + "-" + manifest.getString("id") + ".sqlite")
            .put("parents", new JSONArray().put(folder())).put("description", manifest.toString())
            .put("appProperties", new JSONObject().put("app", "tasker-swiftbar").put("kind", "snapshot").put("backupId", manifest.getString("id")).put("sourceDevice", deviceId));
        HttpURLConnection start = request("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,size,md5Checksum", "POST", bytes(metadata));
        String location;
        try { check(start); location = start.getHeaderField("Location"); } finally { release(start); }
        if (location == null) throw new IOException("Drive did not start an upload");
        HttpURLConnection upload = request(location, "PUT", null);
        try {
            upload.setDoOutput(true); upload.setRequestProperty("Content-Type", "application/vnd.sqlite3"); upload.setFixedLengthStreamingMode(snapshot.length());
            try (InputStream in = new FileInputStream(snapshot); OutputStream out = upload.getOutputStream()) { copy(in, out, BackupStore.MAX_BYTES); }
            JSONObject result = json(upload);
            if (result.optString("id").isEmpty() || !md5.equals(result.optString("md5Checksum")) || !String.valueOf(snapshot.length()).equals(result.optString("size")))
                throw new IOException("Drive did not verify the uploaded snapshot");
        } finally { release(upload); }
    }
    JSONObject download(String fileId, File destination) throws Exception {
        JSONObject manifest = null;
        for (JSONObject candidate : list()) if (fileId.equals(candidate.getString("fileId"))) manifest = candidate;
        if (manifest == null) throw new IOException("App backup not found in Drive");
        HttpURLConnection request = request(API + "/" + encode(fileId) + "?alt=media", "GET", null);
        try {
            check(request);
            try (InputStream in = request.getInputStream(); FileOutputStream out = new FileOutputStream(destination)) { copy(in, out, manifest.getLong("size")); out.getFD().sync(); }
            return manifest;
        } finally { release(request); }
    }
    void prune() throws Exception {
        int count = 0;
        for (JSONObject manifest : list()) if (manifest.getString("kind").equals("automatic") && deviceId.equals(manifest.optString("sourceDevice")) && ++count > 7)
            json(request(API + "/" + encode(manifest.getString("fileId")), "DELETE", null));
    }
    static void copy(InputStream in, OutputStream out, long limit) throws IOException {
        byte[] buffer = new byte[65536]; long total = 0; int n;
        while ((n=in.read(buffer))!=-1) { total += n; if (total > limit) throw new IOException("Backup exceeds the expected size"); out.write(buffer,0,n); }
    }
}
