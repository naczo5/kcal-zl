import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Dumbbell,
  ExternalLink,
  Flame,
  PencilLine,
  RotateCcw,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import CalorieCreator from './components/CalorieCreator';
import brandsRaw from './data/brands.json';
import creatorCatalogRaw from './data/creator-catalog.json';
import itemsRaw from './data/items.json';
import offersRaw from './data/offers.json';
import sourcesSummaryRaw from './data/sources-summary.json';
import {
  computeOfferBounds,
  formatInt,
  formatPln,
  formatRatio,
  getDefaultSelections,
  resolveOffer,
  type OfferBounds,
  type PresetMode,
  type ResolvedOffer,
} from './lib/offerCalculator';
import type {
  Brand,
  CreatorCatalogItem,
  MenuItem,
  Offer,
  OfferType,
  OfficialSourceSummary,
} from './types/data';

type SortKey = 'ratio' | 'primary' | 'price';
type SortDir = 'asc' | 'desc';

const brands = brandsRaw as Brand[];
const items = itemsRaw as MenuItem[];
const offers = offersRaw as Offer[];
const officialSources = sourcesSummaryRaw as OfficialSourceSummary[];
const creatorCatalog = creatorCatalogRaw as CreatorCatalogItem[];

const brandsById = new Map<string, Brand>(brands.map((b) => [b.id, b]));
const itemsById = new Map<string, MenuItem>(items.map((i) => [i.id, i]));
const boundsByOfferId = new Map<string, OfferBounds>(
  offers.map((o) => [o.id, computeOfferBounds(o, itemsById)]),
);

const BRAND_VERIFICATION: Record<
  string,
  { priceStatus: 'verified' | 'manual'; priceLabel: string; priceDetail: string }
> = {
  kfc: {
    priceStatus: 'verified',
    priceLabel: 'Sprawdzone źródło cen',
    priceDetail: 'Ceny weryfikowane z oficjalnej oferty i kuponów KFC Polska.',
  },
  mcdonalds: {
    priceStatus: 'manual',
    priceLabel: 'Ceny manualne',
    priceDetail: 'Wprowadzane ręcznie z oficjalnych regulaminów ofert oraz aplikacji McDonald’s.',
  },
  popeyes: {
    priceStatus: 'manual',
    priceLabel: 'Ceny manualne',
    priceDetail: 'Wprowadzane ręcznie z menu restauracji Popeyes Polska.',
  },
};

