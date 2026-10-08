package org.tasker.android;

import android.content.Context;
import android.content.ContextWrapper;
import android.database.sqlite.SQLiteDatabase;
import android.test.AndroidTestCase;
import java.io.File;
import java.util.concurrent.*;
import org.json.JSONObject;

public class SyncDatabaseTest extends AndroidTestCase {
    private File directory;
    private TaskerDatabase database;
    @Override protected void setUp() throws Exception {
        super.setUp();
        directory = new File(getContext().getCacheDir(), "sync-db-test-" + java.util.UUID.randomUUID());
        assertTrue(directory.mkdir());
        Context isolated = new ContextWrapper(getContext()) {
            @Override public SQLiteDatabase openOrCreateDatabase(String name, int mode, SQLiteDatabase.CursorFactory factory) {
                return SQLiteDatabase.openOrCreateDatabase(new File(directory, name), factory);
            }
            @Override public File getFilesDir() { return directory; }
        };
        database = new TaskerDatabase(isolated);
    }
    @Override protected void tearDown() throws Exception { database.close(); remove(directory); super.tearDown(); }
    private static void remove(File file) { File[] children=file.listFiles(); if(children!=null)for(File child:children)remove(child); file.delete(); }
    private JSONObject call(String json) throws Exception { JSONObject result=new JSONObject(database.execute(json)); assertFalse(result.toString(),result.has("error")); return result; }
    public void testBackupWaitsWithoutBlockingRemainingTransactionCalls() throws Exception {
        call("{\"action\":\"begin\"}");
        ExecutorService worker=Executors.newSingleThreadExecutor();
        CountDownLatch entered=new CountDownLatch(1);
        Future<?> backup=worker.submit(()->{entered.countDown();try{return database.backups(store->store.create("manual"));}catch(Exception e){throw new RuntimeException(e);}});
        try {
            assertTrue(entered.await(1,TimeUnit.SECONDS));
            try { backup.get(100,TimeUnit.MILLISECONDS); fail("Backup must wait for transaction"); } catch(TimeoutException expected) {}
            call("{\"action\":\"run\",\"sql\":\"INSERT INTO lists(name) VALUES (?)\",\"params\":[\"Transaction completed\"]}");
            call("{\"action\":\"commit\"}");
            assertNotNull(backup.get(5,TimeUnit.SECONDS));
        } finally { database.execute("{\"action\":\"rollback\"}");worker.shutdownNow(); }
    }
    public void testSyncSettingsRemainOutsidePortableDatabase() throws Exception {
        JSONObject state=call("{\"action\":\"syncState\"}").getJSONObject("result");
        assertFalse(state.getBoolean("enabled"));
        state.put("enabled",true).put("account","dummy-account");
        call(new JSONObject().put("action","syncState").put("value",state).toString());
        assertEquals("dummy-account",call("{\"action\":\"syncState\"}").getJSONObject("result").getString("account"));
        JSONObject rows=call("{\"action\":\"query\",\"sql\":\"SELECT value FROM config\",\"params\":[]}");
        assertFalse(rows.toString().contains("dummy-account"));
    }
    public void testNetworkBoundaryRejectsOtherOriginsBeforeAuthorization() throws Exception {
        SyncHttp http=new SyncHttp(null);
        CompletableFuture<String> result=new CompletableFuture<>();
        try {
            http.request("test","{\"url\":\"https://example.com/drive/v3/files\",\"method\":\"GET\",\"headers\":{},\"maxBytes\":100}",(id,response)->result.complete(response));
            assertTrue(new JSONObject(result.get(2,TimeUnit.SECONDS)).getString("error").contains("Only Google Drive"));
        } finally { http.close(); }
    }
}
