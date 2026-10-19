import "server-only";
import { locationLabel } from "@/config/kuwait";
import { db } from "@/lib/db";
import type { BusinessDetailsDto, ServiceMode } from "@/types";

/**
 * The business's name (from Instagram at sign-up), its main products / menu categories and its
 * location in Kuwait — onboarding's "Your location" and Settings → Business. Saving the location also refreshes the free-text
 * `location` / `locationAr` shown around the app.
 */

export interface LocationInput {
  governorate: string | null;
  area: string | null;
  serviceMode: ServiceMode | null;
}

const locationData = (input: LocationInput) => ({
  governorate: input.governorate,
  area: input.governorate ? input.area : null,
  serviceMode: input.serviceMode,
  // Only a picked governorate replaces the old free text (admin-created clients may have one).
  ...(input.governorate && { location: locationLabel(input.governorate, input.area, "en"), locationAr: locationLabel(input.governorate, input.area, "ar") }),
});

export async function saveLocation(businessId: string, input: LocationInput) {
  await db.business.update({ where: { id: businessId }, data: locationData(input) });
}

export async function saveBusinessDetails(businessId: string, input: LocationInput & { name: string; products?: string[] }) {
  await db.business.update({
    where: { id: businessId },
    data: { name: input.name, ...(input.products && { products: [...new Set(input.products)] }), ...locationData(input) },
  });
}

export async function getBusinessDetails(businessId: string): Promise<BusinessDetailsDto> {
  const b = await db.business.findUniqueOrThrow({ where: { id: businessId }, select: { name: true, products: true, governorate: true, area: true, serviceMode: true } });
  return { name: b.name, products: b.products, governorate: b.governorate, area: b.area, serviceMode: b.serviceMode as ServiceMode | null };
}
