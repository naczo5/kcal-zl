export type OfferType = 'regular' | 'coupon';

export type VerificationStatus = 'official' | 'official-eu' | 'derived' | 'user';

export interface Brand {
  id: string;
  name: string;
  shortName: string;
  accentColor: string;
  officialSite: string;
  nutritionSourceId: string;
}

export interface ItemNutrition {
  kcal: number;
  kj?: number;
  proteinG: number;
  fatG: number;
  satFatG?: number;
  carbsG: number;
  sugarsG?: number;
  saltG?: number;
}

export interface MenuItem {
  id: string;
  brandId: string;
  name: string;
  category: 'burger' | 'wrap' | 'chicken' | 'fries' | 'drink' | 'dessert' | 'sauce';
  portionLabel: string;
  image?: string;
  nutrition: ItemNutrition;
  source: {
    sourceId: string;
    tableRowName: string;
    verified: VerificationStatus;
    note?: string;
  };
}

export interface OfferSlotOption {
  itemId: string;
  priceDeltaPln?: number;
  badge?: string;
}

export interface OfferSlot {
  id: string;
  label: string;
  quantity?: number;
  defaultItemId: string;
  options: OfferSlotOption[];
}

export interface Offer {
  id: string;
  brandId: string;
  name: string;
  offerType: OfferType;
  pricePln: number;
  priceNote?: string;
  description: string;
  image?: string;
  addedAt: string;
  validUntil?: string | null;
  source: {
    label: string;
    url?: string;
    priceVerifiedBy: 'regulamin' | 'user' | 'menu';
  };
  slots: OfferSlot[];
}

export interface OfficialSourceSummary {
  id: string;
  brandId: string;
  kind?: 'nutrition-official';
  title: string;
  sourceUrl: string;
  secondarySourceUrl?: string;
  fetchedAt: string;
  itemCount: number;
}

export interface CreatorCatalogItem {
  id: string;
  brandId: string;
  name: string;
  portionLabel?: string;
  categoryLabel: string;
  searchAlias?: string;
  image?: string;
  nutrition: ItemNutrition;
}
