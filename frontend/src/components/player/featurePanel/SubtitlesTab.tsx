/**
 * 字幕 Tab：从后端拉取字幕列表（代理迅雷 API），罗列可选字幕，选中后通过 Video.js 原生 addRemoteTextTrack 切换。
 * 不再自动选择字幕：所有字幕选择与偏移调整均由用户手动完成，并实时同步到后端偏好表。
 * 后端负责 SRT → WebVTT 转换，前端仅使用 vttUrl 并在 TextTrack 层做偏移。
 */

import {
  Box,
  HStack,
  Button,
  Checkbox,
  Slider,
  SliderTrack,
  SliderFilledTrack,
  SliderThumb,
  Spinner,
  Stack,
  Text,
  useColorModeValue,
  useToast,
  Tooltip,
} from "@chakra-ui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { VideoJsPlayer } from "../types";
import {
  fetchSubtitles,
  fetchSubtitlePreference,
  saveSubtitlePreference,
  type SubtitleListItem,
} from "../../../api/calls";
import { getBaseUrl } from "../../../api/client";

interface SubtitlesTabProps {
  player: VideoJsPlayer | null;
  /** 编号，用于请求 /api/subtitles?name=code */
  videoCode: string;
}

const OFF_VALUE = "__off__";

/** 排序：score 降序，其次 duration 降序 */
function sortByPriority(items: SubtitleListItem[]): SubtitleListItem[] {
  return [...items].sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    return (b.duration || 0) - (a.duration || 0);
  });
}

/** duration 为毫秒，格式化为 分:秒 */
function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0:00";
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function buildTrackLabel(item: SubtitleListItem): string {
  const extra = (item.extra_name || "").trim();
  return extra ? `${item.name} ${extra}` : item.name;
}

