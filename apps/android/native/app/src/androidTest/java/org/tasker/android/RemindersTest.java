package org.tasker.android;

import android.database.sqlite.SQLiteDatabase;
import android.test.AndroidTestCase;
import java.io.File;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/** Only a temporary fixture database; never posts notifications, sets alarms or opens tasker.db. */
public final class RemindersTest extends AndroidTestCase {
    private static final long HOUR = 60 * 60 * 1000L;
    private static final long NOW = 1_800_000_000_000L;
    private File root;

    @Override protected void setUp() throws Exception {
        super.setUp();
        root = new File(getContext().getCacheDir(), "reminder-tests-" + UUID.randomUUID());
        assertTrue(root.mkdir());
    }

    @Override protected void tearDown() throws Exception {
        BackupStore.remove(root);
        super.tearDown();
    }

    private static JSONObject reminder(String taskId, String date, long at) throws Exception {
        return new JSONObject().put("key", taskId + "@" + date + "T09:00").put("taskId", taskId)
            .put("title", taskId).put("list", "tasks").put("at", at).put("time", JSONObject.NULL);
    }

    public void testPostsDueOnceSkipsStaleAndArmsTheNext() throws Exception {
        JSONArray schedule = new JSONArray()
            .put(reminder("due", "2026-01-01", NOW - HOUR))
            .put(reminder("stale", "2026-01-01", NOW - 13 * HOUR))
            .put(reminder("later", "2026-01-02", NOW + 2 * HOUR))
            .put(reminder("soon", "2026-01-02", NOW + HOUR));
        Reminders.Plan first = Reminders.plan(schedule, Set.of("gone@2026-01-01T09:00"), NOW, r -> true);
        assertEquals(List.of("due"), first.post().stream().map(r -> r.optString("taskId")).collect(java.util.stream.Collectors.toList()));
        assertEquals(Set.of("due@2026-01-01T09:00", "stale@2026-01-01T09:00"), first.delivered());
        assertEquals(NOW + HOUR, first.next());

        Reminders.Plan again = Reminders.plan(schedule, first.delivered(), NOW + 1000, r -> true);
        assertTrue(again.post().isEmpty());

        Reminders.Plan none = Reminders.plan(new JSONArray(), first.delivered(), NOW, r -> true);
        assertEquals(Long.MAX_VALUE, none.next());
        assertTrue(none.delivered().isEmpty());
    }

    public void testTasksNoLongerOpenAreMarkedDeliveredButNotPosted() throws Exception {
        JSONArray schedule = new JSONArray().put(reminder("done", "2026-01-01", NOW - HOUR));
        Reminders.Plan plan = Reminders.plan(schedule, Set.of(), NOW, r -> false);
        assertTrue(plan.post().isEmpty());
        assertEquals(Set.of("done@2026-01-01T09:00"), plan.delivered());
    }

    public void testRechecksStatusTrashAndDateInTheDatabase() throws Exception {
        File file = new File(root, "fixture.db");
        try (SQLiteDatabase db = SQLiteDatabase.openOrCreateDatabase(file, null)) {
            db.execSQL("CREATE TABLE tasks (id TEXT PRIMARY KEY, status INTEGER, is_trashed INTEGER, due_date TEXT)");
            db.execSQL("INSERT INTO tasks VALUES ('open','0','0','2026-01-01'), ('wip','1','0','2026-01-01'), ('done','2','0','2026-01-01'), ('trashed','0','1','2026-01-01'), ('moved','0','0','2026-01-05')");
        }
        assertTrue(Reminders.stillOpen(file, reminder("open", "2026-01-01", NOW)));
        assertTrue(Reminders.stillOpen(file, reminder("wip", "2026-01-01", NOW)));
        assertFalse(Reminders.stillOpen(file, reminder("done", "2026-01-01", NOW)));
        assertFalse(Reminders.stillOpen(file, reminder("trashed", "2026-01-01", NOW)));
        assertFalse(Reminders.stillOpen(file, reminder("moved", "2026-01-01", NOW)));
        assertFalse(Reminders.stillOpen(file, reminder("missing", "2026-01-01", NOW)));
        assertFalse(Reminders.stillOpen(new File(root, "absent.db"), reminder("open", "2026-01-01", NOW)));
    }
}
