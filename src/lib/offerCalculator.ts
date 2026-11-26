import type { Brand, MenuItem, Offer, OfferSlot } from '../types/data';

export type PresetMode = 'max' | 'default';
export type MetricObjective = 'kcal' | 'protein';

export interface OfferBounds {
  maxSelections: Record<string, string>;
  minSelections: Record<string, string>;
  maxProteinSelections: Record<string, string>;
  minKcal: number;
  maxKcal: number;
  minKcalPerPln: number;
  maxKcalPerPln: number;
  minProteinG: number;
  maxProteinG: number;
  minProteinPerPln: number;
  maxProteinPerPln: number;
}

export interface ResolvedOffer {
  offer: Offer;
  brand: Brand;
  selections: Record<string, string>;
  items: { slot: OfferSlot; item: MenuItem; priceDeltaPln: number }[];
  totalKcal: number;
  totalKj: number;
  totalPricePln: number;
  kcalPerPln: number;
  proteinPerPln: number;
  proteinPer1000Kcal: number;
  totalProteinG: number;
  totalFatG: number;
  totalSatFatG: number;
  totalCarbsG: number;
  totalSugarsG: number;
  totalSaltG: number;
  minKcal: number;
  maxKcal: number;
  minKcalPerPln: number;
  maxKcalPerPln: number;
  minProteinG: number;
  maxProteinG: number;
  minProteinPerPln: number;
  maxProteinPerPln: number;
  isCustomizable: boolean;
}

export function getDefaultSelections(offer: Offer): Record<string, string> {
  const map: Record<string, string> = {};
  for (const slot of offer.slots) {
    map[slot.id] = slot.defaultItemId;
  }
  return map;
}

export function getBestValueSelections(
  offer: Offer,
  itemsById: Map<string, MenuItem>,
  objective: 'max' | 'min' = 'max',
  metric: MetricObjective = 'kcal',
): Record<string, string> {
  const totalCombos = offer.slots.reduce((acc, s) => acc * Math.max(1, s.options.length), 1);
  const getVal = (item: MenuItem) =>
    metric === 'protein' ? item.nutrition.proteinG : item.nutrition.kcal;

  if (totalCombos <= 2000) {
    let bestSelections = getDefaultSelections(offer);
    let bestRatio = objective === 'max' ? -Infinity : Infinity;

    const recurse = (
      idx: number,
      current: Record<string, string>,
      valSum: number,
      priceSum: number,
    ) => {
      if (idx === offer.slots.length) {
        const ratio = priceSum > 0 ? valSum / priceSum : 0;
        if (objective === 'max' ? ratio > bestRatio : ratio < bestRatio) {
          bestRatio = ratio;
          bestSelections = { ...current };
        }
        return;
      }
      const slot = offer.slots[idx];
      if (slot.options.length === 0) {
        recurse(idx + 1, current, valSum, priceSum);
        return;
      }
      const qty = slot.quantity ?? 1;
      for (const opt of slot.options) {
        const item = itemsById.get(opt.itemId);
        if (!item) continue;
        current[slot.id] = opt.itemId;
        recurse(
          idx + 1,
          current,
          valSum + getVal(item) * qty,
          priceSum + (opt.priceDeltaPln ?? 0),
        );
      }
    };

    recurse(0, {}, 0, offer.pricePln);
    return bestSelections;
  }

  // Greedy fallback for very large combinatorial menus
  const map = getDefaultSelections(offer);
  for (const slot of offer.slots) {
    if (slot.options.length === 0) continue;
    const qty = slot.quantity ?? 1;
    let chosen = slot.defaultItemId;
    let bestScore = objective === 'max' ? -Infinity : Infinity;
    for (const opt of slot.options) {
      const item = itemsById.get(opt.itemId);
      if (!item) continue;
      const denom = Math.max(0.01, offer.pricePln + (opt.priceDeltaPln ?? 0));
      const score = (getVal(item) * qty) / denom;
      if (objective === 'max' ? score > bestScore : score < bestScore) {
        bestScore = score;
        chosen = opt.itemId;
      }
    }
    map[slot.id] = chosen;
  }
  return map;
}

function evaluateSelections(
  offer: Offer,
  itemsById: Map<string, MenuItem>,
  selections: Record<string, string>,
): { kcal: number; proteinG: number; price: number; kcalRatio: number; proteinRatio: number } {
  let kcal = 0;
  let proteinG = 0;
  let price = offer.pricePln;
  for (const slot of offer.slots) {
    if (slot.options.length === 0) continue;
    const selectedId = selections[slot.id] ?? slot.defaultItemId;
    const opt = slot.options.find((o) => o.itemId === selectedId) ?? slot.options[0];
    if (!opt) continue;
    const item = itemsById.get(opt.itemId);
    const qty = slot.quantity ?? 1;
    if (item) {
      kcal += item.nutrition.kcal * qty;
      proteinG += item.nutrition.proteinG * qty;
    }
    price += opt.priceDeltaPln ?? 0;
  }
  return {
    kcal,
    proteinG,
    price,
    kcalRatio: price > 0 ? kcal / price : 0,
    proteinRatio: price > 0 ? proteinG / price : 0,
  };
}

