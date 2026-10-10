import type { ActivityItem, SystemStatus } from "@/types";

export const MOCK_ACTIVITY: ActivityItem[] = [
  { id: "a1", clientId: "cl_mathanet", kind: "reply_approved", message: "approved 4 AI replies on the saffron cashew post", messageAr: "وافق على ٤ ردود ذكية في منشور الكاجو بالزعفران", at: "2026-10-06T11:42:00+03:00" },
  { id: "a2", clientId: "cl_mathanet", kind: "dm_rule_triggered", message: "“price” rule sent 18 DMs this morning", messageAr: "قاعدة «السعر» أرسلت ١٨ رسالة هذا الصباح", at: "2026-10-06T10:30:00+03:00" },
  { id: "a3", clientId: "cl_cafe", kind: "connection_issue", message: "Instagram token expires in 3 days — reconnect required", messageAr: "صلاحية ربط إنستغرام تنتهي خلال ٣ أيام — يلزم إعادة الربط", at: "2026-10-06T08:15:00+03:00" },
  { id: "a4", clientId: "cl_cafe", kind: "post_published", message: "published “Saffron cake + Spanish latte”", messageAr: "نشر «كيكة الزعفران + سبانش لاتيه»", at: "2026-10-06T08:10:00+03:00" },
  { id: "a5", clientId: "cl_mathanet", kind: "experiment_finished", message: "posting experiment found a +34% evening opportunity", messageAr: "تجربة النشر وجدت فرصة مسائية بزيادة ٣٤٪", at: "2026-10-05T23:00:00+03:00" },
  { id: "a6", clientId: "cl_boutique", kind: "connection_issue", message: "Instagram account disconnected by the owner", messageAr: "تم فصل حساب إنستغرام من قبل المالك", at: "2026-10-03T19:40:00+03:00" },
  { id: "a7", clientId: "cl_boutique", kind: "plan_changed", message: "moved to the Starter plan", messageAr: "انتقل إلى الباقة الأساسية", at: "2026-10-01T12:00:00+03:00" },
];

export const MOCK_SYSTEM_STATUS: SystemStatus = {
  instagramApi: { status: "operational", latencyMs: 182, uptimePct: 99.96, checkedAt: "2026-10-06T11:58:00+03:00" },
  webhooks: { status: "degraded", lastEventAt: "2026-10-06T11:57:12+03:00", deliveredToday: 1284, failedToday: 17 },
  rateLimits: [
    { clientId: "cl_mathanet", used: 148, limit: 200, resetsAt: "2026-10-06T12:00:00+03:00" },
    { clientId: "cl_cafe", used: 61, limit: 200, resetsAt: "2026-10-06T12:00:00+03:00" },
    { clientId: "cl_boutique", used: 0, limit: 200, resetsAt: "2026-10-06T12:00:00+03:00" },
  ],
};
