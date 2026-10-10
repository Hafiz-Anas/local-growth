import { NotAvailable } from "@/components/shared/not-available";

/** Shown inside the user shell — e.g. when a route's feature is turned off for this client. */
export default function UserNotFound() {
  return <NotAvailable homeHref="/dashboard" />;
}
