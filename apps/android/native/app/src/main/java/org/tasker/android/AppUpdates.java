package org.tasker.android;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.*;

/** Only the official release endpoint can supply an update; JS cannot pass an APK URL. */
final class AppUpdates {
    static final String RELEASE = "https://api.github.com/repos/Carlos-err406/tasker/releases/latest";
    static final long MAX_APK = 100L * 1024 * 1024;
    interface Reply { void accept(String id, String json); }
    record Release(String version, String url, String digest, long size) {}
    private final Activity activity;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile HttpURLConnection connection;
    private volatile boolean closed;
    private boolean busy;
    private String phase = "idle", error;
    private int progress;
    private Release available;
    private final File apk;
    AppUpdates(Activity activity) {
        this.activity = activity;
        File folder = new File(activity.getCacheDir(), "updates");
        folder.mkdirs();
        apk = new File(folder, "update.apk");
        // No stale installer survives app replacement. A fresh check selects its release.
        apk.delete();
        new File(folder, "update.part").delete();
    }
    synchronized JSONObject status() throws Exception {
        return new JSONObject().put("currentVersion", BuildConfig.VERSION_NAME)
            .put("version", available == null ? JSONObject.NULL : available.version())
            .put("phase", phase).put("busy", busy).put("progress", progress)
            .put("error", error == null ? JSONObject.NULL : error);
    }
    void request(String id, String action, Reply reply) {
        if (closed) return;
        if ("status".equals(action)) { respond(id, reply); return; }
        synchronized (this) {
            if (busy) { respond(id, reply); return; }
            if (!Set.of("check", "install").contains(action)) { error="Unknown update action"; respond(id,reply); return; }
            busy=true; error=null; progress=0; phase="check".equals(action)?"checking":"downloading";
        }
        worker.execute(() -> {
            try {
                if ("check".equals(action)) check(); else downloadAndInstall();
            } catch (Exception e) {
                synchronized (this) { error=e.getMessage()==null?"Could not update Tasker. Try again.":e.getMessage(); phase="error"; }
            } finally {
                synchronized (this) { busy=false; }
                if (!closed) respond(id,reply);
            }
        });
    }
    private void respond(String id, Reply reply) {
        try { reply.accept(id,new JSONObject().put("result",status()).toString()); }
        catch (Exception ignored) { /* Status contains only JSON values. */ }
    }
    static long versionCode(String version) {
        if (!version.matches("(0|[1-9][0-9]{0,3})\\.(0|[1-9][0-9]{0,2})\\.(0|[1-9][0-9]{0,2})")) throw new IllegalArgumentException("Unsupported Android release version");
        String[] parts=version.split("\\.");
        long code=Long.parseLong(parts[0])*1000000+Long.parseLong(parts[1])*1000+Long.parseLong(parts[2]);
        if (code<1 || code>2100000000L) throw new IllegalArgumentException("Unsupported Android release version");
        return code;
    }
    static Release select(JSONObject release, boolean preview, long installed) throws Exception {
        if (release.optBoolean("draft") || release.optBoolean("prerelease")) throw new IOException("Expected a published stable release");
        String tag=release.getString("tag_name");
        if (!tag.startsWith("v")) throw new IOException("Invalid release version");
        String version=tag.substring(1);
        long code=versionCode(version);
        String name=preview?"tasker-android-preview.apk":"tasker-android.apk";
        JSONArray assets=release.getJSONArray("assets");
        for(int i=0;i<assets.length();i++) {
            JSONObject asset=assets.getJSONObject(i);
            if (!name.equals(asset.optString("name"))) continue;
            if(code<=installed) return null;
            String url=asset.getString("browser_download_url"), digest=asset.optString("digest");
            long size=asset.getLong("size");
            if (!url.equals("https://github.com/Carlos-err406/tasker/releases/download/"+tag+"/"+name)
                || !digest.matches("sha256:[a-f0-9]{64}") || size<1 || size>MAX_APK || !"uploaded".equals(asset.optString("state")))
                throw new IOException("Invalid Android release asset");
            return new Release(version,url,digest.substring(7),size);
        }
        return null;
    }
    private void check() throws Exception {
        ByteArrayOutputStream output=new ByteArrayOutputStream();
        int status=download(RELEASE,output,2*1024*1024,false);
        if(status==404) { synchronized(this){available=null;phase="unpublished";} return; }
        JSONObject release=new JSONObject(output.toString(StandardCharsets.UTF_8.name()));
        Release selected=select(release,BuildConfig.DEBUG,BuildConfig.VERSION_CODE);
        boolean hasApk=false;
        JSONArray assets=release.getJSONArray("assets");
        String expected=BuildConfig.DEBUG?"tasker-android-preview.apk":"tasker-android.apk";
        for(int i=0;i<assets.length();i++) hasApk|=expected.equals(assets.getJSONObject(i).optString("name"));
        synchronized(this){available=selected;phase=selected!=null?"available":hasApk?"current":"unpublished";}
        apk.delete();
    }
    static boolean allowed(URL url) {
        return "https".equals(url.getProtocol()) && (url.getPort()==-1||url.getPort()==443) && url.getUserInfo()==null
            && Set.of("api.github.com","github.com","release-assets.githubusercontent.com","objects.githubusercontent.com").contains(url.getHost());
    }
    private int download(String address, OutputStream output, long limit, boolean reportProgress) throws Exception {
        URL url=new URL(address);
        for(int redirects=0;redirects<=5;redirects++) {
            if(closed) throw new IOException("Update cancelled");
            if(!allowed(url)) throw new IOException("Unexpected update download location");
            HttpURLConnection http=(HttpURLConnection)url.openConnection();connection=http;
            try {
                http.setInstanceFollowRedirects(false);http.setConnectTimeout(15000);http.setReadTimeout(30000);
                http.setRequestProperty("User-Agent","Tasker-Android");
                http.setRequestProperty("Accept","api.github.com".equals(url.getHost())?"application/vnd.github+json":"application/octet-stream");
                int status=http.getResponseCode();
                if(status==301||status==302||status==303||status==307||status==308){String next=http.getHeaderField("Location");if(next==null)throw new IOException("Missing download redirect");url=new URL(url,next);continue;}
                if(status==404&&address.equals(RELEASE))return status;
                if(status!=200)throw new IOException(status==403||status==429?"GitHub is limiting update checks. Try again later.":"Update download failed ("+status+"). Try again.");
                if(http.getContentLengthLong()>limit)throw new IOException("Update download is too large");
                long total=0, deadline=System.nanoTime()+TimeUnit.MINUTES.toNanos(5);
                try(InputStream input=http.getInputStream()){
                    byte[] buffer=new byte[32768];int count;
                    while((count=input.read(buffer))!=-1){
                        total+=count;if(closed||System.nanoTime()>deadline)throw new IOException("Update download timed out");
                        if(total>limit)throw new IOException("Update download is too large");
                        output.write(buffer,0,count);
                        if(reportProgress)synchronized(this){progress=(int)Math.min(99,total*100/limit);}
                    }
                }
                return status;
            } finally {http.disconnect();connection=null;}
        }
        throw new IOException("Too many update redirects");
    }
    private void downloadAndInstall() throws Exception {
        Release release; synchronized(this){release=available;}
        if(release==null)throw new IOException("Check for updates first");
        if(!apk.exists()) {
            File partial=new File(apk.getParentFile(),"update.part");
            try {
                MessageDigest hash=MessageDigest.getInstance("SHA-256");
                try(OutputStream output=new java.security.DigestOutputStream(new FileOutputStream(partial),hash)){download(release.url(),output,release.size(),true);}
                if(partial.length()!=release.size()||!hex(hash.digest()).equals(release.digest()))throw new IOException("Update checksum did not match. Try again.");
                validateApk(partial,release);
                if(!partial.renameTo(apk))throw new IOException("Could not save the update");
            } finally {partial.delete();}
        }
        validateApk(apk,release);
        synchronized(this){progress=100;phase=activity.getPackageManager().canRequestPackageInstalls()?"ready":"permission";}
        activity.runOnUiThread(() -> {
            if(closed||activity.isDestroyed())return;
            try {
                if(!activity.getPackageManager().canRequestPackageInstalls()) {
                    activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+activity.getPackageName())));
                } else {
                    Uri uri=FileProvider.getUriForFile(activity,activity.getPackageName()+".updates",apk);
                    activity.startActivity(new Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION));
                }
            }catch(Exception e){synchronized(this){phase="error";error="Could not open Android’s installer. Try again.";}}
        });
    }
    private void validateApk(File file, Release release) throws Exception {
        PackageManager pm=activity.getPackageManager();
        PackageInfo next=pm.getPackageArchiveInfo(file.getAbsolutePath(),PackageManager.GET_SIGNING_CERTIFICATES);
        PackageInfo current=pm.getPackageInfo(activity.getPackageName(),PackageManager.GET_SIGNING_CERTIFICATES);
        validatePackage(next,current,activity.getPackageName(),release);
    }
    static void validatePackage(PackageInfo next, PackageInfo current, String packageName, Release release) throws IOException {
        if(next==null||!packageName.equals(next.packageName)||next.getLongVersionCode()!=versionCode(release.version())||next.getLongVersionCode()<=current.getLongVersionCode()||!release.version().equals(next.versionName))
            throw new IOException("This update is not compatible with this Tasker app");
        if(next.signingInfo==null||current.signingInfo==null||!signatures(next.signingInfo.getApkContentsSigners()).equals(signatures(current.signingInfo.getApkContentsSigners())))
            throw new IOException("This update uses a different signing key. Your installed app has been kept.");
    }
    private static Set<String> signatures(Signature[] signatures){Set<String> result=new HashSet<>();for(Signature signature:signatures)result.add(signature.toCharsString());return result;}
    static String hex(byte[] bytes){StringBuilder s=new StringBuilder();for(byte b:bytes)s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString();}
    void close(){closed=true;HttpURLConnection http=connection;if(http!=null)http.disconnect();worker.shutdownNow();}
}
