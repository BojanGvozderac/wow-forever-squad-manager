export const regions = ["eu", "us", "kr", "tw", "cn"] as const;
export type Region = (typeof regions)[number];
export const regionLabels: Record<Region, string> = {
  eu: "Europe",
  us: "Americas & Oceania",
  kr: "Korea",
  tw: "Taiwan",
  cn: "China",
};
