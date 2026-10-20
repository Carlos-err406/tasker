package org.tasker.android;

import android.app.Activity;
import android.app.AlertDialog;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProviderInfo;
import android.content.Intent;
import android.content.res.Configuration;
import android.os.Bundle;
import java.util.ArrayList;
import java.util.List;

/** Picks the list a {@link TaskListWidget} shows: when it's added, or by tapping its name. */
public final class TaskListWidgetConfigure extends Activity {
    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        int id = getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID);
        Intent result = new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id);
        setResult(RESULT_CANCELED, result);
        // Exported for the launcher, so only act on this app's own widgets.
        AppWidgetProviderInfo info = AppWidgetManager.getInstance(this).getAppWidgetInfo(id);
        if (info == null || !getPackageName().equals(info.provider.getPackageName())) {
            finish();
            return;
        }

        List<String> lists = TaskListWidget.lists(this);
        if (lists.isEmpty()) lists.add(TaskListWidget.listOf(this, id));
        List<String> values = new ArrayList<>();
        values.add(TaskListWidget.ALL);
        values.addAll(lists);
        String current = TaskListWidget.listOf(this, id);
        String[] labels = new String[values.size()];
        for (int i = 0; i < labels.length; i++)
            labels[i] = TaskListWidget.ALL.equals(values.get(i)) ? getString(R.string.widget_all_lists) : values.get(i);

        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
        new AlertDialog.Builder(this, night ? android.R.style.Theme_DeviceDefault_Dialog_Alert : android.R.style.Theme_DeviceDefault_Light_Dialog_Alert)
            .setTitle(R.string.widget_choose_list)
            .setSingleChoiceItems(labels, values.indexOf(current), (dialog, which) -> {
                TaskListWidget.setList(this, id, values.get(which));
                setResult(RESULT_OK, result);
                dialog.dismiss();
            })
            .setOnDismissListener(dialog -> finish())
            .show();
    }
}
