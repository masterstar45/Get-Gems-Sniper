import { pgTable, serial, text, real, integer, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const priorityEnum = pgEnum("priority", ["high", "normal"]);

export const dealsTable = pgTable("deals", {
  id: serial("id").primaryKey(),
  nftName: text("nft_name").notNull(),
  collectionName: text("collection_name").notNull(),
  collectionSlug: text("collection_slug").notNull(),
  currentPrice: real("current_price").notNull(),
  floorPrice: real("floor_price").notNull(),
  discountPercent: real("discount_percent").notNull(),
  score: integer("score").notNull(),
  priority: priorityEnum("priority").notNull().default("normal"),
  link: text("link").notNull(),
  imageUrl: text("image_url"),
  isActive: boolean("is_active").notNull().default(true),
  alertSent: boolean("alert_sent").notNull().default(false),
  detectedAt: timestamp("detected_at").notNull().defaultNow(),
});

export const insertDealSchema = createInsertSchema(dealsTable).omit({ id: true, detectedAt: true });
export type InsertDeal = z.infer<typeof insertDealSchema>;
export type Deal = typeof dealsTable.$inferSelect;
