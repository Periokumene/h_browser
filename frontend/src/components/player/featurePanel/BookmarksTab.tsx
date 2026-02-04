/**
 * 功能面板 - 书签 Tab：垂直列表、缩略图、可编辑 comment、添加当前时间书签、删除
 */

import {
  Box,
  Button,
  IconButton,
  Input,
  Spinner,
  Text,
  useColorModeValue,
  useToast,
  VStack,
} from "@chakra-ui/react";
import { FiPlus, FiTrash2 } from "react-icons/fi";
import { useCallback, useEffect, useRef, useState } from "react";
import type { VideoJsPlayer } from "../types";
import type { Bookmark } from "../bookmarks/api";
import {
  addBookmark as apiAddBookmark,
  deleteBookmark as apiDeleteBookmark,
  updateBookmark as apiUpdateBookmark,
  fetchBookmarks,
} from "../bookmarks/api";
import { ThumbnailFrame } from "../spriteThumbnails";
import type { ThumbnailCueCss } from "../spriteThumbnails";

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export interface BookmarksTabProps {
  videoCode: string;
  player: VideoJsPlayer | null;
  onBookmarksChange: (bookmarks: Bookmark[]) => void;
  /** 由 VideoJsPlayer 从 spriteThumbnails 插件实例传入，按时间取缩略图 CSS */
  getThumbnailCssForTime?: (time: number) => ThumbnailCueCss | null;
}

export default function BookmarksTab({
  videoCode,
  player,
  onBookmarksChange,
  getThumbnailCssForTime,
}: BookmarksTabProps) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const rowHoverBg = useColorModeValue("blackAlpha.50", "whiteAlpha.100");
  const toast = useToast();
  const videoCodeRef = useRef(videoCode);

  videoCodeRef.current = videoCode;

  const syncToPlugin = useCallback(
    (list: Bookmark[]) => {
      onBookmarksChange(list);
    },
    [onBookmarksChange]
  );

  useEffect(() => {
    if (!videoCode) {
      setBookmarks([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchBookmarks(videoCode)
      .then((list) => {
        if (!cancelled && videoCodeRef.current === videoCode) {
          setBookmarks(list);
        }
      })
      .catch(() => {
        if (!cancelled && videoCodeRef.current === videoCode) {
          setBookmarks([]);
          toast({
            title: "加载书签失败",
            status: "error",
            duration: 4000,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [videoCode, toast]);

  useEffect(() => {
    syncToPlugin(bookmarks);
  }, [bookmarks, syncToPlugin]);

  const handleAddAtCurrent = async () => {
    if (!player || !videoCode) return;
    const time = player.currentTime();
    if (!Number.isFinite(time) || time < 0) return;
    setAdding(true);
    try {
      const added = await apiAddBookmark(videoCode, time, "新书签");
      setBookmarks((prev) => [...prev, added].sort((a, b) => a.time - b.time));
    } catch {
      toast({ title: "添加书签失败", status: "error", duration: 4000 });
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!videoCode) return;
    const prev = bookmarks;
    setBookmarks((p) => p.filter((b) => b.id !== id));
    try {
      await apiDeleteBookmark(videoCode, id);
    } catch {
      setBookmarks(prev);
      toast({ title: "删除书签失败", status: "error", duration: 4000 });
    }
  };

  const handleSeek = (time: number) => {
    player?.currentTime(time);
  };

  const startEdit = (bm: Bookmark) => {
    setEditingId(bm.id);
    setEditValue(bm.comment);
  };

  const saveEdit = async () => {
    if (editingId == null || !videoCode) return;
    const nextComment = editValue.trim() || "未命名书签";
    const idToSave = editingId;
    try {
      await apiUpdateBookmark(videoCode, idToSave, { comment: nextComment });
      setBookmarks((prev) =>
        prev.map((b) => (b.id === idToSave ? { ...b, comment: nextComment } : b))
      );
      setEditingId(null);
      setEditValue("");
    } catch {
      toast({ title: "保存注释失败", status: "error", duration: 4000 });
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue("");
  };

  const getThumbnailCss = useCallback(
    (time: number): ThumbnailCueCss | null => {
      return getThumbnailCssForTime?.(time) ?? null;
    },
    [getThumbnailCssForTime]
  );

  if (loading) {
    return (
      <Box py={8} display="flex" justifyContent="center">
        <Spinner size="sm" color="app.accent" />
      </Box>
    );
  }

  return (
    <VStack align="stretch" spacing={0}>
      <Button
        leftIcon={<FiPlus />}
        size="sm"
        colorScheme="orange"
        variant="outline"
        onClick={handleAddAtCurrent}
        isLoading={adding}
        isDisabled={!player}
        mb={3}
      >
        在当前时间添加书签
      </Button>

      <VStack align="stretch" spacing={0} divider={<Box h="1px" bg="app.border" />}>
        {bookmarks.length === 0 ? (
          <Text fontSize="sm" color="app.muted" py={4}>
            暂无书签
          </Text>
        ) : (
          bookmarks.map((bm) => (
            <Box
              key={bm.id}
              display="flex"
              alignItems="center"
              gap={3}
              py={2}
              px={2}
              borderRadius="md"
              _hover={{ bg: rowHoverBg }}
              cursor="pointer"
              onClick={() => !editingId && handleSeek(bm.time)}
            >
              <ThumbnailFrame cueCss={getThumbnailCss(bm.time)} />
              <Box flex={1} minW={0} onClick={(e) => e.stopPropagation()}>
                {editingId === bm.id ? (
                  <Input
                    size="sm"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={saveEdit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEdit();
                      if (e.key === "Escape") cancelEdit();
                    }}
                    autoFocus
                    placeholder="注释"
                    _focus={{ borderColor: "app.accent" }}
                  />
                ) : (
                  <Box
                    onClick={(e) => { e.stopPropagation(); startEdit(bm); }}
                    title={`${bm.comment}（点击编辑）`}
                  >
                    <Text fontSize="sm" noOfLines={1}>
                      {bm.comment}
                    </Text>
                    <Text fontSize="xs" color="app.muted">
                      {formatTime(bm.time)}
                    </Text>
                  </Box>
                )}
              </Box>
              <IconButton
                aria-label="删除书签"
                variant="ghost"
                size="xs"
                icon={<FiTrash2 />}
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(bm.id);
                }}
                _hover={{ color: "red.400" }}
              />
            </Box>
          ))
        )}
      </VStack>
    </VStack>
  );
}
