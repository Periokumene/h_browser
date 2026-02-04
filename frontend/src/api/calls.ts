import type {
  ActorInfoResponse,
  FilterOptions,
  ItemsListResponse,
  ListFilters,
  ListScope,
  MediaDetail,
  SortMode,
} from "../types/api";
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

export type { ListScope };

export interface FetchItemsParams {
  page: number;
  page_size: number;
  q?: string;
  filters: ListFilters;
  scope?: ListScope;
  actor?: string;
  sort_mode?: SortMode;
  seed?: string;
  /** 是否按「有书签」过滤：true=仅含书签，false=仅不含书签，不传=不过滤 */
  has_bookmark?: boolean;
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
  const { page, page_size, q, filters, scope, actor, sort_mode, seed, has_bookmark } = params;
  const reqParams: Record<string, unknown> = {
    page,
    page_size,
    q: q || undefined,
    ...filtersToParams(filters),
  };
  if (scope === "favorites") reqParams.scope = "favorites";
  if (actor) reqParams.actor = actor;
  if (sort_mode) reqParams.sort_mode = sort_mode;
  if (seed !== undefined && sort_mode === "random") reqParams.seed = seed;
  if (has_bookmark !== undefined) reqParams.has_bookmark = has_bookmark;
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

export interface DataSourceConfig {
  /** 媒体库根路径（一个或多个本地/网络路径） */
  media_roots: string[];
  /** 后端是否检测到可用的 ffmpeg，可用于控制 TS→MP4 功能显隐 */
  ffmpeg_available?: boolean;
  /** 演员头像仓库源 URL；为空表示禁用头像同步 */
  avatar_source_url?: string | null;
  /** 后端启动时是否自动执行媒体库扫描 */
  scan_on_startup?: boolean;
}

/** 异步任务（Beta） */
export interface TaskItem {
  id: string;
  task_type: string;
  status: string;
  progress_pct: number | null;
  payload: { code?: string; overwrite?: boolean; temp_file_path?: string; unique_key?: string };
  result: string | null;
  error: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface TasksListResponse {
  tasks: TaskItem[];
}

export async function fetchTasks(status?: string): Promise<TasksListResponse> {
  const res = await apiClient.get<TasksListResponse>("/api/tasks", {
    params: status ? { status } : undefined,
  });
  return res.data;
}

export async function fetchTask(taskId: string): Promise<TaskItem> {
  const res = await apiClient.get<TaskItem>(`/api/tasks/${encodeURIComponent(taskId)}`);
  return res.data;
}

export interface CreateTaskPayload {
  type: "ts_to_mp4" | "gen_all_thumbnails";
  code?: string;
  overwrite?: boolean;
}

export async function createTask(payload: CreateTaskPayload): Promise<{ id: string; status: string }> {
  const res = await apiClient.post<{ id: string; status: string }>("/api/tasks", payload);
  return res.data;
}

export async function cancelTask(taskId: string): Promise<{ ok: boolean }> {
  const res = await apiClient.post<{ ok: boolean }>(`/api/tasks/${encodeURIComponent(taskId)}/cancel`);
  return res.data;
}

export async function fetchConfig(): Promise<DataSourceConfig> {
  const res = await apiClient.get<DataSourceConfig>("/api/config");
  return res.data;
}

export async function updateConfig(payload: Partial<DataSourceConfig>): Promise<DataSourceConfig> {
  const res = await apiClient.put<DataSourceConfig>("/api/config", payload);
  return res.data;
}

export async function setItemFavorite(code: string, favorite: boolean): Promise<{ ok: boolean; favorite: boolean }> {
  const res = await apiClient.put<{ ok: boolean; favorite: boolean }>(
    `/api/items/${encodeURIComponent(code)}/favorite`,
    { favorite }
  );
  return res.data;
}

export async function fetchActorInfo(name: string): Promise<ActorInfoResponse> {
  const res = await apiClient.get<ActorInfoResponse>(
    `/api/actors/${encodeURIComponent(name)}`
  );
  return res.data;
}

export interface ExtrafanartResponse {
  urls: string[];
  /** 与 urls 同序，每项为 [width, height]，读不出时为 [0,0] */
  dimensions: [number, number][];
}

export async function fetchExtrafanart(code: string): Promise<ExtrafanartResponse> {
  const res = await apiClient.get<ExtrafanartResponse>(
    `/api/items/${encodeURIComponent(code)}/extrafanart`
  );
  return res.data;
}

/** 缩略图状态：200 表示已就绪并返回 URL；202 表示生成中。 */
export interface ThumbnailsReadyResponse {
  vtt_url: string;
  sprite_url: string;
}

export interface ThumbnailsGeneratingResponse {
  status: "generating";
  task_id: string | null;
}

/**
 * 请求该编号的缩略图状态。200 时返回 vtt_url、sprite_url；202 时表示正在生成，含 task_id 供轮询。
 * 调用方需根据 HTTP 状态或返回字段区分就绪与生成中。
 */
export async function fetchThumbnails(
  code: string
): Promise<
  | { status: 200; vtt_url: string; sprite_url: string }
  | { status: 202; task_id: string | null }
> {
  const res = await apiClient.get<ThumbnailsReadyResponse | ThumbnailsGeneratingResponse>(
    `/api/items/${encodeURIComponent(code)}/thumbnails`
  );
  if (res.status === 200 && "vtt_url" in res.data) {
    return { status: 200, vtt_url: res.data.vtt_url, sprite_url: res.data.sprite_url };
  }
  const data = res.data as ThumbnailsGeneratingResponse;
  return { status: 202, task_id: data.task_id ?? null };
}

/** 字幕列表项（后端 /api/subtitles 返回，vttUrl 已指向本后端代理且 SRT 会转 WebVTT） */
export interface SubtitleListItem {
  gcid: string;
  cid: string;
  url: string;
  ext: string;
  name: string;
  duration: number;
  score: number;
  languages: string[];
  extra_name: string;
  vttUrl: string;
}

export async function fetchSubtitles(code: string): Promise<SubtitleListItem[]> {
  const res = await apiClient.get<{ list: SubtitleListItem[] }>("/api/subtitles", {
    params: { name: code },
  });
  return res.data?.list ?? [];
}

/** 单个编号的字幕偏好设置；gcid 为 null 表示「明确选择不使用字幕」 */
export interface SubtitlePreference {
  code: string;
  gcid: string | null;
  offset_seconds: number | null;
}

export async function fetchSubtitlePreference(code: string): Promise<SubtitlePreference | null> {
  try {
    const res = await apiClient.get<SubtitlePreference>(
      `/api/items/${encodeURIComponent(code)}/subtitle_pref`,
    );
    return res.data;
  } catch (err: any) {
    if (err?.response?.status === 404) {
      return null;
    }
    throw err;
  }
}

export async function saveSubtitlePreference(
  code: string,
  payload: { gcid: string | null; offset_seconds: number | null },
): Promise<SubtitlePreference> {
  const res = await apiClient.put<SubtitlePreference>(
    `/api/items/${encodeURIComponent(code)}/subtitle_pref`,
    payload,
  );
  return res.data;
}
