/**
 * VideoBrowser：在 VideoGallery 之上提供功能栏（过滤器、搜索、排序），
 * 并在指定演员时左侧展示 ActorInfo。
 */
import {
  Badge,
  Box,
  Button,
  Flex,
  Icon,
  Input,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
  Stack,
  Text,
} from "@chakra-ui/react";
import { useQuery } from "@tanstack/react-query";
import React, { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { FaClock, FaFilter, FaRandom, FaSortAlphaDown } from "react-icons/fa";
import { FiFilter } from "react-icons/fi";
import { fetchFilters } from "../api/calls";
import type { FilterRuleMode, ListFilters, ListScope, SortMode } from "../types/api";
import ActorInfo from "./ActorInfo";
import VideoGallery from "./VideoGallery";

export type { ListFilters };

function filtersFromSearchParams(searchParams: URLSearchParams): ListFilters {
  const genres = searchParams.getAll("genre").filter(Boolean);
  const tags = searchParams.getAll("tag").filter(Boolean);
  const filterMode = searchParams.get("filter_mode") === "or" ? "or" : "and";
  return { genres, tags, filterMode };
}

function searchParamsFromFilters(prev: URLSearchParams, filters: ListFilters): URLSearchParams {
  const next = new URLSearchParams(prev);
  next.delete("genre");
  next.delete("tag");
  filters.genres.forEach((g) => next.append("genre", g));
  filters.tags.forEach((t) => next.append("tag", t));
  next.set("filter_mode", filters.filterMode);
  return next;
}

function searchParamsWithSort(prev: URLSearchParams, sortMode: SortMode, seed: string): URLSearchParams {
  const next = new URLSearchParams(prev);
  next.set("sort_mode", sortMode);
  if (sortMode === "random") next.set("seed", seed);
  else next.delete("seed");
  return next;
}

export default function VideoBrowser() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  const scope: ListScope = searchParams.get("scope") === "favorites" ? "favorites" : "all";
  const search = searchParams.get("q") ?? "";
  const actor = searchParams.get("actor") || searchParams.get("actor_name") || null;
  const sortMode: SortMode =
    (searchParams.get("sort_mode") as SortMode) === "time" || searchParams.get("sort_mode") === "random"
      ? (searchParams.get("sort_mode") as SortMode)
      : "code";
  const seed = searchParams.get("seed") ?? String(Date.now());

  const filters = filtersFromSearchParams(searchParams);
  const setFilters = useCallback(
    (next: ListFilters | ((prev: ListFilters) => ListFilters)) => {
      setSearchParams((p) => {
        const prev = filtersFromSearchParams(p);
        const resolved = typeof next === "function" ? next(prev) : next;
        return searchParamsFromFilters(p, resolved);
      }, { replace: true });
    },
    [setSearchParams]
  );

  useEffect(() => {
    const initial = (location.state as { initialFilters?: ListFilters } | null)?.initialFilters;
    if (initial) {
      const nextParams = searchParamsFromFilters(searchParams, initial);
      navigate({ pathname: location.pathname, search: nextParams.toString() }, { replace: true, state: {} });
    }
  }, [location.state?.initialFilters]);

  const { data: filterOptions } = useQuery({
    queryKey: ["filters"],
    queryFn: fetchFilters,
  });

  const hasActiveFilters = filters.genres.length > 0 || filters.tags.length > 0;
  const activeGenreLabels = filters.genres.map((g) => `[${g}]`);
  const activeTagLabels = filters.tags.map((t) => `${t}`);
  const allFilterLabels = [...activeGenreLabels, ...activeTagLabels];
  const filterSummaryText =
    !hasActiveFilters
      ? null
      : allFilterLabels.length > 3
        ? `筛选：多个过滤项（${filters.filterMode === "and" ? "交集" : "并集"}）`
        : `筛选：${allFilterLabels.join("、")}（${filters.filterMode === "and" ? "交集" : "并集"}）`;

  const handleFilterChange = (next: ListFilters) => setFilters(next);
  const toggleGenre = (g: string) => {
    handleFilterChange({
      ...filters,
      genres: filters.genres.includes(g) ? filters.genres.filter((x) => x !== g) : [...filters.genres, g],
    });
  };
  const toggleTag = (t: string) => {
    handleFilterChange({
      ...filters,
      tags: filters.tags.includes(t) ? filters.tags.filter((x) => x !== t) : [...filters.tags, t],
    });
  };
  const setFilterMode = (mode: FilterRuleMode) => {
    handleFilterChange({ ...filters, filterMode: mode });
  };

  const [searchInput, setSearchInput] = useState(search);
  useEffect(() => {
    setSearchInput(search);
  }, [search]);
  const submitSearch = () => {
    const next = new URLSearchParams(searchParams);
    if (searchInput.trim()) next.set("q", searchInput.trim());
    else next.delete("q");
    setSearchParams(next, { replace: true });
  };

  const setSortMode = (mode: SortMode) => {
    const newSeed = mode === "random" ? String(Date.now()) : seed;
    setSearchParams((p) => searchParamsWithSort(p, mode, newSeed), { replace: true });
  };

  const sortModeLabels: Record<SortMode, string> = {
    code: "按编号",
    time: "按时间",
    random: "随机序",
  };

  const sortModeIcons: Record<SortMode, React.ElementType> = {
    code: FaSortAlphaDown,
    time: FaClock,
    random: FaRandom,
  };

  return (
    <Stack spacing={4}>
      <Flex align="center" gap={4} flexWrap="wrap">
        <Popover placement="bottom-start" closeOnBlur>
          <PopoverTrigger>
            <Button
              size="sm"
              variant={hasActiveFilters ? "solid" : "outline"}
              colorScheme={hasActiveFilters ? "orange" : undefined}
              aria-label={hasActiveFilters ? `过滤器（${filters.genres.length + filters.tags.length} 项）` : "过滤器"}
            >
              <Icon
                as={hasActiveFilters ? FaFilter : FiFilter}
                boxSize={4}
                aria-hidden
              />
            </Button>
          </PopoverTrigger>
          <PopoverContent w="auto" minW="280px" maxW="400px" _focus={{ outline: 0 }}>
            <PopoverBody>
              <Stack spacing={4}>
                <Flex align="center" justify="space-between" gap={2}>
                  <Flex align="center" gap={2}>
                    <Button
                      size="xs"
                      variant={filters.filterMode === "and" ? "solid" : "outline"}
                      colorScheme="orange"
                      onClick={() => setFilterMode("and")}
                    >
                      交集
                    </Button>
                    <Button
                      size="xs"
                      variant={filters.filterMode === "or" ? "solid" : "outline"}
                      colorScheme="orange"
                      onClick={() => setFilterMode("or")}
                    >
                      并集
                    </Button>
                  </Flex>
                  <Button
                    size="xs"
                    variant="ghost"
                    colorScheme="gray"
                    onClick={() => handleFilterChange({ genres: [], tags: [], filterMode: "and" })}
                  >
                    清空过滤器
                  </Button>
                </Flex>
                <Box>
                  <Text fontSize="xs" color="app.muted" mb={2}>
                    类型
                  </Text>
                  <Flex gap={2} flexWrap="wrap">
                    {(filterOptions?.genres?.length ?? 0) === 0 ? (
                      <Text fontSize="sm" color="app.muted">
                        暂无（请先扫描）
                      </Text>
                    ) : (
                      (filterOptions?.genres ?? []).map((g) => (
                        <Badge
                          key={g.name}
                          variant={filters.genres.includes(g.name) ? "solid" : "subtle"}
                          colorScheme="orange"
                          cursor="pointer"
                          onClick={() => toggleGenre(g.name)}
                          _hover={{ opacity: 0.9 }}
                        >
                          {g.name}
                          {g.count > 0 && (
                            <Text as="span" ml={1} opacity={0.8}>
                              ({g.count})
                            </Text>
                          )}
                        </Badge>
                      ))
                    )}
                  </Flex>
                </Box>
                <Box>
                  <Text fontSize="xs" color="app.muted" mb={2}>
                    标签
                  </Text>
                  <Flex gap={2} flexWrap="wrap">
                    {(filterOptions?.tags?.length ?? 0) === 0 ? (
                      <Text fontSize="sm" color="app.muted">
                        暂无（请先扫描）
                      </Text>
                    ) : (
                      (filterOptions?.tags ?? []).map((t) => (
                        <Badge
                          key={t.name}
                          variant={filters.tags.includes(t.name) ? "solid" : "outline"}
                          colorScheme="gray"
                          cursor="pointer"
                          onClick={() => toggleTag(t.name)}
                          _hover={{ opacity: 0.9 }}
                        >
                          {t.name}
                          {t.count > 0 && (
                            <Text as="span" ml={1} opacity={0.8}>
                              ({t.count})
                            </Text>
                          )}
                        </Badge>
                      ))
                    )}
                  </Flex>
                </Box>
              </Stack>
            </PopoverBody>
          </PopoverContent>
        </Popover>

        <Popover placement="bottom-start" closeOnBlur>
          <PopoverTrigger>
            <Button
              size="sm"
              variant="outline"
              aria-label={`排序：${sortModeLabels[sortMode]}`}
            >
              <Icon as={sortModeIcons[sortMode]} boxSize={4} aria-hidden />
            </Button>
          </PopoverTrigger>
          <PopoverContent w="auto" minW="160px" _focus={{ outline: 0 }}>
            <PopoverBody>
              <Stack spacing={2}>
                <Button
                  size="xs"
                  variant={sortMode === "code" ? "solid" : "outline"}
                  colorScheme="orange"
                  justifyContent="flex-start"
                  leftIcon={<Icon as={FaSortAlphaDown} boxSize={3.5} />}
                  onClick={() => setSortMode("code")}
                >
                  按编号
                </Button>
                <Button
                  size="xs"
                  variant={sortMode === "time" ? "solid" : "outline"}
                  colorScheme="orange"
                  justifyContent="flex-start"
                  leftIcon={<Icon as={FaClock} boxSize={3.5} />}
                  onClick={() => setSortMode("time")}
                >
                  按时间
                </Button>
                <Button
                  size="xs"
                  variant={sortMode === "random" ? "solid" : "outline"}
                  colorScheme="orange"
                  justifyContent="flex-start"
                  leftIcon={<Icon as={FaRandom} boxSize={3.5} />}
                  onClick={() => setSortMode("random")}
                >
                  随机序
                </Button>
              </Stack>
            </PopoverBody>
          </PopoverContent>
        </Popover>

        <Input
          placeholder="按编号或标题搜索（Enter 提交）"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitSearch();
          }}
          maxW="260px"
          size="sm"
        />
      </Flex>

      {filterSummaryText && (
        <Text fontSize="sm" color="app.muted.fg">
          {filterSummaryText}
        </Text>
      )}

      <Flex gap={0} align="flex-start" flexWrap="nowrap">
        {actor ? (
          <Box
            position="sticky"
            top={4}
            alignSelf="flex-start"
            flexShrink={0}
            h="calc(100vh - 2rem)"
            display="flex"
            flexDirection="column"
            minH={0}
          >
            <ActorInfo actorName={actor} />
          </Box>
        ) : null}
        <Box flex={1} minW={0}>
          <VideoGallery
            scope={scope}
            search={search}
            filters={filters}
            actor={actor ?? undefined}
            sortMode={sortMode}
            seed={sortMode === "random" ? seed : undefined}
          />
        </Box>
      </Flex>
    </Stack>
  );
}
