package org.tasker.android;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.util.AtomicFile;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.function.Predicate;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Due-time reminders. The page hands over the upcoming occurrences after every change
 * and sync; this keeps one inexact alarm for the earliest and posts each occurrence
 * once, even while Tasker is closed. The same receiver handles the alarm, reboot and
 * app updates. Alarms are exact (USE_EXACT_ALARM); if the system ever refuses, an
 * inexact one still fires, though Android may hold it back by half an hour or more.
 */
public final class Reminders extends BroadcastReceiver {
    static final String ACTION_ALARM = "org.tasker.android.REMINDER";
    private static final String CHANNEL = "reminders";
    /** Reminders missed while the phone was off are still shown up to this late, like on the Mac. */
    private static final long MAX_LATENESS_MS = 12L * 60 * 60 * 1000;

    @Override public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (ACTION_ALARM.equals(action) || Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action))
            check(context);
    }

    /** Replaces the schedule with the page's list, then delivers anything already due. */
    static void schedule(Context context, String json) {
        AtomicFile file = scheduleFile(context);
        FileOutputStream out = null;
        try {
            new JSONArray(json);
            out = file.startWrite();
            out.write(json.getBytes(StandardCharsets.UTF_8));
            file.finishWrite(out);
        } catch (Exception error) {
            if (out != null) file.failWrite(out);
            return;
        }
        check(context);
    }

    static boolean hasReminders(Context context) {
        JSONArray reminders = load(context);
        return reminders != null && reminders.length() > 0;
    }

    /** What a check does: the occurrences to post, the delivered set to keep, and the next alarm time. */
    record Plan(List<JSONObject> post, Set<String> delivered, long next) {}

    /**
     * Pure decision for one check. Due occurrences are delivered once (posted only if at most
     * 12 hours late and the task is still open); keys no longer scheduled are forgotten.
     */
    static Plan plan(JSONArray reminders, Set<String> deliveredBefore, long now, Predicate<JSONObject> stillOpen) {
        List<JSONObject> post = new ArrayList<>();
        Set<String> delivered = new HashSet<>(deliveredBefore), scheduled = new HashSet<>();
        long next = Long.MAX_VALUE;
        for (int i = 0; i < reminders.length(); i++) {
            JSONObject reminder = reminders.optJSONObject(i);
            if (reminder == null) continue;
            String key = reminder.optString("key");
            long at = reminder.optLong("at");
            scheduled.add(key);
            if (delivered.contains(key)) continue;
            if (at > now) { next = Math.min(next, at); continue; }
            if (now - at <= MAX_LATENESS_MS && stillOpen.test(reminder)) post.add(reminder);
            delivered.add(key);
        }
        // Forget occurrences the page no longer schedules (done, moved or deleted).
        delivered.retainAll(scheduled);
        return new Plan(post, delivered, next);
    }

    /** Posts due occurrences that weren't delivered yet and arms the alarm for the next one. */
    static synchronized void check(Context context) {
        JSONArray reminders = load(context);
        if (reminders == null) return;
        SharedPreferences prefs = context.getSharedPreferences("reminders", Context.MODE_PRIVATE);
        File path = context.getDatabasePath("tasker.db");
        Plan plan = plan(reminders, prefs.getStringSet("delivered", new HashSet<>()), System.currentTimeMillis(),
            reminder -> stillOpen(path, reminder));
        for (JSONObject reminder : plan.post()) post(context, reminder);
        prefs.edit().putStringSet("delivered", plan.delivered()).apply();

        AlarmManager alarms = context.getSystemService(AlarmManager.class);
        PendingIntent alarm = PendingIntent.getBroadcast(context, 0,
            new Intent(context, Reminders.class).setAction(ACTION_ALARM), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        if (plan.next() == Long.MAX_VALUE) alarms.cancel(alarm);
        else if (android.os.Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms()) alarms.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, plan.next(), alarm);
        else alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, plan.next(), alarm);
    }

    /** Rechecks the task, so one completed, trashed or rescheduled since (here or by sync) doesn't notify. */
    static boolean stillOpen(File database, JSONObject reminder) {
        if (!database.exists()) return false;
        try (SQLiteDatabase db = SQLiteDatabase.openDatabase(database.getPath(), null, SQLiteDatabase.OPEN_READWRITE);
             Cursor row = db.rawQuery("SELECT status, is_trashed, due_date FROM tasks WHERE id=?", new String[]{reminder.optString("taskId")})) {
            if (!row.moveToFirst()) return false;
            int status = row.getInt(0);
            return (status == 0 || status == 1) && row.getInt(1) == 0
                && reminder.optString("key").contains("@" + row.getString(2) + "T");
        } catch (Exception unreadable) {
            // Better a reminder for a task that just changed than a missed one.
            return true;
        }
    }

    private static void post(Context context, JSONObject reminder) {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel(CHANNEL,
            context.getString(R.string.reminders_channel), NotificationManager.IMPORTANCE_HIGH));
        String key = reminder.optString("key");
        String time = reminder.isNull("time") ? null : reminder.optString("time");
        String list = reminder.optString("list");
        Intent open = MainActivity.shortcutIntent(context, "open-task", null, reminder.optString("taskId"));
        Notification notification = new Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(reminder.optString("title"))
            .setContentText(time == null ? list : time + " · " + list)
            .setWhen(reminder.optLong("at"))
            .setShowWhen(true)
            .setCategory(Notification.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(PendingIntent.getActivity(context, key.hashCode(), open,
                PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT))
            .build();
        manager.notify(key.hashCode(), notification);
    }

    private static JSONArray load(Context context) {
        try { return new JSONArray(new String(scheduleFile(context).readFully(), StandardCharsets.UTF_8)); }
        catch (Exception error) { return null; }
    }

    private static AtomicFile scheduleFile(Context context) {
        return new AtomicFile(new File(context.getFilesDir(), "reminders.json"));
    }
}
