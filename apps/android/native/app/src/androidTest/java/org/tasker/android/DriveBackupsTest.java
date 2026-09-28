package org.tasker.android;

import android.test.AndroidTestCase;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Fake HTTP only: these tests cannot contact an account or upload user data. */
public final class DriveBackupsTest extends AndroidTestCase {
    private final List<Fake> calls = new ArrayList<>();
    private final Queue<Fake> replies = new ArrayDeque<>();
    private int invalidations;
    private DriveBackups drive;
    private static class Fake extends HttpURLConnection {
        final String body; boolean released; boolean failWrite; String location;
        final ByteArrayOutputStream written = new ByteArrayOutputStream();
        Fake(int status, String body) throws Exception { super(new URL("https://www.googleapis.com/")); responseCode=status; this.body=body; }
        public void disconnect() { released=true; }
        public boolean usingProxy() { return false; }
        public void connect() {}
        public int getResponseCode() { return responseCode; }
        public InputStream getInputStream() { return new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)); }
        public OutputStream getOutputStream() throws IOException { if(failWrite)throw new IOException("offline");return written; }
        public String getHeaderField(String name) { return name.equals("Location") ? location : null; }
        void target(URL value) { url=value; }
    }
    @Override protected void setUp() throws Exception {
        super.setUp(); calls.clear(); replies.clear(); invalidations=0;
        drive=new DriveBackups(new DriveBackups.Authorization(){ public String token(){return "isolated-test-token";} public void invalidate(){invalidations++;}}, "phone", url->{
            Fake response=replies.remove();response.target(url);calls.add(response);return response;
        });
    }
    private Fake reply(int code,String body) throws Exception { Fake f=new Fake(code,body);replies.add(f);return f; }
    private JSONObject manifest(int i,String kind) throws Exception {
        return new JSONObject().put("id",String.format("aaaaaaaa-aaaa-aaaa-aaaa-%012d",i)).put("formatVersion",1).put("schemaVersion",1)
            .put("appVersion","0.1.1").put("createdAt",String.format("2026-09-%02dT12:00:00Z",i+1)).put("kind",kind).put("size",4).put("sha256",String.join("", Collections.nCopies(64, "a")));
    }
    private JSONObject file(int i,String kind,String device) throws Exception {
        JSONObject m=manifest(i,kind);return new JSONObject().put("id","file-"+i).put("description",m.toString())
            .put("appProperties",new JSONObject().put("backupId",m.getString("id")).put("sourceDevice",device));
    }
    public void testExpiredTokenAndQuotaErrorsReleaseConnection() throws Exception {
        Fake expired=reply(401,"");try{drive.list();fail();}catch(IOException expected){assertTrue(expected.getMessage().contains("Reconnect"));}
        assertTrue(expired.released);assertEquals(1,invalidations);
        Fake denied=reply(403,"");try{drive.list();fail();}catch(IOException expected){assertTrue(expected.getMessage().contains("quota"));}assertTrue(denied.released);
    }
    public void testPaginationAndRetentionNeverDeleteOtherDevicesOrManualBackups() throws Exception {
        JSONArray files=new JSONArray();for(int i=0;i<9;i++)files.put(file(i,"automatic","phone"));files.put(file(10,"automatic","mac"));files.put(file(11,"manual","phone"));files.put(file(12,"safety","phone"));
        reply(200,new JSONObject().put("files",files).put("nextPageToken","next").toString());reply(200,"{\"files\":[]}");reply(204,"");reply(204,"");
        drive.prune();assertEquals(4,calls.size());assertTrue(calls.get(1).getURL().toString().contains("pageToken=next"));
        assertEquals("DELETE",calls.get(2).getRequestMethod());assertTrue(calls.get(2).getURL().getPath().endsWith("file-1"));assertTrue(calls.get(3).getURL().getPath().endsWith("file-0"));
        for(Fake f:calls)assertTrue(f.released);
    }
    public void testRepeatedPaginationRejected() throws Exception {
        reply(200,"{\"files\":[],\"nextPageToken\":\"same\"}");reply(200,"{\"files\":[],\"nextPageToken\":\"same\"}");
        try{drive.list();fail();}catch(IOException expected){assertTrue(expected.getMessage().contains("pagination"));}assertEquals(2,calls.size());
    }
    public void testRetryRecognizesVerifiedUpload() throws Exception {
        File snapshot=File.createTempFile("drive-test-",".sqlite",getContext().getCacheDir());
        try { try(var out=new FileOutputStream(snapshot)){out.write("test".getBytes(StandardCharsets.UTF_8));}
            reply(200,"{\"files\":[{\"id\":\"existing\",\"size\":\"4\",\"md5Checksum\":\"098f6bcd4621d373cade4e832627b4f6\"}]}");
            drive.upload(manifest(0,"manual"),snapshot);assertEquals(1,calls.size());assertEquals("GET",calls.get(0).getRequestMethod());
        }finally{assertTrue(snapshot.delete());}
    }
    public void testMetadataWriteFailureClosesConnection() throws Exception {
        File snapshot=File.createTempFile("drive-test-",".sqlite",getContext().getCacheDir());
        try { try(var out=new FileOutputStream(snapshot)){out.write("test".getBytes(StandardCharsets.UTF_8));}
            reply(200,"{\"files\":[]}");reply(200,"{\"files\":[{\"id\":\"folder\"}]}");Fake broken=reply(200,"");broken.failWrite=true;
            try{drive.upload(manifest(0,"manual"),snapshot);fail();}catch(IOException expected){assertEquals("offline",expected.getMessage());}assertTrue(broken.released);
        }finally{assertTrue(snapshot.delete());}
    }
    public void testDownloadRejectsOversizeWithoutReplacingDestinationDatabase() throws Exception {
        File download=File.createTempFile("drive-test-",".sqlite",getContext().getCacheDir());
        try {
            reply(200,new JSONObject().put("files",new JSONArray().put(file(0,"manual","phone"))).toString());Fake oversized=reply(200,"too large");
            try{drive.download("file-0",download);fail();}catch(IOException expected){assertTrue(expected.getMessage().contains("size"));}assertTrue(oversized.released);
        }finally{assertTrue(download.delete());}
    }
}
