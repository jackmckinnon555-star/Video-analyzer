import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type { Video } from "@shared/types/video";

export function useVideos() {
  const qc = useQueryClient();

  const query = useQuery<Video[]>({
    queryKey: ["videos"],
    queryFn: async () => {
      // Fetch everything, then hide children of multi-part uploads
      // client-side. We filter in JS rather than via `.is(parent_video_id,
      // null)` so the dashboard keeps working on databases that haven't
      // applied migration 0009 yet — PostgREST 400s on the WHERE clause
      // when the column doesn't exist, but `select("*")` is fine because
      // it expands server-side.
      const { data, error } = await supabase
        .from("videos")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as Video[];
      return rows.filter((v) => !v.parent_video_id);
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
