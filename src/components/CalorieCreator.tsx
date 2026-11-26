import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { CornerDownLeft, Plus, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { formatInt, formatPln, formatRatio, type ResolvedOffer } from '../lib/offerCalculator';
import type { Brand, CreatorCatalogItem, ItemNutrition } from '../types/data';

type PriceMode = 'total' | 'per-item';

interface CreatorEntry {
  uid: string;
  catalogId?: string;
  brandId: string;
  name: string;
  portionLabel?: string;
  qty: number;
  unitPricePln: number | '';
  nutrition: ItemNutrition;
}

interface ParsedSegment {
  raw: string;
  qty: number;
  query: string;
}

interface CalorieCreatorProps {
  brands: Brand[];
  brandsById: Map<string, Brand>;
  catalog: CreatorCatalogItem[];
  rankedOffers: ResolvedOffer[];
  extendedMode: boolean;
}

const STORAGE_KEY = 'kcal-zl:creator:v1';

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[®™©]/g, '');
}

function parseSegment(raw: string): ParsedSegment {
  const trimmed = raw.trim();
  if (!trimmed) return { raw, qty: 1, query: '' };

  const prefixMatch = trimmed.match(/^(\d+)\s*[x×*]\s*(.*)$/i);
  if (prefixMatch) {
    const qty = Math.max(1, Math.min(99, Number(prefixMatch[1]) || 1));
    return { raw, qty, query: prefixMatch[2].trim() };
  }

  const suffixMatch = trimmed.match(/^(.*?)\s*[x×*]\s*(\d+)$/i);
  if (suffixMatch && suffixMatch[1].trim()) {
    const qty = Math.max(1, Math.min(99, Number(suffixMatch[2]) || 1));
    return { raw, qty, query: suffixMatch[1].trim() };
  }

  return { raw, qty: 1, query: trimmed };
}

function scoreCatalogItem(
  item: CreatorCatalogItem,
  normQuery: string,
  tokens: string[],
  brandShortName: string,
): number {
  if (!normQuery) return 0;
  const normName = normalizeText(item.name);
  const normAlias = item.searchAlias ? normalizeText(item.searchAlias) : '';
  const normPortion = item.portionLabel ? normalizeText(item.portionLabel) : '';
  const hay = `${normName} ${normAlias} ${normPortion} ${normalizeText(brandShortName)}`;

  if (!tokens.every((t) => hay.includes(t))) return -1;

  let score = 10;
  if (normName === normQuery) score += 120;
  else if (normName.startsWith(normQuery)) score += 70;
  else if (normName.split(/\s+/).some((w) => w.startsWith(normQuery))) score += 45;
  else if (normName.includes(normQuery)) score += 25;

  if (normAlias && normAlias.includes(normQuery)) score += 15;
  if (!item.id.startsWith('cat-')) score += 12; // prefer curated modular items slightly
  score -= Math.min(15, normName.length * 0.15);
  return score;
}

function searchCatalog(
  catalog: CreatorCatalogItem[],
  query: string,
  brandFilter: string,
  brandsById: Map<string, Brand>,
  limit = 8,
): CreatorCatalogItem[] {
  const normQuery = normalizeText(query.trim());
  if (!normQuery) return [];
  const tokens = normQuery.split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];

  const scored: { item: CreatorCatalogItem; score: number }[] = [];
  for (const item of catalog) {
    if (brandFilter !== 'all' && item.brandId !== brandFilter) continue;
    const brandShort = brandsById.get(item.brandId)?.shortName ?? item.brandId;
    const score = scoreCatalogItem(item, normQuery, tokens, brandShort);
    if (score >= 0) scored.push({ item, score });
  }

  scored.sort((a, b) => b.score - a.score || a.item.nutrition.kcal - b.item.nutrition.kcal);
  return scored.slice(0, limit).map((s) => s.item);
}