export default function SubtitlesTab({ player, videoCode }: SubtitlesTabProps) {
  const [list, setList] = useState<SubtitleListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(OFF_VALUE);
  const currentTrackRef = useRef<TextTrack | null>(null);
  const appliedOffsetRef = useRef(0);
  const [offsetSeconds, setOffsetSeconds] = useState(0);
  const mutedColor = useColorModeValue("app.muted", "app.muted");
  const rowHoverBg = useColorModeValue("blackAlpha.50", "whiteAlpha.200");
  const toast = useToast();

  // 组件卸载时，确保当前 track 被关闭；Video.js 在 player.dispose() 时也会做一次清理。
  useEffect(() => {
    return () => {
      if (currentTrackRef.current) {
        currentTrackRef.current.mode = "disabled";
        currentTrackRef.current = null;
      }
    };
  }, []);

  // 通过「目标偏移 - 已应用偏移」计算 delta，避免对同一批 cue 反复累加偏移。
  const applyOffsetToCurrentTrack = useCallback(
    (targetOffset: number) => {
      const track = currentTrackRef.current;
      if (!track || !track.cues) {
        appliedOffsetRef.current = targetOffset;
        return;
      }
      const delta = targetOffset - appliedOffsetRef.current;
      if (!delta) return;
      for (let i = 0; i < track.cues.length; i += 1) {
        const cue = track.cues[i];
        // TextTrackCue / VTTCue 的时间单位为秒
        cue.startTime = Math.max(0, cue.startTime + delta);
        cue.endTime = Math.max(0, cue.endTime + delta);
      }
      appliedOffsetRef.current = targetOffset;
    },
    [],
  );

  // 对齐/预览下一句字幕：找「当前时间之后」起始时间最早的一条 cue，并基于它计算新的偏移。
  const getNextCuePreview = useCallback((): string => {
    if (!player || player.isDisposed()) return "播放器尚未就绪";
    const track = currentTrackRef.current;
    if (!track || !track.cues || track.cues.length === 0) return "暂无下一句字幕";
    const now = player.currentTime();
    let candidate: TextTrackCue | null = null;
    // TextTrackList 的访问方式与数组相似
    for (let i = 0; i < track.cues.length; i += 1) {
      const cue = track.cues[i];
      if (cue.startTime <= now) continue;
      if (!candidate || cue.startTime < candidate.startTime) {
        candidate = cue;
      }
    }
    if (!candidate) return "暂无下一句字幕";
    const text = (candidate as any).text ?? "";
    return text || "（该字幕无文本内容）";
  }, [player]);

  // 对齐/预览上一句字幕：找「当前时间之前」起始时间最大的一条 cue，并基于它计算新的偏移。
  const getPrevCuePreview = useCallback((): string => {
    if (!player || player.isDisposed()) return "播放器尚未就绪";
    const track = currentTrackRef.current;
    if (!track || !track.cues || track.cues.length === 0) return "暂无上一句字幕";
    const now = player.currentTime();
    let candidate: TextTrackCue | null = null;
    for (let i = 0; i < track.cues.length; i += 1) {
      const cue = track.cues[i];
      if (cue.endTime >= now) continue;
      if (!candidate || cue.startTime > candidate.startTime) {
        candidate = cue;
      }
    }
    if (!candidate) return "暂无上一句字幕";
    const text = (candidate as any).text ?? "";
    return text || "（该字幕无文本内容）";
  }, [player]);

  // 将「下一句字幕」的开始时间平移到当前播放时间，并据此更新全局 offset。
  const alignNextCueToCurrentTime = useCallback(() => {
    if (!player || player.isDisposed()) return;
    const track = currentTrackRef.current;
    if (!track || !track.cues || track.cues.length === 0) return;
    const now = player.currentTime();
    let candidate: TextTrackCue | null = null;
    for (let i = 0; i < track.cues.length; i += 1) {
      const cue = track.cues[i];
      if (cue.startTime <= now) continue;
      if (!candidate || cue.startTime < candidate.startTime) {
        candidate = cue;
      }
    }
    if (!candidate) {
      toast({
        title: "没有更多字幕",
        description: "当前时间点之后没有下一句字幕可对齐。",
        status: "info",
        duration: 2000,
        isClosable: true,
      });
      return;
    }
    const cueStart = candidate.startTime;
    const desired = now;
    const nextOffset = offsetSeconds + (desired - cueStart);
    setOffsetSeconds(nextOffset);
    if (videoCode.trim()) {
      const gcid = selectedId && selectedId !== OFF_VALUE ? selectedId : null;
      saveSubtitlePreference(videoCode, { gcid, offset_seconds: nextOffset }).catch(() => {});
      toast({
        title: "已对齐下一句字幕",
        description: `新的偏移：${nextOffset.toFixed(1)} 秒`,
        status: "success",
        duration: 2500,
        isClosable: true,
      });
    }
  }, [player, offsetSeconds, videoCode, selectedId, toast]);

  // 将「上一句字幕」的开始时间平移到当前播放时间，并据此更新全局 offset。
  const alignPrevCueToCurrentTime = useCallback(() => {
    if (!player || player.isDisposed()) return;
    const track = currentTrackRef.current;
    if (!track || !track.cues || track.cues.length === 0) return;
    const now = player.currentTime();
    let candidate: TextTrackCue | null = null;
    for (let i = 0; i < track.cues.length; i += 1) {
      const cue = track.cues[i];
      if (cue.endTime >= now) continue;
      if (!candidate || cue.startTime > candidate.startTime) {
        candidate = cue;
      }
    }
    if (!candidate) {
      toast({
        title: "没有更早的字幕",
        description: "当前时间点之前没有上一句字幕可对齐。",
        status: "info",
        duration: 2000,
        isClosable: true,
      });
      return;
    }
    const cueStart = candidate.startTime;
    const desired = now;
    const nextOffset = offsetSeconds + (desired - cueStart);
    setOffsetSeconds(nextOffset);
    if (videoCode.trim()) {
      const gcid = selectedId && selectedId !== OFF_VALUE ? selectedId : null;
      saveSubtitlePreference(videoCode, { gcid, offset_seconds: nextOffset }).catch(() => {});
      toast({
        title: "已对齐上一句字幕",
        description: `新的偏移：${nextOffset.toFixed(1)} 秒`,
        status: "success",
        duration: 2500,
        isClosable: true,
      });
    }
  }, [player, offsetSeconds, videoCode, selectedId, toast]);

  const attachTrackForItem = useCallback(
    (item: SubtitleListItem) => {
      if (!player || player.isDisposed()) return;
      const anyPlayer = player as VideoJsPlayer & {
        addRemoteTextTrack: (
          options: { kind: string; label: string; src: string; srclang?: string },
          manualCleanup?: boolean,
        ) => HTMLTrackElement | undefined;
      };

      if (currentTrackRef.current) {
        currentTrackRef.current.mode = "disabled";
        currentTrackRef.current = null;
      }

      const base = getBaseUrl().replace(/\/$/, "");
      const src = item.vttUrl.startsWith("http")
        ? item.vttUrl
        : `${base}${item.vttUrl.startsWith("/") ? "" : "/"}${item.vttUrl}`;
      const label = buildTrackLabel(item);
      const trackEl = anyPlayer.addRemoteTextTrack(
        { kind: "subtitles", label, src, srclang: item.languages?.[0] ?? "" },
        false,
      );
      if (trackEl?.track) {
        trackEl.track.mode = "showing";
        currentTrackRef.current = trackEl.track;
        appliedOffsetRef.current = 0;
        const apply = () => applyOffsetToCurrentTrack(offsetSeconds);
        const anyTrackEl = trackEl as unknown as { addEventListener?: (type: string, cb: () => void, opts?: any) => void; readyState?: number };
        if (anyTrackEl.addEventListener) {
          anyTrackEl.addEventListener("load", apply, { once: true });
        } else {
          apply();
        }
      }
    },
    [player, applyOffsetToCurrentTrack, offsetSeconds],
  );

  useEffect(() => {
    if (!videoCode.trim()) {
      setList([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchSubtitles(videoCode)
      .then((items) => {
        if (!cancelled) setList(sortByPriority(items));
      })
      .catch(() => {
        if (!cancelled) setList([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [videoCode]);

  // 加载后端字幕偏好设置（若存在），并提示已加载预设；不再自动选择默认字幕
  useEffect(() => {
    if (!videoCode.trim() || list.length === 0) return;
    let cancelled = false;
    fetchSubtitlePreference(videoCode)
      .then((pref) => {
        if (cancelled || !pref) return;
        if (typeof pref.offset_seconds === "number") {
          setOffsetSeconds(pref.offset_seconds);
        }
        if (pref.gcid === null) {
          setSelectedId(OFF_VALUE);
          toast({
            title: "已加载字幕预设",
            description: "当前设定为不使用字幕。",
            status: "info",
            duration: 2500,
            isClosable: true,
          });
          return;
        }
        const item = list.find((i) => i.gcid === pref.gcid);
        if (!item) {
          // 找不到对应字幕时，仅应用偏移，不做自动选择
          return;
        }
        setSelectedId(item.gcid);
        attachTrackForItem(item);
        toast({
          title: "已加载字幕预设",
          description: `已应用字幕：${item.name}`,
          status: "info",
          duration: 2500,
          isClosable: true,
        });
      })
      .catch(() => {
        // 忽略错误，保持自动选择逻辑
      });
    return () => {
      cancelled = true;
    };
  }, [videoCode, list, attachTrackForItem]);

  // 偏移量变化时，对当前字幕轨道的所有 cue 统一平移
  useEffect(() => {
    applyOffsetToCurrentTrack(offsetSeconds);
  }, [offsetSeconds, applyOffsetToCurrentTrack]);

  const handleSelect = useCallback(
    (value: string) => {
      if (!player || player.isDisposed()) return;

      setSelectedId(value);

      if (value === OFF_VALUE) {
        if (currentTrackRef.current) {
          currentTrackRef.current.mode = "disabled";
          currentTrackRef.current = null;
        }
        if (videoCode.trim()) {
          saveSubtitlePreference(videoCode, { gcid: null, offset_seconds: offsetSeconds }).catch(() => {});
          toast({
            title: "已设置字幕偏好",
            description: "当前编号将不再自动启用字幕。",
            status: "success",
            duration: 3000,
            isClosable: true,
          });
        }
        return;
      }

      const item = list.find((i) => i.gcid === value);
      if (!item?.vttUrl) return;

      attachTrackForItem(item);
      if (videoCode.trim()) {
        saveSubtitlePreference(videoCode, { gcid: item.gcid, offset_seconds: offsetSeconds }).catch(() => {});
        toast({
          title: "已设置字幕偏好",
          description: `将优先使用字幕：${item.name}`,
          status: "success",
          duration: 3000,
          isClosable: true,
        });
      }
    },
    [player, list, attachTrackForItem, videoCode, offsetSeconds, toast],
  );

  if (!player) {
    return (
      <Box py={4}>
        <Text fontSize="sm" color={mutedColor}>
          播放器尚未就绪，无法加载字幕。
        </Text>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box py={6} display="flex" justifyContent="center">
        <Spinner size="sm" color="app.accent" />
      </Box>
    );
  }

  if (list.length === 0) {
    return (
      <Box py={4}>
        <Text fontSize="sm" color={mutedColor}>
          未找到该编号的在线字幕；请确认编号正确或稍后重试。
        </Text>
      </Box>
    );
  }

  return (
    <Box py={2}>
      <Box mb={3}>
        <HStack spacing={2} mb={1} align="center" justify="space-between">
          <Text fontSize="sm" color={mutedColor}>
            字幕偏移（s）：
          </Text>
          <Text fontSize="xs" color={mutedColor}>
            {offsetSeconds.toFixed(1)}s
          </Text>
        </HStack>
        <Box position="relative" mt={1}>
          <Box
            position="absolute"
            left="50%"
            top={0}
            bottom={0}
            w="1px"
            bg="app.border"
            opacity={0.8}
            pointerEvents="none"
          />
          <Slider
            min={-20}
            max={20}
            step={0.5}
            value={offsetSeconds}
            colorScheme="orange"
            onChange={(v) => setOffsetSeconds(v)}
            onChangeEnd={(v) => {
              if (!videoCode.trim()) return;
              const gcid = selectedId && selectedId !== OFF_VALUE ? selectedId : null;
              saveSubtitlePreference(videoCode, { gcid, offset_seconds: v }).catch(() => {});
              toast({
                title: "已更新字幕偏移",
                description: `当前偏移：${v.toFixed(1)} 秒`,
                status: "success",
                duration: 2000,
                isClosable: true,
              });
            }}
          >
            <SliderTrack>
              <SliderFilledTrack />
            </SliderTrack>
            <SliderThumb />
          </Slider>
        </Box>
        <HStack mt={2} justify="space-between" spacing={2}>
          <Tooltip label={getPrevCuePreview()} hasArrow>
            <Button
              size="xs"
              variant="outline"
              colorScheme="orange"
              onClick={alignPrevCueToCurrentTime}
              isDisabled={!player || player.isDisposed()}
            >
              对齐上一句字幕
            </Button>
          </Tooltip>
          <Tooltip label={getNextCuePreview()} hasArrow>
            <Button
              size="xs"
              variant="outline"
              colorScheme="orange"
              onClick={alignNextCueToCurrentTime}
              isDisabled={!player || player.isDisposed()}
            >
              对齐下一句字幕
            </Button>
          </Tooltip>
        </HStack>
      </Box>
      <Text fontSize="sm" mb={2} color={mutedColor}>
        选择要显示的字幕：
      </Text>
      <Stack direction="column" spacing={3}>
        <Checkbox
          isChecked={selectedId === OFF_VALUE}
          onChange={() => handleSelect(OFF_VALUE)}
          size="sm"
          width="100%"
          display="flex"
          alignItems="center"
          px={2}
          py={2}
          borderRadius="md"
          _hover={{ bg: rowHoverBg }}
        >
          <Text fontSize="sm">关闭字幕</Text>
        </Checkbox>
        {list.map((item) => (
          <Checkbox
            key={item.gcid}
            isChecked={selectedId === item.gcid}
            onChange={() => handleSelect(item.gcid)}
            size="sm"
            width="100%"
            display="flex"
            alignItems="center"
            px={2}
            py={2}
            borderRadius="md"
            _hover={{ bg: rowHoverBg }}
          >
            <Box w="100%">
              <Text fontSize="sm" fontWeight="medium" noOfLines={1}>
                {item.name}
              </Text>
              <Text fontSize="xs" color={mutedColor}>
                {formatDurationMs(item.duration)} · score {item.score}
                {item.extra_name ? ` · ${item.extra_name}` : ""}
              </Text>
            </Box>
          </Checkbox>
        ))}
      </Stack>
    </Box>
  );
}
