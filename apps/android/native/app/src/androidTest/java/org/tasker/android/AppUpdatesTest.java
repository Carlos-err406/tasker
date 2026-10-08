package org.tasker.android;
import android.test.AndroidTestCase;
import org.json.JSONObject;
import org.json.JSONArray;
import java.net.URL;

public class AppUpdatesTest extends AndroidTestCase {
    private JSONObject release(String version,boolean preview) throws Exception {
        String name=preview?"tasker-android-preview.apk":"tasker-android.apk";
        return new JSONObject().put("tag_name","v"+version).put("draft",false).put("prerelease",false)
            .put("assets",new JSONArray().put(new JSONObject().put("name",name).put("state","uploaded").put("size",100)
            .put("digest","sha256:"+"a".repeat(64)).put("browser_download_url","https://github.com/Carlos-err406/tasker/releases/download/v"+version+"/"+name)));
    }
    public void testSelectsOnlyNewerMatchingPackageChannel() throws Exception {
        assertNotNull(AppUpdates.select(release("0.1.2",true),true,1001));
        assertNull(AppUpdates.select(release("0.1.2",false),true,1001));
        assertNull(AppUpdates.select(release("0.1.1",true),true,1001));
        assertNull(AppUpdates.select(release("0.1.0",true),true,1001));
        assertEquals(1002003,AppUpdates.versionCode("1.2.3"));
    }
    public void testRejectsUnverifiedOrOversizedAssets() throws Exception {
        for(String field:new String[]{"digest","size","browser_download_url","state"}) {
            JSONObject release=release("0.1.2",true),asset=release.getJSONArray("assets").getJSONObject(0);
            asset.put(field,field.equals("size")?AppUpdates.MAX_APK+1:"invalid");
            try{AppUpdates.select(release,true,1001);fail(field);}catch(java.io.IOException expected){}
        }
    }
    public void testRejectsDraftsAndPrereleases() throws Exception {
        for(String field:new String[]{"draft","prerelease"}) {
            try{AppUpdates.select(release("0.1.2",true).put(field,true),true,1001);fail(field);}catch(java.io.IOException expected){}
        }
    }
    public void testRedirectsRemainOnHttpsGithubHosts() throws Exception {
        assertTrue(AppUpdates.allowed(new URL("https://release-assets.githubusercontent.com/file")));
        for(String url:new String[]{"http://github.com/file","https://github.com.evil.test/file","https://github.com:8443/file","https://user@github.com/file","https://example.com/file"})assertFalse(AppUpdates.allowed(new URL(url)));
    }
    public void testVersionCodesAreMonotonicAndBounded() {
        assertTrue(AppUpdates.versionCode("0.2.0")>AppUpdates.versionCode("0.1.999"));
        for(String version:new String[]{"01.2.3","1.1000.0","1.2","v1.2.3","1.2.3-beta","2101.0.0","0.0.0"}) {
            try{AppUpdates.versionCode(version);fail(version);}catch(IllegalArgumentException expected){}
        }
    }
    public void testPackageIdentityVersionAndSigningGate() throws Exception {
        android.content.pm.PackageManager pm=getContext().getPackageManager();
        String name=getContext().getPackageName();
        android.content.pm.PackageInfo current=pm.getPackageInfo(name,android.content.pm.PackageManager.GET_SIGNING_CERTIFICATES);
        android.content.pm.PackageInfo next=new android.content.pm.PackageInfo();
        next.packageName=name;next.signingInfo=current.signingInfo;
        AppUpdates.Release release=new AppUpdates.Release("0.1.2","unused","unused",1);
        next.setLongVersionCode(1002);next.versionName="0.1.2";
        AppUpdates.validatePackage(next,current,name,release);
        next.packageName="another.app";
        try{AppUpdates.validatePackage(next,current,name,release);fail("wrong package");}catch(java.io.IOException expected){}
        next.packageName=name;next.setLongVersionCode(current.getLongVersionCode());
        try{AppUpdates.validatePackage(next,current,name,release);fail("not newer");}catch(java.io.IOException expected){}
        next.setLongVersionCode(1002);next.signingInfo=null;
        try{AppUpdates.validatePackage(next,current,name,release);fail("missing signer");}catch(java.io.IOException expected){}
    }
}
