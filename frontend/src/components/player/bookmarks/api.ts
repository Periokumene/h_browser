/**
 * 书签 API：与后端 /api/items/<code>/bookmarks 通信。
 * 后端 id 统一以字符串形式返回，与 Bookmark.id 类型一致。
 */

import { apiClient } from "../../../api/client";

export interface Bookmark {
  id: string;
  time: number;
  comment: string;
}

function toBookmark(raw: { id: string | number; time: number; comment: string }): Bookmark {
  return {
    id: String(raw.id),
    time: Number(raw.time),
    comment: String(raw.comment ?? ""),
  };
}

/** 获取该视频的书签列表，按 time 升序 */
export async function fetchBookmarks(videoCode: string): Promise<Bookmark[]> {
  const res = await apiClient.get<{ bookmarks: Bookmark[] }>(
    `/api/items/${encodeURIComponent(videoCode)}/bookmarks`
  );
  const list = res.data?.bookmarks ?? [];
  return list.map(toBookmark);
}

/** 添加书签，返回带 id 的完整书签 */
export async function addBookmark(
  videoCode: string,
  time: number,
  comment: string
): Promise<Bookmark> {
  const res = await apiClient.post<{ id: string; time: number; comment: string }>(
    `/api/items/${encodeURIComponent(videoCode)}/bookmarks`,
    { time, comment: comment.trim() || "未命名书签" }
  );
  return toBookmark(res.data);
}

/** 更新书签注释 */
export async function updateBookmark(
  videoCode: string,
  bookmarkId: string,
  patch: { comment: string }
): Promise<void> {
  await apiClient.patch(
    `/api/items/${encodeURIComponent(videoCode)}/bookmarks/${encodeURIComponent(bookmarkId)}`,
    { comment: patch.comment.trim() || "未命名书签" }
  );
}

/** 删除书签 */
export async function deleteBookmark(videoCode: string, bookmarkId: string): Promise<void> {
  await apiClient.delete(
    `/api/items/${encodeURIComponent(videoCode)}/bookmarks/${encodeURIComponent(bookmarkId)}`
  );
}
