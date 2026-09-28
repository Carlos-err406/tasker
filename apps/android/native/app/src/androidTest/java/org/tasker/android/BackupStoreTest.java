package org.tasker.android;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.test.AndroidTestCase;
import org.json.JSONObject;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.UUID;

/** Only temporary fixture databases; never opens tasker.db or connects to Google. */
public final class BackupStoreTest extends AndroidTestCase {
    private File root;
    private SQLiteDatabase db;
    private BackupStore store;
    private String schema;
    private static final String IMAGE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    @Override protected void setUp() throws Exception {
        super.setUp(); root = new File(getContext().getCacheDir(), "backup-tests-" + UUID.randomUUID()); assertTrue(root.mkdir());
        try (var in = getContext().getAssets().open("schema.sql"); var out = new java.io.ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int count;
            while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
            schema = out.toString(StandardCharsets.UTF_8.name());
        }
        db = SQLiteDatabase.openOrCreateDatabase(new File(root,"fixture.db"), null); db.setForeignKeyConstraintsEnabled(true); db.enableWriteAheadLogging(); BackupStore.createSchema(db,schema);
        db.execSQL("INSERT INTO lists(name) VALUES ('Tasks')");
        db.execSQL("INSERT INTO tasks(id,description,status,created_at,list_name) VALUES ('one',?,0,'2026-09-28','Tasks')",new Object[]{"Fixture\n![image](/attachments/" + IMAGE + ")"});
        db.execSQL("INSERT INTO attachments VALUES (?,'image/png',4,'2026-09-28',?)",new Object[]{IMAGE,new byte[]{1,2,3,4}});
        db.execSQL("INSERT INTO undo_history(stack_type,command_json,created_at) VALUES ('undo','{}','2026-09-28')");
        store = new BackupStore(new File(root,"backups"), db, schema);
    }
    @Override protected void tearDown() throws Exception { db.close(); BackupStore.remove(root); super.tearDown(); }
    private String description() { try (Cursor c=db.rawQuery("SELECT description FROM tasks WHERE id='one'",null)) { assertTrue(c.moveToFirst()); return c.getString(0); } }
    private void reviseManifest(JSONObject m) throws Exception {
        m.put("sha256",BackupStore.hash(store.file(m.getString("id")),"SHA-256")).put("size",store.file(m.getString("id")).length());
        Files.write(new File(store.file(m.getString("id")).getParentFile(),"manifest.json").toPath(),m.toString().getBytes(StandardCharsets.UTF_8));
    }
    private void mustReject(JSONObject m) throws Exception {
        String before = description(); int backups = store.list().size();
        try { store.restore(m.getString("id"),true); fail("Invalid backup accepted"); } catch (java.io.IOException expected) {}
        assertEquals(before,description()); assertEquals(backups,store.list().size());
    }
    public void testRoundTripIncludesImagesUndoAndSafety() throws Exception {
        JSONObject original = store.create("manual");
        db.execSQL("UPDATE tasks SET description='Changed',status=2"); db.execSQL("DELETE FROM attachments"); db.execSQL("DELETE FROM undo_history");
        JSONObject restored = store.restore(original.getString("id"),true);
        assertTrue(description().startsWith("Fixture"));
        try(Cursor c=db.rawQuery("SELECT data FROM attachments",null)){assertTrue(c.moveToFirst());assertEquals(4,c.getBlob(0).length);}
        assertEquals("[[\"1\"]]",BackupStore.rows(db,"SELECT count(*) FROM undo_history"));
        store.restore(restored.getString("safetyBackupId"),true); assertEquals("Changed",description());
        assertEquals("[[\"1\"]]",BackupStore.rows(db,"PRAGMA foreign_keys"));
    }
    public void testRequiresConfirmation() throws Exception {
        JSONObject m=store.create("manual"); try{store.restore(m.getString("id"),false);fail();}catch(java.io.IOException expected){}
        assertEquals(1,store.list().size());assertTrue(description().startsWith("Fixture"));
    }
    public void testCorruptChecksumRejectedBeforeSafetyOrMutation() throws Exception {
        JSONObject m=store.create("manual");try(var out=new java.io.FileOutputStream(store.file(m.getString("id")),true)){out.write(1);}mustReject(m);
    }
    public void testMissingImageRejected() throws Exception {
        JSONObject m=store.create("manual");try(SQLiteDatabase s=SQLiteDatabase.openDatabase(store.file(m.getString("id")).getAbsolutePath(),null,0)){s.execSQL("DELETE FROM attachments");}reviseManifest(m);mustReject(m);
    }
    public void testExecutableAndChangedSchemasRejected() throws Exception {
        JSONObject m=store.create("manual");try(SQLiteDatabase s=SQLiteDatabase.openDatabase(store.file(m.getString("id")).getAbsolutePath(),null,0)){s.execSQL("CREATE TRIGGER unsafe AFTER INSERT ON tasks BEGIN DELETE FROM lists; END");}reviseManifest(m);mustReject(m);
        JSONObject second=store.create("manual");try(SQLiteDatabase s=SQLiteDatabase.openDatabase(store.file(second.getString("id")).getAbsolutePath(),null,0)){s.execSQL("ALTER TABLE tasks ADD COLUMN unknown TEXT");}reviseManifest(second);mustReject(second);
    }
    public void testRollbackAfterLiveTablesWereDeleted() throws Exception {
        JSONObject m=store.create("manual");db.execSQL("UPDATE tasks SET description='Keep current'");
        try { store.restore(m.getString("id"),true,()->{throw new IllegalStateException("simulated activation failure");});fail(); } catch(IllegalStateException expected){}
        assertEquals("Keep current",description());assertEquals("[[\"1\"]]",BackupStore.rows(db,"PRAGMA foreign_keys"));
        store.restore(m.getString("id"),true);assertTrue(description().startsWith("Fixture"));
    }
    public void testRetentionPreservesManualAndSafety() throws Exception {
        assertTrue(store.due());store.create("manual");store.create("safety");for(int i=0;i<9;i++)store.create("automatic");
        assertEquals(9,store.list().size());assertFalse(store.due());
    }
    public void testImportRejectsUnsupportedVersionsAndBadIds() throws Exception {
        JSONObject m=store.create("manual");m.put("formatVersion",2);
        try{store.importSnapshot(m,store.file(m.getString("id")));fail();}catch(java.io.IOException expected){}
        try{store.file("../tasker.db");fail();}catch(IllegalArgumentException expected){}
    }
}