export function computeOfferBounds(offer: Offer, itemsById: Map<string, MenuItem>): OfferBounds {
  const maxSelections = getBestValueSelections(offer, itemsById, 'max', 'kcal');
  const minSelections = getBestValueSelections(offer, itemsById, 'min', 'kcal');
  const maxProteinSelections = getBestValueSelections(offer, itemsById, 'max', 'protein');
  const minProteinSelections = getBestValueSelections(offer, itemsById, 'min', 'protein');

  let minKcal = 0;
  let maxKcal = 0;
  let minProteinG = 0;
  let maxProteinG = 0;
  for (const slot of offer.slots) {
    const qty = slot.quantity ?? 1;
    const slotKcals = slot.options
      .map((o) => itemsById.get(o.itemId)?.nutrition.kcal)
      .filter((k): k is number => typeof k === 'number')
      .map((k) => k * qty);
    if (slotKcals.length > 0) {
      minKcal += Math.min(...slotKcals);
      maxKcal += Math.max(...slotKcals);
    }
    const slotProt = slot.options
      .map((o) => itemsById.get(o.itemId)?.nutrition.proteinG)
      .filter((p): p is number => typeof p === 'number')
      .map((p) => p * qty);
    if (slotProt.length > 0) {
      minProteinG += Math.min(...slotProt);
      maxProteinG += Math.max(...slotProt);
    }
  }

  const maxEval = evaluateSelections(offer, itemsById, maxSelections);
  const minEval = evaluateSelections(offer, itemsById, minSelections);
  const maxProtEval = evaluateSelections(offer, itemsById, maxProteinSelections);
  const minProtEval = evaluateSelections(offer, itemsById, minProteinSelections);

  return {
    maxSelections,
    minSelections,
    maxProteinSelections,
    minKcal: Math.round(minKcal),
    maxKcal: Math.round(maxKcal),
    minKcalPerPln: minEval.kcalRatio,
    maxKcalPerPln: maxEval.kcalRatio,
    minProteinG: Number(minProteinG.toFixed(1)),
    maxProteinG: Number(maxProteinG.toFixed(1)),
    minProteinPerPln: minProtEval.proteinRatio,
    maxProteinPerPln: maxProtEval.proteinRatio,
  };
}

export function resolveOffer(
  offer: Offer,
  brandsById: Map<string, Brand>,
  itemsById: Map<string, MenuItem>,
  selections: Record<string, string>,
  bounds?: OfferBounds,
): ResolvedOffer {
  const brand: Brand = brandsById.get(offer.brandId) ?? {
    id: offer.brandId,
    name: offer.brandId,
    shortName: offer.brandId,
    accentColor: '#374151',
    officialSite: '',
    nutritionSourceId: '',
  };

  const resolvedItems: { slot: OfferSlot; item: MenuItem; priceDeltaPln: number }[] = [];
  let totalKcal = 0;
  let totalKj = 0;
  let totalPricePln = offer.pricePln;
  let totalProteinG = 0;
  let totalFatG = 0;
  let totalSatFatG = 0;
  let totalCarbsG = 0;
  let totalSugarsG = 0;
  let totalSaltG = 0;

  for (const slot of offer.slots) {
    if (slot.options.length === 0) continue;
    const selectedId = selections[slot.id] ?? slot.defaultItemId;
    const opt = slot.options.find((o) => o.itemId === selectedId) ?? slot.options[0];
    if (!opt) continue;
    const item = itemsById.get(opt.itemId);
    if (!item) continue;

    const qty = slot.quantity ?? 1;
    const delta = opt.priceDeltaPln ?? 0;

    resolvedItems.push({ slot, item, priceDeltaPln: delta });
    totalKcal += item.nutrition.kcal * qty;
    totalKj += (item.nutrition.kj ?? Math.round(item.nutrition.kcal * 4.184)) * qty;
    totalPricePln += delta;
    totalProteinG += item.nutrition.proteinG * qty;
    totalFatG += item.nutrition.fatG * qty;
    totalSatFatG += (item.nutrition.satFatG ?? 0) * qty;
    totalCarbsG += item.nutrition.carbsG * qty;
    totalSugarsG += (item.nutrition.sugarsG ?? 0) * qty;
    totalSaltG += (item.nutrition.saltG ?? 0) * qty;
  }

  const computedBounds = bounds ?? computeOfferBounds(offer, itemsById);
  const isCustomizable = offer.slots.some((s) => s.options.length > 1);
  const roundedKcal = Math.round(totalKcal);

  return {
    offer,
    brand,
    selections,
    items: resolvedItems,
    totalKcal: roundedKcal,
    totalKj: Math.round(totalKj),
    totalPricePln: Number(totalPricePln.toFixed(2)),
    kcalPerPln: totalPricePln > 0 ? totalKcal / totalPricePln : 0,
    proteinPerPln: totalPricePln > 0 ? totalProteinG / totalPricePln : 0,
    proteinPer1000Kcal: roundedKcal > 0 ? (totalProteinG / roundedKcal) * 1000 : 0,
    totalProteinG: Number(totalProteinG.toFixed(1)),
    totalFatG: Number(totalFatG.toFixed(1)),
    totalSatFatG: Number(totalSatFatG.toFixed(1)),
    totalCarbsG: Number(totalCarbsG.toFixed(1)),
    totalSugarsG: Number(totalSugarsG.toFixed(1)),
    totalSaltG: Number(totalSaltG.toFixed(2)),
    minKcal: computedBounds.minKcal,
    maxKcal: computedBounds.maxKcal,
    minKcalPerPln: computedBounds.minKcalPerPln,
    maxKcalPerPln: computedBounds.maxKcalPerPln,
    minProteinG: computedBounds.minProteinG,
    maxProteinG: computedBounds.maxProteinG,
    minProteinPerPln: computedBounds.minProteinPerPln,
    maxProteinPerPln: computedBounds.maxProteinPerPln,
    isCustomizable,
  };
}

export function formatPln(val: number): string {
  return val.toLocaleString('pl-PL', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatRatio(val: number): string {
  return val.toLocaleString('pl-PL', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

export function formatInt(val: number): string {
  return Math.round(val).toLocaleString('pl-PL');
}
