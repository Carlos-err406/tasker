package org.tasker.android;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.util.AtomicFile;
import android.widget.RemoteViews;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Home-screen widget showing one list's open tasks (or All lists). It draws the snapshot the
 * page writes whenever the app leaves the foreground, so order and titles match the app.
 * Read-only: taps open the app.
 */
public final class TaskListWidget extends AppWidgetProvider {
    /** The list name meaning All lists. */
    static final String ALL = "";
    private static final String DEFAULT_LIST = "tasks";
    private static final int MAX_ROWS = 100;

    @Override public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
        for (int id : ids) update(context, manager, id);
        // Also on the periodic update, so "Today" and "Tomorrow" follow the date.
        manager.notifyAppWidgetViewDataChanged(ids, R.id.widget_list);
    }

    @Override public void onDeleted(Context context, int[] ids) {
        SharedPreferences.Editor editor = prefs(context).edit();
        for (int id : ids) editor.remove("list-" + id);
        editor.apply();
    }

    static void saveSnapshot(Context context, String json) {
        AtomicFile file = snapshotFile(context);
        FileOutputStream out = null;
        try {
            new JSONObject(json);
            out = file.startWrite();
            out.write(json.getBytes(StandardCharsets.UTF_8));
            file.finishWrite(out);
        } catch (Exception error) {
            if (out != null) file.failWrite(out);
            return;
        }
        updateAll(context);
    }

    static JSONObject snapshot(Context context) {
        try { return new JSONObject(new String(snapshotFile(context).readFully(), StandardCharsets.UTF_8)); }
        catch (Exception error) { return null; }
    }

    static List<String> lists(Context context) {
        List<String> names = new ArrayList<>();
        JSONObject snapshot = snapshot(context);
        JSONArray lists = snapshot == null ? null : snapshot.optJSONArray("lists");
        for (int i = 0; lists != null && i < lists.length(); i++) names.add(lists.optString(i));
        return names;
    }

    static String listOf(Context context, int id) {
        return prefs(context).getString("list-" + id, DEFAULT_LIST);
    }

    static void setList(Context context, int id, String list) {
        prefs(context).edit().putString("list-" + id, list).apply();
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        update(context, manager, id);
        manager.notifyAppWidgetViewDataChanged(new int[]{id}, R.id.widget_list);
    }

    static void updateAll(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, TaskListWidget.class));
        if (ids.length == 0) return;
        for (int id : ids) update(context, manager, id);
        manager.notifyAppWidgetViewDataChanged(ids, R.id.widget_list);
    }

    @SuppressWarnings("deprecation") // setRemoteAdapter(int, Intent): RemoteCollectionItems needs API 31.
    private static void update(Context context, AppWidgetManager manager, int id) {
        String list = listOf(context, id);
        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_task_list);
        views.setTextViewText(R.id.widget_title, ALL.equals(list) ? context.getString(R.string.widget_all_lists) : list);

        Intent adapter = new Intent(context, TaskListWidgetService.class).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        adapter.setData(Uri.parse(adapter.toUri(Intent.URI_INTENT_SCHEME)));
        views.setRemoteAdapter(R.id.widget_list, adapter);
        views.setEmptyView(R.id.widget_list, R.id.widget_empty);
        JSONObject snapshot = snapshot(context);
        views.setTextViewText(R.id.widget_empty, context.getString(
            snapshot == null ? R.string.widget_no_snapshot
                : !ALL.equals(list) && !lists(context).contains(list) ? R.string.widget_missing_list
                : R.string.widget_no_tasks));

        // Distinct request codes per widget and target: PendingIntents that differ only in extras are shared.
        Intent choose = new Intent(context, TaskListWidgetConfigure.class)
            .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        views.setOnClickPendingIntent(R.id.widget_header, PendingIntent.getActivity(context, id * 4,
            choose, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        views.setOnClickPendingIntent(R.id.widget_add, PendingIntent.getActivity(context, id * 4 + 1,
            MainActivity.shortcutIntent(context, "new-task", list, null), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        views.setOnClickPendingIntent(R.id.widget_empty, PendingIntent.getActivity(context, id * 4 + 2,
            MainActivity.shortcutIntent(context, "open-list", list, null), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        // Mutable so each row can fill in its task id.
        views.setPendingIntentTemplate(R.id.widget_list, PendingIntent.getActivity(context, id * 4 + 3,
            MainActivity.shortcutIntent(context, "open-task", list, null), PendingIntent.FLAG_MUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        manager.updateAppWidget(id, views);
    }

    /** The widget's open tasks in the app's order. */
    static List<JSONObject> rows(Context context, int id) {
        List<JSONObject> rows = new ArrayList<>();
        JSONObject snapshot = snapshot(context);
        if (snapshot == null) return rows;
        String list = listOf(context, id);
        JSONArray tasks = snapshot.optJSONArray("tasks");
        if (tasks == null) return rows;
        if (ALL.equals(list)) {
            Map<String, JSONObject> byId = new HashMap<>();
            for (int i = 0; i < tasks.length(); i++) {
                JSONObject task = tasks.optJSONObject(i);
                if (task != null) byId.put(task.optString("id"), task);
            }
            JSONArray order = snapshot.optJSONArray("allOrder");
            for (int i = 0; order != null && i < order.length() && rows.size() < MAX_ROWS; i++) {
                JSONObject task = byId.remove(order.optString(i));
                if (task != null) rows.add(task);
            }
            return rows;
        }
        for (int i = 0; i < tasks.length() && rows.size() < MAX_ROWS; i++) {
            JSONObject task = tasks.optJSONObject(i);
            if (task != null && list.equals(task.optString("list"))) rows.add(task);
        }
        return rows;
    }

    /** Like the app: "3d overdue", "Today", "Tomorrow", "In 5d", then the date; plus the time. */
    static String dueLabel(String due, String time, LocalDate today) {
        LocalDate date = LocalDate.parse(due);
        long days = ChronoUnit.DAYS.between(today, date);
        String label = days < 0 ? -days + "d overdue"
            : days == 0 ? "Today"
            : days == 1 ? "Tomorrow"
            : days <= 7 ? "In " + days + "d"
            : date.format(DateTimeFormatter.ofPattern(date.getYear() == today.getYear() ? "MMM d" : "MMM d, yyyy", Locale.US));
        return time == null ? label : label + " " + time;
    }

    private static AtomicFile snapshotFile(Context context) {
        return new AtomicFile(new File(context.getFilesDir(), "widget-snapshot.json"));
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences("widgets", Context.MODE_PRIVATE);
    }
}
