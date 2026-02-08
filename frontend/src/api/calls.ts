import type { FilterOptions, ItemsListResponse, ListFilters, MediaDetail } from "../types/api";
import { apiClient } from "./client";

function serializeParams(params: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      v.forEach((vv) =>
        parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(vv))}`)
      );
    } else {
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.join("&");
}

function filtersToParams(filters: ListFilters): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (filters.genres?.length) params.genre = filters.genres;
  if (filters.tags?.length) params.tag = filters.tags;
  params.filter_mode = filters.filterMode;
  return params;
}

export interface FetchItemsParams {
  page: number;
  page_size: number;
  q?: string;
  filters: ListFilters;
}

export async function fetchItem(code: string): Promise<MediaDetail> {
  const res = await apiClient.get<MediaDetail>(`/api/items/${encodeURIComponent(code)}`);
  return res.data;
}

export interface UpdateItemMetadataPayload {
  genres: string[];
  tags: string[];
}

export async function updateItemMetadata(
  code: string,
  payload: UpdateItemMetadataPayload
): Promise<{ ok: boolean }> {
  const res = await apiClient.patch<{ ok: boolean }>(
    `/api/items/${encodeURIComponent(code)}/metadata`,
    payload
  );
  return res.data;
}

export async function fetchItems(params: FetchItemsParams): Promise<ItemsListResponse> {
  const { page, page_size, q, filters } = params;
  const reqParams = {
    page,
    page_size,
    q: q || undefined,
    ...filtersToParams(filters),
  };
  const res = await apiClient.get<ItemsListResponse>("/api/items", {
    params: reqParams,
    paramsSerializer: (p: Record<string, unknown>) => serializeParams(p),
  });
  return res.data;
}

export async function fetchFilters(): Promise<FilterOptions> {
  const res = await apiClient.get<FilterOptions>("/api/filters");
  return { genres: res.data.genres || [], tags: res.data.tags || [] };
}

export async function postScan(): Promise<{ processed: number }> {
  const res = await apiClient.post<{ processed: number }>("/api/scan");
  return res.data;
}

export interface MediaLibraryConfig {
  media_roots: string[];
}

export async function fetchConfig(): Promise<MediaLibraryConfig> {
  const res = await apiClient.get<MediaLibraryConfig>("/api/config");
  return res.data;
}

export async function updateConfig(payload: Partial<MediaLibraryConfig>): Promise<MediaLibraryConfig> {
  const res = await apiClient.put<MediaLibraryConfig>("/api/config", payload);
  return res.data;
}
