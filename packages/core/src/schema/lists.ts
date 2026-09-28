import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const lists = sqliteTable('lists', {
  name: text('name').primaryKey(),
  isCollapsed: integer('is_collapsed').default(0),
  hideCompleted: integer('hide_completed').default(0),
  /** Highest value = most recently created/moved */
  sortOrder: integer('sort_order').default(0),
  /** ISO timestamp of the last write; maintained by the desktop sync layer for last-write-wins. */
  updatedAt: text('updated_at'),
});
