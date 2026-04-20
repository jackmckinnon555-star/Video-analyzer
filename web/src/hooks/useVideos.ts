import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { Video } from "@shared/types/video";

export function useVideos() {
  const qc = useQueryClient();

  const query = useQuery<Video[]>({
    queryKey: ["videos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("videos")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Video[];
    },
  });

  useEffect(() => {
    const channel = supabase
      .channel("videos")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "videos" },
        () => qc.invalidateQueries({ queryKey: ["videos"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  return query;
}

export function useVideo(videoId: string | undefined) {
  const qc = useQueryClient();

  const query = useQuery<Video | null>({
    queryKey: ["video", videoId],
    enabled: !!videoId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("videos")
        .select("*")
        .eq("id", videoId!)
        .single();
      if (error) throw error;
      return (data ?? null) as Video | null;
    },
  });

  useEffect(() => {
    if (!videoId) return;
    const channel = supabase
      .channel(`video:${videoId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "videos", filter: `id=eq.${videoId}` },
        () => qc.invalidateQueries({ queryKey: ["video", videoId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [videoId, qc]);

  return query;
}
