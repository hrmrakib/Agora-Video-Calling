"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";

const VideoCall = dynamic(() => import("@/components/VideoCall"), {
  ssr: false,
  loading: () => (
    <div style={{ padding: "40px", textAlign: "center" }}>
      Loading video call...
    </div>
  ),
});

interface ChannelPageProps {
  params: Promise<{ channelName: string }>;
}

export default function ChannelPage({ params }: ChannelPageProps) {
  const [channelName, setChannelName] = useState<string | null>(null);
  const searchParams = useSearchParams();

  // Extract user profile from URL search params
  const displayName = searchParams.get("name") || "Guest";
  const avatarColor = searchParams.get("color") || "#6366f1";

  useEffect(() => {
    params.then(({ channelName }) => {
      setChannelName(decodeURIComponent(channelName));
    });
  }, [params]);

  const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID ?? "";

  if (!channelName) {
    return <div>Loading...</div>;
  }

  return (
    <VideoCall
      channelName={channelName}
      appId={appId}
      displayName={displayName}
      avatarColor={avatarColor}
    />
  );
}
