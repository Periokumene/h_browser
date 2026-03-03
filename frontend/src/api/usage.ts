/**
 * 使用行为 API：播放进度、会话、心跳，与后端 usage 统计对接。
 * 单用户场景，无 device_id。
 */

import { apiClient } from "./client";

export interface PlaybackProgress {
  code: string;
  position_seconds: number;
  duration_seconds: number | null;
  updated_at: string | null;
}

/** 获取该片的播放进度，用于「继续上一次的播放」。不存在时接口返回 404。 */
export async function getProgress(videoCode: string): Promise<PlaybackProgress | null> {
  try {
    const res = await apiClient.get<PlaybackProgress>(
      `/api/items/${encodeURIComponent(videoCode)}/progress`
    );
    return res.data;
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && "response" in err) {
      const ax = err as { response?: { status?: number } };
      if (ax.response?.status === 404) return null;
    }
    throw err;
  }
}

/** 保存播放进度。 */
export async function saveProgress(
  videoCode: string,
  payload: { position_seconds: number; duration_seconds?: number }
): Promise<PlaybackProgress> {
  const res = await apiClient.put<PlaybackProgress>(
    `/api/items/${encodeURIComponent(videoCode)}/progress`,
    payload
  );
  return res.data;
}

export interface StartSessionResponse {
  id: number;
  code: string;
  started_at: string | null;
}

/** 开始一次播放会话。 */
export async function startSession(
  videoCode: string,
  payload?: Record<string, never>
): Promise<StartSessionResponse> {
  const res = await apiClient.post<StartSessionResponse>(
    `/api/items/${encodeURIComponent(videoCode)}/play/session`,
    payload ?? {}
  );
  return res.data;
}

/** 结束指定播放会话。 */
export async function endSession(
  videoCode: string,
  sessionId: number,
  payload: { watched_seconds?: number }
): Promise<void> {
  await apiClient.patch(
    `/api/items/${encodeURIComponent(videoCode)}/play/session/${sessionId}`,
    payload
  );
}

/** 更新会话的累计观看时长（秒），不修改 started_at/ended_at/位置。 */
export async function updateSessionWatched(
  videoCode: string,
  sessionId: number,
  watchedSeconds: number
): Promise<void> {
  await apiClient.patch(
    `/api/items/${encodeURIComponent(videoCode)}/play/session/${sessionId}/watched`,
    { watched_seconds: watchedSeconds }
  );
}

/** 上报当前播放位置（心跳），用于热门片段统计。仅应在视频正在播放时调用，暂停期间禁止调用。 */
export async function sendHeartbeat(
  videoCode: string,
  payload: { position_seconds: number }
): Promise<void> {
  await apiClient.post(
    `/api/items/${encodeURIComponent(videoCode)}/play/heartbeat`,
    payload
  );
}
