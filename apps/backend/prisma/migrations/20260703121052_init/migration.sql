-- CreateTable
CREATE TABLE "Zone" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "mqtt_topic_cmd" TEXT NOT NULL,
    "mqtt_topic_status" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "moisture_threshold" INTEGER,
    "ignore_rain" BOOLEAN NOT NULL DEFAULT false,
    "default_duration" INTEGER NOT NULL DEFAULT 15
);

-- CreateTable
CREATE TABLE "Schedule" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "zone_id" INTEGER NOT NULL,
    "time_of_day" TEXT NOT NULL,
    "duration_mins" INTEGER NOT NULL,
    "day_sunday" BOOLEAN NOT NULL DEFAULT false,
    "day_monday" BOOLEAN NOT NULL DEFAULT false,
    "day_tuesday" BOOLEAN NOT NULL DEFAULT false,
    "day_wednesday" BOOLEAN NOT NULL DEFAULT false,
    "day_thursday" BOOLEAN NOT NULL DEFAULT false,
    "day_friday" BOOLEAN NOT NULL DEFAULT false,
    "day_saturday" BOOLEAN NOT NULL DEFAULT false,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Schedule_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "Zone" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "History" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "zone_id" INTEGER NOT NULL,
    "start_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "end_time" DATETIME,
    "trigger_source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "water_used_l" REAL,
    CONSTRAINT "History_zone_id_fkey" FOREIGN KEY ("zone_id") REFERENCES "Zone" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Zone_mqtt_topic_cmd_key" ON "Zone"("mqtt_topic_cmd");

-- CreateIndex
CREATE UNIQUE INDEX "Zone_mqtt_topic_status_key" ON "Zone"("mqtt_topic_status");
