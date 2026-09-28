package org.tasker.android;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.system.Os;
import android.system.OsConstants;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;
import java.util.regex.Pattern;

/** Mac-compatible snapshots. Call while holding TaskerDatabase's exclusive monitor. */
final class BackupStore {
    static final long MAX_BYTES = 512L * 1024 * 1024;
    static final String[] TABLES = {"lists", "tasks", "task_dependencies", "task_relations", "config", "undo_history", "attachments"};
    private final File root;
    private final SQLiteDatabase db;
    private final String schema;
    BackupStore(File root, SQLiteDatabase db, String schema) throws Exception {
        this.root = root; this.db = db; this.schema = schema;
        if (!root.isDirectory() && !root.mkdirs()) throw new IOException("Cannot create backup folder");
        for (File file : Objects.requireNonNull(root.listFiles()))
            if (file.getName().startsWith(".pending-")) remove(file);
    }
    static void createSchema(SQLiteDatabase target, String schema) {
        for (String sql : schema.split(";")) if (!sql.trim().isEmpty()) target.execSQL(sql);
    }
    static boolean validId(String id) { return id != null && id.matches("[a-f0-9-]{36}"); }
    File file(String id) {
        if (!validId(id)) throw new IllegalArgumentException("Invalid backup ID");
        return new File(new File(root, id), "snapshot.sqlite");
    }
    static void checkManifest(JSONObject m) throws Exception {
        if (!validId(m.getString("id")) || m.getInt("formatVersion") != 1 || m.getInt("schemaVersion") != 1)
            throw new IOException("Unsupported backup version");
        if (!Set.of("manual", "automatic", "safety").contains(m.getString("kind")) ||
            !m.getString("sha256").matches("[a-f0-9]{64}") || m.getLong("size") <= 0 || m.getLong("size") > MAX_BYTES)
            throw new IOException("Invalid backup manifest");
        Instant.parse(m.getString("createdAt"));
    }
    List<JSONObject> list() throws Exception {
        List<JSONObject> result = new ArrayList<>();
        for (File dir : Objects.requireNonNull(root.listFiles())) {
            if (!validId(dir.getName())) continue;
            try {
                File manifest = new File(dir, "manifest.json");
                if (manifest.length() > 65536) continue;
                JSONObject m = new JSONObject(new String(Files.readAllBytes(manifest.toPath()), java.nio.charset.StandardCharsets.UTF_8));
                checkManifest(m);
                if (m.getString("id").equals(dir.getName()) && file(dir.getName()).isFile()) result.add(m);
            } catch (Exception ignored) { /* Incomplete/invalid entries are never restorable. */ }
        }
        result.sort((a, b) -> java.time.Instant.parse(b.optString("createdAt")).compareTo(java.time.Instant.parse(a.optString("createdAt"))));
        return result;
    }
    boolean due() throws Exception {
        for (JSONObject m : list()) if (m.getString("kind").equals("automatic"))
            return Instant.now().toEpochMilli() - Instant.parse(m.getString("createdAt")).toEpochMilli() >= 86400000;
        return true;
    }
    JSONObject create(String kind) throws Exception {
        if (!Set.of("automatic", "manual", "safety").contains(kind)) throw new IllegalArgumentException("Invalid backup kind");
        if (db.inTransaction()) throw new IOException("Finish the current edit before backing up");
        String id = UUID.randomUUID().toString();
        File folder = new File(root, ".pending-" + id);
        if (!folder.mkdir()) throw new IOException("Cannot create backup");
        try {
            File snapshot = new File(folder, "snapshot.sqlite");
            db.execSQL("VACUUM INTO ?", new Object[]{snapshot.getAbsolutePath()});
            JSONObject m = new JSONObject().put("id", id).put("formatVersion", 1).put("schemaVersion", 1)
                .put("appVersion", BuildConfig.VERSION_NAME).put("createdAt", Instant.now().toString()).put("kind", kind)
                .put("size", snapshot.length()).put("sha256", hash(snapshot, "SHA-256"));
            validate(m, snapshot);
            publish(folder, m);
            if (kind.equals("automatic")) {
                int count = 0;
                for (JSONObject old : list()) if (old.getString("kind").equals("automatic") && ++count > 7)
                    remove(file(old.getString("id")).getParentFile());
            }
            return m;
        } catch (Exception error) { remove(folder); throw error; }
    }
    private void publish(File folder, JSONObject m) throws Exception {
        flush(new File(folder, "snapshot.sqlite"));
        try (FileOutputStream out = new FileOutputStream(new File(folder, "manifest.json"))) {
            out.write(m.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)); out.getFD().sync();
        }
        flushDirectory(folder);
        if (!folder.renameTo(new File(root, m.getString("id")))) throw new IOException("Cannot finalize backup");
        flushDirectory(root);
    }
    JSONObject manifest(String id) throws Exception {
        file(id);
        for (JSONObject m : list()) if (m.getString("id").equals(id)) return m;
        throw new IOException("Backup not found");
    }
    void validate(JSONObject m, File snapshot) throws Exception {
        checkManifest(m);
        if (snapshot.length() != m.getLong("size") || !hash(snapshot, "SHA-256").equals(m.getString("sha256")))
            throw new IOException("Backup checksum mismatch");
        try (SQLiteDatabase source = SQLiteDatabase.openDatabase(snapshot.getAbsolutePath(), null, SQLiteDatabase.OPEN_READONLY | SQLiteDatabase.NO_LOCALIZED_COLLATORS);
             SQLiteDatabase expected = SQLiteDatabase.create(null)) {
            createSchema(expected, schema);
            try (Cursor check = source.rawQuery("PRAGMA integrity_check", null)) {
                if (!check.moveToFirst() || !"ok".equals(check.getString(0)) || check.moveToNext()) throw new IOException("Invalid database");
            }
            requireEmpty(source, "PRAGMA foreign_key_check", "Invalid task relationships");
            requireEmpty(source, "SELECT 1 FROM sqlite_master WHERE type IN ('view','trigger')", "Unsupported executable database schema");
            for (String table : TABLES) for (String pragma : new String[]{"table_info", "foreign_key_list"})
                if (!rows(source, "PRAGMA " + pragma + "('" + table + "')").equals(rows(expected, "PRAGMA " + pragma + "('" + table + "')")))
                    throw new IOException("Unsupported backup table schema: " + table);
            requireEmpty(source, "SELECT 1 FROM attachments WHERE mime_type NOT IN ('image/png','image/jpeg','image/webp','image/gif') OR typeof(data) != 'blob' OR byte_length != length(data) OR byte_length < 1 OR byte_length > 10485760", "Invalid attachment data");
            Pattern reference = Pattern.compile("/attachments/([a-f0-9-]{36})");
            try (Cursor texts = source.rawQuery("SELECT description FROM tasks UNION ALL SELECT command_json FROM undo_history", null)) {
                while (texts.moveToNext()) {
                    var matcher = reference.matcher(texts.getString(0));
                    while (matcher.find()) try (Cursor image = source.rawQuery("SELECT 1 FROM attachments WHERE id=?", new String[]{matcher.group(1)})) {
                        if (!image.moveToFirst()) throw new IOException("Missing image in backup");
                    }
                }
            }
        }
    }
    JSONObject restore(String id, boolean confirm) throws Exception {
        return restore(id, confirm, () -> {});
    }
    JSONObject restore(String id, boolean confirm, Runnable afterDelete) throws Exception {
        if (!confirm) throw new IOException("Confirm restore before replacing tasks");
        if (db.inTransaction()) throw new IOException("Finish the current edit before restoring");
        validate(manifest(id), file(id));
        JSONObject safety = create("safety");
        // Keep the live connection and file. SQLite atomically commits all restored
        // tables or rolls them back, including after process death or disk failure.
        db.setForeignKeyConstraintsEnabled(false);
        boolean attached = false;
        try {
            db.execSQL("ATTACH DATABASE ? AS restore_source", new Object[]{file(id).getAbsolutePath()}); attached = true;
            db.beginTransaction();
            try {
                for (String table : TABLES) db.execSQL("DELETE FROM main.\"" + table + "\"");
                afterDelete.run();
                for (String table : TABLES) db.execSQL("INSERT INTO main.\"" + table + "\" SELECT * FROM restore_source.\"" + table + "\"");
                db.execSQL("DELETE FROM main.sqlite_sequence WHERE name='undo_history'");
                db.execSQL("INSERT INTO main.sqlite_sequence(name,seq) SELECT name,seq FROM restore_source.sqlite_sequence WHERE name='undo_history'");
                requireEmpty(db, "PRAGMA main.foreign_key_check", "Invalid restored relationships");
                db.setTransactionSuccessful();
            } finally { db.endTransaction(); }
        } finally {
            try { if (attached) db.execSQL("DETACH DATABASE restore_source"); }
            finally { db.setForeignKeyConstraintsEnabled(true); }
        }
        return new JSONObject().put("safetyBackupId", safety.getString("id"));
    }
    void importSnapshot(JSONObject manifest, File downloaded) throws Exception {
        validate(manifest, downloaded);
        String id = manifest.getString("id");
        if (file(id).exists()) { validate(manifest, file(id)); return; }
        File folder = new File(root, ".pending-" + id);
        if (!folder.mkdir()) throw new IOException("Cannot stage downloaded backup");
        try {
            Files.copy(downloaded.toPath(), new File(folder, "snapshot.sqlite").toPath());
            publish(folder, manifest);
        } catch (Exception error) { remove(folder); throw error; }
    }
    static String rows(SQLiteDatabase database, String sql) throws Exception {
        JSONArray rows = new JSONArray();
        try (Cursor c = database.rawQuery(sql, null)) {
            while (c.moveToNext()) { JSONArray row = new JSONArray(); for (int i=0;i<c.getColumnCount();i++) row.put(c.isNull(i) ? JSONObject.NULL : c.getString(i)); rows.put(row); }
        }
        return rows.toString();
    }
    static void requireEmpty(SQLiteDatabase database, String sql, String error) throws IOException {
        try (Cursor c = database.rawQuery(sql, null)) { if (c.moveToFirst()) throw new IOException(error); }
    }
    static String hash(File file, String algorithm) throws Exception {
        MessageDigest digest = MessageDigest.getInstance(algorithm);
        try (InputStream in = new FileInputStream(file)) { byte[] buffer = new byte[65536]; int n; while ((n=in.read(buffer))!=-1) digest.update(buffer,0,n); }
        StringBuilder result = new StringBuilder(); for (byte b : digest.digest()) result.append(String.format(Locale.ROOT, "%02x", b & 255)); return result.toString();
    }
    static void flush(File file) throws Exception { try (RandomAccessFile handle = new RandomAccessFile(file, "rw")) { handle.getFD().sync(); } }
    static void flushDirectory(File dir) throws Exception { var fd = Os.open(dir.getAbsolutePath(), OsConstants.O_RDONLY, 0); try { Os.fsync(fd); } finally { Os.close(fd); } }
    static void remove(File file) throws IOException {
        if (!file.exists()) return;
        if (file.isDirectory()) for (File child : Objects.requireNonNull(file.listFiles())) remove(child);
        if (!file.delete()) throw new IOException("Cannot remove incomplete backup");
    }
}
