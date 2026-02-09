/** 与后端 API 一致的共享类型，供 api 层与页面复用 */

export interface MediaItem {
  code: string;
  title?: string;
  video_type?: string;
  has_video: boolean;
  poster_url?: string;
  is_favorite?: boolean;
  actors?: string[];
}

export interface Actor {
  name: string;
  role?: string;
  thumb?: string | null;
}

export interface Metadata {
  rating?: number | null;
  userrating?: number | null;
  votes?: number | null;
  year?: number | null;
  premiered?: string | null;
  runtime?: number | null;
  genres?: string[];
  tags?: string[];
  country?: string | null;
  director?: string | null;
  studio?: string | null;
  actors?: Actor[];
  outline?: string | null;
}

export interface MediaDetail {
  code: string;
  title?: string | null;
  description?: string | null;
  video_type?: string | null;
  has_video: boolean;
  poster_url?: string;
  is_favorite?: boolean;
  metadata?: Metadata;
}

export type FilterRuleMode = "and" | "or";

export type ListScope = "all" | "favorites";

export interface ListFilters {
  genres: string[];
  tags: string[];
  filterMode: FilterRuleMode;
}

export interface FilterOptionItem {
  name: string;
  count: number;
}

export interface FilterOptions {
  genres: FilterOptionItem[];
  tags: FilterOptionItem[];
}

export interface ItemsListResponse {
  page: number;
  page_size: number;
  total: number;
  items: MediaItem[];
}
