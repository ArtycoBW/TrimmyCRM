export type HairstyleAudience = "women" | "men" | "all";

export type HairstyleTemplate = {
  id: string;
  label: string;
  audience: HairstyleAudience[];
  asset: string;
  preview: string;
  anchor: {
    x: number;
    y: number;
    width: number;
  };
  author: string;
  rightsBasis: string;
  rightsDocument: string;
  sha256: string;
  productionApproved: boolean;
};

export type HairstyleManifest = {
  version: 1;
  templates: HairstyleTemplate[];
};

export type TryOnTransform = {
  x: number;
  y: number;
  width: number;
  rotation: number;
  mirrored: boolean;
  opacity: number;
};
