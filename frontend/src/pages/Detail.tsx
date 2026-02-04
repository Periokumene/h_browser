import {
  Badge,
  Box,
  Button,
  Heading,
  Stack,
  Text,
  useToast
} from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { apiClient } from "../api/client";

interface MediaDetail {
  code: string;
  title?: string;
  description?: string;
  video_type?: string;
  has_video: boolean;
}

export default function DetailPage() {
  const { code } = useParams<{ code: string }>();
  const [item, setItem] = useState<MediaDetail | null>(null);
  const toast = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    const load = async () => {
      try {
        const res = await apiClient.get(`/api/items/${code}`);
        setItem(res.data);
      } catch (err: any) {
        const msg = err?.response?.data?.error || "加载详情失败";
        toast({ title: msg, status: "error" });
      }
    };
    if (code) {
      load();
    }
  }, [code, toast]);

  if (!item) {
    return (
      <Box>
        <Text>正在加载...</Text>
      </Box>
    );
  }

  return (
    <Stack spacing={4}>
      <Heading size="lg">{item.title || item.code}</Heading>
      <Text fontSize="sm" color="gray.500">
        番号：{item.code}
      </Text>
      <Box>
        <Badge mr={2}>{item.has_video ? "有视频" : "无视频"}</Badge>
        {item.video_type && <Badge variant="outline">{item.video_type}</Badge>}
      </Box>
      {item.description && (
        <Text whiteSpace="pre-wrap" fontSize="sm" color="gray.200">
          {item.description}
        </Text>
      )}
      <Box>
        <Button
          colorScheme="teal"
          isDisabled={!item.has_video}
          onClick={() =>
            navigate(`/play/${encodeURIComponent(item.code)}`)
          }
        >
          播放
        </Button>
      </Box>
    </Stack>
  );
}

