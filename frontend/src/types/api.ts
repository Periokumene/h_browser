/** 与后端 API 一致的共享类型，供 api 层与页面复用 */

export interface MediaItem {
  code: string;
  title?: string;
  has_video: boolean;
  has_mp4?: boolean;
  has_ts?: boolean;
  poster_url?: string;
  is_favorite?: boolean;
  /** 该条目是否至少有一条书签（列表接口返回，可选用于筛选与展示） */
  has_bookmark?: boolean;
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
  has_video: boolean;
  has_mp4?: boolean;
  has_ts?: boolean;
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

export type SortMode = "code" | "time" | "random";

export interface ActorInfoResponse {
  name: string;
  intro: string;
  image_url: string | null;
  codes: string[];
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
