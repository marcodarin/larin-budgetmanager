/**
 * Hook di lettura per le viste del cruscotto vendite. Le viste sono in RLS
 * "authenticated legge": nessuna scrittura, nessun filtro per ruolo qui (la
 * voce di menu è già ristretta ad admin/finance/account in AppHeader).
 *
 * Le viste non sono ancora nei tipi generati (src/integrations/supabase/types.ts):
 * `.from(nome as any)` bypassa il controllo statico sul nome, `.returns<T>()`
 * ripristina un tipo preciso sul risultato, stesso pattern già in uso in
 * src/pages/InvoiceQueue.tsx.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type {
  OfferConversionRow,
  RevenueMixRow,
  SalesByProductRow,
  SalesBySalespersonRow,
} from './types';

export function useSalesYears() {
  return useQuery({
    queryKey: ['sales-years'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('revenue_mix' as any)
        .select('anno')
        .returns<{ anno: number }[]>();
      if (error) throw error;
      const years = [...new Set(data.map((r) => r.anno))].sort((a, b) => b - a);
      return years;
    },
  });
}

export function useSalesByProduct(year: number | null) {
  return useQuery({
    queryKey: ['sales-by-product', year],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_by_product' as any)
        .select('*')
        .eq('anno', year)
        .returns<SalesByProductRow[]>();
      if (error) throw error;
      return data;
    },
    enabled: year !== null,
  });
}

export function useSalesBySalesperson(year: number | null) {
  return useQuery({
    queryKey: ['sales-by-salesperson', year],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_by_salesperson' as any)
        .select('*')
        .eq('anno', year)
        .returns<SalesBySalespersonRow[]>();
      if (error) throw error;
      return data;
    },
    enabled: year !== null,
  });
}

export function useRevenueMix(year: number | null) {
  return useQuery({
    queryKey: ['revenue-mix', year],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('revenue_mix' as any)
        .select('*')
        .eq('anno', year)
        .maybeSingle()
        .returns<RevenueMixRow | null>();
      if (error) throw error;
      return data;
    },
    enabled: year !== null,
  });
}

export function useOfferConversion(year: number | null) {
  return useQuery({
    queryKey: ['offer-conversion', year],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('offer_conversion' as any)
        .select('*')
        .eq('anno', year)
        .returns<OfferConversionRow[]>();
      if (error) throw error;
      return data;
    },
    enabled: year !== null,
  });
}
