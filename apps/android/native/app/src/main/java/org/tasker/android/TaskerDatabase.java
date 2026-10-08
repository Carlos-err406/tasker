package org.tasker.android;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteStatement;
import android.util.Base64;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.UUID;

/** Private native SQLite; neither the Mac service nor user Google accounts are involved. */
final class TaskerDatabase {
    private final SQLiteDatabase db;
    private final java.util.concurrent.locks.ReentrantLock gate = new java.util.concurrent.locks.ReentrantLock();
    private final BackupStore backups;
    private final android.util.AtomicFile syncState;
    TaskerDatabase(Context context) {
        syncState = new android.util.AtomicFile(new java.io.File(context.getFilesDir(), "sync-state.json"));
        db = context.openOrCreateDatabase("tasker.db", Context.MODE_PRIVATE, null);
        db.setForeignKeyConstraintsEnabled(true);
        db.enableWriteAheadLogging();
        try (var input = context.getAssets().open("schema.sql")) {
            java.io.ByteArrayOutputStream schemaBytes = new java.io.ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) schemaBytes.write(buffer, 0, count);
            String schema = schemaBytes.toString(java.nio.charset.StandardCharsets.UTF_8.name());
            BackupStore.createSchema(db, schema);
            db.execSQL("INSERT OR IGNORE INTO lists (name, sort_order) VALUES ('tasks', 0)");
            backups = new BackupStore(new java.io.File(context.getFilesDir(), "backups"), db, schema);
        } catch (Exception error) { db.close(); throw new IllegalStateException("Could not initialize local backups", error); }
    }
    String execute(String request) {
        gate.lock();
        try {
        JSONObject response = new JSONObject();
        try {
            JSONObject input = new JSONObject(request);
            Object result;
            switch (input.getString("action")) {
                case "query": result = query(input.getString("sql"), input.getJSONArray("params")); break;
                case "run": result = run(input.getString("sql"), input.getJSONArray("params")); break;
                case "begin": db.beginTransactionNonExclusive(); gate.lock(); result = true; break;
                case "commit":
                    if (!db.inTransaction()) throw new IllegalStateException("No transaction to commit");
                    try { db.setTransactionSuccessful(); } finally { try { db.endTransaction(); } finally { gate.unlock(); } }
                    result = true; break;
                case "rollback": if (db.inTransaction()) { try { db.endTransaction(); } finally { gate.unlock(); } } result = true; break;
                case "syncState": result = syncState(input); break;
                case "syncReadImage": {
                    String id = input.getString("id");
                    try (Cursor c = db.rawQuery("SELECT data,mime_type,created_at FROM attachments WHERE id=?", new String[]{id})) {
                        result = c.moveToFirst() ? new JSONObject().put("body", Base64.encodeToString(c.getBlob(0), Base64.NO_WRAP)).put("mimeType", c.getString(1)).put("createdAt", c.getString(2)) : JSONObject.NULL;
                    }
                    break;
                }
                case "syncWriteImage": {
                    JSONObject image = input.getJSONObject("image");
                    byte[] bytes = Base64.decode(input.getString("body"), Base64.DEFAULT);
                    if (bytes.length == 0 || bytes.length > 10 * 1024 * 1024 || !image.getString("id").matches("[a-f0-9-]{36}")) throw new IllegalArgumentException("Invalid sync image");
                    db.execSQL("INSERT OR IGNORE INTO attachments(id,mime_type,byte_length,created_at,data) VALUES(?,?,?,?,?)", new Object[]{image.getString("id"),image.getString("mimeType"),bytes.length,image.getString("createdAt"),bytes});
                    result = true; break;
                }
                case "saveImage": result = saveImage(input.getString("data"), input.getString("mimeType")); break;
                default: throw new IllegalArgumentException("Unknown database operation");
            }
            response.put("result", result);
        } catch (Exception error) {
            try { response.put("error", error.getMessage() == null ? "Database operation failed" : error.getMessage()); }
            catch (Exception ignored) { /* JSONObject accepts this string. */ }
        }
        return response.toString();
        } finally { gate.unlock(); }
    }
    private JSONObject syncState(JSONObject request) throws Exception {
        if (request.has("value")) {
            JSONObject value = request.getJSONObject("value");
            if (!value.getString("replica").matches("[a-f0-9-]{36}") || value.getLong("sequence") < 0) throw new IllegalArgumentException("Invalid sync settings");
            java.io.FileOutputStream output = syncState.startWrite();
            try { output.write(value.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)); syncState.finishWrite(output); }
            catch (Exception error) { syncState.failWrite(output); throw error; }
            return value;
        }
        if (syncState.getBaseFile().exists()) return new JSONObject(new String(syncState.readFully(), java.nio.charset.StandardCharsets.UTF_8));
        JSONObject value = new JSONObject().put("replica", UUID.randomUUID().toString()).put("enabled", false).put("account", JSONObject.NULL).put("lastSync", JSONObject.NULL).put("sequence", 0);
        return syncState(new JSONObject().put("value", value));
    }
    private JSONObject query(String sql, JSONArray params) throws Exception {
        // Bind with native types, preserving null and numeric values as well as strings.
        try (Cursor cursor = db.rawQueryWithFactory((database, driver, editTable, query) -> {
            try {
                for (int i = 0; i < params.length(); i++) {
                    Object value = params.get(i);
                    if (value == JSONObject.NULL) query.bindNull(i + 1);
                    else if (value instanceof Number) query.bindDouble(i + 1, ((Number)value).doubleValue());
                    else query.bindString(i + 1, value.toString());
                }
            } catch (Exception error) { throw new IllegalArgumentException(error); }
            return new android.database.sqlite.SQLiteCursor(driver, editTable, query);
        }, sql, new String[0], null)) {
            JSONArray columns = new JSONArray();
            for (String column : cursor.getColumnNames()) columns.put(column);
            JSONArray rows = new JSONArray();
            while (cursor.moveToNext()) {
                JSONArray row = new JSONArray();
                for (int i = 0; i < cursor.getColumnCount(); i++) {
                    switch (cursor.getType(i)) {
                        case Cursor.FIELD_TYPE_NULL: row.put(JSONObject.NULL); break;
                        case Cursor.FIELD_TYPE_INTEGER: row.put(cursor.getLong(i)); break;
                        case Cursor.FIELD_TYPE_FLOAT: row.put(cursor.getDouble(i)); break;
                        case Cursor.FIELD_TYPE_BLOB: throw new IllegalArgumentException("Use the attachment endpoint to read image bytes");
                        default: row.put(cursor.getString(i));
                    }
                }
                rows.put(row);
            }
            return new JSONObject().put("columns", columns).put("rows", rows);
        }
    }
    private JSONObject run(String sql, JSONArray params) throws Exception {
        try (SQLiteStatement statement = db.compileStatement(sql)) {
            for (int i = 0; i < params.length(); i++) {
                Object value = params.get(i);
                if (value == JSONObject.NULL) statement.bindNull(i + 1);
                else if (value instanceof Number) statement.bindDouble(i + 1, ((Number)value).doubleValue());
                else statement.bindString(i + 1, value.toString());
            }
            statement.execute();
        }
        try (Cursor cursor = db.rawQuery("SELECT changes(), last_insert_rowid()", null)) {
            cursor.moveToFirst();
            return new JSONObject().put("changes", cursor.getLong(0)).put("lastInsertRowid", cursor.getLong(1));
        }
    }
    private String saveImage(String encoded, String mime) throws Exception {
        if (!java.util.Set.of("image/png", "image/jpeg", "image/webp", "image/gif").contains(mime))
            throw new IllegalArgumentException("Unsupported image format");
        if (encoded.length() > 14 * 1024 * 1024) throw new IllegalArgumentException("Image too large");
        byte[] bytes = Base64.decode(encoded, Base64.DEFAULT);
        if (bytes.length == 0 || bytes.length > 10 * 1024 * 1024) throw new IllegalArgumentException("Images must be between 1 byte and 10 MB");
        String id = UUID.randomUUID().toString();
        try (SQLiteStatement insert = db.compileStatement("INSERT INTO attachments VALUES (?,?,?,?,?)")) {
            insert.bindString(1, id); insert.bindString(2, mime); insert.bindLong(3, bytes.length);
            insert.bindString(4, java.time.Instant.now().toString()); insert.bindBlob(5, bytes); insert.executeInsert();
        }
        return "/attachments/" + id;
    }
    Image image(String id) {
        gate.lock();
        try {
        try (Cursor cursor = db.rawQuery("SELECT mime_type, data FROM attachments WHERE id=?", new String[]{id})) {
            return cursor.moveToFirst() ? new Image(cursor.getString(0), cursor.getBlob(1)) : null;
        }
        } finally { gate.unlock(); }
    }
    void close() { gate.lock(); try { db.close(); } finally { gate.unlock(); } }
    interface BackupOperation<T> { T run(BackupStore store) throws Exception; }
    <T> T backups(BackupOperation<T> operation) throws Exception { gate.lock(); try { return operation.run(backups); } finally { gate.unlock(); } }
    record Image(String mime, byte[] bytes) {}
}
