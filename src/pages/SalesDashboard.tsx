/**
 * Cruscotto di vendita: risponde alla domanda che Alberto fa senza doverla
 * cercare offerta per offerta ("quante analisi strategiche abbiamo venduto
 * quest'anno") e alle domande strategiche che la seguono, mix ricorrente e
 * conversione. Le viste sono già in piedi lato database (sales_by_product,
 * sales_by_salesperson, revenue_mix, offer_conversion), qui solo lettura.
 */
import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatCurrency } from '@/lib/utils';
import { RevenueByCategoryChart } from '@/components/sales/RevenueByCategoryChart';
import { TopProductsTable } from '@/components/sales/TopProductsTable';
import { RevenueMixSection } from '@/components/sales/RevenueMixSection';
import { ConversionSection } from '@/components/sales/ConversionSection';
import { SalesBySalespersonChart } from '@/components/sales/SalesBySalespersonChart';
import {
  useOfferConversion,
  useRevenueMix,
  useSalesByProduct,
  useSalesBySalesperson,
  useSalesYears,
} from '@/components/sales/useSalesData';

const CardSkeleton = () => <div className="animate-pulse h-40 bg-muted rounded-md" />;

const SalesDashboard = () => {
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  const { data: years = [], isLoading: isLoadingYears } = useSalesYears();
  const currentCalendarYear = new Date().getFullYear();
  const defaultYear = years.includes(currentCalendarYear) ? currentCalendarYear : years[0] ?? null;
  const year = selectedYear ?? defaultYear;

  const { data: byProduct = [], isLoading: isLoadingByProduct } = useSalesByProduct(year);
  const { data: bySalesperson = [], isLoading: isLoadingBySalesperson } = useSalesBySalesperson(year);
  const { data: revenueMix, isLoading: isLoadingMix } = useRevenueMix(year);
  const { data: conversion = [], isLoading: isLoadingConversion } = useOfferConversion(year);

  const vendutoTotale = useMemo(() => {
    if (revenueMix) return Number(revenueMix.totale ?? 0);
    return byProduct.reduce((sum, r) => sum + Number(r.venduto ?? 0), 0);
  }, [revenueMix, byProduct]);

  const offerteAccettate = useMemo(
    () => conversion.reduce((sum, r) => sum + Number(r.accettate ?? 0), 0),
    [conversion]
  );

  if (!isLoadingYears && years.length === 0) {
    return (
      <div className="container mx-auto p-6">
        <h1 className="text-2xl font-bold">Cruscotto vendite</h1>
        <div className="empty-state">
          <p className="empty-state-text">Nessuna offerta ancora registrata: il cruscotto si popola alla prima offerta uscita.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Cruscotto vendite</h1>
          <p className="mt-1 text-muted-foreground">Venduto, mix ricavi e conversione delle offerte.</p>
        </div>
        <Select
          value={year !== null ? String(year) : undefined}
          onValueChange={(v) => setSelectedYear(Number(v))}
          disabled={years.length === 0}
        >
          <SelectTrigger className="w-[120px]">
            <SelectValue placeholder="Anno" />
          </SelectTrigger>
          <SelectContent className="bg-background border z-50">
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Hero: il numero con cui il cruscotto apre */}
      <Card>
        <CardContent className="pt-6">
          {isLoadingMix ? (
            <CardSkeleton />
          ) : (
            <>
              <div className="text-5xl font-bold text-foreground">{formatCurrency(vendutoTotale)}</div>
              <p className="mt-2 text-muted-foreground">
                Venduto {year}
                {offerteAccettate > 0 && ` · ${offerteAccettate} offerte accettate`}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {/* 1. Venduto per categoria di ricavo + classifica prodotti */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Venduto per categoria</CardTitle>
            <CardDescription>Confronto tra le categorie di ricavo nel {year}</CardDescription>
          </CardHeader>
          <CardContent>{isLoadingByProduct ? <CardSkeleton /> : <RevenueByCategoryChart rows={byProduct} />}</CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Classifica prodotti</CardTitle>
            <CardDescription>Quanto è stato venduto di ciascun prodotto nel {year}</CardDescription>
          </CardHeader>
          <CardContent>{isLoadingByProduct ? <CardSkeleton /> : <TopProductsTable rows={byProduct} />}</CardContent>
        </Card>
      </div>

      {/* 2. Mix ricorrente / una tantum */}
      <Card>
        <CardHeader>
          <CardTitle>Mix ricorrente e una tantum</CardTitle>
          <CardDescription>Quanto del venduto {year} è fatturato prevedibile</CardDescription>
        </CardHeader>
        <CardContent>{isLoadingMix ? <CardSkeleton /> : <RevenueMixSection mix={revenueMix} year={year ?? currentCalendarYear} />}</CardContent>
      </Card>

      {/* 3. Conversione delle offerte */}
      <Card>
        <CardHeader>
          <CardTitle>Conversione delle offerte</CardTitle>
          <CardDescription>Quante offerte uscite diventano accettate, in quanti giorni, e cosa resta in pipeline</CardDescription>
        </CardHeader>
        <CardContent>{isLoadingConversion ? <CardSkeleton /> : <ConversionSection rows={conversion} />}</CardContent>
      </Card>

      {/* 4. Venduto per commerciale */}
      <Card>
        <CardHeader>
          <CardTitle>Venduto per commerciale</CardTitle>
          <CardDescription>L'account del cliente quando c'è, altrimenti chi ha composto l'offerta</CardDescription>
        </CardHeader>
        <CardContent>{isLoadingBySalesperson ? <CardSkeleton /> : <SalesBySalespersonChart rows={bySalesperson} />}</CardContent>
      </Card>
    </div>
  );
};

export default SalesDashboard;
