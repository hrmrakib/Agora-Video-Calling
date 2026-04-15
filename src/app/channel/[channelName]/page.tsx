import VideoCall from "@/components/VideoCall";

interface ChannelPageProps {
  params: Promise<{ channelName: string }>;
}

export default async function ChannelPage({ params }: ChannelPageProps) {
  const { channelName } = await params;
  const decoded = decodeURIComponent(channelName);
  const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID ?? "";

  return <VideoCall channelName={decoded} appId={appId} />;
}
