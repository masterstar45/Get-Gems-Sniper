import { pgTable, serial, text, real, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const botConfigTable = pgTable("bot_config", {
  id: serial("id").primaryKey(),
  telegramToken: text("telegram_token"),
  chatId: text("chat_id"),
  scanInterval: integer("scan_interval").notNull().default(5),
  dealThreshold: real("deal_threshold").notNull().default(30),
  priorityThreshold: real("priority_threshold").notNull().default(50),
  isRunning: boolean("is_running").notNull().default(false),
  totalScans: integer("total_scans").notNull().default(0),
  totalAlertsSet: integer("total_alerts_sent").notNull().default(0),
  lastActivity: timestamp("last_activity"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertBotConfigSchema = createInsertSchema(botConfigTable).omit({ id: true, updatedAt: true });
export type InsertBotConfig = z.infer<typeof insertBotConfigSchema>;
export type BotConfig = typeof botConfigTable.$inferSelect;
