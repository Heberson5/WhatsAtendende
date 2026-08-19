import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "../lib/api";

export interface Branding {
  companyName: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string | null;
  faviconUrl: string | null;
}

export function useBranding() {
  const query = useQuery({
    queryKey: ["branding"],
    queryFn: async () => (await api.get<Branding>("/settings/branding")).data,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!query.data) return;
    document.documentElement.style.setProperty("--color-primary", query.data.primaryColor);
    document.documentElement.style.setProperty("--color-secondary", query.data.secondaryColor);
    document.title = query.data.companyName;
    if (query.data.faviconUrl) {
      const link = document.getElementById("app-favicon") as HTMLLinkElement | null;
      if (link) link.href = query.data.faviconUrl;
    }
  }, [query.data]);

  return query;
}
