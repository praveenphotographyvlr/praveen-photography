import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  serial,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core'

// ─── admins ──────────────────────────────────────────────────────────────────
export const admins = pgTable('admins', {
  id:           serial('id').primaryKey(),
  username:     text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  logoUrl:      text('logo_url').default('').notNull(),
})

// ─── customers ───────────────────────────────────────────────────────────────
export const customers = pgTable('customers', {
  id:               serial('id').primaryKey(),
  name:             text('name').notNull(),
  email:            text('email').notNull(),
  phone:            text('phone').notNull(),
  eventName:        text('event_name').notNull(),
  eventDate:        text('event_date').notNull(),
  accessCode:       text('access_code').notNull().unique(),
  folderId:         text('folder_id').notNull().unique(),
  createdAt:        timestamp('created_at').defaultNow().notNull(),
  photoCount:       integer('photo_count').default(0).notNull(),
  selectedCount:    integer('selected_count').default(0).notNull(),
  maxSelectCount:   integer('max_select_count').default(0).notNull(),
  selectionLocked:  boolean('selection_locked').default(false).notNull(),
  selectionLockedAt: timestamp('selection_locked_at'),
})

// ─── folders ─────────────────────────────────────────────────────────────────
export const folders = pgTable(
  'folders',
  {
    id:              serial('id').primaryKey(),
    customerId:      integer('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
    name:            text('name').notNull(),
    description:     text('description').default('').notNull(),
    photoCount:      integer('photo_count').default(0).notNull(),
    localSourcePath: text('local_source_path').default('').notNull(),
    createdAt:       timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    customerIdx: index('folders_customer_idx').on(t.customerId),
  })
)

// ─── photos ──────────────────────────────────────────────────────────────────
export const photos = pgTable(
  'photos',
  {
    id:                 serial('id').primaryKey(),
    customerId:         integer('customer_id').notNull().references(() => customers.id, { onDelete: 'cascade' }),
    folderDbId:         integer('folder_db_id').notNull().references(() => folders.id, { onDelete: 'cascade' }),
    folderName:         text('folder_name').default('').notNull(),
    originalName:       text('original_name').notNull(),
    mimeType:           text('mime_type').notNull(),
    size:               integer('size').default(0).notNull(),
    thumbnailUrl:       text('thumbnail_url').notNull(),
    r2ObjectKey:        text('r2_object_key').notNull(),
    isSelected:         boolean('is_selected').default(false).notNull(),
    selectedAt:         timestamp('selected_at'),
    savedToFolder:      boolean('saved_to_folder').default(false).notNull(),
    savedAt:            timestamp('saved_at'),
    uploadedAt:         timestamp('uploaded_at').defaultNow().notNull(),
  },
  (t) => ({
    customerIdx: index('photos_customer_idx').on(t.customerId),
    folderIdx:   index('photos_folder_idx').on(t.folderDbId),
  })
)

// ─── Inferred types ───────────────────────────────────────────────────────────
export type Admin    = typeof admins.$inferSelect
export type Customer = typeof customers.$inferSelect
export type Folder   = typeof folders.$inferSelect
export type Photo    = typeof photos.$inferSelect

export type NewAdmin    = typeof admins.$inferInsert
export type NewCustomer = typeof customers.$inferInsert
export type NewFolder   = typeof folders.$inferInsert
export type NewPhoto    = typeof photos.$inferInsert
