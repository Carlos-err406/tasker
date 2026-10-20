package org.tasker.android;

import android.appwidget.AppWidgetManager;
import android.content.Context;
import android.content.Intent;
import android.view.View;
import android.widget.RemoteViews;
import android.widget.RemoteViewsService;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONObject;

/** Rows for {@link TaskListWidget}. */
public final class TaskListWidgetService extends RemoteViewsService {
    @Override public RemoteViewsFactory onGetViewFactory(Intent intent) {
        return new Rows(getApplicationContext(), intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID));
    }

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

            String due = task.isNull("due") ? null : task.optString("due");
            String time = task.isNull("time") ? null : task.optString("time");
            views.setViewVisibility(R.id.widget_item_due, due == null ? View.GONE : View.VISIBLE);
            if (due != null) {
                String label;
                try { label = TaskListWidget.dueLabel(due, time, today); }
                catch (RuntimeException badDate) { label = due; }
                views.setTextViewText(R.id.widget_item_due, label);
                // Rows are recycled, so always set the color.
                int compare = due.compareTo(today.toString());
                views.setTextColor(R.id.widget_item_due, context.getColor(
                    compare < 0 ? R.color.widget_overdue : compare == 0 ? R.color.widget_today : R.color.widget_muted));
            }
            views.setOnClickFillInIntent(R.id.widget_item, new Intent().putExtra("task", task.optString("id")));
            return views;
        }

        @Override public RemoteViews getLoadingView() { return null; }
        @Override public int getViewTypeCount() { return 1; }
        @Override public long getItemId(int position) { return position; }
        @Override public boolean hasStableIds() { return false; }
    }
}
