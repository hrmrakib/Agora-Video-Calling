"use client";

import { useEffect, useState } from "react";
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

  useEffect(() => {
    params.then(({ channelName }) => {
      setChannelName(decodeURIComponent(channelName));
    });
  }, [params]);

  const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID ?? "";

  if (!channelName) {
    return <div>Loading...</div>;
  }

  return <VideoCall channelName={channelName} appId={appId} />;
}
