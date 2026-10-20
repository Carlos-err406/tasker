package org.tasker.android;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.content.res.TypedArray;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.text.SpannableStringBuilder;
import android.text.Spanned;
import android.text.style.BackgroundColorSpan;
import android.text.style.ForegroundColorSpan;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONArray;
import org.json.JSONObject;

/** Rows for {@link TaskListWidget}. */
public final class TaskListWidgetService extends RemoteViewsService {
    @Override public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Rows(getApplicationContext(), intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID));
    }

    private static final int[] IMAGES = {R.id.widget_item_image_0, R.id.widget_item_image_1, R.id.widget_item_image_2};

    private static final class Rows implements RemoteViewsFactory {
        private final Context context;
        private final int widgetId;
        private List<JSONObject> rows = new ArrayList<>();
        private LocalDate today = LocalDate.now();

        Rows(Context context, int widgetId) {
            this.context = context;
            this.widgetId = widgetId;
        }

        @Override public void onCreate() {}
        @Override public void onDataSetChanged() {
            rows = TaskListWidget.rows(context, widgetId);
            today = LocalDate.now();
        }
        @Override public void onDestroy() { rows = new ArrayList<>(); }
        @Override public int getCount() { return rows.size(); }

        @Override public RemoteViews getViewAt(int position) {
            RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_task_item);
            if (position >= rows.size()) return views;
            JSONObject task = rows.get(position);
            views.setTextViewText(R.id.widget_item_title, task.optString("title"));
            views.setImageViewResource(R.id.widget_item_status,
                task.optInt("status") == 1 ? R.drawable.ic_widget_box_progress : R.drawable.ic_widget_box);

            int priority = task.isNull("priority") ? 0 : task.optInt("priority");
            views.setViewVisibility(R.id.widget_item_priority, priority == 0 ? View.GONE : View.VISIBLE);
            if (priority != 0) views.setImageViewResource(R.id.widget_item_priority,
                priority == 1 ? R.drawable.ic_widget_priority_high
                    : priority == 2 ? R.drawable.ic_widget_priority_medium
                    : R.drawable.ic_widget_priority_low);

            String notes = task.isNull("notes") ? "" : task.optString("notes");
            views.setTextViewText(R.id.widget_item_notes, notes);
            views.setViewVisibility(R.id.widget_item_notes, notes.isEmpty() ? View.GONE : View.VISIBLE);
            JSONArray images = task.optJSONArray("images");
            boolean anyImage = false;
            for (int i = 0; i < IMAGES.length; i++) {
                java.io.File file = images != null && i < images.length() ? TaskListWidget.thumbnail(context, images.optString(i)) : null;
                Bitmap thumb = file != null && file.isFile() ? BitmapFactory.decodeFile(file.getPath()) : null;
                views.setViewVisibility(IMAGES[i], thumb == null ? View.GONE : View.VISIBLE);
                if (thumb != null) { views.setImageViewBitmap(IMAGES[i], thumb); anyImage = true; }
            }
            views.setViewVisibility(R.id.widget_item_images, anyImage ? View.VISIBLE : View.GONE);
            CharSequence meta = meta(task);
            views.setTextViewText(R.id.widget_item_meta, meta);
            views.setViewVisibility(R.id.widget_item_meta, meta.length() == 0 ? View.GONE : View.VISIBLE);
            views.setOnClickFillInIntent(R.id.widget_item, new Intent().putExtra("task", task.optString("id")));
            return views;
        }

        /** Due date, repeat, links and tags on one line, colored like the app. */
        private CharSequence meta(JSONObject task) {
            SpannableStringBuilder meta = new SpannableStringBuilder();
            String due = task.isNull("due") ? null : task.optString("due");
            if (due != null) {
                String time = task.isNull("time") ? null : task.optString("time");
                String label;
                try { label = TaskListWidget.dueLabel(due, time, today); }
                catch (RuntimeException badDate) { label = due; }
                int compare = due.compareTo(today.toString());
                append(meta, label, compare < 0 ? R.color.widget_overdue : compare == 0 ? R.color.widget_today : 0);
                if (task.optBoolean("repeats")) meta.append(" ↻");
            }
            links(meta, task, "blockedBy", "⊘ Blocked by ", R.color.widget_in_progress);
            links(meta, task, "blocks", "⊘ Blocks ", R.color.widget_in_progress);
            String parent = task.isNull("parent") ? null : task.optString("parent");
            if (parent != null) { separate(meta); meta.append("↑ ").append(parent); }
            int subtasks = task.optInt("subtasks");
            if (subtasks > 0) { separate(meta); meta.append("↳ ").append(String.valueOf(subtasks)).append(subtasks == 1 ? " subtask" : " subtasks"); }
            links(meta, task, "related", "↔ ", 0);
            JSONArray tags = task.optJSONArray("tags");
            if (tags != null && tags.length() > 0) {
                separate(meta);
                // TypedArray is only AutoCloseable from API 31; minSdk is 30.
                TypedArray text = context.getResources().obtainTypedArray(R.array.widget_tag_text);
                TypedArray background = context.getResources().obtainTypedArray(R.array.widget_tag_background);
                for (int i = 0; i < tags.length(); i++) {
                    JSONObject tag = tags.optJSONObject(i);
                    if (tag == null) continue;
                    if (i > 0) meta.append(" ");
                    int color = Math.floorMod(tag.optInt("color"), text.length());
                    int start = meta.length();
                    meta.append("\u2009#").append(tag.optString("name")).append("\u2009");
                    meta.setSpan(new ForegroundColorSpan(text.getColor(color, 0)), start, meta.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                    meta.setSpan(new BackgroundColorSpan(background.getColor(color, 0)), start, meta.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
                }
                text.recycle();
                background.recycle();
            }
            return meta;
        }

        private void links(SpannableStringBuilder meta, JSONObject task, String key, String prefix, int color) {
            JSONArray titles = task.optJSONArray(key);
            if (titles == null || titles.length() == 0) return;
            List<String> names = new ArrayList<>();
            for (int i = 0; i < titles.length(); i++) names.add(titles.optString(i));
            separate(meta);
            append(meta, prefix + String.join(", ", names), color);
        }

        private void append(SpannableStringBuilder text, String part, int color) {
            int start = text.length();
            text.append(part);
            if (color != 0) text.setSpan(new ForegroundColorSpan(context.getColor(color)), start, text.length(), Spanned.SPAN_EXCLUSIVE_EXCLUSIVE);
        }

        private static void separate(SpannableStringBuilder text) {
            if (text.length() > 0) text.append("  ·  ");
        }

        @Override public RemoteViews getLoadingView() { return null; }
        @Override public int getViewTypeCount() { return 1; }
        @Override public long getItemId(int position) { return position; }
        @Override public boolean hasStableIds() { return false; }
    }
}
