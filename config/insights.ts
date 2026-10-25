/**
 * The Insights → Statistics tab (components/statistics/statistics-view.tsx, /api/statistics) is turned
 * off: its followers / reach / engagement numbers repeat Home and Weekly reports, and its range picker
 * is more than a business owner needs. Its one unique piece — which post types and weekdays work best —
 * now sits on Post performance ("What works best"). /statistics redirects there, and the admin page hides
 * the module's switch. The page, API routes, daily follower snapshots and the assistant's use of the
 * numbers stay; set this to true to bring the tab back.
 */
export const SHOW_STATISTICS = false;