export default function CalorieCreator({
  brands,
  brandsById,
  catalog,
  rankedOffers,
  extendedMode,
}: CalorieCreatorProps) {
  const inputId = useId();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const [entries, setEntries] = useState<CreatorEntry[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.entries)) return parsed.entries;
      }
    } catch {
      // ignore storage errors
    }
    return [];
  });
  const [priceMode, setPriceMode] = useState<PriceMode>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.priceMode === 'per-item' || parsed.priceMode === 'total') return parsed.priceMode;
      }
    } catch {
      // ignore
    }
    return 'total';
  });
  const [totalPriceStr, setTotalPriceStr] = useState<string>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.totalPriceStr === 'string') return parsed.totalPriceStr;
      }
    } catch {
      // ignore
    }
    return '';
  });

  const [brandFilter, setBrandFilter] = useState<string>('all');
  const [inputText, setInputText] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  // Manual custom product inline form
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customName, setCustomName] = useState('');
  const [customQty, setCustomQty] = useState('1');
  const [customKcal, setCustomKcal] = useState('');
  const [customPrice, setCustomPrice] = useState('');
  const [customProtein, setCustomProtein] = useState('');
  const [customFat, setCustomFat] = useState('');
  const [customCarbs, setCustomCarbs] = useState('');

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ entries, priceMode, totalPriceStr }),
      );
    } catch {
      // ignore storage errors
    }
  }, [entries, priceMode, totalPriceStr]);

  const segments = useMemo(() => {
    const parts = inputText.split(/[,+]/);
    return parts.map(parseSegment);
  }, [inputText]);

  const activeSegment = segments[segments.length - 1] ?? { raw: '', qty: 1, query: '' };
  const completedSegments = segments.slice(0, -1).filter((s) => s.query.length > 0);

  const suggestions = useMemo(
    () => searchCatalog(catalog, activeSegment.query, brandFilter, brandsById, 8),
    [catalog, activeSegment.query, brandFilter, brandsById],
  );

  const completedMatches = useMemo(
    () =>
      completedSegments.map((seg) => ({
        seg,
        match: searchCatalog(catalog, seg.query, brandFilter, brandsById, 1)[0] ?? null,
      })),
    [completedSegments, catalog, brandFilter, brandsById],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [activeSegment.query, brandFilter]);

  const appendCatalogItems = (itemsToAdd: { item: CreatorCatalogItem; qty: number }[]) => {
    if (itemsToAdd.length === 0) return;
    setEntries((prev) => {
      const next = [...prev];
      for (const { item, qty } of itemsToAdd) {
        const existingIdx = next.findIndex((e) => e.catalogId === item.id);
        if (existingIdx >= 0) {
          next[existingIdx] = {
            ...next[existingIdx],
            qty: next[existingIdx].qty + qty,
          };
        } else {
          next.push({
            uid: `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            catalogId: item.id,
            brandId: item.brandId,
            name: item.name,
            portionLabel: item.portionLabel,
            qty,
            unitPricePln: '',
            nutrition: item.nutrition,
          });
        }
      }
      return next;
    });
  };

  const commitAllFromInput = (chosenForActive?: CreatorCatalogItem) => {
    const toAdd: { item: CreatorCatalogItem; qty: number }[] = [];
    const unresolved: string[] = [];

    for (const { seg, match } of completedMatches) {
      if (match) {
        toAdd.push({ item: match, qty: seg.qty });
      } else {
        unresolved.push(seg.raw.trim());
      }
    }

    const activePick = chosenForActive ?? suggestions[activeIndex] ?? suggestions[0];
    if (activeSegment.query) {
      if (activePick) {
        toAdd.push({ item: activePick, qty: activeSegment.qty });
      } else {
        unresolved.push(activeSegment.raw.trim());
      }
    }

    if (toAdd.length > 0) {
      appendCatalogItems(toAdd);
      setInputText(unresolved.join(', '));
      if (unresolved.length === 0) setDropdownOpen(false);
    }
  };

  const autocompleteActiveWith = (item: CreatorCatalogItem) => {
    const prefix = completedSegments.map((s) => s.raw.trim()).filter(Boolean);
    const qtyPrefix = activeSegment.qty > 1 ? `${activeSegment.qty}x ` : '';
    const nextParts = [...prefix, `${qtyPrefix}${item.name}`];
    setInputText(`${nextParts.join(', ')}, `);
    setDropdownOpen(true);
    setActiveIndex(0);
    inputRef.current?.focus();
  };

  const handleInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' && suggestions.length > 0) {
      e.preventDefault();
      setDropdownOpen(true);
      setActiveIndex((prev) => (prev + 1) % suggestions.length);
      return;
    }
    if (e.key === 'ArrowUp' && suggestions.length > 0) {
      e.preventDefault();
      setDropdownOpen(true);
      setActiveIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
      return;
    }
    if (e.key === 'Tab' && dropdownOpen && suggestions.length > 0 && activeSegment.query) {
      e.preventDefault();
      const picked = suggestions[activeIndex] ?? suggestions[0];
      if (picked) autocompleteActiveWith(picked);
      return;
    }
    if (e.key === 'Enter') {
      if (suggestions.length > 0 || completedMatches.some((m) => m.match)) {
        e.preventDefault();
        commitAllFromInput();
      }
      return;
    }
    if (e.key === 'Escape') {
      setDropdownOpen(false);
    }
  };

  const handleAddCustomProduct = () => {
    const name = customName.trim();
    const kcalVal = Number(customKcal.replace(',', '.'));
    const qtyVal = Math.max(1, Math.min(99, Number(customQty) || 1));
    if (!name || Number.isNaN(kcalVal) || kcalVal < 0) return;

    const p = Math.max(0, Number(customProtein.replace(',', '.')) || 0);
    const f = Math.max(0, Number(customFat.replace(',', '.')) || 0);
    const c = Math.max(0, Number(customCarbs.replace(',', '.')) || 0);
    const unitP = Number(customPrice.replace(',', '.'));

    setEntries((prev) => [
      ...prev,
      {
        uid: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        brandId: 'custom',
        name,
        portionLabel: 'własny wpis',
        qty: qtyVal,
        unitPricePln: !Number.isNaN(unitP) && unitP > 0 ? unitP : '',
        nutrition: {
          kcal: Math.round(kcalVal),
          kj: Math.round(kcalVal * 4.184),
          proteinG: p,
          fatG: f,
          carbsG: c,
        },
      },
    ]);

    setCustomName('');
    setCustomQty('1');
    setCustomKcal('');
    setCustomPrice('');
    setCustomProtein('');
    setCustomFat('');
    setCustomCarbs('');
    setShowCustomForm(false);
  };

  const handleSwitchPriceMode = (nextMode: PriceMode) => {
    if (nextMode === priceMode) return;
    if (nextMode === 'total') {
      const perItemSum = entries.reduce(
        (sum, e) => sum + (typeof e.unitPricePln === 'number' ? e.unitPricePln * e.qty : 0),
        0,
      );
      if (perItemSum > 0 && !totalPriceStr) {
        setTotalPriceStr(perItemSum.toFixed(2).replace('.', ','));
      }
    }
    setPriceMode(nextMode);
  };

  const totals = useMemo(() => {
    let kcal = 0;
    let kj = 0;
    let proteinG = 0;
    let fatG = 0;
    let satFatG = 0;
    let carbsG = 0;
    let sugarsG = 0;
    let saltG = 0;
    let perItemPriceSum = 0;

    for (const e of entries) {
      kcal += e.nutrition.kcal * e.qty;
      kj += (e.nutrition.kj ?? Math.round(e.nutrition.kcal * 4.184)) * e.qty;
      proteinG += e.nutrition.proteinG * e.qty;
      fatG += e.nutrition.fatG * e.qty;
      satFatG += (e.nutrition.satFatG ?? 0) * e.qty;
      carbsG += e.nutrition.carbsG * e.qty;
      sugarsG += (e.nutrition.sugarsG ?? 0) * e.qty;
      saltG += (e.nutrition.saltG ?? 0) * e.qty;
      if (typeof e.unitPricePln === 'number' && e.unitPricePln > 0) {
        perItemPriceSum += e.unitPricePln * e.qty;
      }
    }

    const parsedTotalInput = Number(totalPriceStr.replace(',', '.'));
    const totalPricePln =
      priceMode === 'total'
        ? !Number.isNaN(parsedTotalInput) && parsedTotalInput > 0
          ? parsedTotalInput
          : 0
        : Number(perItemPriceSum.toFixed(2));

    const kcalPerPln = totalPricePln > 0 ? kcal / totalPricePln : 0;
    const proteinPerPln = totalPricePln > 0 ? proteinG / totalPricePln : 0;

    return {
      kcal: Math.round(kcal),
      kj: Math.round(kj),
      proteinG: Number(proteinG.toFixed(1)),
      fatG: Number(fatG.toFixed(1)),
      satFatG: Number(satFatG.toFixed(1)),
      carbsG: Number(carbsG.toFixed(1)),
      sugarsG: Number(sugarsG.toFixed(1)),
      saltG: Number(saltG.toFixed(2)),
      totalPricePln,
      kcalPerPln,
      proteinPerPln,
    };
  }, [entries, priceMode, totalPriceStr]);

  const hypotheticalRank = useMemo(() => {
    if (totals.totalPricePln <= 0) return null;
    if (extendedMode) {
      if (totals.proteinG <= 0) return null;
      const sorted = [...rankedOffers].sort((a, b) => b.proteinPerPln - a.proteinPerPln);
      const idx = sorted.findIndex((r) => totals.proteinPerPln >= r.proteinPerPln);
      const pos = idx === -1 ? sorted.length + 1 : idx + 1;
      const beatOffer = idx >= 0 ? sorted[idx] : null;
      return { pos, total: sorted.length + 1, beatOffer };
    }
    if (totals.kcal <= 0) return null;
    const sorted = [...rankedOffers].sort((a, b) => b.kcalPerPln - a.kcalPerPln);
    const idx = sorted.findIndex((r) => totals.kcalPerPln >= r.kcalPerPln);
    const pos = idx === -1 ? sorted.length + 1 : idx + 1;
    const beatOffer = idx >= 0 ? sorted[idx] : null;
    return { pos, total: sorted.length + 1, beatOffer };
  }, [
    extendedMode,
    totals.kcal,
    totals.proteinG,
    totals.totalPricePln,
    totals.kcalPerPln,
    totals.proteinPerPln,
    rankedOffers,
  ]);

  return (
    <section id="kreator" className="creator-section" aria-labelledby="creator-heading">
      <div className="container">
        <div className="section-head">
          <div>
            <h2 id="creator-heading" className="section-title mode-morph">
              {extendedMode
                ? 'Manualny kreator makro i białka/zł'
                : 'Manualny kreator kalorii i kcal/zł'}
            </h2>
            <p className="section-sub">
              Złóż własny zestaw z {catalog.length} oficjalnych pozycji lub dodaj własne produkty.
              Wpisuj np. <span className="mono">2x chikker, frytki</span> — użyj{' '}
              <kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd>, <kbd className="kbd">Tab</kbd>{' '}
              (autouzupełnienie) i <kbd className="kbd">Enter</kbd> (dodaj do zestawu).
            </p>
          </div>
          {entries.length > 0 && (
            <button
              type="button"
              className="reset-link-btn"
              onClick={() => {
                setEntries([]);
                setTotalPriceStr('');
              }}
            >
              <RotateCcw
                size={13}
                aria-hidden="true"
                style={{ display: 'inline', marginRight: '0.35rem', verticalAlign: 'middle' }}
              />
              Wyczyść zestaw
            </button>
          )}
        </div>

        <div className="creator-shell">
          <div className="creator-left">
            <div className="creator-toolbar">
              <div className="segmented" role="group" aria-label="Filtr sieci w kreatorze">
                <button
                  type="button"
                  aria-pressed={brandFilter === 'all'}
                  onClick={() => setBrandFilter('all')}
                >
                  Wszystkie sieci
                </button>
                {brands.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    aria-pressed={brandFilter === b.id}
                    onClick={() => setBrandFilter(b.id)}
                  >
                    {b.shortName}
                  </button>
                ))}
              </div>

              <div className="segmented" role="group" aria-label="Tryb wprowadzania ceny">
                <button
                  type="button"
                  aria-pressed={priceMode === 'total'}
                  onClick={() => handleSwitchPriceMode('total')}
                >
                  Cena za całość
                </button>
                <button
                  type="button"
                  aria-pressed={priceMode === 'per-item'}
                  onClick={() => handleSwitchPriceMode('per-item')}
                >
                  Cena za produkt
                </button>
              </div>
            </div>

            <div className="creator-input-wrap">
              <label htmlFor={inputId} className="sr-only">
                Wpisz produkty (np. 2x chikker, frytki)
              </label>
              <div className="creator-combobox">
                <Sparkles size={16} className="creator-input-icon" aria-hidden="true" />
                <input
                  ref={inputRef}
                  id={inputId}
                  type="text"
                  role="combobox"
                  aria-expanded={dropdownOpen && suggestions.length > 0}
                  aria-controls={listboxId}
                  aria-autocomplete="list"
                  aria-activedescendant={
                    dropdownOpen && suggestions[activeIndex]
                      ? `${listboxId}-opt-${activeIndex}`
                      : undefined
                  }
                  className="creator-input"
                  placeholder="Wpisz np. 2x chikker, frytki średnie, zinger..."
                  value={inputText}
                  onFocus={() => setDropdownOpen(true)}
                  onBlur={() => {
                    setTimeout(() => setDropdownOpen(false), 150);
                  }}
                  onChange={(e) => {
                    setInputText(e.target.value);
                    setDropdownOpen(true);
                  }}
                  onKeyDown={handleInputKeyDown}
                />
                {inputText.trim() && (suggestions.length > 0 || completedMatches.some((m) => m.match)) && (
                  <button
                    type="button"
                    className="creator-commit-btn"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => commitAllFromInput()}
                  >
                    <CornerDownLeft size={14} aria-hidden="true" />
                    Dodaj
                  </button>
                )}
              </div>

              {completedSegments.length > 0 && (
                <div className="creator-multi-preview" aria-live="polite">
                  {completedMatches.map(({ seg, match }, i) => (
                    <span
                      key={`${seg.raw}-${i}`}
                      className={`multi-chip ${match ? 'matched' : 'missed'}`}
                    >
                      {match
                        ? `${seg.qty > 1 ? `${seg.qty}× ` : ''}${match.name} (${match.nutrition.kcal * seg.qty} kcal)`
                        : `Nie znaleziono: „${seg.query}”`}
                    </span>
                  ))}
                  {activeSegment.query && suggestions[activeIndex] && (
                    <span className="multi-chip active">
                      {activeSegment.qty > 1 ? `${activeSegment.qty}× ` : ''}
                      {suggestions[activeIndex].name} (
                      {suggestions[activeIndex].nutrition.kcal * activeSegment.qty} kcal)
                    </span>
                  )}
                </div>
              )}

              {dropdownOpen && activeSegment.query && (
                suggestions.length === 0 ? (
                  <div className="creator-dropdown creator-dropdown-empty">
                    Brak pozycji dla „{activeSegment.query}”.{' '}
                    <button
                      type="button"
                      className="inline-link-btn"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setCustomName(activeSegment.query);
                        setCustomQty(String(activeSegment.qty));
                        setShowCustomForm(true);
                        setDropdownOpen(false);
                      }}
                    >
                      Dodaj własny produkt
                    </button>
                  </div>
                ) : (
                  <ul id={listboxId} role="listbox" className="creator-dropdown">
                    {suggestions.map((item, idx) => {
                      const brand = brandsById.get(item.brandId);
                      const isActive = idx === activeIndex;
                      const previewKcal = item.nutrition.kcal * activeSegment.qty;
                      return (
                        <li
                          key={item.id}
                          id={`${listboxId}-opt-${idx}`}
                          role="option"
                          aria-selected={isActive}
                          className={`creator-option ${isActive ? 'active' : ''}`}
                          onMouseEnter={() => setActiveIndex(idx)}
                          onMouseDown={(e) => {
                            e.preventDefault();
                            commitAllFromInput(item);
                          }}
                        >
                          <div className="creator-option-main">
                            <span
                              className="brand-dot"
                              style={{ backgroundColor: brand?.accentColor ?? '#374151' }}
                              aria-hidden="true"
                            />
                            <div>
                              <div className="creator-option-name">
                                {activeSegment.qty > 1 && (
                                  <span className="qty-pill">{activeSegment.qty}×</span>
                                )}{' '}
                                {item.name}
                              </div>
                              <div className="creator-option-meta">
                                {brand?.shortName}
                                {item.portionLabel ? ` • ${item.portionLabel}` : ''}
                                {extendedMode
                                  ? ` • B: ${item.nutrition.proteinG}g / T: ${item.nutrition.fatG}g / W: ${item.nutrition.carbsG}g`
                                  : ''}
                              </div>
                            </div>
                          </div>
                          <div className="creator-option-right">
                            <span className="mono">
                              {extendedMode
                                ? `${formatRatio(item.nutrition.proteinG * activeSegment.qty)} g B`
                                : `${formatInt(previewKcal)} kcal`}
                            </span>
                            <button
                              type="button"
                              className="tab-hint-btn"
                              title="Autouzupełnij w polu (Tab)"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                autocompleteActiveWith(item);
                              }}
                            >
                              Tab ⇥
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )
              )}
            </div>

            <div className="creator-manual-bar">
              <button
                type="button"
                className="inline-link-btn"
                onClick={() => setShowCustomForm((v) => !v)}
              >
                <Plus size={14} aria-hidden="true" />
                {showCustomForm ? 'Ukryj formularz własnego produktu' : 'Dodaj własny produkt ręcznie'}
              </button>
            </div>

            {showCustomForm && (
              <div className="creator-custom-form">
                <div className="custom-form-grid">
                  <label className="custom-field custom-field--wide">
                    <span>Nazwa produktu</span>
                    <input
                      type="text"
                      placeholder="np. Kanapka własna / napój"
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                    />
                  </label>
                  <label className="custom-field">
                    <span>Ilość</span>
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={customQty}
                      onChange={(e) => setCustomQty(e.target.value)}
                    />
                  </label>
                  <label className="custom-field">
                    <span>kcal / szt.</span>
                    <input
                      type="number"
                      min={0}
                      placeholder="np. 350"
                      value={customKcal}
                      onChange={(e) => setCustomKcal(e.target.value)}
                    />
                  </label>
                  {priceMode === 'per-item' && (
                    <label className="custom-field">
                      <span>Cena / szt. (zł)</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="np. 7,50"
                        value={customPrice}
                        onChange={(e) => setCustomPrice(e.target.value)}
                      />
                    </label>
                  )}
                  {extendedMode && (
                    <>
                      <label className="custom-field">
                        <span>Białko (g)</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0"
                          value={customProtein}
                          onChange={(e) => setCustomProtein(e.target.value)}
                        />
                      </label>
                      <label className="custom-field">
                        <span>Tłuszcz (g)</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0"
                          value={customFat}
                          onChange={(e) => setCustomFat(e.target.value)}
                        />
                      </label>
                      <label className="custom-field">
                        <span>Węgl. (g)</span>
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0"
                          value={customCarbs}
                          onChange={(e) => setCustomCarbs(e.target.value)}
                        />
                      </label>
                    </>
                  )}
                </div>
                <div className="custom-form-actions">
                  <button
                    type="button"
                    className="btn-primary btn-sm"
                    onClick={handleAddCustomProduct}
                    disabled={!customName.trim() || !customKcal}
                  >
                    Dodaj produkt
                  </button>
                </div>
              </div>
            )}

            {entries.length === 0 ? (
              <div className="creator-empty">
                Dodaj pierwszy produkt powyżej (np. wpisz <span className="mono">2x chikker, frytki</span>)
                lub wybierz własny produkt, aby policzyć kalorie i <span className="mono">kcal/zł</span>.
              </div>
            ) : (
              <ul className="creator-list" aria-label="Wybrane produkty w kreatorze">
                {entries.map((entry) => {
                  const brand = brandsById.get(entry.brandId);
                  const rowKcal = entry.nutrition.kcal * entry.qty;
                  return (
                    <li key={entry.uid} className="creator-item">
                      <div className="creator-item-info">
                        <span
                          className="brand-dot"
                          style={{ backgroundColor: brand?.accentColor ?? '#64748b' }}
                          aria-hidden="true"
                        />
                        <div>
                          <div className="creator-item-name">
                            {entry.name}
                            {entry.portionLabel && (
                              <span className="creator-item-portion"> ({entry.portionLabel})</span>
                            )}
                          </div>
                          <div className="creator-item-sub">
                            {brand?.shortName ?? 'Własny'} • {entry.nutrition.kcal} kcal/szt.
                            {extendedMode && (
                              <>
                                {' '}
                                • B:{' '}
                                {formatRatio(entry.nutrition.proteinG * entry.qty)} g | T:{' '}
                                {formatRatio(entry.nutrition.fatG * entry.qty)} g | W:{' '}
                                {formatRatio(entry.nutrition.carbsG * entry.qty)} g
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="creator-item-controls">
                        <div className="qty-stepper" aria-label={`Ilość dla ${entry.name}`}>
                          <button
                            type="button"
                            onClick={() =>
                              setEntries((prev) =>
                                prev
                                  .map((it) =>
                                    it.uid === entry.uid ? { ...it, qty: it.qty - 1 } : it,
                                  )
                                  .filter((it) => it.qty > 0),
                              )
                            }
                            aria-label="Zmniejsz ilość"
                          >
                            −
                          </button>
                          <span className="mono">{entry.qty}×</span>
                          <button
                            type="button"
                            onClick={() =>
                              setEntries((prev) =>
                                prev.map((it) =>
                                  it.uid === entry.uid
                                    ? { ...it, qty: Math.min(99, it.qty + 1) }
                                    : it,
                                ),
                              )
                            }
                            aria-label="Zwiększ ilość"
                          >
                            +
                          </button>
                        </div>

                        {priceMode === 'per-item' && (
                          <label className="unit-price-wrap">
                            <span className="sr-only">Cena za sztukę (zł)</span>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              placeholder="0,00"
                              value={entry.unitPricePln}
                              onChange={(e) => {
                                const val = e.target.value;
                                const num = val === '' ? '' : Number(val);
                                setEntries((prev) =>
                                  prev.map((it) =>
                                    it.uid === entry.uid
                                      ? {
                                          ...it,
                                          unitPricePln:
                                            num === '' || Number.isNaN(num) || num < 0 ? '' : num,
                                        }
                                      : it,
                                  ),
                                );
                              }}
                            />
                            <span className="unit-price-suffix">zł/szt.</span>
                          </label>
                        )}

                        <div className="creator-item-kcal mono">
                          {extendedMode
                            ? `${formatRatio(entry.nutrition.proteinG * entry.qty)} g B`
                            : `${formatInt(rowKcal)} kcal`}
                        </div>

                        <button
                          type="button"
                          className="icon-remove-btn"
                          onClick={() =>
                            setEntries((prev) => prev.filter((it) => it.uid !== entry.uid))
                          }
                          aria-label={`Usuń ${entry.name}`}
                        >
                          <Trash2 size={15} aria-hidden="true" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <aside className="creator-summary" aria-label="Podsumowanie kreatora">
            <div className="creator-summary-top">
              <div>
                <div className="creator-summary-label">
                  {extendedMode ? 'Wynik makro' : 'Wynik zestawu'}
                </div>
                <div className="creator-score-val mono">
                  {totals.totalPricePln > 0
                    ? formatRatio(extendedMode ? totals.proteinPerPln : totals.kcalPerPln)
                    : '—'}
                </div>
                <div className="creator-score-unit">
                  {extendedMode ? 'g białka / zł' : 'kcal / zł'}
                </div>
              </div>

              <div className="creator-price-box">
                {priceMode === 'total' ? (
                  <label className="total-price-field">
                    <span>Łączna cena (zł)</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="np. 10,10"
                      value={totalPriceStr}
                      onChange={(e) => setTotalPriceStr(e.target.value)}
                    />
                  </label>
                ) : (
                  <div className="total-price-readonly">
                    <span>Suma cen produktów</span>
                    <strong className="mono">{formatPln(totals.totalPricePln)} zł</strong>
                  </div>
                )}
              </div>
            </div>

            {extendedMode ? (
              <>
                <div className="creator-metrics-grid">
                  <div>
                    <div className="leader-metric-label">Białko</div>
                    <div className="leader-metric-val">{formatRatio(totals.proteinG)} g</div>
                  </div>
                  <div>
                    <div className="leader-metric-label">Tłuszcz (nasyc.)</div>
                    <div className="leader-metric-val">
                      {formatRatio(totals.fatG)} g ({formatRatio(totals.satFatG)} g)
                    </div>
                  </div>
                  <div>
                    <div className="leader-metric-label">Węglowodany (cukry)</div>
                    <div className="leader-metric-val">
                      {formatRatio(totals.carbsG)} g ({formatRatio(totals.sugarsG)} g)
                    </div>
                  </div>
                  <div>
                    <div className="leader-metric-label">Sól</div>
                    <div className="leader-metric-val">{formatPln(totals.saltG)} g</div>
                  </div>
                </div>
                <div className="creator-extended-macros">
                  <div>
                    <span>Kalorie / Energia</span>
                    <strong className="mono">
                      {formatInt(totals.kcal)} kcal ({formatInt(totals.kj)} kJ)
                    </strong>
                  </div>
                  <div>
                    <span>Gęstość białka</span>
                    <strong className="mono">
                      {totals.kcal > 0
                        ? `${formatRatio((totals.proteinG / totals.kcal) * 1000)} g / 1k kcal`
                        : '—'}
                    </strong>
                  </div>
                </div>
              </>
            ) : (
              <div className="creator-metrics-grid">
                <div>
                  <div className="leader-metric-label">Kalorie</div>
                  <div className="leader-metric-val">{formatInt(totals.kcal)} kcal</div>
                </div>
                <div>
                  <div className="leader-metric-label">Białko</div>
                  <div className="leader-metric-val">{formatRatio(totals.proteinG)} g</div>
                </div>
                <div>
                  <div className="leader-metric-label">Tłuszcz</div>
                  <div className="leader-metric-val">{formatRatio(totals.fatG)} g</div>
                </div>
                <div>
                  <div className="leader-metric-label">Węglowodany</div>
                  <div className="leader-metric-val">{formatRatio(totals.carbsG)} g</div>
                </div>
              </div>
            )}

            {hypotheticalRank ? (
              <div className="creator-rank-banner">
                W rankingu {extendedMode ? 'białko/zł' : 'kcal/zł'} ({rankedOffers.length} ofert) ten
                zestaw zająłby{' '}
                <strong className="mono">
                  #{hypotheticalRank.pos}/{hypotheticalRank.total}
                </strong>{' '}
                miejsce
                {hypotheticalRank.beatOffer
                  ? ` (przed: ${hypotheticalRank.beatOffer.brand.shortName} ${hypotheticalRank.beatOffer.offer.name})`
                  : ''}
                .
              </div>
            ) : (
              <div className="creator-rank-banner muted">
                Dodaj produkty i podaj cenę, aby sprawdzić miejsce swojego zestawu w rankingu{' '}
                {extendedMode ? 'makro/zł' : 'kcal/zł'}.
              </div>
            )}
          </aside>
        </div>
      </div>
    </section>
  );
}
