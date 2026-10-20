package org.tasker.android;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.util.Map;

/** Serves the bundled page and attachment images on Tasker's fixed HTTPS origin. */
final class LocalAssets {
    static final String ORIGIN = "https://app.tasker.local";
    private static final String CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; media-src 'self' https:; font-src 'self'; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

    private LocalAssets() {}

    /** The response for a request on Tasker's origin, or null to let anything else through. */
    static WebResourceResponse respond(Context context, TaskerDatabase database, Uri uri) {
        if (!"https".equals(uri.getScheme()) || !"app.tasker.local".equals(uri.getHost()) || uri.getPort() != -1) return null;
        String path = uri.getPath();
        try {
            if (path == null || path.contains("..") || path.contains("\\")) return missing();
            if (path.matches("/attachments/[a-f0-9-]{36}")) {
                TaskerDatabase.Image image = database.image(path.substring("/attachments/".length()));
                if (image == null) return missing();
                return response(image.mime(), new ByteArrayInputStream(image.bytes()));
            }
            String asset = path.equals("/") ? "index.html" : path.substring(1);
            if (!asset.equals("index.html") && !asset.matches("assets/[A-Za-z0-9_.-]+")) return missing();
            String mime = asset.endsWith(".html") ? "text/html" : asset.endsWith(".js") ? "text/javascript" : asset.endsWith(".css") ? "text/css" : asset.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream";
            return response(mime, context.getAssets().open(asset));
        } catch (Exception error) { return missing(); }
    }

    private static WebResourceResponse response(String mime, InputStream content) {
        return new WebResourceResponse(mime, "UTF-8", 200, "OK", Map.of("Content-Security-Policy", CSP, "X-Content-Type-Options", "nosniff", "Cache-Control", "no-store"), content);
    }

    private static WebResourceResponse missing() {
        return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Map.of(), new ByteArrayInputStream(new byte[0]));
    }
}
