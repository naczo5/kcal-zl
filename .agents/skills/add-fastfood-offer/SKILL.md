---
name: add-fastfood-offer
description: Dodawanie nowych ofert, zestawów i kuponów fast food do strony kcal-zl z użyciem zapisanych oficjalnych tabel wartości odżywczych, modułowego katalogu produktów i walidacji projektu.
---

# Dodawanie oferty lub kuponu do `kcal-zl`

Używaj tego skilla zawsze, gdy użytkownik prosi o dodanie nowego zestawu, pojedynczej oferty albo tymczasowego kuponu (np. z aplikacji McDonald's, Popeyes, KFC, Burger King).

## Zasady nadrzędne

1. **Oficjalne dane żywieniowe ponad zgadywanie**: najpierw przeszukuj zapisane lokalnie oficjalne tabele w [src/data/sources/](../../../src/data/sources/). Jeśli sieci lub nowej pozycji sezonowej jeszcze tam nie ma, sprawdź oficjalną polską tabelę wartości odżywczych publikowaną przez producenta i dodaj ją jako nowy plik JSON w `src/data/sources/<brand>-pl.json`.
2. **Modułowość pozycji**: nigdy nie duplikuj tych samych produktów w `src/data/items.json`. Jeśli nowy kupon lub zestaw używa np. `Cheeseburger` czy `Frytki Małe`, użyj istniejącego `itemId` (`mcd-cheeseburger`, `mcd-frytki-male`).
3. **Jeden wiersz dla oferty konfigurowalnej**: zestawy z opcjami wyboru modeluj przez tablicę `slots` wewnątrz jednego obiektu w `src/data/offers.json` (nie twórz osobnych wierszy dla każdego wariantu smakowego).
4. **Rozróżnienie kupon vs stała oferta**:
   - `"offerType": "coupon"` — dla tymczasowych kuponów z aplikacji lub promocji ograniczonych czasowo (uzupełnij `validUntil` w formacie `YYYY-MM-DD`, jeśli znane, oraz `"priceVerifiedBy": "user"`).
   - `"offerType": "regular"` — dla stałych pozycji i zestawów z cennika/regulaminu.
5. **Brak danych wewnętrznych i nieoficjalnych cenników**: nie umieszczaj w repozytorium ani w polach `source.label` / `priceNote` żadnych wewnętrznych nazw technicznych, metod zbierania danych ani niezweryfikowanych cenników zewnętrznych.

## Zweryfikowany proces krok po kroku

### Krok 1: Sprawdź istniejące produkty i zapisane tabele

Uruchom skrypt wyszukujący (niewrażliwy na wielkość liter i polskie znaki diakrytyczne) w `src/data/items.json` oraz we wszystkich plikach `src/data/sources/*.json`:

```bash
npm run find-nutrition -- "nazwa produktu"
```

Jeśli produkt już istnieje w `src/data/items.json`, zanotuj jego `id` i przejdź do Kroku 3 (lub Kroku 4, jeśli wszystkie składniki już istnieją).

### Krok 2: Jeśli brakuje sieci lub nowej pozycji w tabeli oficjalnej

1. Sprawdź oficjalną polską tabelę wartości odżywczych na stronie producenta (`mcdonalds.pl`, `kfc.pl`, `popeyeschicken.pl`).
2. Dla nowej sieci zapisz sparsowane rekordy do `src/data/sources/<brand>-pl.json` (z polami `id`, `brandId`, `kind: "nutrition-official"`, `title`, `sourceUrl`, `fetchedAt`, `itemCount`, `items`) oraz dodaj wpis sieci w [src/data/brands.json](../../../src/data/brands.json) ze wszystkimi wymaganymi polami (`id`, `name`, `shortName`, `accentColor`, `officialSite`, `nutritionSourceId`).
3. Jeśli wartość dla porcji została wyliczona matematycznie z oficjalnej wartości na 100 g/ml (zamiast osobnego wiersza w tabeli), oznacz `"verified": "derived"` i dopisz wyjaśnienie w `source.note`.

### Krok 3: Dodaj brakujące produkty modułowe i zdjęcia

Dla każdego nowego składnika, którego nie ma jeszcze w [src/data/items.json](../../../src/data/items.json):

1. Zapisz oficjalne zdjęcie (packshot) produktu lokalnie w `public/images/items/<item-id>.<ext>` (`.webp`, `.jpg` lub `.png`). Upewnij się, że plik nie jest pusty ani stroną błędu HTML.
2. Dodaj obiekt do `src/data/items.json`:
   - dozwolone wartości `category`: `"burger" | "wrap" | "chicken" | "fries" | "drink" | "dessert" | "sauce"`,
   - `tableRowName` przy `"verified": "official"` musi dokładnie odpowiadać nazwie wiersza `name` w pliku `src/data/sources/*.json`.

```json
{
  "id": "mcd-big-mac",
  "brandId": "mcdonalds",
  "name": "Big Mac®",
  "category": "burger",
  "portionLabel": "1 porcja",
  "image": "./images/items/mcd-big-mac.jpg",
  "nutrition": {
    "kcal": 544,
    "kj": 2273,
    "proteinG": 27,
    "fatG": 29,
    "carbsG": 42,
    "sugarsG": 8.8,
    "saltG": 2.3
  },
  "source": {
    "sourceId": "mcdonalds-pl-2026-11",
    "tableRowName": "Big Mac®",
    "verified": "official"
  }
}
```

### Krok 4: Dodaj ofertę lub kupon do `src/data/offers.json`

1. Jeśli oferta ma dedykowany packshot zestawu/kuponu, zapisz go w `public/images/offers/<offer-id>.<ext>` i wskaż w polu `"image"`. Jeśli oferta nie ma jednego oficjalnego zdjęcia zestawu (np. zestaw konfigurowalny), pomiń `"image"` — interfejs automatycznie wyrenderuje kolaż z pierwszych 4 aktywnych składników zestawu.
2. Dodaj wpis do [src/data/offers.json](../../../src/data/offers.json) z wszystkimi wymaganymi polami (`id`, `brandId`, `name`, `offerType`, `pricePln`, `description`, `addedAt`, `source.label`, `source.priceVerifiedBy`, `slots`).

### Krok 5: Walidacja, generowanie embedów i test buildu (obowiązkowe!)

Po każdej zmianie uruchom walidację danych, regenerację SVG/SEO oraz pełny build TypeScript + Vite:

```bash
npm run validate && npm run build
```

Zanim odpowiesz użytkownikowi, upewnij się, że oba polecenia zakończyły się kodem `0`.
