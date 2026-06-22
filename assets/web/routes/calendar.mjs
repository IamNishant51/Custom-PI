import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { SHARED_PATHS } from "../shared-constants.mjs";

const { PI_DIR } = SHARED_PATHS;

export default function registerCalendar(app, { sendError }) {
  const CALENDAR_FILE = path.join(PI_DIR, "calendar-events.json");
  function loadCalendarEvents() {
    try { return JSON.parse(fs.readFileSync(CALENDAR_FILE, "utf8")); } catch { return []; }
  }
  function saveCalendarEvents(events) { fs.writeFileSync(CALENDAR_FILE, JSON.stringify(events, null, 2)); }

  app.get("/api/calendar/events", { schema: { response: { 200: { type: "object", properties: { events: { type: "array" } } } } } }, async () => {
    const events = loadCalendarEvents();
    const now = Date.now();
    return { events: events.filter(e => !e.end || e.end > now).sort((a, b) => (a.start || 0) - (b.start || 0)).slice(0, 100) };
  });

  app.post("/api/calendar/events", {
    schema: {
      body: { type: "object", required: ["title", "start"], properties: { title: { type: "string" }, start: { type: "number" }, end: { type: "number" }, description: { type: "string" }, location: { type: "string" } } },
      response: { 200: { type: "object", properties: { success: { type: "boolean" }, event: { type: "object" }, error: { type: "string" } } } },
    },
  }, async (req) => {
    const { title, start, end, description, location } = req.body || {};
    if (!title || !start) return { error: "title and start required" };
    const events = loadCalendarEvents();
    const event = { id: `cal_${Date.now()}`, title, start, end: end || start + 3600000, description: description || "", location: location || "", createdAt: Date.now() };
    events.push(event);
    saveCalendarEvents(events);
    return { success: true, event };
  });

  app.delete("/api/calendar/events/:id", { schema: { response: { 200: { type: "object", properties: { success: { type: "boolean" } } } } } }, async (req) => {
    saveCalendarEvents(loadCalendarEvents().filter(e => e.id !== req.params.id));
    return { success: true };
  });

  app.post("/api/calendar/caldav/sync", { schema: { body: { type: "object", additionalProperties: true, properties: { serverUrl: { type: "string" }, username: { type: "string" }, password: { type: "string" } } }, response: { 200: { type: "object", properties: { success: { type: "boolean" }, imported: { type: "number" }, error: { type: "string" } } } } } }, async (req) => {
    const { serverUrl, username, password } = req.body || {};
    if (!serverUrl || !username) return { error: "serverUrl and username required" };
    try {
      const res = await fetch(`${serverUrl.replace(/\/$/, "")}/`, {
        headers: { "Authorization": "Basic " + Buffer.from(`${username}:${password || ""}`).toString("base64") },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return { error: `CalDAV returned ${res.status}` };
      const text = await res.text();
      const vevents = text.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
      const events = loadCalendarEvents();
      let imported = 0;
      for (const vevent of vevents) {
        const title = vevent.match(/SUMMARY:(.+)/i)?.[1]?.trim() || "Untitled";
        const dtStart = vevent.match(/DTSTART(?:;.*?)?:(.+)/i)?.[1]?.trim();
        const dtEnd = vevent.match(/DTEND(?:;.*?)?:(.+)/i)?.[1]?.trim();
        if (!dtStart) continue;
        const parseIcalDate = (s) => { const m = s.match(/(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?(\d{2})?/); return m ? new Date(m[1], m[2]-1, m[3]||1, m[4]||0, m[5]||0, m[6]||0).getTime() : Date.now(); };
        const id = `caldav_${crypto.createHash("md5").update(title + dtStart).digest("hex").slice(0, 12)}`;
        if (!events.find(e => e.id === id)) {
          events.push({ id, title, start: parseIcalDate(dtStart), end: dtEnd ? parseIcalDate(dtEnd) : parseIcalDate(dtStart) + 3600000, description: vevent.match(/DESCRIPTION:(.+)/i)?.[1]?.trim() || "", location: vevent.match(/LOCATION:(.+)/i)?.[1]?.trim() || "", createdAt: Date.now() });
          imported++;
        }
      }
      saveCalendarEvents(events);
      return { success: true, imported };
    } catch (e) { return { error: e.message, imported: 0 }; }
  });
}
