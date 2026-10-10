import { boutiquePack } from "./boutique";
import { cafePack } from "./cafe";
import { mathanetPack } from "./mathanet";
import type { ClientDataPack } from "./types";

export type { ClientDataPack } from "./types";

export const CLIENT_DATA: Record<string, ClientDataPack> = {
  cl_mathanet: mathanetPack,
  cl_cafe: cafePack,
  cl_boutique: boutiquePack,
};