function normalizeForSearch(text: string): string {
  return text
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function getBaseSelections(
  offer: Offer,
  mode: PresetMode,
  macroMode: boolean,
): Record<string, string> {
  if (mode === 'default') return getDefaultSelections(offer);
  const bounds = boundsByOfferId.get(offer.id);
  if (macroMode) return bounds?.maxProteinSelections ?? getDefaultSelections(offer);
  return bounds?.maxSelections ?? getDefaultSelections(offer);
}

function formatSlotItemLabel(name: string, quantity?: number): string {
  return quantity && quantity > 1 ? `${quantity}× ${name}` : name;
}

function itemMonogram(name: string): string {
  return name.replace(/[^A-Za-z0-9ĄĆĘŁŃÓŚŹŻąćęłńóśźż]/g, '').slice(0, 2).toUpperCase() || '•';
}

export default function App() {
  const [presetMode, setPresetMode] = useState<PresetMode>('max');
  const [customSelections, setCustomSelections] = useState<Record<string, Record<string, string>>>(
    {},
  );
  const [brandFilter, setBrandFilter] = useState<string>('all');
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('ratio');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<'all' | OfferType>('all');
  const [macroMode, setMacroMode] = useState(false);
  const [transitionTick, setTransitionTick] = useState(0);

  useEffect(() => {
    document.documentElement.dataset.mode = macroMode ? 'macro' : 'kcal';
  }, [macroMode]);

  const resolvedAll = useMemo<ResolvedOffer[]>(() => {
    return offers.map((offer) => {
      const baseSelections = getBaseSelections(offer, presetMode, macroMode);
      const mergedSelections = {
        ...baseSelections,
        ...(customSelections[offer.id] ?? {}),
      };
      return resolveOffer(
        offer,
        brandsById,
        itemsById,
        mergedSelections,
        boundsByOfferId.get(offer.id),
      );
    });
  }, [presetMode, customSelections, macroMode]);

  const leader = useMemo(() => {
    return [...resolvedAll].sort((a, b) =>
      macroMode ? b.proteinPerPln - a.proteinPerPln : b.kcalPerPln - a.kcalPerPln,
    )[0];
  }, [resolvedAll, macroMode]);

  const maxRatioInDataset = useMemo(() => {
    if (!leader) return 1;
    return Math.max(macroMode ? leader.proteinPerPln : leader.kcalPerPln, 0.1);
  }, [leader, macroMode]);

  const filteredAndSorted = useMemo(() => {
    const q = normalizeForSearch(query.trim());
    const filtered = resolvedAll.filter((entry) => {
      if (typeFilter !== 'all' && entry.offer.offerType !== typeFilter) return false;
      if (brandFilter !== 'all' && entry.offer.brandId !== brandFilter) return false;
      if (q) {
        const hay = normalizeForSearch(
          [
            entry.offer.name,
            entry.brand.name,
            entry.offer.description,
            ...entry.offer.slots.flatMap((s) =>
              s.options.map((o) => itemsById.get(o.itemId)?.name ?? ''),
            ),
          ].join(' '),
        );
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    return filtered.sort((a, b) => {
      let diff = 0;
      if (sortKey === 'ratio') {
        diff = macroMode ? a.proteinPerPln - b.proteinPerPln : a.kcalPerPln - b.kcalPerPln;
      } else if (sortKey === 'primary') {
        diff = macroMode ? a.totalProteinG - b.totalProteinG : a.totalKcal - b.totalKcal;
      } else if (sortKey === 'price') {
        diff = a.totalPricePln - b.totalPricePln;
      }
      return sortDir === 'asc' ? diff : -diff;
    });
  }, [resolvedAll, typeFilter, brandFilter, query, sortKey, sortDir, macroMode]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'price' ? 'asc' : 'desc');
    }
  };

  const handleSelectOption = (offer: Offer, slotId: string, itemId: string) => {
    const baseSelections = getBaseSelections(offer, presetMode, macroMode);
    setCustomSelections((prev) => {
      const nextOfferSel = {
        ...(prev[offer.id] ?? {}),
        [slotId]: itemId,
      };
      const matchesBase = offer.slots.every(
        (s) => (nextOfferSel[s.id] ?? baseSelections[s.id]) === baseSelections[s.id],
      );
      if (matchesBase) {
        const next = { ...prev };
        delete next[offer.id];
        return next;
      }
      return {
        ...prev,
        [offer.id]: nextOfferSel,
      };
    });
  };

  const handleResetOffer = (offerId: string) => {
    setCustomSelections((prev) => {
      const next = { ...prev };
      delete next[offerId];
      return next;
    });
  };

  const handlePresetSwitch = (mode: PresetMode) => {
    setPresetMode(mode);
    setCustomSelections({});
  };

  const handleSetMacroMode = (nextMacro: boolean) => {
    if (nextMacro === macroMode) return;
    setMacroMode(nextMacro);
    setCustomSelections({});
    setTransitionTick((t) => t + 1);
  };

  const clearFilters = () => {
    setTypeFilter('all');
    setBrandFilter('all');
    setQuery('');
  };

  const jumpToLeaderInTable = () => {
    if (!leader) return;
    clearFilters();
    setSortKey('ratio');
    setSortDir('desc');
    setExpandedId(leader.offer.id);
    const el = document.getElementById('ranking');
    el?.scrollIntoView({ behavior: 'smooth' });
  };

  const renderSortIcon = (key: SortKey) => {
    if (sortKey !== key) return <ArrowUpDown size={14} aria-hidden="true" />;
    return sortDir === 'desc' ? (
      <ArrowDown size={14} aria-hidden="true" />
    ) : (
      <ArrowUp size={14} aria-hidden="true" />
    );
  };

  const getAriaSort = (key: SortKey): 'ascending' | 'descending' | 'none' => {
    if (sortKey !== key) return 'none';
    return sortDir === 'asc' ? 'ascending' : 'descending';
  };

  const totalSavedOfficialRows = officialSources.reduce((sum, s) => sum + s.itemCount, 0);
  const hasCouponsInDataset = offers.some((o) => o.offerType === 'coupon');
  const isDefaultRankingSort = sortKey === 'ratio' && sortDir === 'desc';

  return (
    <div className="app-shell" data-mode={macroMode ? 'macro' : 'kcal'}>
      {transitionTick > 0 && (
        <div key={transitionTick} className="mode-sweep-veil" aria-hidden="true" />
      )}

      <header className="topbar">
        <div className="container topbar-inner">
          <a href="#top" className="brand-mark">
            <span className="brand-mark-badge">{macroMode ? 'makro/zł' : 'kcal/zł'}</span>
            <span className="brand-mark-text">Indeks fast food</span>
          </a>
          <div className="topbar-right">
            <nav className="topbar-nav" aria-label="Nawigacja główna">
              <a href="#kreator">Kreator</a>
              <a href="#ranking">Ranking</a>
              <a href="#zrodla">Źródła danych</a>
            </nav>
            <div className="mini-mode-switch" role="group" aria-label="Przełącznik trybu">
              <span
                className="mini-mode-thumb"
                style={{ transform: macroMode ? 'translateX(100%)' : 'translateX(0%)' }}
                aria-hidden="true"
              />
              <button
                type="button"
                aria-pressed={!macroMode}
                onClick={() => handleSetMacroMode(false)}
              >
                <Flame size={13} aria-hidden="true" />
                kcal/zł
              </button>
              <button
                type="button"
                aria-pressed={macroMode}
                onClick={() => handleSetMacroMode(true)}
              >
                <Dumbbell size={13} aria-hidden="true" />
                makro/zł
              </button>
            </div>
          </div>
        </div>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="hero-heading">
          <div className="container hero-grid">
            <div>
              <div className="hero-switch-block">
                <div
                  className={`big-mode-switch ${macroMode ? 'is-macro' : 'is-kcal'}`}
                  role="group"
                  aria-label="Tryb analizy strony"
                >
                  <span
                    className="big-mode-thumb"
                    style={{ transform: macroMode ? 'translateX(100%)' : 'translateX(0%)' }}
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    className="big-mode-btn"
                    aria-pressed={!macroMode}
                    onClick={() => handleSetMacroMode(false)}
                  >
                    <span className="big-mode-icon">
                      <Flame size={18} aria-hidden="true" />
                    </span>
                    <span className="big-mode-text">
                      <strong className="mono">kcal / zł</strong>
                      <span>Tryb kalorii</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="big-mode-btn"
                    aria-pressed={macroMode}
                    onClick={() => handleSetMacroMode(true)}
                  >
                    <span className="big-mode-icon">
                      <Dumbbell size={18} aria-hidden="true" />
                    </span>
                    <span className="big-mode-text">
                      <strong className="mono">makro / zł</strong>
                      <span>Tryb rozszerzony</span>
                    </span>
                  </button>
                </div>
              </div>

              <div key={`hero-copy-${macroMode}`} className="mode-morph">
                <h1 id="hero-heading" className="hero-title">
                  {macroMode
                    ? 'Najwięcej białka i makro za każdą złotówkę'
                    : 'Najwięcej kalorii za każdą złotówkę'}
                </h1>
                <p className="hero-lead">
                  {macroMode ? (
                    <>
                      Tryb rozszerzony sortuje oferty po przeliczniku{' '}
                      <strong className="mono">g białka/zł</strong> oraz odkrywa pełny rozkład
                      makroskładników (tłuszcze, nasycone, węglowodany, cukry, sól i kJ) z
                      oficjalnych tabel producentów.
                    </>
                  ) : (
                    <>
                      Zestawienie ofert, zestawów i kuponów fast food w Polsce sortowane po
                      przeliczniku <strong className="mono">kcal/zł</strong>. Kalorie i makro są
                      sprawdzone w oficjalnych tabelach; ceny KFC pochodzą ze sprawdzonego źródła, a
                      McDonald’s i Popeyes są uzupełniane manualnie.
                    </>
                  )}
                </p>
              </div>

              <div className="hero-actions">
                <a href="#kreator" className="btn-primary">
                  <Calculator size={16} aria-hidden="true" />
                  {macroMode ? 'Kreator makro' : 'Kreator kalorii'}
                </a>
                <a href="#ranking" className="btn-secondary">
                  Przejdź do rankingu
                </a>
                <a href="#zrodla" className="btn-secondary">
                  Weryfikacja i źródła
                </a>
              </div>

              <div className="hero-facts">
                <div>
                  <div className="hero-fact-value">{offers.length}</div>
                  <div className="hero-fact-label">zestawów i kuponów w rankingu</div>
                </div>
                <div>
                  <div className="hero-fact-value">{creatorCatalog.length}</div>
                  <div className="hero-fact-label">pozycji w kreatorze (oficjalne dane)</div>
                </div>
                <div>
                  <div className="hero-fact-value">{totalSavedOfficialRows}</div>
                  <div className="hero-fact-label">rekordów z oficjalnych tabel</div>
                </div>
                <div>
                  <div className="hero-fact-value">{brands.length}</div>
                  <div className="hero-fact-label">wspierane sieci</div>
                </div>
              </div>
            </div>

            {leader && (
              <aside
                key={`leader-${macroMode}-${leader.offer.id}`}
                className="leader-panel mode-morph"
                aria-label={
                  macroMode
                    ? 'Obecny lider rankingu białka na złotówkę'
                    : 'Obecny lider rankingu kcal na złotówkę'
                }
              >
                <div className="leader-header">
                  <span className="leader-rank-pill">
                    <span className="leader-rank-dot" aria-hidden="true" />
                    {macroMode ? 'Lider makro (#1)' : 'Obecny lider (#1)'}
                  </span>
                  <span className="mono" style={{ fontSize: '0.78rem', opacity: 0.85 }}>
                    {customSelections[leader.offer.id]
                      ? 'Własna konfiguracja'
                      : presetMode === 'max'
                        ? macroMode
                          ? 'Optymalne białko'
                          : 'Optymalny skład'
                        : 'Skład domyślny'}
                  </span>
                </div>

                <div className={`leader-media ${leader.offer.image ? '' : 'is-collage'}`}>
                  <span className="leader-brand-tag">
                    <span
                      className="brand-dot"
                      style={{ backgroundColor: leader.brand.accentColor }}
                      aria-hidden="true"
                    />
                    {leader.brand.shortName}
                  </span>
                  {leader.offer.image ? (
                    <img
                      src={leader.offer.image}
                      alt={`${leader.brand.shortName} ${leader.offer.name}`}
                    />
                  ) : (
                    <div className="modular-collage">
                      {leader.items.slice(0, 4).map(({ slot, item }) => (
                        <div key={slot.id} className="modular-collage-tile">
                          {item.image ? (
                            <img src={item.image} alt={item.name} />
                          ) : (
                            <span className="img-fallback" aria-hidden="true">
                              {itemMonogram(item.name)}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="leader-body">
                  <div className="leader-top-row">
                    <div>
                      <span className={`type-badge ${leader.offer.offerType}`}>
                        {leader.offer.offerType === 'coupon' ? 'Kupon' : 'Stała oferta'}
                      </span>
                      <h2 className="leader-name">{leader.offer.name}</h2>
                    </div>
                    <div className="leader-score-box">
                      <div className="leader-score-val">
                        {formatRatio(macroMode ? leader.proteinPerPln : leader.kcalPerPln)}
                      </div>
                      <div className="leader-score-unit">
                        {macroMode ? 'g białka / zł' : 'kcal / zł'}
                      </div>
                    </div>
                  </div>

                  {macroMode ? (
                    <>
                      <div className="leader-metrics">
                        <div>
                          <div className="leader-metric-label">Białko</div>
                          <div className="leader-metric-val">
                            {formatRatio(leader.totalProteinG)} g
                          </div>
                        </div>
                        <div>
                          <div className="leader-metric-label">Cena</div>
                          <div className="leader-metric-val">
                            {formatPln(leader.totalPricePln)} zł
                          </div>
                        </div>
                        <div>
                          <div className="leader-metric-label">Kalorie</div>
                          <div className="leader-metric-val">{formatInt(leader.totalKcal)} kcal</div>
                        </div>
                      </div>
                      <div className="leader-extended-grid">
                        <div>
                          <span>Tłuszcz (nasyc.)</span>
                          <strong className="mono">
                            {formatRatio(leader.totalFatG)} g ({formatRatio(leader.totalSatFatG)} g)
                          </strong>
                        </div>
                        <div>
                          <span>Węgl. (cukry)</span>
                          <strong className="mono">
                            {formatRatio(leader.totalCarbsG)} g ({formatRatio(leader.totalSugarsG)}{' '}
                            g)
                          </strong>
                        </div>
                        <div>
                          <span>Sól</span>
                          <strong className="mono">{formatPln(leader.totalSaltG)} g</strong>
                        </div>
                        <div>
                          <span>Gęstość białka</span>
                          <strong className="mono">
                            {formatRatio(leader.proteinPer1000Kcal)} g / 1k kcal
                          </strong>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="leader-metrics">
                      <div>
                        <div className="leader-metric-label">Kalorie</div>
                        <div className="leader-metric-val">{formatInt(leader.totalKcal)} kcal</div>
                      </div>
                      <div>
                        <div className="leader-metric-label">Cena</div>
                        <div className="leader-metric-val">{formatPln(leader.totalPricePln)} zł</div>
                      </div>
                      <div>
                        <div className="leader-metric-label">Białko</div>
                        <div className="leader-metric-val">{formatRatio(leader.totalProteinG)} g</div>
                      </div>
                    </div>
                  )}

                  <div className="leader-items-list" aria-label="Skład lidera">
                    {leader.items.map(({ slot, item }) => {
                      const qty = slot.quantity ?? 1;
                      return (
                        <span key={slot.id} className="item-chip">
                          {formatSlotItemLabel(item.name, slot.quantity)} (
                          {macroMode
                            ? `${formatRatio(item.nutrition.proteinG * qty)}g B`
                            : `${item.nutrition.kcal * qty} kcal`}
                          )
                        </span>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    className="btn-secondary leader-footer-btn"
                    onClick={jumpToLeaderInTable}
                  >
                    <SlidersHorizontal size={15} aria-hidden="true" />
                    Zobacz i dostosuj w tabeli
                  </button>
                </div>
              </aside>
            )}
          </div>
        </section>

        <CalorieCreator
          brands={brands}
          brandsById={brandsById}
          catalog={creatorCatalog}
          rankedOffers={resolvedAll}
          extendedMode={macroMode}
        />

        <section id="ranking" className="ranking-section" aria-labelledby="ranking-heading">
          <div className="container">
            <div className="section-head">
              <div>
                <h2 id="ranking-heading" className="section-title">
                  {macroMode ? 'Ranking makro — białko/zł i rozkład B/T/W' : 'Ranking ofert i kuponów'}
                </h2>
                <p className="section-sub">
                  Każdy zestaw i kupon mieści się w jednym wierszu. Kliknij „Dostosuj” lub „Skład”,
                  aby podejrzeć makroskładniki albo zmienić warianty i przeliczyć pozycję na żywo.
                </p>
              </div>
            </div>

            <div className="controls-bar" role="region" aria-label="Filtry i tryb przeliczania">
              <div className="filter-groups">
                <div className="segmented" role="group" aria-label="Typ oferty">
                  <button
                    type="button"
                    aria-pressed={typeFilter === 'all'}
                    onClick={() => setTypeFilter('all')}
                  >
                    Wszystkie
                  </button>
                  <button
                    type="button"
                    aria-pressed={typeFilter === 'regular'}
                    onClick={() => setTypeFilter('regular')}
                  >
                    Stała oferta
                  </button>
                  <button
                    type="button"
                    aria-pressed={typeFilter === 'coupon'}
                    onClick={() => setTypeFilter('coupon')}
                  >
                    Kupon
                  </button>
                </div>

                <div className="segmented" role="group" aria-label="Sieć restauracji">
                  <button
                    type="button"
                    aria-pressed={brandFilter === 'all'}
                    onClick={() => setBrandFilter('all')}
                  >
                    Wszystkie sieci
                  </button>
                  {brands.map((brand) => (
                    <button
                      key={brand.id}
                      type="button"
                      aria-pressed={brandFilter === brand.id}
                      onClick={() => setBrandFilter(brand.id)}
                    >
                      {brand.shortName}
                    </button>
                  ))}
                </div>

                <div className="segmented" role="group" aria-label="Tryb wyboru wariantów">
                  <button
                    type="button"
                    aria-pressed={presetMode === 'max' && Object.keys(customSelections).length === 0}
                    onClick={() => handlePresetSwitch('max')}
                    title={
                      macroMode
                        ? 'Automatycznie wybiera warianty dające najwięcej białka na złotówkę'
                        : 'Automatycznie wybiera warianty dające najwięcej kcal/zł'
                    }
                  >
                    {macroMode ? 'Maks. białko/zł' : 'Maks. kcal/zł'}
                  </button>
                  <button
                    type="button"
                    aria-pressed={
                      presetMode === 'default' && Object.keys(customSelections).length === 0
                    }
                    onClick={() => handlePresetSwitch('default')}
                    title="Standardowa konfiguracja zestawu"
                  >
                    Domyślny zestaw
                  </button>
                </div>
              </div>

              <div className="search-wrap">
                <Search size={15} aria-hidden="true" />
                <input
                  type="search"
                  className="search-input"
                  placeholder="Szukaj oferty lub składnika (np. cheeseburger)..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Szukaj oferty lub składnika"
                />
              </div>
            </div>

            <div className="table-shell">
              <div className="table-scroll">
                <table className="offers-table">
                  <thead>
                    <tr>
                      <th>Poz.</th>
                      <th>Oferta</th>
                      <th aria-sort={getAriaSort('ratio')}>
                        <button
                          type="button"
                          className={`sort-btn ${sortKey === 'ratio' ? 'active' : ''}`}
                          onClick={() => handleSort('ratio')}
                        >
                          {macroMode ? 'Przelicznik (białko/zł)' : 'Przelicznik (kcal/zł)'}
                          {renderSortIcon('ratio')}
                        </button>
                      </th>
                      <th aria-sort={getAriaSort('primary')}>
                        <button
                          type="button"
                          className={`sort-btn ${sortKey === 'primary' ? 'active' : ''}`}
                          onClick={() => handleSort('primary')}
                        >
                          {macroMode ? 'Makroskładniki' : 'Kalorie'}
                          {renderSortIcon('primary')}
                        </button>
                      </th>
                      <th aria-sort={getAriaSort('price')}>
                        <button
                          type="button"
                          className={`sort-btn ${sortKey === 'price' ? 'active' : ''}`}
                          onClick={() => handleSort('price')}
                        >
                          Cena
                          {renderSortIcon('price')}
                        </button>
                      </th>
                      <th style={{ textAlign: 'right' }}>Konfiguracja</th>
                    </tr>
                  </thead>
                  <tbody key={`tbody-${macroMode}`} className="mode-morph">
                    {filteredAndSorted.length === 0 ? (
                      <tr>
                        <td colSpan={6}>
                          <div className="empty-state">
                            <strong>Brak ofert spełniających wybrane filtry</strong>
                            <p style={{ margin: '0 0 0.85rem' }}>
                              {typeFilter === 'coupon' && !hasCouponsInDataset
                                ? 'Nie dodano jeszcze aktywnych kuponów. Przełącz filtr na „Wszystkie”.'
                                : 'Zmień wyszukiwaną frazę albo wyczyść aktywne filtry.'}
                            </p>
                            <button type="button" className="reset-link-btn" onClick={clearFilters}>
                              Wyczyść filtry
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      filteredAndSorted.map((entry, idx) => {
                        const isExpanded = expandedId === entry.offer.id;
                        const isCustomized = Boolean(customSelections[entry.offer.id]);
                        const isTopLeader =
                          isDefaultRankingSort && entry.offer.id === leader?.offer.id;
                        const activeRatio = macroMode ? entry.proteinPerPln : entry.kcalPerPln;
                        const barWidthPct = Math.max(
                          8,
                          Math.min(100, (activeRatio / maxRatioInDataset) * 100),
                        );
                        const drawerId = `drawer-${entry.offer.id}`;
                        const collageItems = entry.items.slice(0, 4);
                        const brandVer = BRAND_VERIFICATION[entry.offer.brandId];

                        return (
                          <Fragment key={entry.offer.id}>
                            <tr
                              className={`offer-row ${isExpanded ? 'expanded' : ''} ${isTopLeader ? 'is-leader' : ''}`}
                            >
                              <td className={`rank-cell ${isTopLeader ? 'top' : ''}`}>
                                #{idx + 1}
                              </td>
                              <td className="offer-main-cell">
                                <div className="offer-identity">
                                  <div className="offer-thumb">
                                    {entry.offer.image ? (
                                      <img
                                        src={entry.offer.image}
                                        alt={`${entry.brand.shortName} ${entry.offer.name}`}
                                        loading="lazy"
                                      />
                                    ) : (
                                      <div
                                        className={`thumb-collage thumb-collage--n${collageItems.length}`}
                                      >
                                        {collageItems.map(({ slot, item }) =>
                                          item.image ? (
                                            <img
                                              key={slot.id}
                                              src={item.image}
                                              alt=""
                                              loading="lazy"
                                            />
                                          ) : (
                                            <span
                                              key={slot.id}
                                              className="img-fallback img-fallback--sm"
                                              aria-hidden="true"
                                            >
                                              {itemMonogram(item.name)}
                                            </span>
                                          ),
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  <div>
                                    <div className="offer-title-line">
                                      <span className="offer-name">{entry.offer.name}</span>
                                      <span className="offer-brand-inline">
                                        {entry.brand.shortName}
                                      </span>
                                      <span className={`type-badge ${entry.offer.offerType}`}>
                                        {entry.offer.offerType === 'coupon'
                                          ? 'Kupon'
                                          : 'Stała oferta'}
                                      </span>
                                      {isCustomized && (
                                        <span className="delta-tag">Zmieniono</span>
                                      )}
                                    </div>
                                    <div className="offer-active-summary">
                                      {entry.items
                                        .map((x) =>
                                          formatSlotItemLabel(x.item.name, x.slot.quantity),
                                        )
                                        .join(' + ')}
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="ratio-cell">
                                <div className="ratio-primary">
                                  {formatRatio(activeRatio)}{' '}
                                  <span style={{ fontSize: '0.78rem', fontWeight: 500 }}>
                                    {macroMode ? 'g B/zł' : 'kcal/zł'}
                                  </span>
                                </div>
                                <div className="ratio-bar-track" aria-hidden="true">
                                  <div
                                    className="ratio-bar-fill"
                                    style={{ width: `${barWidthPct}%` }}
                                  />
                                </div>
                                {macroMode ? (
                                  <div className="cell-sub">
                                    {entry.isCustomizable
                                      ? `Zakres: ${formatRatio(entry.minProteinPerPln)}–${formatRatio(entry.maxProteinPerPln)} • `
                                      : ''}
                                    {formatRatio(entry.kcalPerPln)} kcal/zł
                                  </div>
                                ) : (
                                  entry.isCustomizable && (
                                    <div className="cell-sub">
                                      Zakres: {formatRatio(entry.minKcalPerPln)}–
                                      {formatRatio(entry.maxKcalPerPln)}
                                    </div>
                                  )
                                )}
                              </td>
                              <td className="kcal-cell">
                                {macroMode ? (
                                  <>
                                    <div className="cell-primary">
                                      B: {formatRatio(entry.totalProteinG)} g
                                    </div>
                                    <div className="cell-sub">
                                      T: {formatRatio(entry.totalFatG)}g • W:{' '}
                                      {formatRatio(entry.totalCarbsG)}g •{' '}
                                      {formatInt(entry.totalKcal)} kcal
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <div className="cell-primary">
                                      {formatInt(entry.totalKcal)} kcal
                                    </div>
                                    {entry.isCustomizable && (
                                      <div className="cell-sub">
                                        {formatInt(entry.minKcal)}–{formatInt(entry.maxKcal)} kcal
                                      </div>
                                    )}
                                  </>
                                )}
                              </td>
                              <td className="price-cell">
                                <div className="cell-primary">
                                  {formatPln(entry.totalPricePln)} zł
                                </div>
                                <div className="cell-sub" title={entry.offer.priceNote}>
                                  {brandVer?.priceStatus === 'verified'
                                    ? 'sprawdzone źródło'
                                    : entry.offer.source.priceVerifiedBy === 'regulamin'
                                      ? 'manualne (regulamin)'
                                      : 'manualne'}
                                </div>
                              </td>
                              <td className="actions-cell">
                                <button
                                  type="button"
                                  className="customize-btn"
                                  aria-expanded={isExpanded}
                                  aria-controls={drawerId}
                                  aria-label={`${entry.isCustomizable ? 'Dostosuj' : 'Pokaż skład'} ${entry.brand.shortName} ${entry.offer.name}`}
                                  onClick={() =>
                                    setExpandedId(isExpanded ? null : entry.offer.id)
                                  }
                                >
                                  {entry.isCustomizable ? 'Dostosuj' : 'Skład'}
                                  {isExpanded ? (
                                    <ChevronUp size={15} aria-hidden="true" />
                                  ) : (
                                    <ChevronDown size={15} aria-hidden="true" />
                                  )}
                                </button>
                              </td>
                            </tr>

                            {isExpanded && (
                              <tr id={drawerId} className="drawer-row">
                                <td colSpan={6}>
                                  <div className="drawer-content">
                                    <div className="drawer-header">
                                      <div>
                                        <strong>{entry.offer.description}</strong>
                                        {entry.offer.priceNote && (
                                          <div className="cell-sub">{entry.offer.priceNote}</div>
                                        )}
                                      </div>
                                      <div className="drawer-macros">
                                        <span>
                                          Białko:{' '}
                                          <strong>{formatRatio(entry.totalProteinG)} g</strong>
                                        </span>
                                        <span>
                                          Tłuszcz: <strong>{formatRatio(entry.totalFatG)} g</strong>
                                          {macroMode && (
                                            <span className="cell-sub">
                                              {' '}
                                              (nasyc. {formatRatio(entry.totalSatFatG)} g)
                                            </span>
                                          )}
                                        </span>
                                        <span>
                                          Węglowodany:{' '}
                                          <strong>{formatRatio(entry.totalCarbsG)} g</strong>
                                          {macroMode && (
                                            <span className="cell-sub">
                                              {' '}
                                              (cukry {formatRatio(entry.totalSugarsG)} g)
                                            </span>
                                          )}
                                        </span>
                                        {macroMode && (
                                          <>
                                            <span>
                                              Sól:{' '}
                                              <strong>{formatPln(entry.totalSaltG)} g</strong>
                                            </span>
                                            <span>
                                              Energia:{' '}
                                              <strong>{formatInt(entry.totalKj)} kJ</strong>
                                            </span>
                                            <span>
                                              Białko/zł:{' '}
                                              <strong>{formatRatio(entry.proteinPerPln)} g/zł</strong>
                                            </span>
                                          </>
                                        )}
                                      </div>
                                    </div>

                                    <div className="slots-grid">
                                      {entry.offer.slots.map((slot) => {
                                        const activeId = entry.selections[slot.id];
                                        const qty = slot.quantity ?? 1;
                                        const slotHeadingId = `slot-${entry.offer.id}-${slot.id}`;
                                        return (
                                          <div
                                            key={slot.id}
                                            className="slot-box"
                                            role="group"
                                            aria-labelledby={slotHeadingId}
                                          >
                                            <div id={slotHeadingId} className="slot-label">
                                              {slot.label}
                                              {qty > 1 ? ` (${qty}×)` : ''}
                                            </div>
                                            <div className="slot-options">
                                              {slot.options.map((opt) => {
                                                const item = itemsById.get(opt.itemId);
                                                if (!item) return null;
                                                const isSelected = activeId === item.id;
                                                return (
                                                  <button
                                                    key={item.id}
                                                    type="button"
                                                    className="slot-opt-btn"
                                                    aria-pressed={isSelected}
                                                    onClick={() =>
                                                      handleSelectOption(
                                                        entry.offer,
                                                        slot.id,
                                                        item.id,
                                                      )
                                                    }
                                                  >
                                                    <span className="slot-opt-left">
                                                      {item.image ? (
                                                        <img
                                                          src={item.image}
                                                          alt=""
                                                          className="slot-opt-img"
                                                          loading="lazy"
                                                        />
                                                      ) : (
                                                        <span
                                                          className="img-fallback img-fallback--opt"
                                                          aria-hidden="true"
                                                        >
                                                          {itemMonogram(item.name)}
                                                        </span>
                                                      )}
                                                      <span className="slot-opt-name">
                                                        {formatSlotItemLabel(item.name, qty)}
                                                      </span>
                                                    </span>
                                                    <span className="slot-opt-meta">
                                                      {opt.badge ? (
                                                        <span className="delta-tag">
                                                          {opt.badge}
                                                        </span>
                                                      ) : opt.priceDeltaPln ? (
                                                        <span className="delta-tag">
                                                          +{formatPln(opt.priceDeltaPln)} zł
                                                        </span>
                                                      ) : null}
                                                      {macroMode ? (
                                                        <span>
                                                          {formatRatio(item.nutrition.proteinG * qty)}g B
                                                        </span>
                                                      ) : (
                                                        <span>{item.nutrition.kcal * qty} kcal</span>
                                                      )}
                                                    </span>
                                                  </button>
                                                );
                                              })}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>

                                    <div className="drawer-footer">
                                      <div>
                                        Źródło oferty:{' '}
                                        {entry.offer.source.url ? (
                                          <a
                                            href={entry.offer.source.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                          >
                                            {entry.offer.source.label}{' '}
                                            <ExternalLink
                                              size={12}
                                              aria-hidden="true"
                                              style={{ display: 'inline', verticalAlign: 'middle' }}
                                            />
                                          </a>
                                        ) : (
                                          entry.offer.source.label
                                        )}{' '}
                                        | Kalorie i makro: <strong>oficjalna tabela</strong> | Ceny:{' '}
                                        <strong>
                                          {brandVer?.priceLabel ?? 'weryfikowane'}
                                        </strong>{' '}
                                        | Dodano: <span className="mono">{entry.offer.addedAt}</span>
                                        {entry.offer.validUntil
                                          ? ` | Ważne do: ${entry.offer.validUntil}`
                                          : ''}
                                      </div>
                                      {isCustomized && (
                                        <button
                                          type="button"
                                          className="reset-link-btn"
                                          onClick={() => handleResetOffer(entry.offer.id)}
                                        >
                                          <RotateCcw
                                            size={12}
                                            aria-hidden="true"
                                            style={{
                                              display: 'inline',
                                              marginRight: '0.35rem',
                                              verticalAlign: 'middle',
                                            }}
                                          />
                                          Przywróć tryb globalny
                                        </button>
                                      )}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        <section id="zrodla" className="sources-section" aria-labelledby="sources-heading">
          <div className="container">
            <h2 id="sources-heading" className="section-title">
              Weryfikacja danych i oficjalne tabele
            </h2>
            <p className="section-sub">
              Wszystkie wartości kaloryczne i makroskładniki (białko, tłuszcze, węglowodany, cukry,
              sól) pochodzą w 100% ze sprawdzonych oficjalnych tabel producentów w Polsce. Poniżej
              podsumowanie statusu źródeł cen i kalorii dla każdej sieci.
            </p>

            <div className="verification-grid">
              {brands.map((brand) => {
                const ver = BRAND_VERIFICATION[brand.id];
                return (
                  <div key={brand.id} className="verification-card">
                    <div className="verification-head">
                      <span className="verification-brand">
                        <span
                          className="brand-dot"
                          style={{ backgroundColor: brand.accentColor }}
                          aria-hidden="true"
                        />
                        <strong>{brand.name}</strong>
                      </span>
                    </div>
                    <div className="verification-pills">
                      <span className="ver-pill ok">
                        <CheckCircle2 size={13} aria-hidden="true" />
                        Kalorie i makro: sprawdzone (oficjalna tabela)
                      </span>
                      <span
                        className={`ver-pill ${ver?.priceStatus === 'verified' ? 'ok' : 'manual'}`}
                      >
                        {ver?.priceStatus === 'verified' ? (
                          <CheckCircle2 size={13} aria-hidden="true" />
                        ) : (
                          <PencilLine size={13} aria-hidden="true" />
                        )}
                        Ceny: {ver?.priceLabel ?? 'manualne'}
                      </span>
                    </div>
                    <p className="verification-desc">{ver?.priceDetail}</p>
                  </div>
                );
              })}
            </div>

            <div className="sources-grid">
              {officialSources.map((src) => {
                const brand = brandsById.get(src.brandId);
                return (
                  <article key={src.id} className="source-card">
                    <h3>{src.title}</h3>
                    <p>
                      Zapisano <strong className="mono">{src.itemCount}</strong> pozycji z
                      oficjalnej tabeli wartości odżywczych sieci {brand?.name ?? src.brandId}{' '}
                      (kcal, białko, tłuszcze, nasycone, węglowodany, cukry, sól).
                    </p>
                    <div className="source-meta">
                      <span className="mono">Aktualizacja: {src.fetchedAt}</span>
                      <a href={src.sourceUrl} target="_blank" rel="noopener noreferrer">
                        Oficjalna tabela na stronie sieci
                      </a>
                    </div>
                  </article>
                );
              })}

              <article className="source-card">
                <h3>Katalog modułowy i kreator</h3>
                <p>
                  Baza łączy <strong className="mono">{items.length}</strong> pozycji zestawowych
                  oraz <strong className="mono">{creatorCatalog.length}</strong> produktów
                  dostępnych w manualnym kreatorze. Przełącznik{' '}
                  <strong className="mono">makro/zł</strong> zmienia całą analizę na białko/zł i
                  pełne makroskładniki.
                </p>
                <div className="source-meta">
                  <span className="mono">
                    Stałe: {offers.filter((o) => o.offerType === 'regular').length} | Kupony:{' '}
                    {offers.filter((o) => o.offerType === 'coupon').length}
                  </span>
                  <span>Oficjalne dane żywieniowe</span>
                </div>
              </article>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="container footer-inner">
          <span>
            {macroMode ? 'makro/zł' : 'kcal/zł'} — kalorie i makroskładniki sprawdzone w oficjalnych
            tabelach producentów w Polsce.
          </span>
          <span>Ceny KFC: sprawdzone źródło • McDonald’s i Popeyes: manualne.</span>
        </div>
      </footer>
    </div>
  );
}
